#!/usr/bin/env bun
// screepub — screenplay PDF → Fountain → reflowable EPUB3.
import { parseArgs } from 'node:util';
import { existsSync } from 'node:fs';
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
import { mapConversionError, CliError, errorMessage, type JsonError } from './cli-errors';
import { resolveCommand, devicesCommand, sendCommand, VERBS, type Verb } from './cli-devices';
import { settingsCommand } from './cli-settings';
import { exportCommand } from './cli-export';
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
  --preview-inline       put that same HTML in the --json result (for the app)
  --options <file.json>  formatting options (see docs/formatting-options-log.md)
  --options-json <json>  the same options as one JSON argument (for the app)
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
  screepub settings <file.fountain> [--set <json>] [--json]
                                            read/write a script's own settings
  screepub export <file.epub> [--for kindle|epub] [--json]
                                            the file you would put on a reader

A verb is only a verb when no file of that name exists: a script saved as
"devices" still converts, and "./devices" always means the file.
Each verb has its own --help.
`;

// A verb's --help must advertise the verb's OWN flags. parseVerbArgs accepts
// --device, --json and -h and nothing else; printing the conversion usage here
// offered -o, --mobi, --options and --progress, every one of which the verb
// parser rejects as an unknown flag.
const DEVICES_USAGE = `screepub devices — list every connected e-reader

Usage:
  screepub devices [--json]

Lists USB-mounted Kindle, Kobo and tolino volumes, plus a docked reMarkable if
its USB web interface answers. Nothing connected is an empty list, not an error.

Options:
  --json                 machine-readable result on stdout (for the app)
  -h, --help             show this help
`;

const SEND_USAGE = `screepub send — send an existing file to a connected reader

Usage:
  screepub send <file> [--device <id>] [--json]

send never converts: convert first, then send the output. A reMarkable accepts
only PDF and EPUB.

Options:
  --device <id>          which reader, as the id \`screepub devices\` prints.
                         Optional with exactly one connected; required with
                         several
  --json                 machine-readable result on stdout (for the app)
  -h, --help             show this help
`;

const SETTINGS_USAGE = `screepub settings — this script's own formatting

Usage:
  screepub settings <file.fountain> [--set <json>] [--json]

Reads the settings stored beside the script (<Stem>.screepub.json). --set
overlays a partial JSON object on what is there and saves it; knobs you do
not mention keep their values.

Options:
  --set <json>           a partial FormatOptions object to overlay and save
  --json                 machine-readable result on stdout (for the app)
  -h, --help             show this help
`;

const EXPORT_USAGE = `screepub export — the file you would put on a reader

Usage:
  screepub export <file.epub> [--for kindle|epub] [--fountain <f>] [--json]

export never sends: it produces (or reuses) the right file, and
\`screepub send\` moves it. Kindle climbs KFX → AZW3 → MOBI, taking the best
rung this machine can reach.

Options:
  --for <kindle|epub>    which file you want (default epub)
  --fountain <file>      the script's .fountain, needed to rebuild a MOBI
  --options-json <json>  this script's settings, so a rebuild keeps them
  --json                 machine-readable result on stdout (for the app)
  -h, --help             show this help
`;

function verbUsage(verb: Verb): string {
  if (verb === 'devices') return DEVICES_USAGE;
  if (verb === 'settings') return SETTINGS_USAGE;
  if (verb === 'export') return EXPORT_USAGE;
  return SEND_USAGE;
}

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

