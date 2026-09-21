import { describe, test, expect } from 'bun:test';
import { mkdtempSync, writeFileSync, readFileSync, chmodSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, delimiter } from 'node:path';
import { platform } from 'node:process';
import {
  installKfxPlugin,
  previewerPath,
  kfxStatus,
  toKfx,
  kfxSibling,
  kfxScratchPath,
  computeReady,
  KfxToolchainNotReadyError,
} from '../src/export/kfx';
import { calibreTool, CALIBRE_FORMAT_GUARDS } from '../src/export/calibre';

test('Kindle Previewer is never found on Linux — Amazon ships no build', () => {
  if (platform === 'linux') expect(previewerPath()).toBeNull();
});

test('status.ready requires all three pieces', async () => {
  const status = await kfxStatus();
  expect(status.ready).toBe(status.calibre && status.previewer && status.pluginInstalled);
});

// computeReady: the AND behind `ready`, tested directly with synthetic
// booleans. This is what makes the conjunction provable on Linux, where
// `previewer` can never actually be true (Amazon ships no build) so the
// test above can never distinguish a correct three-way AND from a buggy
// two-way one. Each single-false case pins one term; a mutant dropping any
// one term from the AND fails at least one of these.
test('computeReady is true only when calibre, previewer, and pluginInstalled are all true', () => {
  expect(computeReady({ calibre: true, previewer: true, pluginInstalled: true })).toBe(true);
});

test('computeReady is false when calibre is false', () => {
  expect(computeReady({ calibre: false, previewer: true, pluginInstalled: true })).toBe(false);
});

test('computeReady is false when previewer is false', () => {
  expect(computeReady({ calibre: true, previewer: false, pluginInstalled: true })).toBe(false);
});

test('computeReady is false when pluginInstalled is false', () => {
  expect(computeReady({ calibre: true, previewer: true, pluginInstalled: false })).toBe(false);
});

test('status.calibre agrees with Calibre discovery', async () => {
  const status = await kfxStatus();
  expect(status.calibre).toBe(calibreTool('calibre-customize') !== null);
});

test('pluginInstalled is false whenever Calibre is absent', async () => {
  // The plugin lives inside Calibre, so it cannot be installed without it.
  const status = await kfxStatus();
  if (!status.calibre) expect(status.pluginInstalled).toBe(false);
});

test('on Linux the KFX rung is never ready, so the ladder degrades', async () => {
  if (platform === 'linux') expect((await kfxStatus()).ready).toBe(false);
});

test('toKfx refuses outright when Calibre is absent', async () => {
  // The conversion itself cannot be exercised without Kindle Previewer, which
  // Amazon ships for macOS and Windows only — that path is covered by the
  // hardware pass in piece C. What IS testable everywhere is that it fails
  // honestly rather than reporting success with no file.
  if (calibreTool('ebook-convert')) return;
  await expect(toKfx(join(tmpdir(), 'screepub-nonexistent.epub'))).rejects.toThrow(
    'ebook-convert was not found',
  );
});

// --- kfxSibling: exported per the controller ruling so a later task (the
// export ladder) imports this derivation instead of repeating the regex.
// Mirrors Export.swift's mobiSibling(for:) precedent.

test('kfxSibling derives same directory, same stem, .kfx extension', () => {
  expect(kfxSibling('/tmp/book.epub')).toBe('/tmp/book.kfx');
});

test('kfxSibling matches the extension case-insensitively', () => {
  expect(kfxSibling('/tmp/Book.EPUB')).toBe('/tmp/Book.kfx');
});

// --- toKfx driven for real against a fake ebook-convert. The tool and the
// status probe are injected rather than PATH-shadowed, because this machine
// (and any machine with Calibre installed) resolves ebook-convert from a
// fixed install path before PATH, and because `ready` can never be true on
// Linux. Everything else — argv, the scratch file, the rename — is real.

