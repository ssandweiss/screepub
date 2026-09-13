import { existsSync, writeFileSync } from 'node:fs';
import { convertFountain } from '../convert';
import type { FormatOptions } from '../options';
import { toAzw3 } from './calibre';
import { needsRegeneration } from './freshness';
import type { ExportFormat } from './formats';
import { kfxSibling, toKfx } from './kfx';

export class CannotRegenerateError extends Error {
  constructor() {
    super("Can't rebuild the Kindle file — the script's .fountain is missing.");
    this.name = 'CannotRegenerateError';
  }
}

/** The sibling `.mobi` for a given EPUB — same directory, same stem. Shared
 * by availableFormats and freshKindleArtifact so the derivation lives in
 * exactly one place; call sites go through those two. */
export function mobiSibling(epub: string): string {
  return `${epub.replace(/\.epub$/i, '')}.mobi`;
}

/** EPUB is always available (it is the conversion's primary output). The
 * Kindle format needs either Calibre (converts from the current EPUB) or an
 * already-built .mobi to refresh. */
export function availableFormats(epub: string, calibreAvailable: boolean): ExportFormat[] {
  const formats: ExportFormat[] = ['epub'];
  if (calibreAvailable || existsSync(mobiSibling(epub))) formats.push('kindle');
  return formats;
}

export interface FreshKindleArtifactOptions {
  epub: string;
  fountainPath: string | null;
  /** Must be the script's real settings, not the defaults, or the export
   * silently loses the user's tuned formatting. */
  format: FormatOptions;
  calibreAvailable: boolean;
  kfxReady: boolean;
  onStage?: (stage: string) => void;
}

/** A Kindle-format file guaranteed current with `epub`. Calibre converts
 * straight from the present EPUB, so that branch is fresh by construction;
 * the MOBI branch re-runs the engine only when the staleness rule says the
 * file is out of date.
 *
 * NOTE: the MOBI branch REWRITES `epub` in place before it writes the .mobi
 * beside it — this function can mutate the EPUB it was handed, not just
 * produce the Kindle file. */
export async function freshKindleArtifact(opts: FreshKindleArtifactOptions): Promise<string> {
  const { epub, fountainPath, format, calibreAvailable, kfxReady, onStage } = opts;

  if (kfxReady) {
    // Same staleness rule as the MOBI branch: the EPUB is the sole input and
    // the flags are constant, so a sibling .kfx no older than its EPUB is the
    // previous run's answer — reusing it turns a ~20s Kindle Previewer cold
    // start into a file stat. toKfx writes scratch-then-rename, so a partial
    // file never appears at this path to be trusted.
    const kfx = kfxSibling(epub);
    if (!needsRegeneration(kfx, epub)) return kfx;
    return toKfx(epub, onStage);
  }

  if (calibreAvailable) {
    onStage?.('converting to AZW3 for Kindle…');
    return toAzw3(epub);
  }

  const mobi = mobiSibling(epub);
  if (!needsRegeneration(mobi, epub)) return mobi;
  if (!fountainPath) throw new CannotRegenerateError();

  onStage?.('rebuilding the Kindle file…');
  const fountainText = await Bun.file(fountainPath).text();
  const result = await convertFountain(fountainText, { format, mobi: true });
  writeFileSync(epub, result.epub);
  if (!result.mobi) {
    throw new Error('the engine reported success but produced no .mobi');
  }
  writeFileSync(mobi, result.mobi);
  return mobi;
}
