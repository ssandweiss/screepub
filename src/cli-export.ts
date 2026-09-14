// The `export` verb: the file you would actually put on a reader. `send`
// never converts, and a Kindle never indexes a sideloaded EPUB, so the
// window needs a way to ask for the Kindle rung before it sends. The LADDER
// is src/export/artifact.ts's — this file chooses nothing, it only carries
// the answer out. Returns a value; cli.ts owns stdout.
import { statSync } from 'node:fs';
import { CliError, errorMessage } from './cli-errors';
import { availableFormats, freshKindleArtifact } from './export/artifact';
import { isCalibreAvailable } from './export/calibre';
import { fileExtension, formatLabel, type ExportFormat } from './export/formats';
import { kfxStatus } from './export/kfx';
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

export async function exportCommand(options: ExportOptions): Promise<ExportResult> {
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

  const calibreAvailable = isCalibreAvailable();
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

  const kfx = await kfxStatus();
  const state = { calibreAvailable, kfxReady: kfx.ready };
  const stages: string[] = [];
  let path: string;
  try {
    path = await freshKindleArtifact({
      epub: options.epub,
      fountainPath: options.fountain ?? null,
      format: readFormat(options.optionsJson),
      calibreAvailable,
      kfxReady: kfx.ready,
      onStage: (stage) => stages.push(stage),
    });
  } catch (err) {
    // The ladder's own sentences are already written for a person
    // (CannotRegenerateError, RegenerationFailedError, CalibreMissingError);
    // passing them through verbatim is the rule this project already keeps
    // for send-failed.
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
