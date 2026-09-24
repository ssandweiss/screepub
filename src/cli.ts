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
import { adoptSidecar, existingLibraryOutput, libraryOutput, libraryRoot } from './library';
import { resolveFormatOptions, type FormatOptions } from './options';
import { appDefaultOptions } from './settings/app-defaults';
import { readScriptSettings } from './settings/sidecar';
import { resolveCommand, devicesCommand, sendCommand, VERBS, type Verb } from './cli-devices';
import { updateDecisionCommand, updateShouldCheckCommand } from './cli-update';
import { settingsCommand } from './cli-settings';
import { exportCommand } from './cli-export';
import { kfxInstallCommand, kfxStatusCommand, installLines, setupLines } from './cli-kfx';
import { kfxPossible } from './export/kfx-setup';
import type { ListDevicesOptions } from './device/list';

const USAGE = `screepub — screenplay PDF → reflowable EPUB3 (via Fountain)

Usage:
  screepub <input.pdf | input.fountain> [options]

PDF is the primary path. .fountain input is PARTIALLY SUPPORTED: contdMode
and rejoinSplitDialogue are applied when a PDF is read, so they do not take
effect here (asking to strip (CONT'D) warns rather than failing silently),
and the scanned-PDF and not-a-screenplay guards are PDF-only. See the
README's "Fountain input" section.

Every conversion starts from your app-wide format defaults, when you have
set any, underneath all of this.

A script's saved settings are used by the conversion that finds them: if
<script>.screepub.json sits beside the input — or in the script's library
folder, under --library — this run renders with it and says so on stderr.
--options/--options-json override it knob by knob. Write one with the
settings command.

Options:
  -o, --output <file>    EPUB output path (default: <input>.epub)
  --library              write into the library folder instead of beside the
                         input: <library>/<stem>/<stem>.epub. The library is
                         <Documents>/Screepub — ~/Documents on macOS and
                         Windows, and XDG_DOCUMENTS_DIR (else ~/Documents)
                         elsewhere; $SCREEPUB_LIBRARY overrides it
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
  screepub kfx-status [--json]              can this computer make KFX for a Kindle?
  screepub kfx-install [--json]             add the KFX plugin to Calibre (online)
  screepub update-decision --offered <v> --current <v> [--json]
                                            should this update be offered? (offline)
  screepub update-should-check [--opted-in] [--last-checked <ms>] [--json]
                                            may a check be made now? (offline)

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

const KFX_STATUS_USAGE = `screepub kfx-status: can this computer make KFX for a Kindle?

Usage:
  screepub kfx-status [--json]

A Kindle gets its best rendering from a KFX file, and making one needs three
free tools: Calibre, Amazon's Kindle Previewer, and the KFX Output plugin
inside Calibre. This says which are installed, where to get the missing ones,
and what a Kindle gets until then. Installs nothing; works offline.

Options:
  --json                 machine-readable result on stdout (for the app)
  -h, --help             show this help
`;

const KFX_INSTALL_USAGE = `screepub kfx-install: install the KFX plugin into Calibre

Usage:
  screepub kfx-install [--json]

Downloads the current KFX Output plugin from Calibre's own plugin index and
installs it with Calibre's own installer, replacing any older copy. Needs
Calibre, and the internet. Kindle Previewer is not installed by this: it is
Amazon's, and \`screepub kfx-status\` says where to get it. Refuses, before
touching Calibre, on a system Amazon makes no Kindle Previewer for: the
plugin would have nothing to drive there.

Options:
  --json                 machine-readable result on stdout (for the app)
  -h, --help             show this help
`;

const UPDATE_DECISION_USAGE = `screepub update-decision — should this update be offered?

Usage:
  screepub update-decision --offered <version> --current <version> [--json]

Judges; never fetches. You supply the release that was found and the
build that is running, and get back whether to offer it. Works offline.

