#!/usr/bin/env bun
// screepub — screenplay PDF → Fountain → reflowable EPUB3.
import { parseArgs } from 'node:util';
import { basename, delimiter, dirname, extname, join } from 'node:path';
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
  type ConvertStage,
} from './convert';
import { mapConversionError, CliError, type JsonError } from './cli-errors';
import { resolveCommand, devicesCommand, sendCommand, type Verb } from './cli-devices';
import type { ListDevicesOptions } from './device/list';

const USAGE = `screepub — screenplay PDF → reflowable EPUB3 (via Fountain)

Usage:
  screepub <input.pdf | input.fountain> [options]

PDF is the primary path. .fountain input is PARTIALLY SUPPORTED: contdMode
and rejoinSplitDialogue are applied when a PDF is read, so they do not take
effect here (asking to strip (CONT'D) warns rather than failing silently),
and the scanned-PDF and not-a-screenplay guards are PDF-only. See the
README's "Fountain input" section.

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
  --progress             emit NDJSON progress to STDERR while converting
  --debug                also dump classified elements, and let pdf.js's
                         internal warnings through to stderr
  -h, --help             show this help
      --version          print the version and exit

Commands:
  screepub devices [--json]                 list connected e-readers
  screepub send <file> [--device <id>] [--json]
                                            send an existing file to one

A verb is only a verb when no file of that name exists: a script saved as
"devices" still converts, and "./devices" always means the file.
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

function showHelp(): never {
  if (jsonMode) {
    console.log(JSON.stringify({ ok: true, usage: USAGE }));
  } else {
    console.log(USAGE);
  }
  process.exit(0);
}

function showVersion(): never {
  if (jsonMode) {
    console.log(JSON.stringify({ ok: true, version: pkg.version }));
  } else {
    console.log(`screepub ${pkg.version}`);
  }
  process.exit(0);
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
      progress: { type: 'boolean', default: false },
      debug: { type: 'boolean', default: false },
      help: { type: 'boolean', short: 'h', default: false },
      version: { type: 'boolean', default: false },
    },
  });
}

/** Test seams, and a debugging hook for the Tauri shell: the mount roots to
 * scan and the reMarkable base URL. Read ONLY by the device commands — the
 * conversion path does not consult them. Unset means "the real thing". */
function deviceSeams(): ListDevicesOptions {
  const roots = process.env.SCREEPUB_VOLUME_ROOTS;
  const endpoint = process.env.SCREEPUB_REMARKABLE_ENDPOINT;
  return {
    roots: roots ? roots.split(delimiter).filter(Boolean) : undefined,
    remarkableEndpoint: endpoint || undefined,
  };
}

function parseVerbArgs(args: string[]) {
  return parseArgs({
    args,
    allowPositionals: true,
    options: {
      device: { type: 'string' },
      json: { type: 'boolean', default: false },
      help: { type: 'boolean', short: 'h', default: false },
    },
  });
}

async function runVerb(verb: Verb, args: string[]): Promise<void> {
  let parsed: ReturnType<typeof parseVerbArgs>;
  try {
    parsed = parseVerbArgs(args);
  } catch (err) {
    fail({ code: 'usage', message: (err as Error).message });
  }
  const { values, positionals } = parsed;
  jsonMode = values.json;

  if (values.help) {
    showHelp();
  }

  try {
    if (verb === 'devices') {
      if (positionals.length > 0) {
        fail({ code: 'usage', message: `devices takes no arguments (got "${positionals[0]}")` });
      }
      const { devices } = await devicesCommand(deviceSeams());
      if (jsonMode) {
        console.log(JSON.stringify({ ok: true, devices }));
        return;
      }
      if (devices.length === 0) {
        console.log('no devices connected');
        return;
      }
      for (const d of devices) console.log(`${d.name} (${d.kind}) — ${d.id}`);
      return;
    }

    // verb === 'send'
    if (positionals.length !== 1) {
      fail({ code: 'usage', message: 'expected exactly one file to send (see --help)' });
    }
    const sent = await sendCommand({
      file: positionals[0],
      deviceId: values.device,
      ...deviceSeams(),
    });
    if (jsonMode) {
      // `destination` is OMITTED for reMarkable, which has no path; `uploaded`
      // takes its place. Two shapes, one object, per the design spec.
      console.log(
        JSON.stringify({
          ok: true,
          device: sent.device,
          ...(sent.destination !== undefined ? { destination: sent.destination } : { uploaded: true }),
        }),
      );
      return;
    }
    console.log(
      sent.destination !== undefined
        ? `sent ${basename(positionals[0])} to ${sent.device.name} — ${sent.destination}`
        : `sent ${basename(positionals[0])} to ${sent.device.name}`,
    );
  } catch (err) {
    if (err instanceof CliError) fail(err.toJson());
    throw err;
  }
}

async function main() {
  // Dispatch BEFORE parseArgs: a verb's flags are not the conversion flags.
  // jsonMode's raw-argv pre-scan above already holds for this path, so a
  // throw inside the verb parser still exits as one JSON object.
  const command = resolveCommand(process.argv.slice(2));
  if (command.kind === 'verb') {
    await runVerb(command.verb, command.args);
    return;
  }

  let parsed: ReturnType<typeof parseCliArgs>;
  try {
    parsed = parseCliArgs();
  } catch (err) {
    fail({ code: 'usage', message: (err as Error).message });
  }
  const { values, positionals } = parsed;
  jsonMode = values.json;

  if (values.version) {
    showVersion();
  }
  if (values.help) {
    showHelp();
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

  // Progress goes to STDERR, never stdout. --json's contract is that stdout
  // is exactly one parseable object, and the app decodes it as such; a
  // progress line on stdout would corrupt every conversion the app runs.
  // Ticks are throttled to whole percents so a 300-page script emits ~100
  // lines rather than one per page per stage.
  let lastPercent = -1;
  const onProgress = values.progress
    ? (stage: ConvertStage, fraction: number) => {
        const percent = Math.round(fraction * 100);
        if (percent === lastPercent) return;
        lastPercent = percent;
        process.stderr.write(`${JSON.stringify({ progress: { stage, percent } })}\n`);
      }
    : undefined;

  const opts = { title: values.title, author: values.author, force: values.force, mobi: values.mobi, format, onProgress };

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
