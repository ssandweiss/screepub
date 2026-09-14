// Per-script formatting overrides, stored beside the script's .fountain in
// the library: `<Stem>.screepub.json`. Absent sidecar = the caller's base.
import { readFileSync, renameSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { resolveFormatOptions, type FormatOptions } from '../options';

export function sidecarPath(fountainPath: string): string {
  const stem = basename(fountainPath).replace(/\.[^.]*$/, '');
  return join(dirname(fountainPath), `${stem}.screepub.json`);
}

/** What a script's sidecar has to say, if it has anything.
 *
 * `null` when there is no sidecar to read at all. `settings: null` when a
 * file IS there but is not a settings object — hand-edited with a trailing
 * comma, or half a write from something else. That case must never break a
 * conversion that would otherwise succeed, so the caller falls back; it is
 * told apart from "absent" only so the caller can SAY so.
 *
 * Unknown keys and invalid values are ignored and missing keys leave
 * `fallback` standing, so neither an older nor a newer schema can wipe a
 * user's per-script tuning — that merge is resolveFormatOptions', not a
 * second copy of it. */
export function readScriptSettings(
  fountainPath: string,
  fallback: FormatOptions,
): { path: string; settings: FormatOptions | null } | null {
  const path = sidecarPath(fountainPath);
  let text: string;
  try {
    text = readFileSync(path, 'utf8');
  } catch {
    return null;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { path, settings: null };
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return { path, settings: null };
  }
  return { path, settings: resolveFormatOptions(parsed as Record<string, unknown>, fallback) };
}

/** Read a sidecar and overlay it on `fallback` — or hand `fallback` straight
 * back when there is nothing usable to overlay. */
export function loadScriptSettings(fountainPath: string, fallback: FormatOptions): FormatOptions {
  return readScriptSettings(fountainPath, fallback)?.settings ?? fallback;
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