Not plain semver, on purpose: a build past a tag calls itself
0.6.0-1-g965cb10, which semver reads as OLDER than 0.6.0, so a semver
updater offers the tag and installs a downgrade. This does not.

A refusal is an ANSWER and exits 0 with its reason. Only bad usage
exits non-zero.

Options:
  --offered <version>  the release an update check found
  --current <version>  the build that is running
  --json               machine-readable result on stdout (for the app)
  -h, --help           show this help
`;

const UPDATE_SHOULD_CHECK_USAGE = `screepub update-should-check — may a check be made right now?

Usage:
  screepub update-should-check [--opted-in] [--last-checked <epoch-ms>] [--json]

Decides; never fetches. Without --opted-in the answer is always no:
update checks are off by default. With it, at most once a day, and a
clock set backwards reads as "checked recently", never as overdue.

Options:
  --opted-in               the user has switched update checks on
  --last-checked <ms>      when a check last ran, in epoch milliseconds
  --json                   machine-readable result on stdout (for the app)
  -h, --help               show this help
`;

function verbUsage(verb: Verb): string {
  if (verb === 'devices') return DEVICES_USAGE;
  if (verb === 'settings') return SETTINGS_USAGE;
  if (verb === 'export') return EXPORT_USAGE;
  if (verb === 'kfx-status') return KFX_STATUS_USAGE;
  if (verb === 'kfx-install') return KFX_INSTALL_USAGE;
  if (verb === 'update-decision') return UPDATE_DECISION_USAGE;
  if (verb === 'update-should-check') return UPDATE_SHOULD_CHECK_USAGE;
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

/** Print one line on stdout and WAIT for it to leave this process.
 *
 * `console.log` to a PIPE is buffered, and exiting does not wait for the
 * tail. Measured on this machine: the engine's own answer for a generated
 * 1,000-scene script reached a piped caller cut to exactly 262,144 or
 * 655,360 bytes — 64 KiB multiples, the pipe buffer — one run in four, with
 * no app and no Tauri anywhere, while the same run redirected to a FILE was
 * always whole. An answer under one pipe buffer never noticed; a
 * --preview-inline answer is 1.85-2.6 KB per page, so a 120-page script is
 * already several buffers deep, and the desktop window reads exactly this
 * way. Anything that can exceed 64 KiB goes through here.
 *
 * Deliberately NOT everything. `fail()`, `showHelp()`, `showVersion()`, the
 * catch-all and the verb handlers all still use `console.log`, because each
 * of them writes a bounded answer — an error object, a fixed usage screen, a
 * version string, a device list — that cannot approach one pipe buffer, and
 * a plain `console.log` keeps them synchronous and callable from anywhere,
 * including a `never`-returning exit path where there is no one to await.
 * The rule is about SIZE, not about stdout: route a writer through `sayLine`
 * the moment its output can grow with the script.
 *
 * The wait is UNCONDITIONAL, not `if (!write(...)) await drain`. The
 * conditional form is correct only while the runtime flushes a write that
 * stayed under the high-water mark before it exits — true of Bun today, and
 * exactly the sort of unstated assumption that produced this bug. Waiting
 * for the write's own callback depends on nothing: measured over 10 runs of
 * a small answer, both forms take the same time to the millisecond.
 */
async function sayLine(text: string): Promise<void> {
  await new Promise<void>((resolve) => {
    process.stdout.write(`${text}\n`, () => resolve());
  });
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
      library: { type: 'boolean', default: false },
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
      offered: { type: 'string' },
      current: { type: 'string' },
      'opted-in': { type: 'boolean', default: false },
      'last-checked': { type: 'string' },
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
    // The update verbs' flags live in the schema every verb shares, so
    // every OTHER verb has to refuse them. Without this,
    // `screepub devices --offered 1.0` quietly succeeds, which is the
    // failure the per-verb rejections below exist to prevent, arriving
    // through a flag they were written before.
    if (verb !== 'update-decision' && verb !== 'update-should-check') {
      const updateFlags: [unknown, string, string][] = [
        [values.offered, '--offered', 'update-decision'],
        [values.current, '--current', 'update-decision'],
        [values['last-checked'], '--last-checked', 'update-should-check'],
        [values['opted-in'] ? true : undefined, '--opted-in', 'update-should-check'],
      ];
      for (const [value, flag, owner] of updateFlags) {
        if (value !== undefined) {
          fail({ code: 'usage', message: `${verb} takes no ${flag} (${flag} belongs to ${owner})` });
        }
      }
    }

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

    if (verb === 'update-decision' || verb === 'update-should-check') {
      // Rejected rather than ignored, the same rule `devices` follows: a
      // flag this verb cannot act on must not look like it did something.
      const foreign: [unknown, string, string][] = [
        [values.device, '--device', 'send'],
        [values.set, '--set', 'settings'],
        [values.for, '--for', 'export'],
        [values.fountain, '--fountain', 'export'],
        [values['options-json'], '--options-json', 'export'],
      ];
      if (verb === 'update-decision') {
        foreign.push([values['last-checked'], '--last-checked', 'update-should-check']);
        if (values['opted-in']) foreign.push([true, '--opted-in', 'update-should-check']);
      } else {
        foreign.push([values.offered, '--offered', 'update-decision']);
        foreign.push([values.current, '--current', 'update-decision']);
      }
      for (const [value, flag, owner] of foreign) {
        if (value !== undefined) {
          fail({ code: 'usage', message: `${verb} takes no ${flag} (${flag} belongs to ${owner})` });
        }
      }
      if (positionals.length > 0) {
        fail({ code: 'usage', message: `${verb} takes no arguments (got "${positionals[0]}")` });
      }

      if (verb === 'update-decision') {
        let decision: ReturnType<typeof updateDecisionCommand>;
        try {
          decision = updateDecisionCommand({ offered: values.offered, current: values.current });
        } catch (err) {
          fail({ code: 'usage', message: errorMessage(err) });
        }
        if (jsonMode) {
          console.log(JSON.stringify({ ok: true, ...decision }));
          return;
        }
        // A refusal is an answer, not an error: exit 0 either way.
        console.log(decision.offer ? `offer ${decision.version}` : `no: ${decision.reason}`);
        return;
      }

      let answer: ReturnType<typeof updateShouldCheckCommand>;
      try {
        answer = updateShouldCheckCommand({
          optedIn: values['opted-in'],
          lastChecked: values['last-checked'],
          now: Date.now(),
        });
      } catch (err) {
        fail({ code: 'usage', message: errorMessage(err) });
      }
      if (jsonMode) {
        console.log(JSON.stringify({ ok: true, ...answer }));
        return;
      }
      console.log(answer.check ? 'check' : 'do not check');
      return;
    }

    if (verb === 'kfx-status' || verb === 'kfx-install') {
      // Every refusal comes BEFORE anything runs. For kfx-install that order
      // is the point: a mistyped command must not reach the network or the
      // user's Calibre. tests/cli-kfx.test.ts pins the order in this source.
      const foreign: [unknown, string, string][] = [
        [values.device, '--device', 'send'],
        [values.set, '--set', 'settings'],
        [values.for, '--for', 'export'],
        [values.fountain, '--fountain', 'export'],
        [values['options-json'], '--options-json', 'export'],
      ];
      for (const [value, flag, owner] of foreign) {
        if (value !== undefined) {
          fail({ code: 'usage', message: `${verb} takes no ${flag} (${flag} belongs to ${owner})` });
        }
      }
      if (positionals.length > 0) {
        fail({ code: 'usage', message: `${verb} takes no arguments (got "${positionals[0]}")` });
      }

      if (verb === 'kfx-status') {
        const setup = await kfxStatusCommand();
        if (jsonMode) {
          console.log(JSON.stringify({ ok: true, ...setup }));
          return;
        }
        for (const line of setupLines(setup)) console.log(line);
        return;
      }

      // A person at a terminal waits several seconds for a download; say so
      // on stderr, where it cannot disturb the one JSON line on stdout. Only
      // where an install can run at all: elsewhere kfxInstallCommand refuses
      // before installing, and this line would stand over that refusal.
      if (!jsonMode && kfxPossible(process.platform)) {
        console.error("installing the KFX plugin from Calibre's plugin index...");
      }
      const installed = await kfxInstallCommand();
      if (jsonMode) {
        console.log(JSON.stringify({ ok: true, ...installed }));
        return;
      }
      for (const line of installLines(installed)) console.log(line);
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
  // -o already says where the output goes, so --library beside it says
  // nothing this run can act on. Rejected rather than ignored, the same way
  // --options with --options-json is: a flag that silently did nothing
  // teaches the caller it did something.
  if (values.library && values.output !== undefined) {
    fail({
      code: 'usage',
      message: 'pass --library or -o, not both — -o already says where the output goes',
    });
  }
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

  // The script's own saved settings apply to THIS conversion — the one the
  // user just asked for — and not only to whatever happens to re-render the
  // book afterwards. They used to be read by `screepub settings` alone, so a
  // library conversion ADOPTED a sidecar and then rendered without it: the
  // first book off a tuned script came out at the defaults, and every rung
  // that converts the EPUB as it stands (export's KFX and AZW3, and every
  // non-Kindle device, which get the EPUB verbatim) shipped those defaults to
  // the reader.
  //
  // Scope: any conversion that finds this script's sidecar, not only
  // --library. A .screepub.json never appears by accident — `screepub
  // settings --set` is the only thing that writes one — so honouring it is
  // honouring something the user deliberately said about this script, and
  // the same file being obeyed or ignored depending on an unrelated output
  // flag would be the stranger rule. What keeps that from being a surprise
  // is that it is SAID, on stderr, every time it happens.
  //
  // Precedence: explicit flag > sidecar > app defaults > shipped defaults,
  // knob by knob, through the one merge resolveFormatOptions already is,
  // no second rule. A partial --options therefore moves the knobs it names
  // and leaves the rest of the script's tuning standing, which is what
  // cli-settings' --set does with the same call.
  //
  // Read once per conversion, not once per sidecar candidate below: the
  // user's own settings do not change mid-conversion, and two reads could
  // in principle disagree if the app settings file were rewritten between
  // them (the app changing it while a long conversion runs).
  const appDefaults = appDefaultOptions();
  let settings: FormatOptions | undefined;
  let settingsPath: string | undefined;
  const sidecarCandidates: string[] = [];
  // Resolved at most once here and reused below, rather than each of the
  // two --library uses calling libraryRoot() on its own: two separate
  // reads of the settings file could disagree with each other if the
  // chosen library folder changed between them, landing one conversion in
  // two different folders. Left undefined if resolving it here throws; the
  // second use recomputes it, and that is where the failure has always
  // been reported.
  let libRoot: string | undefined;
  if (values.library) {
    // A sidecar already IN the library outranks the older copy beside the
    // PDF — the same precedence adoptSidecar applies when it refuses to
    // overwrite it. Read-only: resolving it must not create a folder for an
    // input that is about to be refused.
    try {
      libRoot = libraryRoot();
      const prefix = existingLibraryOutput(input, libRoot);
      if (prefix !== null) sidecarCandidates.push(`${prefix}.fountain`);
    } catch {
      // An unusable library is the conversion's problem, and it is reported
      // below with its own code. It is not a reason to fail here.
    }
  }
  sidecarCandidates.push(input);
  for (const candidate of sidecarCandidates) {
    // The sidecar is read OVER the app defaults, not the shipped ones: a
    // knob the sidecar never mentions still comes from what the user chose
    // as their own starting point, not from Screepub's.
    const read = readScriptSettings(candidate, appDefaults);
    if (read === null) continue;
    if (read.settings === null) {
      // Malformed must never break a conversion that would otherwise
      // succeed — loadScriptSettings has always shrugged at one — but
      // shrugging SILENTLY is how "why does this look different from last
      // time" goes unanswered.
      process.stderr.write(
        `screepub: ignoring ${read.path} — it is not a settings object\n`,
      );
      continue;
    }
    settings = read.settings;
    settingsPath = read.path;
    process.stderr.write(
      `screepub: using this script's saved settings — ${read.path}` +
        `${format ? ' (the options you passed override them)' : ''}\n`,
    );
    break;
  }
  // One object, one merge: the flags over the sidecar over the app defaults
  // over the shipped ones. No sidecar applied, so the base one layer down is
  // the app defaults rather than convertPdf/convertFountain's own
  // shipped-defaults base. A FULL object here (resolveFormatOptions always
  // returns one) is what keeps that base from being resolved away when
  // convert.ts merges it again over DEFAULT_FORMAT_OPTIONS.
  const formatForConvert = settings === undefined
    ? resolveFormatOptions(format, appDefaults)
    : resolveFormatOptions(format, settings);

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

  const opts = { title: values.title, author: values.author, force: values.force, mobi: values.mobi, format: formatForConvert, onProgress };

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

  // WHERE the output goes is decided only once there is output to put there.
  // Resolving the library earlier made a folder — and CLAIMED the plain stem
  // name, pushing the real script of that name into a hashed one — for every
  // typo'd path and every file that turned out not to be a screenplay.
  // Nothing above this line writes anything, so a refusal leaves the library
  // exactly as it found it.
  let inputStem = join(dirname(input), basename(input, extname(input)));
  if (values.library) {
    try {
      inputStem = libraryOutput(input, libRoot);
      // Tuning the user already did beside the PDF follows the script in,
      // so the library does not start it over at the defaults.
      adoptSidecar(input, inputStem);
    } catch (err) {
      // The app's contract holds even here: one JSON object, never a throw
      // from deep inside node:fs.
      //
      // This message DOES carry the raw node:fs text, path and all, where
      // bad-options deliberately does not. The difference: a bad --options
      // path is a temp file the app made and the user has never seen, while
      // this one is a folder in the user's own home that they are the only
      // person who can fix. "EACCES … mkdir '/home/ada/Documents/Screepub'"
      // is the whole of the fix; "cannot open the library folder" alone
      // would send them looking for a location we never named.
      fail({ code: 'library', message: `cannot open the library folder — ${errorMessage(err)}` });
    }
  }
  const epubPath = values.output ?? `${inputStem}.epub`;
  // Companion outputs (.mobi/.fountain/.elements.json) follow the EPUB, so
  // -o into a library folder keeps everything together.
  const stem = join(dirname(epubPath), basename(epubPath, extname(epubPath)));

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
    // sayLine, not console.log: this is the one answer that can outgrow a
    // pipe buffer, and the window on the other end of that pipe needs all
    // of it. See sayLine's note.
    await sayLine(
      JSON.stringify({
        ok: true,
        title: result.meta.title,
        author: result.meta.author,
        pages: sp?.pageCount,
        scenes: sp?.scenes.length,
        characters: sp?.characters.length,
        topCharacters: sp?.characters.slice(0, 5).map((c) => c.name) ?? [],
        warnings: result.warnings,
        // Word spaces pdf.js invented and we removed against the glyph
        // stream. Reported rather than hidden because it edits the author's
        // text; normally 0, and a number that jumps is how a misfire shows.
        spacingRepairs: result.spacingRepairs,
        epubPath,
        mobiPath,
        fountainPath,
        // The sidecar this conversion actually rendered with, so the window
        // (and anyone reading the answer later) can tell a book built from a
        // script's saved settings from one built at the defaults.
        settingsPath,
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
