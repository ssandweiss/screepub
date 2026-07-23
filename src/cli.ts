#!/usr/bin/env bun
// screepub — screenplay PDF → Fountain → reflowable EPUB3.
import { parseArgs } from 'node:util';
import { basename, dirname, extname, join } from 'node:path';
import { readFile, writeFile, rename } from 'node:fs/promises';
import {
  convertPdf,
  convertFountain,
  ScannedPdfError,
  NotAScreenplayError,
  type ConvertResult,
} from './convert';

const USAGE = `screepub — screenplay PDF → reflowable EPUB3 (via Fountain)

Usage:
  screepub <input.pdf | input.fountain> [options]

Options:
  -o, --output <file>    EPUB output path (default: <input>.epub)
  --fountain <file>      Fountain output path (default: <input>.fountain for PDF input)
  --no-fountain          skip writing the intermediate .fountain file
  --title <text>         override detected title
  --author <text>        override detected author
  --force                convert even if it doesn't look like a screenplay
  --mobi                 also write a .mobi (for USB sideload to Kindle)
  --preview-html <file>  also write the script as one self-contained HTML file
  --options <file.json>  formatting options (see docs/formatting-options-log.md)
  --json                 machine-readable result on stdout (for the app)
  --debug                also dump classified elements to <input>.elements.json
  -h, --help             show this help
`;

interface JsonError {
  code: 'scanned' | 'not-screenplay' | 'unreadable' | 'password' | 'unsupported-type' | 'internal';
  message: string;
}

let jsonMode = false;

/// Write to a temp file then rename into place, so a reader (e.g. the app's
/// reader window mid-render) never observes a partially-written output.
async function writeFileAtomic(
  path: string,
  data: Uint8Array | string,
  enc?: BufferEncoding,
): Promise<void> {
  const tmp = `${path}.${process.pid}.tmp`;
  await writeFile(tmp, data, enc);
  await rename(tmp, path);
}

function fail(error: JsonError): never {
  if (jsonMode) {
    console.log(JSON.stringify({ ok: false, error }));
  } else {
    console.error(`screepub: ${error.message}`);
  }
  process.exit(1);
}

async function main() {
  const { values, positionals } = parseArgs({
    args: process.argv.slice(2),
    allowPositionals: true,
    options: {
      output: { type: 'string', short: 'o' },
      fountain: { type: 'string' },
      'no-fountain': { type: 'boolean', default: false },
      title: { type: 'string' },
      author: { type: 'string' },
      force: { type: 'boolean', default: false },
      mobi: { type: 'boolean', default: false },
      'preview-html': { type: 'string' },
      options: { type: 'string' },
      json: { type: 'boolean', default: false },
      debug: { type: 'boolean', default: false },
      help: { type: 'boolean', short: 'h', default: false },
    },
  });
  jsonMode = values.json;

  if (values.help || positionals.length === 0) {
    console.log(USAGE);
    process.exit(values.help ? 0 : 1);
  }
  if (positionals.length > 1) {
    fail({ code: 'internal', message: 'expected exactly one input file' });
  }

  const input = positionals[0];
  const ext = extname(input).toLowerCase();
  const inputStem = join(dirname(input), basename(input, extname(input)));
  const epubPath = values.output ?? `${inputStem}.epub`;
  // Companion outputs (.mobi/.fountain/.elements.json) follow the EPUB, so
  // -o into a library folder keeps everything together.
  const stem = join(dirname(epubPath), basename(epubPath, extname(epubPath)));

  let format: Record<string, unknown> | undefined;
  if (values.options) {
    try {
      format = JSON.parse(await readFile(values.options, 'utf8'));
    } catch (err) {
      fail({ code: 'internal', message: `cannot read options file ${values.options}: ${err}` });
    }
  }

  const opts = { title: values.title, author: values.author, force: values.force, mobi: values.mobi, format };

  let result: ConvertResult;
  const isPdf = ext === '.pdf';
  try {
    if (isPdf) {
      result = await convertPdf(new Uint8Array(await readFile(input)), opts);
    } else if (ext === '.fountain' || ext === '.txt') {
      result = await convertFountain(await readFile(input, 'utf8'), opts);
    } else {
      fail({
        code: 'unsupported-type',
        message: `unsupported input type "${ext}" — expected .pdf, .fountain, or .txt`,
      });
    }
  } catch (err) {
    if (err instanceof ScannedPdfError) {
      fail({ code: 'scanned', message: err.message });
    }
    if (err instanceof NotAScreenplayError) {
      fail({ code: 'not-screenplay', message: err.message });
    }
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      fail({ code: 'unreadable', message: `cannot read ${input}` });
    }
    if (String(err).includes('password')) {
      fail({ code: 'password', message: 'this PDF is password-protected — remove the password first' });
    }
    throw err;
  }

  await writeFileAtomic(epubPath, result.epub);

  let mobiPath: string | undefined;
  if (values.mobi && result.mobi) {
    mobiPath = `${stem}.mobi`;
    await writeFileAtomic(mobiPath, result.mobi);
  }

  let fountainPath: string | undefined;
  if (isPdf && !values['no-fountain']) {
    fountainPath = values.fountain ?? `${stem}.fountain`;
    await writeFileAtomic(fountainPath, result.fountainText, 'utf8');
  }
  let previewPath: string | undefined;
  if (values['preview-html']) {
    previewPath = values['preview-html'];
    await writeFileAtomic(previewPath, result.previewHtml, 'utf8');
  }
  let debugPath: string | undefined;
  if (values.debug && result.screenplay) {
    debugPath = `${stem}.elements.json`;
    await writeFile(debugPath, JSON.stringify(result.screenplay, null, 2), 'utf8');
  }

  const sp = result.screenplay;
  if (jsonMode) {
    console.log(
      JSON.stringify({
        ok: true,
        title: result.meta.title,
        author: result.meta.author,
        pages: sp?.pageCount,
        scenes: sp?.scenes.length,
        characters: sp?.characters.length,
        topCharacters: sp?.characters.slice(0, 5).map((c) => c.name) ?? [],
        warnings: result.warnings,
        epubPath,
        mobiPath,
        fountainPath,
        previewHtmlPath: previewPath,
        debugPath,
      }),
    );
    return;
  }

  console.log(`${result.meta.title}${result.meta.author ? ` — ${result.meta.author}` : ''}`);
  if (sp) {
    const top = sp.characters
      .slice(0, 5)
      .map((c) => c.name)
      .join(', ');
    console.log(
      `  ${sp.pageCount} pages · ${sp.scenes.length} scenes · ` +
        `${sp.characters.length} speaking characters${top ? ` (${top}…)` : ''}`,
    );
  }
  for (const w of result.warnings) console.log(`  warning: ${w}`);
  for (const f of [epubPath, mobiPath, fountainPath, previewPath, debugPath]) {
    if (f) console.log(`  wrote ${f}`);
  }
}

await main();
