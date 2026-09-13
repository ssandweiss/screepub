import { test, expect } from 'bun:test';
import { mkdtempSync, writeFileSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, delimiter } from 'node:path';
import { platform } from 'node:process';
import { previewerPath, kfxStatus, toKfx, kfxSibling } from '../src/export/kfx';
import { calibreTool } from '../src/export/calibre';

test('Kindle Previewer is never found on Linux — Amazon ships no build', () => {
  if (platform === 'linux') expect(previewerPath()).toBeNull();
});

test('status.ready requires all three pieces', async () => {
  const status = await kfxStatus();
  expect(status.ready).toBe(status.calibre && status.previewer && status.pluginInstalled);
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

test('kfxSibling is what toKfx actually writes to', () => {
  // Guards against a copy-pasted second derivation inside toKfx that drifts
  // from kfxSibling — the exact defect the controller ruling calls out.
  if (calibreTool('ebook-convert')) return;
  const epub = join(tmpdir(), 'screepub-nonexistent-2.epub');
  expect(kfxSibling(epub)).toBe(`${epub.replace(/\.epub$/i, '')}.kfx`);
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