function fakeEbookConvert(): { tool: string; argvLog: string; workDir: string } {
  const toolDir = mkdtempSync(join(tmpdir(), 'screepub-kfx-fake-'));
  const name = platform === 'win32' ? 'ebook-convert.exe' : 'ebook-convert';
  const tool = join(toolDir, name);
  const argvLog = join(toolDir, 'argv.log');
  // Logs argv one entry per line, then touches the output path it was told
  // to write — mimicking ebook-convert's own file creation.
  writeFileSync(tool, `#!/bin/sh\nfor a in "$@"; do echo "$a"; done > "${argvLog}"\ntouch "$2"\n`);
  chmodSync(tool, 0o755);
  const workDir = mkdtempSync(join(tmpdir(), 'screepub-kfx-work-'));
  return { tool, argvLog, workDir };
}

const READY: Awaited<ReturnType<typeof kfxStatus>> = {
  calibre: true,
  previewer: true,
  pluginInstalled: true,
  ready: true,
};

test('toKfx writes to a .kfx scratch path and renames it onto kfxSibling', async () => {
  // Regression pin for the defect that made toKfx unrunnable: the scratch
  // path ended in `.tmp`, and ebook-convert picks its OUTPUT FORMAT from the
  // extension ("ValueError: No plugin to handle output format: tmp").
  // Verified against Calibre 8.7.0. This is the third time in this branch
  // that Calibre's extension rule has bitten, hence a test and not a comment.
  if (platform === 'win32') return; // the fake tool is a /bin/sh script
  const { tool, argvLog, workDir } = fakeEbookConvert();
  const epub = join(workDir, 'book.epub');
  writeFileSync(epub, 'fake epub bytes');

  const out = await toKfx(epub, undefined, { tool: () => tool, status: async () => READY });

  expect(out).toBe(kfxSibling(epub));
  const argv = readFileSync(argvLog, 'utf8').split('\n').filter(Boolean);
  expect(argv[0]).toBe(epub);
  expect(argv[1].endsWith('.kfx')).toBe(true);
  expect(argv[1]).toBe(kfxScratchPath(epub));
  expect(argv.slice(2)).toEqual([...CALIBRE_FORMAT_GUARDS]);
  expect(existsSync(kfxScratchPath(epub))).toBe(false); // renamed away
  expect(existsSync(out)).toBe(true);
});

test('the scratch path is hidden, same-directory, and keeps the .kfx extension', () => {
  expect(kfxScratchPath('/tmp/dir/Book.EPUB')).toBe('/tmp/dir/.Book.partial.kfx');
});

test('toKfx refuses when the toolchain is not ready, naming what is missing', async () => {
  if (platform === 'win32') return;
  const { tool, workDir } = fakeEbookConvert();
  const epub = join(workDir, 'book.epub');
  writeFileSync(epub, 'fake epub bytes');
  const notReady = { calibre: true, previewer: false, pluginInstalled: false, ready: false };

  const attempt = toKfx(epub, undefined, { tool: () => tool, status: async () => notReady });

  await expect(attempt).rejects.toThrow(KfxToolchainNotReadyError);
  await expect(attempt).rejects.toThrow('KFX conversion needs Kindle Previewer and the KFX plugin.');
  expect(existsSync(kfxSibling(epub))).toBe(false); // and nothing was written
});

// --- pluginInstalled: exercised directly against a fake calibre-customize
// so the "KFX Output" substring check is actually proven, not just assumed.
// Without these, a mutant that hardcodes pluginInstalled to `calibre`
// (always true when Calibre is present) or to `false` (always, regardless
// of what calibre-customize reports) would both still pass every test above
// on this Linux dev machine, because calibre itself is absent here.

const describesPathScan = platform !== 'darwin';

