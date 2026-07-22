// fountain-js tokens → XHTML body files. Scenes flow continuously as
// anchored <section>s inside one file — a spine boundary forces a page break
// in every reader, so files split only when a size budget is exceeded.
import type { Token } from 'fountain-js';

export interface BodyFile {
  /** filename-safe id, e.g. "body001" */
  id: string;
  /** complete XHTML document */
  xhtml: string;
}

export interface TocEntry {
  title: string;
  /** href relative to OEBPS/, e.g. "text/body001.xhtml#sc-001" */
  href: string;
}

export interface BookBody {
  files: BodyFile[];
  toc: TocEntry[];
}

/** Keep each body file comfortably under Kindle's per-flow size warnings. */
const DEFAULT_MAX_FILE_BYTES = 250_000;

export function escapeXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function xhtmlDoc(title: string, body: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops">
<head>
<title>${escapeXml(title)}</title>
<link rel="stylesheet" type="text/css" href="../style.css"/>
</head>
<body>
${body}</body>
</html>
`;
}

/**
 * Render body tokens (no title-page tokens) as discrete blocks — one string
 * per paragraph, with a complete dialogue block as a single string. Discrete
 * blocks let the section assembler wrap heading + first block together.
 */
function renderBlocks(tokens: Token[]): string[] {
  const blocks: string[] = [];
  let dialogue: string[] | null = null;
  const emit = (s: string) => {
    if (dialogue) dialogue.push(s);
    else blocks.push(s);
  };

  for (const t of tokens) {
    const text = t.text ?? '';
    switch (t.type) {
      case 'scene_heading':
        emit(`<h2 class="scene-heading">${escapeXml(text)}</h2>\n`);
        break;
      case 'action':
        emit(`<p class="action">${escapeXml(text)}</p>\n`);
        break;
      case 'dialogue_begin':
        dialogue = ['<div class="dialogue-block">\n'];
        break;
      case 'dialogue_end':
        if (dialogue) {
          dialogue.push('</div>\n');
          blocks.push(dialogue.join(''));
          dialogue = null;
        }
        break;
      case 'character':
        emit(`<p class="character">${escapeXml(text)}</p>\n`);
        break;
      case 'parenthetical':
        emit(`<p class="parenthetical">${escapeXml(text)}</p>\n`);
        break;
      case 'dialogue':
        emit(`<p class="dialogue">${escapeXml(text)}</p>\n`);
        break;
      case 'transition':
        emit(`<p class="transition">${escapeXml(text.replace(/^>\s*/, ''))}</p>\n`);
        break;
      case 'centered':
        emit(`<p class="centered">${escapeXml(text)}</p>\n`);
        break;
      case 'lyrics':
        emit(`<p class="action">${escapeXml(text)}</p>\n`);
        break;
      default:
        // structural/no-render tokens: title page, page breaks, notes, etc.
        break;
    }
  }
  if (dialogue) blocks.push(dialogue.join('') + '</div>\n');
  return blocks;
}

/**
 * A scene's heading and its first block share an unbreakable wrapper so a
 * slugline never strands at a page bottom — the pair moves to the next page
 * together. `page-break-inside: avoid` on a container is the form Amazon
 * documents for exactly this ("headlines with paragraphs to keep together").
 */
function renderScene(tokens: Token[], startsWithHeading: boolean): string {
  const blocks = renderBlocks(tokens);
  if (!startsWithHeading || blocks.length === 0) return blocks.join('');
  const kept = blocks.slice(0, 2).join('');
  const rest = blocks.slice(2).join('');
  return `<div class="keep-together">\n${kept}</div>\n${rest}`;
}

interface SceneSection {
  anchor: string;
  title: string;
  html: string;
}

/**
 * Split body tokens into anchored scene sections, then pack sections into
 * as few files as the size budget allows. Content before the first scene
 * heading becomes an "Opening" section.
 */
export function tokensToBody(
  tokens: Token[],
  opts: { maxFileBytes?: number } = {},
): BookBody {
  const maxBytes = opts.maxFileBytes ?? DEFAULT_MAX_FILE_BYTES;
  const body = tokens.filter((t) => !t.is_title);

  const groups: { title: string; tokens: Token[] }[] = [];
  let current: { title: string; tokens: Token[] } | null = null;

  for (const t of body) {
    if (t.type === 'scene_heading') {
      current = { title: t.text ?? 'Scene', tokens: [t] };
      groups.push(current);
    } else {
      if (!current) {
        current = { title: 'Opening', tokens: [] };
        groups.push(current);
      }
      current.tokens.push(t);
    }
  }

  const sections: SceneSection[] = groups.map((g, i) => {
    const anchor = `sc-${String(i + 1).padStart(3, '0')}`;
    const startsWithHeading = g.tokens[0]?.type === 'scene_heading';
    return {
      anchor,
      title: g.title,
      html: `<section class="scene" id="${anchor}">\n${renderScene(g.tokens, startsWithHeading)}</section>\n`,
    };
  });

  // Pack sections into files, starting a new file only when the budget
  // would be exceeded (a file always holds at least one section).
  const files: BodyFile[] = [];
  const toc: TocEntry[] = [];
  let pending: SceneSection[] = [];
  let pendingBytes = 0;

  const flush = () => {
    if (pending.length === 0) return;
    const id = `body${String(files.length + 1).padStart(3, '0')}`;
    for (const s of pending) toc.push({ title: s.title, href: `text/${id}.xhtml#${s.anchor}` });
    files.push({ id, xhtml: xhtmlDoc(pending[0].title, pending.map((s) => s.html).join('')) });
    pending = [];
    pendingBytes = 0;
  };

  for (const s of sections) {
    const size = Buffer.byteLength(s.html, 'utf8');
    if (pending.length > 0 && pendingBytes + size > maxBytes) flush();
    pending.push(s);
    pendingBytes += size;
  }
  flush();

  return { files, toc };
}
