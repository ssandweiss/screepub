#!/usr/bin/env bun
// screepub — screenplay PDF → Fountain → reflowable EPUB3.
import { parseArgs } from 'node:util';
import { basename, dirname, extname, join } from 'node:path';
import { readFile, writeFile, rename } from 'node:fs/promises';
// Inlined by `bun build --compile`, so the shipped binary reports the same
// version as the tag that built it. release.sh checks the two agree.
import pkg from '../package.json' with { type: 'json' };
import {
  convertPdf,
  convertFountain,
  ScannedPdfError,
  NotAScreenplayError,
  type ConvertResult,
} from './convert';
import { mapConversionError, type JsonError } from './cli-errors';

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
  --debug                also dump classified elements, and let pdf.js's
                         internal warnings through to stderr
  -h, --help             show this help
      --version          print the version and exit
`;

// --json is the app's only channel: EVERY exit in that mode must be one
// parseable JSON object on stdout. jsonMode is therefore pre-scanned from
// raw argv — parseArgs itself can throw (unknown flag) before it would
// have told us the mode.
let jsonMode = process.argv.includes('--json');

/// Write to a temp file then rename into place, so a reader (e.g. the app's
/// reader window mid-render) never observes a partially-written output.
async function writeFileAtomic(
  path: string,
  data: Uint8Array | string,
  enc?: BufferEncoding,
): Promise<void> {
  const tmp = join(dirname(path), `.${basename(path)}.${process.pid}.tmp`);
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

function parseCliArgs() {
  return parseArgs({
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
      version: { type: 'boolean', default: false },
    },
  });
}

async function main() {
  let parsed: ReturnType<typeof parseCliArgs>;
  try {
    parsed = parseCliArgs();
  } catch (err) {
    fail({ code: 'usage', message: (err as Error).message });
  }
  const { values, positionals } = parsed;
  jsonMode = values.json;

  if (values.version) {
    console.log(`screepub ${pkg.version}`);
    process.exit(0);
  }
  if (values.help) {
    console.log(USAGE);
    process.exit(0);
  }
  if (positionals.length === 0) {
    if (jsonMode) {
      fail({ code: 'usage', message: 'expected exactly one input file (see --help)' });
    }
    console.log(USAGE);
    process.exit(1);
  }
  if (positionals.length > 1) {
    fail({ code: 'usage', message: 'expected exactly one input file' });
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
    } catch {
      // Its own code: "your options file is bad" and "the engine crashed"
      // demand different reactions from the caller, and the raw error
      // would leak a temp path into a user-facing message.
      fail({ code: 'bad-options', message: `cannot read options file ${values.options}` });
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
    const mapped = mapConversionError(err);
    if (mapped) fail(mapped);
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

// The last line of defense for the app contract: an error nobody
// anticipated (disk full, a pdf.js internal, an OOM-adjacent throw) must
// still come out as JSON on stdout, or the app surfaces a stack trace.
try {
  await main();
} catch (err) {
  if (jsonMode) {
    console.log(JSON.stringify({
      ok: false,
      error: { code: 'internal', message: String(err) },
    }));
  } else {
    console.error(err);
  }
  process.exit(1);
}
