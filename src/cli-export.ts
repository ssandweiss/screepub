// The `export` verb: the file you would actually put on a reader. `send`
// never converts, and a Kindle never indexes a sideloaded EPUB, so the
// window needs a way to ask for the Kindle rung before it sends. The LADDER
// is src/export/artifact.ts's — this file chooses nothing, it only carries
// the answer out. Returns a value; cli.ts owns stdout.
import { statSync } from 'node:fs';
import { copyFile, mkdir, rename, unlink } from 'node:fs/promises';
import { basename, dirname, extname, isAbsolute, join, resolve } from 'node:path';
import { CliError, errorMessage } from './cli-errors';
import {
  availableFormats,
  freshKindleArtifact as realFreshKindleArtifact,
  type FreshKindleArtifactOptions,
} from './export/artifact';
import { isCalibreAvailable } from './export/calibre';
import { fileExtension, formatLabel, type ExportFormat } from './export/formats';
import { kfxStatus as realKfxStatus, type KfxStatus } from './export/kfx';
import { DEFAULT_FORMAT_OPTIONS, resolveFormatOptions, type FormatOptions } from './options';

export interface ExportResult {
  path: string;
  format: ExportFormat;
  extension: string;
  label: string;
  available: ExportFormat[];
  stages: string[];
}

export interface ExportOptions {
  /** An EXISTING .epub — the conversion's primary output. */
  epub: string;
  /** 'epub' (default) or 'kindle'. */
  for?: string;
  /** The script's .fountain, needed only by the MOBI rung. */
  fountain?: string;
  /** This script's settings, as --options-json carries them elsewhere. */
  optionsJson?: string;
  /** Where the window's own save dialog said to put a copy. The window
   * never writes a file itself (see cli.ts's --out); when given, it MUST
   * be absolute, checked before any toolchain probe or ladder run. */
  out?: string;
}

// Injectable seams, same shape as tools/build-cli.ts's `Spawn` and
// tools/sidecar-targets.ts's `HostTriple`: a typed function, defaulted to
// the real thing, so a test can drive a specific rung (KFX ready / Calibre
// only / neither) without depending on which toolchain happens to be
// installed on the machine running the suite. Real Calibre on Linux checks
// FIXED paths before PATH (src/export/calibre.ts's candidatePaths), so the
// PATH-shadowing trick used elsewhere in this codebase cannot reach a
// machine that has a genuine install — this seam is the only way to test
// the wrapper's rung SELECTION independently of what is actually on disk.
// Production call sites pass no `deps` at all and get the real detectors
// untouched.
export type CalibreProbe = () => boolean;
export type KfxProbe = () => Promise<KfxStatus>;
export type KindleLadder = (opts: FreshKindleArtifactOptions) => Promise<string>;

export interface ExportDeps {
  calibreAvailable?: CalibreProbe;
  kfxStatus?: KfxProbe;
  freshKindleArtifact?: KindleLadder;
}

function readFormat(optionsJson: string | undefined): FormatOptions {
  if (optionsJson === undefined) return DEFAULT_FORMAT_OPTIONS;
  let parsed: unknown;
  try {
    parsed = JSON.parse(optionsJson);
  } catch {
    throw new CliError('bad-options', '--options-json is not valid JSON');
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new CliError('bad-options', '--options-json must be a JSON object');
  }
  return resolveFormatOptions(parsed as Record<string, unknown>);
}

/** The extension a chosen --out must carry, checked against the artifact's
 * own (never the other way: a person can type any name in a save dialog).
 * Case-insensitive on both sides; the message names the wrong one in caps,
 * the way formatLabel already names a format, and the right one lowercase
 * with its dot, ready to paste into a filename. */
function checkOutExtension(out: string, wantExt: string): void {
  const outExt = extname(out).slice(1);
  if (outExt.toLowerCase() !== wantExt.toLowerCase()) {
    throw new CliError(
      'usage',
      `that is a ${outExt.toUpperCase()} file: choose a name ending in .${wantExt.toLowerCase()}`,
    );
  }
}

/** Temp file in the destination folder, then rename over: a reader watching
 * `out` never observes a partial write, and an existing file there is
 * replaced in one step. On any failure the temp file is removed too. No
 * trace left beside the destination either way. Mirrors cli.ts's own
 * writeFileAtomic, which this cannot import (that one takes bytes already
 * in memory; this one has a source file on disk to stream from instead). */