function withFakeCustomize(pluginListing: string, run: (dir: string) => Promise<void>) {
  return async () => {
    if (!describesPathScan) return;
    if (calibreTool('calibre-customize')) return; // never shadow a real install
    const dir = mkdtempSync(join(tmpdir(), 'screepub-kfx-customize-'));
    const name = platform === 'win32' ? 'calibre-customize.exe' : 'calibre-customize';
    const fake = join(dir, name);
    writeFileSync(fake, `#!/bin/sh\ncat <<'EOF'\n${pluginListing}\nEOF\n`);
    chmodSync(fake, 0o755);
    const originalPath = process.env.PATH;
    process.env.PATH = `${dir}${delimiter}${originalPath ?? ''}`;
    try {
      await run(dir);
    } finally {
      process.env.PATH = originalPath;
    }
  };
}

test(
  'pluginInstalled is true when calibre-customize lists KFX Output',
  withFakeCustomize('Plugin: KFX Output (2, 17, 1) by jhowell', async () => {
    const status = await kfxStatus();
    expect(status.calibre).toBe(true);
    expect(status.pluginInstalled).toBe(true);
  }),
);

test(
  'pluginInstalled is false when calibre-customize lists other plugins but not KFX Output',
  withFakeCustomize('Plugin: Quality Check (1, 0, 0) by someone\nPlugin: Kobo Utilities (1, 0, 0) by someone', async () => {
    const status = await kfxStatus();
    expect(status.calibre).toBe(true);
    expect(status.pluginInstalled).toBe(false);
  }),
);

// ── installing jhowell's plugin without shipping a copy of it ────────
//
// The old Swift app carried a 485 KB GPL-3 zip of the KFX Output plugin and
// installed it with `calibre-customize -a`. That copy was pinned at 2.12.0
// AND was a fork, so the thing we shipped was already eight minor versions
// behind the plugin it claimed to be. Vendoring it also meant redistributing
// someone else's GPL-3 binary and keeping THIRD-PARTY-NOTICES honest about
// it.
//
// We do not ship it now. Calibre's own plugin index is the upstream, and
// Calibre's own `add_plugin` is the installer, so the newest version is
// whatever Calibre says it is on the day the user asks. Our part is one
// `calibre-debug -c` call and reading one JSON line back.
//
// This is a WRITE to the user's Calibre and it fetches third-party code over
// the network, so it is never automatic: something has to ask for it.
describe('installKfxPlugin', () => {
  const okLine = (v: string) =>
    `some calibre chatter\nSCREEPUB_RESULT ${JSON.stringify({ ok: true, version: v })}\n`;

  test('reports the version Calibre actually installed', async () => {
    const r = await installKfxPlugin(async () => ({ code: 0, stdout: okLine('2.20.1'), stderr: '' }));
    expect(r.ok).toBe(true);
    expect(r.version).toBe('2.20.1');
  });

  test('no Calibre is a named reason, not a throw', async () => {
    // The ladder still works without KFX — it degrades to AZW3 then MOBI —
    // so a missing toolchain must never take the caller down with it.
    const r = await installKfxPlugin(async () => ({ code: 127, stdout: '', stderr: '' }), null);
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/calibre/i);
  });

  test('a failed install carries Calibre’s own words', async () => {
    const r = await installKfxPlugin(async () => ({
      code: 1, stdout: '', stderr: 'urlopen error timed out',
    }));
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/timed out/);
  });

  test('output with no result line is refused rather than read as success', async () => {
    // exit 0 proves calibre-debug ran, not that the plugin landed.
    const r = await installKfxPlugin(async () => ({ code: 0, stdout: 'hello\n', stderr: '' }));
    expect(r.ok).toBe(false);
  });

  test('a result line saying failure is honoured over the exit code', async () => {
    const r = await installKfxPlugin(async () => ({
      code: 0,
      stdout: `SCREEPUB_RESULT ${JSON.stringify({ ok: false, error: 'size mismatch' })}\n`,
      stderr: '',
    }));
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/size mismatch/);
  });
});
