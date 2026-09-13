// The only KFX writer in existence is inside Amazon's Kindle Previewer, so
// the KFX rung needs Calibre + Kindle Previewer + jhowell's KFX Output
// plugin, which drives Previewer headlessly. Amazon ships Previewer for
// macOS and Windows only: on Linux this rung is simply never ready, and
// formats.ts's ladder degrades to AZW3 without any special-casing.
//
// Plugin INSTALLATION is deferred to piece C — it needs the vendored 485 KB
// zip, and how a `bun build --compile` binary embeds a binary asset is a
// packaging decision that belongs with app packaging. This module reads
// (discovery, status) and performs one write (conversion).
import { existsSync, renameSync, rmSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { platform } from 'node:process';
import { calibreTool, runCalibre, CALIBRE_FORMAT_GUARDS, CalibreMissingError, CalibreFailedError } from './calibre';

export interface KfxStatus {
  calibre: boolean;
  previewer: boolean;
  /** Only meaningful when `calibre` is true — the plugin lives inside it. */
  pluginInstalled: boolean;
  ready: boolean;
}

export function previewerPath(): string | null {
  if (platform === 'darwin') {
    const app = '/Applications/Kindle Previewer 3.app';
    return existsSync(app) ? app : null;
  }
  if (platform === 'win32') {
    const local = process.env.LOCALAPPDATA;
    if (!local) return null;
    const exe = join(local, 'Amazon', 'Kindle Previewer 3', 'Kindle Previewer 3.exe');
    return existsSync(exe) ? exe : null;
  }
  return null;
}

async function pluginInstalled(customize: string): Promise<boolean> {
  const proc = Bun.spawn([customize, '--list-plugins'], { stdout: 'pipe', stderr: 'pipe' });
  const [code, stdout] = await Promise.all([proc.exited, new Response(proc.stdout).text()]);
  return code === 0 && stdout.includes('KFX Output');
}

/** The conjunction behind `KfxStatus.ready`, pulled out as a pure function
 * and exported (marked internal, not part of the module's real interface)
 * only so the AND itself can be unit-tested with synthetic booleans. `ready`
 * can never actually be `true` on a platform where `previewerPath()` has no
 * branch (Linux) — Amazon ships no build there — so without this function
 * the conjunction's correctness would be provable only on macOS/Windows
 * hardware with Kindle Previewer installed. */
export function computeReady(s: { calibre: boolean; previewer: boolean; pluginInstalled: boolean }): boolean {
  return s.calibre && s.previewer && s.pluginInstalled;
}

/** What's present on this machine. Spawns `calibre-customize` (~1s of Python
 * startup) only when Calibre is actually present. */
export async function kfxStatus(): Promise<KfxStatus> {
  const customize = calibreTool('calibre-customize');
  const calibre = customize !== null;
  const previewer = previewerPath() !== null;
  const installed = calibre ? await pluginInstalled(customize) : false;
  return {
    calibre,
    previewer,
    pluginInstalled: installed,
    ready: computeReady({ calibre, previewer, pluginInstalled: installed }),
  };
}

/** The sibling `.kfx` for a given EPUB — same directory, same stem. Exported
 * so callers (including a later export-ladder task) derive the path here
 * rather than repeating the regex; mirrors Export.swift's mobiSibling(for:)
 * precedent. */
export function kfxSibling(epub: string): string {
  return `${epub.replace(/\.epub$/i, '')}.kfx`;
}

/** Hidden same-directory scratch the conversion writes into, mirroring
 * KFXToolchain.scratchURL exactly. Three constraints meet in this one name:
 * same DIRECTORY means same volume, so promoting the finished file is a
 * rename and not a copy; the `.kfx` EXTENSION has to survive, because
 * ebook-convert picks its output format from the extension and dies on
 * anything it does not recognise ("No plugin to handle output format: tmp");
 * and the LEADING DOT keeps Finder, library scans and the staleness rung
 * blind to a file that is not finished yet. */
export function kfxScratchPath(epub: string): string {
  const stem = basename(epub).replace(/\.epub$/i, '');
  return join(dirname(epub), `.${stem}.partial.kfx`);
}

export class KfxToolchainNotReadyError extends Error {
  constructor(status: { calibre: boolean; previewer: boolean; pluginInstalled: boolean }) {
    const missing: string[] = [];
    if (!status.calibre) missing.push('Calibre');
    if (!status.previewer) missing.push('Kindle Previewer');
    if (status.calibre && !status.pluginInstalled) missing.push('the KFX plugin');
    super(`KFX conversion needs ${missing.join(' and ')}.`);
    this.name = 'KfxToolchainNotReadyError';
  }
}

/** Injectable seams, present only so `toKfx` is testable. Both default to the
 * real thing. `tool` exists because the PATH-shadowing trick the other
 * Calibre tests use cannot reach a machine that has a REAL Calibre —
 * calibreTool checks the fixed install paths before PATH — and the argv this
 * function hands ebook-convert (specifically the output EXTENSION) has now
 * been wrong three times in this branch, so it needs a test everywhere, not
 * just on bare runners. */
export interface KfxDeps {
  tool?: () => string | null;
  status?: () => Promise<KfxStatus>;
}

/** Convert an EPUB to KFX. Runs the same guard trio as the AZW3 recipe, from
 * the same constant, so a device-validated flag change lands on both rungs or
 * neither. Writes to a scratch path and renames into place, so a partial file
 * never appears where a freshness check would trust it — see kfxScratchPath
 * for what constrains that name. Most of the wall-clock is Kindle Previewer
 * cold-starting, hence onStage. */
export async function toKfx(
  epub: string,
  onStage?: (stage: string) => void,
  deps: KfxDeps = {},
): Promise<string> {
  const tool = (deps.tool ?? (() => calibreTool('ebook-convert')))();
  if (!tool) throw new CalibreMissingError();
  // KFXToolchain.convert's opening guard. Without it a machine that has
  // Calibre but not Previewer or the plugin gets ebook-convert's raw Python
  // failure instead of a sentence naming what to install. DIVERGENCE: Swift
  // checks readiness FIRST and reports a missing Calibre through the same
  // error; the port keeps CalibreMissingError ahead of it because that error
  // is the more precise answer and other call sites already discriminate on
  // it. (Swift's status() is cached, so its guard is ~free; ours re-probes,
  // which costs ~1s of Python startup against a ~20s conversion.)
  const status = await (deps.status ?? kfxStatus)();
  if (!status.ready) throw new KfxToolchainNotReadyError(status);
  const kfx = kfxSibling(epub);
  const scratch = kfxScratchPath(epub);
  onStage?.('converting to KFX (Kindle Previewer can take ~20s to start)…');
  try {
    await runCalibre(tool, [epub, scratch, ...CALIBRE_FORMAT_GUARDS]);
    if (!existsSync(scratch)) {
      throw new CalibreFailedError('ebook-convert exited cleanly but produced no .kfx');
    }
    rmSync(kfx, { force: true });
    renameSync(scratch, kfx);
  } catch (error) {
    rmSync(scratch, { force: true });
    throw error;
  }
  return kfx;
}
