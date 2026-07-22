// Orchestration: PDF/Fountain input → parsed screenplay → Fountain text →
// fountain-js tokens → XHTML chapters → EPUB bytes.
import { Fountain } from 'fountain-js';
import { extractDocument } from './parser/extract';
import { parseLines } from './parser/index';
import type { ParsedScreenplay } from './parser/types';
import { extractTitleMeta, toFountain, type TitleMeta } from './fountain/serialize';
import { tokensToChapters } from './epub/html';
import { buildEpub, type BookMeta } from './epub/build';

/** Below this many text lines per page, the PDF has no usable text layer. */
const MIN_LINES_PER_PAGE = 3;

export class ScannedPdfError extends Error {
  constructor(pages: number, lines: number) {
    super(
      `No usable text layer (${lines} text lines across ${pages} pages). ` +
        `This looks like a scanned/image-only PDF — run OCR on it first.`,
    );
    this.name = 'ScannedPdfError';
  }
}

export class NotAScreenplayError extends Error {
  constructor() {
    super(
      'No scene headings and no dialogue found — this does not look like a ' +
        'screenplay. Pass --force to convert it anyway.',
    );
    this.name = 'NotAScreenplayError';
  }
}

export interface ConvertOptions {
  title?: string;
  author?: string;
  /** convert even when the document doesn't look like a screenplay */
  force?: boolean;
}

export interface ConvertResult {
  epub: Uint8Array;
  fountainText: string;
  screenplay: ParsedScreenplay | null;
  meta: BookMeta;
  warnings: string[];
}

function resolveMeta(detected: TitleMeta, opts: ConvertOptions): BookMeta {
  return {
    title: opts.title ?? detected.title ?? 'Untitled Screenplay',
    author: opts.author ?? detected.author,
  };
}

function renderEpub(fountainText: string, meta: BookMeta) {
  const { tokens } = new Fountain().parse(fountainText, true);
  const chapters = tokensToChapters(tokens);
  return buildEpub(meta, chapters);
}

/** Full pipeline for a screenplay PDF. */
export async function convertPdf(
  pdfBytes: Uint8Array,
  opts: ConvertOptions = {},
): Promise<ConvertResult> {
  const warnings: string[] = [];

  const { lines, pageCount } = await extractDocument(pdfBytes);
  if (lines.length < pageCount * MIN_LINES_PER_PAGE) {
    throw new ScannedPdfError(pageCount, lines.length);
  }

  const screenplay = parseLines(lines);
  const sceneCount = screenplay.scenes.length;
  const dialogueCount = screenplay.elements.filter((e) => e.type === 'dialogue').length;
  if (sceneCount === 0 && dialogueCount === 0 && !opts.force) {
    throw new NotAScreenplayError();
  }
  if (sceneCount === 0) {
    warnings.push('No scene headings detected — the EPUB will have no scene navigation.');
  }

  const meta = resolveMeta(extractTitleMeta(screenplay.elements), opts);
  const fountainText = toFountain(screenplay, { title: meta.title, author: meta.author });
  const epub = await renderEpub(fountainText, meta);

  return { epub, fountainText, screenplay, meta, warnings };
}

/** Pipeline for Fountain text input (stage 1 skipped). */
export async function convertFountain(
  fountainText: string,
  opts: ConvertOptions = {},
): Promise<ConvertResult> {
  const { tokens } = new Fountain().parse(fountainText, true);
  const detected: TitleMeta = {
    title: tokens.find((t) => t.type === 'title')?.text?.replace(/<[^>]+>/g, ''),
    author: tokens.find((t) => t.type === 'author' || t.type === 'authors')?.text,
  };
  const meta = resolveMeta(detected, opts);
  const epub = await buildEpub(meta, tokensToChapters(tokens));

  return { epub, fountainText, screenplay: null, meta, warnings: [] };
}
