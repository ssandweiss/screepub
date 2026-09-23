// The only KFX writer in existence is inside Amazon's Kindle Previewer, so
// the KFX rung needs Calibre + Kindle Previewer + jhowell's KFX Output
// plugin, which drives Previewer headlessly. Amazon ships Previewer for
// macOS and Windows only: on Linux this rung is simply never ready, and
// formats.ts's ladder degrades to AZW3 without any special-casing.
//
// Plugin INSTALLATION lives at the bottom of this file. It used to be
// deferred because it "needs the vendored 485 KB zip"; there is no zip now,
// and that is the point — see the comment above installKfxPlugin.
import { existsSync, mkdtempSync, renameSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
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
  // Kindle Previewer, which the plugin runs to do the real conversion,
  // writes a <uuid>/ folder into the temp folder on EVERY run (conv_out/,
  // conversionLog.csv, an intermediate .mobi; about 250 KB) and never
  // removes it. Measured 2026-09-22 with Calibre, KFX Output and Previewer
  // 3 on macOS: one conversion, one new folder in $TMPDIR, and 189 had
  // piled up there. Previewer honours TMPDIR (same measurement, redirected:
  // the folder landed in the redirect instead), and the plugin passes
  // TMPDIR, TMP and TEMP through to it, so each conversion gets a temp
  // folder of its own and loses it, whatever Previewer left inside, when
  // the conversion ends either way. TMP and TEMP are Windows's names for
  // the same thing; Previewer on Windows has not been measured.
  const previewerTmp = mkdtempSync(join(tmpdir(), 'screepub-kfx-'));
  const env = { ...process.env, TMPDIR: previewerTmp, TMP: previewerTmp, TEMP: previewerTmp };
  onStage?.('converting to KFX (Kindle Previewer can take ~20s to start)…');
  try {
    await runCalibre(tool, [epub, scratch, ...CALIBRE_FORMAT_GUARDS], env);
    if (!existsSync(scratch)) {
      throw new CalibreFailedError('ebook-convert exited cleanly but produced no .kfx');
    }
    rmSync(kfx, { force: true });
    renameSync(scratch, kfx);
  } catch (error) {
    rmSync(scratch, { force: true });
    throw error;
  } finally {
    rmSync(previewerTmp, { recursive: true, force: true });
  }
  return kfx;
}

// ── installing jhowell's plugin, without shipping a copy of it ───────
//
// The header above says installation was deferred because it "needs the
// vendored 485 KB zip". That premise is gone: there is no zip. Calibre's
// own plugin index is the upstream and Calibre's own add_plugin is the
// installer, so the user gets whatever version is current on the day they
// ask rather than whatever we last vendored. The Swift app's copy was
// pinned at 2.12.0 and was a FORK; the index currently offers 2.20.1.
//
// Not shipping it also drops a GPL-3 redistribution obligation and the
// THIRD-PARTY-NOTICES entries that went with it.
//
// This runs inside Calibre's Python (`calibre-debug -c`) because everything
// it needs lives there: bz2 for the index, Calibre's cert-pinned fetch for
// the index itself, and add_plugin. Our side is one spawn and one JSON line.
//
// Integrity: the index declares the zip's exact byte size and the download
// is refused unless it matches. That is weaker than a signature, which does
// not exist for this plugin, and it is the honest limit of what can be
// checked. The index fetch uses Calibre's pinned CA; the zip download
// cannot, because the mirror's cert does not validate under that pinning.
//
// NEVER call this on its own initiative. It writes to the user's Calibre
// and fetches third-party code over the network, so it belongs behind an
// explicit request. It is also the one thing in this module that needs a
// network at all (registry: everything else works offline).
const INSTALL_SNIPPET = `
import bz2, io, json, os, tempfile, urllib.request, zipfile
try:
    from calibre.utils.https import get_https_resource_securely
    from calibre.gui2.dialogs.plugin_updater import INDEX_URL
    from calibre.customize.ui import (
        add_plugin, initialized_plugins, output_format_plugins, remove_plugin)

    # Raised only around the two NETWORK fetches below, so the outer except
    # clauses can tell "could not reach the index or the zip" (most likely:
    # offline) apart from every other way this can fail, and report the
    # first one as one plain sentence instead of raw urllib/http text.
    class Unreachable(Exception):
        pass

    # Clear FORKS first. A variant registers the same internal package
    # (calibre_plugins.kfx_output) under a different plugin NAME, so calibre
    # happily holds both and the new plugin's code then imports the fork's
    # kfxlib -- KFX conversion dies with ImportError and the toolchain still
    # reports ready. Adding without clearing is worse than not installing.
    #
    # Only CONVERSION OUTPUT plugins can collide for the .kfx slot, and
    # calibre is asked which those are rather than guessed at by name. A
    # name-only test also matched "Set KFX metadata (from KFX Output)",
    # which is the companion metadata writer shipping in the same zip, and
    # deleted it; it survived only because add_plugin put it back.
    outs = set()
    for p in output_format_plugins():
        outs.add(getattr(p, 'name', ''))
    removed = []
    for p in list(initialized_plugins()):
        n = getattr(p, 'name', '')
        if n in outs and 'KFX Output' in n and n != 'KFX Output':
            remove_plugin(p)
            removed.append(n)
    try:
        idx_raw = get_https_resource_securely(INDEX_URL)
    except Exception as e:
        raise Unreachable(str(e))
    idx = json.loads(bz2.decompress(idx_raw).decode('utf-8'))
    meta = idx.get('KFX Output')
    if meta is None:
        raise RuntimeError('KFX Output is not in calibre\\'s plugin index')
    try:
        data = urllib.request.urlopen(
            'https://plugins.calibre-ebook.com/' + meta['file'], timeout=120).read()
    except Exception as e:
        raise Unreachable(str(e))
    if len(data) != meta['size']:
        raise RuntimeError('downloaded %d bytes, index says %d' % (len(data), meta['size']))
    if '__init__.py' not in zipfile.ZipFile(io.BytesIO(data)).namelist():
        raise RuntimeError('downloaded file is not a calibre plugin')
    fd, path = tempfile.mkstemp(suffix='.zip')
    try:
        os.write(fd, data); os.close(fd)
        add_plugin(path)
    finally:
        os.unlink(path)
    print('SCREEPUB_RESULT ' + json.dumps(
        {'ok': True, 'version': '.'.join(map(str, meta['version'])), 'removed': removed}))
except Unreachable as e:
    print('SCREEPUB_RESULT ' + json.dumps({'ok': False, 'error': str(e), 'offline': True}))
except Exception as e:
    print('SCREEPUB_RESULT ' + json.dumps({'ok': False, 'error': str(e)}))
`;

