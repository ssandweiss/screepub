// The `export` verb: the file you would actually put on a reader. `send`
// never converts, and a Kindle never indexes a sideloaded EPUB, so the
// window needs a way to ask for the Kindle rung before it sends. The LADDER
// is src/export/artifact.ts's — this file chooses nothing, it only carries
// the answer out. Returns a value; cli.ts owns stdout.
import { statSync } from 'node:fs';
import { CliError, errorMessage } from './cli-errors';
import {
  availableFormats,
  freshKindleArtifact as realFreshKindleArtifact,
  type FreshKindleArtifactOptions,
} from './export/artifact';
import { isCalibreAvailable } from './export/calibre';
import { fileExtension, formatLabel, type ExportFormat } from './export/formats';
import { kfxStatus as realKfxStatus, type KfxStatus } from './export/kfx';
import { resolveFormatOptions, type FormatOptions } from './options';
import { appDefaultOptions } from './settings/app-defaults';

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
  /** Where to read the app-wide format defaults from. Defaults to the
   * production app settings file (`appSettingsPath()`); a test points this
   * at a scratch file so it never touches a real one. */
  appSettingsPath?: string;
}

/** `--options-json`, overlaid on the app-wide format defaults (piece C) so
 * the same precedence a conversion honours (flags > sidecar > app defaults
 * > shipped) holds here too: a rebuild through the MOBI rung must start
 * from the user's own defaults, not Screepub's, when the caller mentioned
 * no `--options-json` knob at all, or only some of them. A FULL object (what
 * the window actually sends: `screepub settings`'s answer, read back
 * whole) leaves nothing for the app defaults to fill, so this changes
 * nothing observable for it. */
function readFormat(optionsJson: string | undefined, appSettingsPath: string | undefined): FormatOptions {
  const base = appDefaultOptions(appSettingsPath);
  if (optionsJson === undefined) return base;
  let parsed: unknown;
  try {
    parsed = JSON.parse(optionsJson);
  } catch {
    throw new CliError('bad-options', '--options-json is not valid JSON');
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new CliError('bad-options', '--options-json must be a JSON object');
  }
  return resolveFormatOptions(parsed as Record<string, unknown>, base);
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

  // Parsed here, before the epub branch returns and before any toolchain
  // probe: --options-json is either well-formed argv or it is not, and that
  // cannot depend on what --for happens to say. The epub rung ignores the
  // VALUE (it converts nothing), but a window sending malformed JSON must
  // hear the same 'bad-options' either way, or the same argv is valid and
  // invalid at once.
  const formatOptions = readFormat(options.optionsJson, deps.appSettingsPath);

  const calibreAvailable = (deps.calibreAvailable ?? isCalibreAvailable)();
  const available = availableFormats(options.epub, calibreAvailable);
  const format: ExportFormat = wanted;

  if (format === 'epub') {
    const state = { calibreAvailable, kfxReady: false };
    return {
      path: options.epub,
      format,
      extension: fileExtension(format, state),
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

  return {
    path,
    format,
    extension: fileExtension(format, state),
    label: formatLabel(format, state),
    available,
    stages,
  };
}