function showHelp(usage: string = USAGE): never {
  if (jsonMode) {
    console.log(JSON.stringify({ ok: true, usage }));
  } else {
    console.log(usage);
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

/** The one thing that fixes `screepub --json devices`.
 *
 * resolveCommand looks at argv[0] and nothing else, deliberately and
 * permanently: a verb found after a flag is indistinguishable from that flag's
 * value (`--title send`). So flag-before-verb — how a shell alias or a spawn
 * wrapper commonly builds argv — reaches the CONVERSION path and used to die
 * on `unsupported input type ""`, which names neither the cause nor the cure.
 * Message-only: dispatch is untouched.
 *
 * The hint is withheld when a file of that name exists, because then the user
 * really did mean the file — that is the shadowing rule, and telling them to
 * run the verb instead would be wrong. */
function verbHint(input: string): string {
  if (extname(input) !== '') return '';
  if (!(VERBS as readonly string[]).includes(input)) return '';
  if (existsSync(input)) return '';
  return ` — did you mean \`screepub ${input}\`? the verb must come first`;
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
      'preview-inline': { type: 'boolean', default: false },
      options: { type: 'string' },
      'options-json': { type: 'string' },
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
      set: { type: 'string' },
      for: { type: 'string' },
      fountain: { type: 'string' },
      'options-json': { type: 'string' },
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
    fail({ code: 'usage', message: errorMessage(err) });
  }
  const { values, positionals } = parsed;
  jsonMode = values.json;

  if (values.help) {
    showHelp(verbUsage(verb));
  }

  try {
    if (verb === 'devices') {
      // Rejected rather than ignored, for the same reason `devices extra` is:
      // silently accepting a flag the command cannot act on teaches the user
      // it did something. --device belongs to send.
      if (values.device !== undefined) {
        fail({ code: 'usage', message: 'devices takes no --device — it lists every reader (--device belongs to send)' });
      }
      if (values.set !== undefined) {
        fail({ code: 'usage', message: 'devices takes no --set (--set belongs to settings)' });
      }
      if (values.for !== undefined) {
        fail({ code: 'usage', message: 'devices takes no --for (--for belongs to export)' });
      }
      if (values.fountain !== undefined) {
        fail({ code: 'usage', message: 'devices takes no --fountain (--fountain belongs to export)' });
      }
      if (values['options-json'] !== undefined) {
        fail({ code: 'usage', message: 'devices takes no --options-json (--options-json belongs to export)' });
      }
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

    if (verb === 'settings') {
      if (positionals.length !== 1) {
        fail({ code: 'usage', message: 'expected exactly one .fountain (see --help)' });
      }
      const result = settingsCommand({ fountain: positionals[0], set: values.set });
      if (jsonMode) {
        console.log(JSON.stringify({ ok: true, ...result }));
        return;
      }
      console.log(`settings for ${basename(positionals[0])} — ${result.sidecar}`);
      for (const [key, value] of Object.entries(result.settings)) {
        console.log(`  ${key}: ${value}`);
      }
      return;
    }

    if (verb === 'export') {
      if (positionals.length !== 1) {
        fail({ code: 'usage', message: 'expected exactly one .epub to export (see --help)' });
      }
      const result = await exportCommand({
        epub: positionals[0],
        for: values.for,
        fountain: values.fountain,
        optionsJson: values['options-json'],
      });
      if (jsonMode) {
        console.log(JSON.stringify({ ok: true, ...result }));
        return;
      }
      for (const stage of result.stages) console.log(`  ${stage}`);
      console.log(`${result.label}\n  ${result.path}`);
      return;
    }

    // verb === 'send'
    if (values.set !== undefined) {
      fail({ code: 'usage', message: 'send takes no --set (--set belongs to settings)' });
    }
    if (values.for !== undefined) {
      fail({ code: 'usage', message: 'send takes no --for (--for belongs to export)' });
    }
    if (values.fountain !== undefined) {
      fail({ code: 'usage', message: 'send takes no --fountain (--fountain belongs to export)' });
    }
    if (values['options-json'] !== undefined) {
      fail({ code: 'usage', message: 'send takes no --options-json (--options-json belongs to export)' });
    }
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
      // takes its place. Two shapes, one object, per the design spec. Which
      // shape is READ OFF SendResult.uploaded, never re-derived here: two
      // places deciding the same thing is two places that can disagree.
      console.log(
        JSON.stringify({
          ok: true,
          device: sent.device,
          ...(sent.uploaded ? { uploaded: true } : { destination: sent.destination }),
        }),
      );
      return;
    }
    console.log(
      sent.uploaded
        ? `sent ${basename(positionals[0])} to ${sent.device.name}`
        : `sent ${basename(positionals[0])} to ${sent.device.name} — ${sent.destination}`,
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
    fail({ code: 'usage', message: errorMessage(err) });
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
  // Checked before any file I/O: without --json there is nowhere for the
  // document to go (stdout is human-readable text, not the app's decode
  // target), so failing here — rather than after a full conversion has
  // already written .epub/.fountain output — avoids doing (and writing)
  // work the caller cannot use.
  if (values['preview-inline'] && !jsonMode) {
    fail({
      code: 'usage',
      message: '--preview-inline needs --json: the document rides inside the result object',
    });
  }

  const input = positionals[0];
  const ext = extname(input).toLowerCase();
  const inputStem = join(dirname(input), basename(input, extname(input)));
  const epubPath = values.output ?? `${inputStem}.epub`;
  // Companion outputs (.mobi/.fountain/.elements.json) follow the EPUB, so
  // -o into a library folder keeps everything together.
  const stem = join(dirname(epubPath), basename(epubPath, extname(epubPath)));

  let format: Record<string, unknown> | undefined;
  if (values.options !== undefined && values['options-json'] !== undefined) {
    fail({
      code: 'bad-options',
      message: 'pass --options or --options-json, not both',
    });
  }
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
  if (values['options-json'] !== undefined) {
    // The app's channel: the window has no filesystem, so its settings
    // arrive as one argv element. The PAYLOAD never reaches the message —
    // it is a whole settings object and would bury the sentence.
    let parsed: unknown;
    try {
      parsed = JSON.parse(values['options-json']);
    } catch {
      fail({ code: 'bad-options', message: '--options-json is not valid JSON' });
    }
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      fail({ code: 'bad-options', message: '--options-json must be a JSON object' });
    }
    format = parsed as Record<string, unknown>;
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
        message:
          `unsupported input type "${ext}" — expected .pdf, .fountain, or .txt` +
          verbHint(input),
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
        // Spread, not a plain key: the app asks for this and nothing else
        // does, and a megabyte of HTML on every conversion would be a tax
        // every other caller pays for one caller's convenience.
        ...(values['preview-inline'] ? { previewHtml: result.previewHtml } : {}),
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
