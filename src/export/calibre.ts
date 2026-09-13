// EPUB → AZW3/KEPUB via Calibre's ebook-convert. Kindles do NOT index
// sideloaded EPUBs — a USB copy must be AZW3 (Calibre's "Send to Device"
// does exactly this conversion first; Send-to-Kindle email/web converts
// server-side).
import { accessSync, constants, existsSync, renameSync, rmSync } from 'node:fs';
import { delimiter, join } from 'node:path';
import { platform } from 'node:process';

/** Calibre would otherwise undo two Screepub decisions during the convert: it
 * inserts page-break-before on every h2 (scene-per-page again), and its
 * remove-fake-margins heuristic sees side margins on most blocks — which is
 * what a screenplay's dialogue column looks like — and deletes them as
 * "publisher page margins", regardless of unit. Device-verified 2026-07-29;
 * change them in one place or not at all. (--extra-css is no rescue: on
 * multi-file EPUBs Calibre attaches it only to its generated inline ToC.) */
export const CALIBRE_FORMAT_GUARDS = [
  '--page-breaks-before=/',
  '--chapter-mark=none',
  '--disable-remove-fake-margins',
] as const;

function isExecutable(path: string): boolean {
  try {
    accessSync(path, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

/** One scanner for every Calibre CLI tool, so callers can never disagree
 * about whether Calibre exists. Per-OS: macOS keeps the tools inside the app
 * bundle, Linux installs them on PATH, Windows uses Program Files. */
function candidatePaths(name: string): string[] {
  if (platform === 'darwin') {
    return [
      `/Applications/calibre.app/Contents/MacOS/${name}`,
      `/opt/homebrew/bin/${name}`,
      `/usr/local/bin/${name}`,
    ];
  }
  if (platform === 'win32') {
    const exe = `${name}.exe`;
    return [
      join(process.env.ProgramFiles ?? 'C:\\Program Files', 'Calibre2', exe),
      join(process.env['ProgramFiles(x86)'] ?? 'C:\\Program Files (x86)', 'Calibre2', exe),
      ...pathEntries(exe),
    ];
  }
  return [`/usr/bin/${name}`, `/usr/local/bin/${name}`, ...pathEntries(name)];
}

function pathEntries(name: string): string[] {
  return (process.env.PATH ?? '').split(delimiter).filter(Boolean).map((dir) => join(dir, name));
}

export function calibreTool(name: string): string | null {
  return candidatePaths(name).find((p) => existsSync(p) && isExecutable(p)) ?? null;
}

export function isCalibreAvailable(): boolean {
  return calibreTool('ebook-convert') !== null;
}

export class CalibreMissingError extends Error {
  constructor() {
    super("Calibre's ebook-convert was not found.");
    this.name = 'CalibreMissingError';
  }
}

export class CalibreFailedError extends Error {
  constructor(detail: string) {
    super(`ebook-convert failed: ${detail}`);
    this.name = 'CalibreFailedError';
  }
}

/** Exported because export/kfx.ts runs the same tool with the same guards. */
export async function runCalibre(tool: string, args: string[]): Promise<void> {
  const proc = Bun.spawn([tool, ...args], { stdout: 'pipe', stderr: 'pipe' });
  const [code, stderr] = await Promise.all([proc.exited, new Response(proc.stderr).text()]);
  if (code !== 0) throw new CalibreFailedError(stderr.trim() || `exit ${code}`);
}

/** Convert an EPUB to AZW3 next to it (~1s; no caching — a stale cache would
 * outlive conversion-recipe changes). */
export async function toAzw3(epub: string): Promise<string> {
  const tool = calibreTool('ebook-convert');
  if (!tool) throw new CalibreMissingError();
  const azw3 = `${epub.replace(/\.epub$/i, '')}.azw3`;
  await runCalibre(tool, [epub, azw3, ...CALIBRE_FORMAT_GUARDS]);
  if (!existsSync(azw3)) {
    throw new CalibreFailedError('ebook-convert exited cleanly but produced no .azw3');
  }
  return azw3;
}

/** Convert an EPUB to KEPUB for Kobo's own renderer (Calibre 7.1+ emits
 * KEPUB with sentence-level koboSpan markup when the output extension is
 * `.kepub`). Two-step, matching EbookConvert.swift exactly: ebook-convert
 * selects its OUTPUT FORMAT from the output file's extension, so converting
 * straight to `<stem>.kepub.epub` makes it see ".epub" and emit a plain
 * EPUB with no koboSpan markup at all — the one thing that makes this a
 * KEPUB. Convert to `<stem>.kepub` first, then rename to the double
 * extension the Kobo renderer selects on.
 *
 * DELIBERATE DIVERGENCE from EbookConvert.swift (2026-09-12): the Swift
 * passes the guards to toAzw3 but not here, and this port passes them to
 * both. That difference was carried across faithfully at first, on the
 * rule that device behavior nobody can re-verify gets preserved rather
 * than "fixed" — but the rule does not apply, because the guards are not
 * device behavior. `--disable-remove-fake-margins` governs how Calibre
 * READS the EPUB: the heuristic strips per-block side margins during
 * input processing, before the output format is chosen, and the Swift's
 * own note records it deleting them "regardless of unit". A screenplay's
 * dialogue column is exactly what it mistakes for publisher page margins,
 * so KEPUB is affected for the same reason AZW3 was — device-verified
 * 2026-07-29 on the AZW3 path. The Swift omission reads as a plain bug.
 *
 * Consequence: TypeScript and Swift now disagree here until the Swift app
 * retires (cross-platform piece F). Nothing consumes this function yet,
 * so no user sees either behavior. Still unconfirmed on real hardware —
 * no Kobo has ever been connected to this project — so this stays on the
 * device-checklist for the first Kobo pass. */
export async function toKepub(epub: string): Promise<string> {
  const tool = calibreTool('ebook-convert');
  if (!tool) throw new CalibreMissingError();
  const stem = epub.replace(/\.epub$/i, '');
  const raw = `${stem}.kepub`;
  const kepub = `${stem}.kepub.epub`;
  await runCalibre(tool, [epub, raw, ...CALIBRE_FORMAT_GUARDS]);
  if (!existsSync(raw)) {
    throw new CalibreFailedError('ebook-convert exited cleanly but produced no .kepub');
  }
  rmSync(kepub, { force: true });
  renameSync(raw, kepub);
  return kepub;
}
