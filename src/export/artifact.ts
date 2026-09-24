import { existsSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { convertFountain } from '../convert';
import type { FormatOptions } from '../options';
import { azw3Sibling, toAzw3 } from './calibre';
import { needsRegeneration } from './freshness';
import type { ExportFormat } from './formats';
import { kfxSibling, toKfx } from './kfx';

export class RegenerationFailedError extends Error {
  constructor(why: string) {
    super(`Couldn't rebuild the Kindle file: ${why}`);
    this.name = 'RegenerationFailedError';
  }
}

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

/** A Kindle-format file guaranteed current with `epub`. Every rung reuses
 * the file already beside the EPUB when the staleness rule (freshness.ts)
 * says it is current, and builds it again only when it is not: KFX and AZW3
 * convert straight from the present EPUB, and the MOBI branch re-runs the
 * engine.
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
    // Same staleness rule as the KFX rung above, for the same reason: the
    // EPUB is the sole input and the flags are constant. Without it, "Save a
    // Kindle file" converted twice on a Calibre-only machine (the window's
    // `export --for kindle` to learn the extension, then `route
    // save-kindle`). toAzw3 writes scratch-then-rename, so a partial file
    // never appears at this path to be trusted.
    const azw3 = azw3Sibling(epub);
    if (!needsRegeneration(azw3, epub)) return azw3;
    onStage?.('converting to AZW3 for Kindle…');
    return toAzw3(epub);
  }

  const mobi = mobiSibling(epub);
  if (!needsRegeneration(mobi, epub)) return mobi;
  if (!fountainPath) throw new CannotRegenerateError();

  onStage?.('rebuilding the Kindle file…');
  const fountainText = await Bun.file(fountainPath).text();
  const result = await convertFountain(fountainText, { format, mobi: true });
  if (!result.mobi) {
    throw new RegenerationFailedError('the engine reported success but produced no .mobi');
  }
  // Swift's branch shelled out to cli.ts, and Export.swift leans on what that
  // does: each output goes to a temp file that is renamed into place, so a
  // partial `.mobi` never appears at the final path in the FIRST PLACE. That
  // is load-bearing for the rung right above — a kill or disk-full mid-write
  // would otherwise leave a truncated `.mobi` whose mtime is NEWER than the
  // EPUB's, which needsRegeneration would then trust as fresh forever. Same
  // discipline as cli.ts's writeFileAtomic, settings/sidecar.ts and
  // export/kfx.ts.
  writeFileAtomic(epub, result.epub);
  writeFileAtomic(mobi, result.mobi);
  return mobi;
}

/** Write-then-rename, so the final path only ever holds a complete file.
 * The temp sibling is hidden and lives in the same directory as its target,
 * so it shares a volume and the promote is a rename, not a copy. */
function writeFileAtomic(path: string, data: Uint8Array): void {
  const tmp = join(dirname(path), `.${basename(path)}.${process.pid}.tmp`);
  try {
    writeFileSync(tmp, data);
    renameSync(tmp, path);
  } catch (error) {
    rmSync(tmp, { force: true });
    throw error;
  }
}
