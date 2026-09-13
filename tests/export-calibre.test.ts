import { test, expect, test as bunTest } from 'bun:test';
import { accessSync, constants, mkdtempSync, writeFileSync, readFileSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, delimiter } from 'node:path';
import { platform } from 'node:process';
import {
  CALIBRE_FORMAT_GUARDS,
  calibreTool,
  isCalibreAvailable,
  toAzw3,
  toKepub,
  CalibreMissingError,
} from '../src/export/calibre';
import { convertFountain } from '../src/convert';

test('the format guards are exactly the device-verified trio', () => {
  // Device-verified 2026-07-29. Calibre would otherwise insert a page break
  // before every h2 (scene-per-page again) and its remove-fake-margins
  // heuristic would delete the dialogue column's side margins, which is what
  // a screenplay looks like to it. Change them in one place or not at all.
  expect([...CALIBRE_FORMAT_GUARDS]).toEqual([
    '--page-breaks-before=/',
    '--chapter-mark=none',
    '--disable-remove-fake-margins',
  ]);
});

test('isAvailable agrees with toolURL in both directions', () => {
  const tool = calibreTool('ebook-convert');
  if (tool) {
    expect(isCalibreAvailable()).toBe(true);
    expect(() => accessSync(tool, constants.X_OK)).not.toThrow();
  } else {
    expect(isCalibreAvailable()).toBe(false);
  }
});

test('an unknown tool name is not discovered', () => {
  expect(calibreTool('definitely-not-a-calibre-tool')).toBeNull();
});

// darwin's candidate list is fixed app-bundle/homebrew paths and never
// consults PATH (see src/export/calibre.ts candidatePaths); linux and win32
// both fall back to a PATH scan, which is real, controllable behavior we can
// exercise here without Calibre actually being installed.
const describesPathScan = platform !== 'darwin';

test('calibreTool discovers an executable found on PATH', () => {
  if (!describesPathScan) return;
  const dir = mkdtempSync(join(tmpdir(), 'screepub-calibre-path-'));
  const name = platform === 'win32' ? 'screepub-fake-calibre-tool.exe' : 'screepub-fake-calibre-tool';
  const fake = join(dir, name);
  writeFileSync(fake, '#!/bin/sh\nexit 0\n');
  chmodSync(fake, 0o755);
  const originalPath = process.env.PATH;
  process.env.PATH = `${dir}${delimiter}${originalPath ?? ''}`;
  try {
    // calibreTool appends the platform's exe suffix itself, so pass the bare name.
    expect(calibreTool('screepub-fake-calibre-tool')).toBe(fake);
  } finally {
    process.env.PATH = originalPath;
  }
});

test('calibreTool refuses a same-named file on PATH that is not executable', () => {
  if (!describesPathScan) return;
  const dir = mkdtempSync(join(tmpdir(), 'screepub-calibre-path-'));
  const name = platform === 'win32' ? 'screepub-fake-calibre-tool2.exe' : 'screepub-fake-calibre-tool2';
  const fake = join(dir, name);
  writeFileSync(fake, '#!/bin/sh\nexit 0\n');
  chmodSync(fake, 0o644); // present, but not executable
  const originalPath = process.env.PATH;
  process.env.PATH = `${dir}${delimiter}${originalPath ?? ''}`;
  try {
    expect(calibreTool('screepub-fake-calibre-tool2')).toBeNull();
  } finally {
    process.env.PATH = originalPath;
  }
});

// Mirrors kit-check: environment-dependent checks self-skip rather than fail,
// so CI stays green on bare runners.
const withCalibre = calibreTool('ebook-convert') ? bunTest : bunTest.skip;
// The inverse: these assert the missing-tool error path, which is only true
// to test when Calibre is genuinely absent from this machine.
const withoutCalibre = calibreTool('ebook-convert') ? bunTest.skip : bunTest;

withoutCalibre('toAzw3 throws CalibreMissingError, specifically, when Calibre is absent', async () => {
  await expect(toAzw3('/tmp/screepub-does-not-exist.epub')).rejects.toThrow(CalibreMissingError);
});

withoutCalibre('toKepub throws CalibreMissingError, specifically, when Calibre is absent', async () => {
  await expect(toKepub('/tmp/screepub-does-not-exist.epub')).rejects.toThrow(CalibreMissingError);
});

async function minimalEpub(): Promise<string> {
  const dir = mkdtempSync(join(tmpdir(), 'screepub-test-'));
  const epub = join(dir, 'book.epub');
  const result = await convertFountain('Title: Test\n\nINT. ROOM - DAY\n\nA line of action.\n');
  writeFileSync(epub, result.epub);
  return epub;
}

withCalibre('toAzw3 produces an .azw3 beside the EPUB', async () => {
  const out = await toAzw3(await minimalEpub());
  expect(out.endsWith('.azw3')).toBe(true);
  expect(readFileSync(out).length).toBeGreaterThan(0);
}, 120_000);

withCalibre('toKepub names its output .kepub.epub for Kobo', async () => {
  const out = await toKepub(await minimalEpub());
  expect(out.endsWith('.kepub.epub')).toBe(true);
}, 120_000);
