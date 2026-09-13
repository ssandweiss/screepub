// Per-script formatting overrides, stored beside the script's .fountain in
// the library: `<Stem>.screepub.json`. Absent sidecar = the caller's base.
import { readFileSync, renameSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { resolveFormatOptions, type FormatOptions } from '../options';

export function sidecarPath(fountainPath: string): string {
  const stem = basename(fountainPath).replace(/\.[^.]*$/, '');
  return join(dirname(fountainPath), `${stem}.screepub.json`);
}

/** Read a sidecar and overlay it on `fallback`. Unknown keys and invalid
 * values are ignored and missing keys leave `fallback` standing, so neither
 * an older nor a newer schema can wipe a user's per-script tuning — that
 * merge is resolveFormatOptions', not a second copy of it. */
export function loadScriptSettings(fountainPath: string, fallback: FormatOptions): FormatOptions {
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(sidecarPath(fountainPath), 'utf8'));
  } catch {
    return fallback;
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return fallback;
  return resolveFormatOptions(parsed as Record<string, unknown>, fallback);
}

/** Write the sidecar with sorted keys, via temp-then-rename so a reader
 * never observes a partial file — the same discipline cli.ts uses. */
export function saveScriptSettings(settings: FormatOptions, fountainPath: string): void {
  const path = sidecarPath(fountainPath);
  const sorted = Object.fromEntries(
    Object.entries(settings).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)),
  );
  const tmp = join(dirname(path), `.${basename(path)}.${process.pid}.tmp`);
  writeFileSync(tmp, `${JSON.stringify(sorted, null, 2)}\n`);
  renameSync(tmp, path);
}
