import { test, expect, test as bunTest } from 'bun:test';
import { accessSync, constants, mkdtempSync, writeFileSync, readFileSync, chmodSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, delimiter } from 'node:path';
import { platform } from 'node:process';
import JSZip from 'jszip';
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

// ebook-convert selects its OUTPUT FORMAT from the output file's extension,
// so toKepub must convert to `<stem>.kepub` first and only THEN rename to
// `<stem>.kepub.epub` -- writing straight to the double extension would make
// real Calibre see ".epub" and emit a plain EPUB with no koboSpan markup at
// all. A fake ebook-convert that just touches whatever path it's told to
// write lets us prove the two-step shape without Calibre installed: it
// fails closed (CalibreFailedError, "no .kepub") if toKepub ever regresses
// to the single-step form, because the fake would then create `.kepub.epub`
// directly and the intermediate `.kepub` existsSync check would find nothing.
test('toKepub converts to .kepub then renames to .kepub.epub (fake ebook-convert)', async () => {
  if (!describesPathScan) return;
  if (calibreTool('ebook-convert')) return; // never shadow a real install

  const toolDir = mkdtempSync(join(tmpdir(), 'screepub-calibre-fake-'));
  const name = platform === 'win32' ? 'ebook-convert.exe' : 'ebook-convert';
  const fakeTool = join(toolDir, name);
  const argvLog = join(toolDir, 'argv.log');
  // Logs the exact argv it received (one per line, so a guard flag
  // containing "=" or "/" round-trips safely), then touches the output path
  // it's told to write, mimicking ebook-convert's own file creation.
  writeFileSync(fakeTool, `#!/bin/sh\nfor a in "$@"; do echo "$a"; done > "${argvLog}"\ntouch "$2"\n`);
  chmodSync(fakeTool, 0o755);

  const originalPath = process.env.PATH;
  process.env.PATH = `${toolDir}${delimiter}${originalPath ?? ''}`;
  try {
    const workDir = mkdtempSync(join(tmpdir(), 'screepub-calibre-work-'));
    const epub = join(workDir, 'book.epub');
    writeFileSync(epub, 'fake epub bytes');
    const rawKepub = join(workDir, 'book.kepub');
    const finalKepub = join(workDir, 'book.kepub.epub');
    writeFileSync(finalKepub, 'stale leftover'); // proves the rmSync-before-rename step

    const out = await toKepub(epub);

    expect(out).toBe(finalKepub);
    expect(out.endsWith('.kepub.epub')).toBe(true);
    expect(existsSync(rawKepub)).toBe(false); // renamed away, not left behind
    expect(readFileSync(out, 'utf8')).not.toBe('stale leftover'); // overwritten

    // Ruling B: toKepub must call ebook-convert with exactly [epub, raw] --
    // no CALIBRE_FORMAT_GUARDS, matching EbookConvert.swift's toKepub
    // (which passes guards to toAzw3 but not here). This is a deliberately
    // preserved discrepancy pending a Kobo hardware pass, not an oversight
    // to "fix" by making the two recipes consistent.
    const argv = readFileSync(argvLog, 'utf8').split('\n').filter(Boolean);
    expect(argv).toEqual([epub, rawKepub]);
    for (const guard of CALIBRE_FORMAT_GUARDS) {
      expect(argv).not.toContain(guard);
    }
  } finally {
    process.env.PATH = originalPath;
  }
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

withCalibre('toKepub names its output .kepub.epub AND emits koboSpan markup', async () => {
  // The filename alone proves nothing: the BROKEN single-step form produces
  // a file with this same name -- a plain EPUB with no koboSpan markup at
  // all. koboSpan is the only assertion that discriminates the two, which is
  // why kit-check asserted both halves (KitCheck/main.swift:349-350) and why
  // the fake-tool test above cannot stand in for it: it self-skips on every
  // machine that actually has Calibre.
  const out = await toKepub(await minimalEpub());
  expect(out.endsWith('.kepub.epub')).toBe(true);
  // kit-check used zipgrep; an EPUB is a deflated zip, so the marker is not
  // in the raw bytes and the entries have to be inflated to see it.
  const zip = await JSZip.loadAsync(readFileSync(out));
  const entries = Object.values(zip.files).filter((f) => !f.dir);
  const texts = await Promise.all(entries.map((f) => f.async('string')));
  expect(texts.some((t) => t.includes('koboSpan'))).toBe(true);
}, 120_000);