async function copyArtifactAtomic(source: string, destination: string): Promise<void> {
  const destDir = dirname(destination);
  await mkdir(destDir, { recursive: true });
  const tmp = join(destDir, `.${basename(destination)}.${process.pid}.tmp`);
  try {
    await copyFile(source, tmp);
    await rename(tmp, destination);
  } catch (err) {
    await unlink(tmp).catch(() => {});
    throw err;
  }
}

/** Resolve --out against the artifact the ladder (or the epub rung)
 * actually produced. Already sitting at `out`: answer without copying,
 * since it is already there, and copying a file onto itself is only ever a
 * footgun. Otherwise copy it there atomically. Either way the returned path
 * IS `out`, per the contract: every other field in the answer is unchanged. */
async function resolveOut(artifactPath: string, out: string): Promise<string> {
  if (resolve(out) !== resolve(artifactPath)) {
    try {
      await copyArtifactAtomic(artifactPath, out);
    } catch (err) {
      throw new CliError('export-failed', errorMessage(err));
    }
  }
  return out;
}

export async function exportCommand(
  options: ExportOptions,
  deps: ExportDeps = {},
): Promise<ExportResult> {
  const wanted = options.for ?? 'epub';
  if (wanted !== 'epub' && wanted !== 'kindle') {
    throw new CliError('usage', `--for takes epub or kindle, not "${wanted}"`);
  }

  // The file is checked FIRST, before any toolchain probe: a typo must not
  // pay Calibre's ~1s Python start to be reported.
  let isFile = false;
  try {
    isFile = statSync(options.epub).isFile();
  } catch {
    isFile = false;
  }
  if (!isFile) {
    throw new CliError('unreadable', `cannot read the book to export: ${options.epub}`);
  }

  // --out is validated for shape before ANYTHING else that costs real time:
  // Calibre's probe, Kindle Previewer's status check, and the ladder itself.
  // A save dialog always hands back an absolute path, so a relative one here
  // means a caller built the argv by hand and got it wrong; it must not pay
  // for a KFX build to be told so.
  if (options.out !== undefined && !isAbsolute(options.out)) {
    throw new CliError('usage', 'the path given with --out must be absolute');
  }

  // Parsed here, before the epub branch returns and before any toolchain
  // probe: --options-json is either well-formed argv or it is not, and that
  // cannot depend on what --for happens to say. The epub rung ignores the
  // VALUE (it converts nothing), but a window sending malformed JSON must
  // hear the same 'bad-options' either way, or the same argv is valid and
  // invalid at once.
  const formatOptions = readFormat(options.optionsJson);

  const calibreAvailable = (deps.calibreAvailable ?? isCalibreAvailable)();
  const available = availableFormats(options.epub, calibreAvailable);
  const format: ExportFormat = wanted;

  if (format === 'epub') {
    const state = { calibreAvailable, kfxReady: false };
    const extension = fileExtension(format, state);
    // The epub rung does no ladder work at all, so "before any work" means
    // right here: checked before resolveOut so much as looks at the disk.
    if (options.out !== undefined) checkOutExtension(options.out, extension);
    const path = options.out !== undefined
      ? await resolveOut(options.epub, options.out)
      : options.epub;
    return {
      path,
      format,
      extension,
      label: formatLabel(format, state),
      available,
      stages: [],
    };
  }

  const kfx = await (deps.kfxStatus ?? realKfxStatus)();
  const state = { calibreAvailable, kfxReady: kfx.ready };
  const stages: string[] = [];
  let path: string;
  try {
    path = await (deps.freshKindleArtifact ?? realFreshKindleArtifact)({
      epub: options.epub,
      fountainPath: options.fountain ?? null,
      format: formatOptions,
      calibreAvailable,
      kfxReady: kfx.ready,
      onStage: (stage) => stages.push(stage),
    });
  } catch (err) {
    // Only the LADDER's own errors belong here (CannotRegenerateError,
    // RegenerationFailedError, CalibreMissingError, ...) — none of them are
    // CliError, so this rewrap can't accidentally swallow a typed code. Any
    // CliError this command itself needs to throw (bad-options above,
    // unreadable earlier, usage at the top) is raised OUTSIDE this try, on
    // purpose, so its code survives verbatim.
    throw new CliError('export-failed', errorMessage(err));
  }

  const extension = fileExtension(format, state);
  // Only now does the wrapper know which rung was actually taken. KFX,
  // AZW3 and MOBI are three different right answers to the same --out, and
  // asking any earlier would mean guessing at a toolchain probe the ladder
  // itself already ran a moment ago.
  if (options.out !== undefined) {
    checkOutExtension(options.out, extension);
    path = await resolveOut(path, options.out);
  }

  return {
    path,
    format,
    extension,
    label: formatLabel(format, state),
    available,
    stages,
  };
}