export interface KfxInstallResult {
  ok: boolean;
  /** The version Calibre installed, when it succeeded. */
  version?: string;
  /** Why not, in words a user can act on. */
  reason?: string;
  /** Conflicting KFX forks cleared to make room. Usually empty; non-empty
   *  for anyone upgrading from the Swift app's vendored copy, which
   *  installs under a different NAME and would otherwise break conversion
   *  outright. Worth surfacing: we removed something they installed. */
  removed?: string[];
}

type DebugRunner = (argv: string[]) => Promise<{ code: number; stdout: string; stderr: string }>;

const realDebugRun: DebugRunner = async (argv) => {
  const proc = Bun.spawn(argv, { stdout: 'pipe', stderr: 'pipe' });
  const [code, stdout, stderr] = await Promise.all([
    proc.exited,
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);
  return { code, stdout, stderr };
};

/**
 * Install (or update to) the current KFX Output plugin, using Calibre's own
 * index and installer. Never throws: the KFX rung is the top of a ladder
 * that degrades to AZW3 then MOBI, so a failure here must not take the
 * caller down with it.
 */
export async function installKfxPlugin(
  run: DebugRunner = realDebugRun,
  debugTool: string | null = calibreTool('calibre-debug'),
): Promise<KfxInstallResult> {
  if (!debugTool) {
    return { ok: false, reason: "Calibre was not found, and the plugin lives inside it." };
  }
  const { code, stdout, stderr } = await run([debugTool, '-c', INSTALL_SNIPPET]);
  // The result LINE decides, not the exit code: calibre-debug exits 0 for a
  // snippet that caught its own exception, so a bare exit code would read a
  // reported failure as success.
  const line = stdout.split('\n').find((l) => l.startsWith('SCREEPUB_RESULT '));
  if (!line) {
    const detail = (stderr.trim() || stdout.trim() || `calibre-debug exited ${code}`).slice(0, 400);
    return { ok: false, reason: detail };
  }
  try {
    const parsed = JSON.parse(line.slice('SCREEPUB_RESULT '.length)) as {
      ok?: boolean; version?: string; error?: string; removed?: string[]; offline?: boolean;
    };
    if (parsed.ok && parsed.version) {
      return { ok: true, version: parsed.version, removed: parsed.removed ?? [] };
    }
    if (parsed.offline) {
      return {
        ok: false,
        reason: "could not reach Calibre's plugin index. Check the internet connection, then try again.",
      };
    }
    return { ok: false, reason: parsed.error ?? 'calibre reported a failure with no reason' };
  } catch {
    return { ok: false, reason: `could not read calibre's answer: ${line.slice(0, 200)}` };
  }
}
