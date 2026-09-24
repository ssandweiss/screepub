import { afterAll, test, expect, test as bunTest } from 'bun:test';
import { accessSync, constants, mkdtempSync, writeFileSync, readFileSync, chmodSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, delimiter } from 'node:path';
import { platform } from 'node:process';
import JSZip from 'jszip';
import {
  CALIBRE_FORMAT_GUARDS,
  azw3ScratchPath,
  azw3Sibling,
  calibreTool,
  isCalibreAvailable,
  toAzw3,
  toKepub,
  CalibreFailedError,
  CalibreMissingError,
} from '../src/export/calibre';
import { convertFountain } from '../src/convert';

const SCRATCH = mkdtempSync(join(tmpdir(), 'screepub-export-calibre-'));
afterAll(() => rmSync(SCRATCH, { recursive: true, force: true }));

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
  const dir = mkdtempSync(join(SCRATCH, 'calibre-path-'));
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
  const dir = mkdtempSync(join(SCRATCH, 'calibre-path-'));
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

  const toolDir = mkdtempSync(join(SCRATCH, 'calibre-fake-'));
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
    const workDir = mkdtempSync(join(SCRATCH, 'calibre-work-'));
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

    // toKepub converts to the RAW .kepub path (the extension is what makes
    // ebook-convert emit KEPUB at all) and passes the same guard trio as
    // toAzw3. EbookConvert.swift omits the guards here; this port applies
    // them deliberately, because remove-fake-margins is an input-side
    // heuristic that strips the dialogue column's side margins before the
    // output format is even chosen -- see the note on toKepub. A regression
    // back to the Swift's guard-free call fails this.
    const argv = readFileSync(argvLog, 'utf8').split('\n').filter(Boolean);
    expect(argv).toEqual([epub, rawKepub, ...CALIBRE_FORMAT_GUARDS]);
  } finally {
    process.env.PATH = originalPath;
  }
});

// --- toAzw3 driven for real against a fake ebook-convert, through the same
// tool seam toKfx has (a machine with Calibre installed resolves the real
// one from a fixed path before PATH, so PATH-shadowing cannot reach it).
// The AZW3 rung now reuses a fresh .azw3 (artifact.ts), so a half-written
// one must never sit at the final path: it would be newer than its EPUB and
// trusted as fresh forever. Same scratch-then-rename discipline as toKfx.

function fakeAzw3Tool(exitCode: number): { tool: string; argvLog: string; epub: string } {
  const toolDir = mkdtempSync(join(SCRATCH, 'azw3-fake-'));
  const tool = join(toolDir, 'ebook-convert');
  const argvLog = join(toolDir, 'argv.log');
  // Logs argv one entry per line, writes something to the output path it
  // was told to (a partial file, when it then fails), and exits as told.
  writeFileSync(
    tool,
    `#!/bin/sh\nfor a in "$@"; do echo "$a"; done > "${argvLog}"\necho converted > "$2"\nexit ${exitCode}\n`,
  );
  chmodSync(tool, 0o755);
  const epub = join(mkdtempSync(join(SCRATCH, 'azw3-work-')), 'book.epub');
  writeFileSync(epub, 'fake epub bytes');
  return { tool, argvLog, epub };
}

test('azw3Sibling: same directory, same stem, .azw3, whatever the case of .epub', () => {
  expect(azw3Sibling(join('/tmp', 'lib', 'Script.epub'))).toBe(join('/tmp', 'lib', 'Script.azw3'));
  expect(azw3Sibling(join('/tmp', 'lib', 'Script.EPUB'))).toBe(join('/tmp', 'lib', 'Script.azw3'));
});

test('the AZW3 scratch path is hidden, same-directory, and keeps the .azw3 extension', () => {
  // ebook-convert picks its output format from the extension, so the
  // scratch must end in .azw3; the leading dot keeps it out of sight.
  expect(azw3ScratchPath(join('/tmp', 'dir', 'Book.EPUB'))).toBe(join('/tmp', 'dir', '.Book.partial.azw3'));
});

test('toAzw3 converts into the scratch path, then renames it onto azw3Sibling', async () => {
  if (platform === 'win32') return; // the fake tool is a /bin/sh script
  const { tool, argvLog, epub } = fakeAzw3Tool(0);
  writeFileSync(azw3Sibling(epub), 'an older conversion');

  const out = await toAzw3(epub, { tool: () => tool });

  expect(out).toBe(azw3Sibling(epub));
  const argv = readFileSync(argvLog, 'utf8').split('\n').filter(Boolean);
  expect(argv).toEqual([epub, azw3ScratchPath(epub), ...CALIBRE_FORMAT_GUARDS]);
  expect(existsSync(azw3ScratchPath(epub))).toBe(false); // renamed away
  expect(readFileSync(out, 'utf8')).toBe('converted\n'); // replaced the older one
});

test('a failed conversion leaves no scratch behind and never touches the .azw3 already there', async () => {
  if (platform === 'win32') return;
  const { tool, epub } = fakeAzw3Tool(1);
  writeFileSync(azw3Sibling(epub), 'an older conversion');

  await expect(toAzw3(epub, { tool: () => tool })).rejects.toThrow(CalibreFailedError);

  expect(existsSync(azw3ScratchPath(epub))).toBe(false);
  expect(readFileSync(azw3Sibling(epub), 'utf8')).toBe('an older conversion');
});

test('a tool that exits cleanly but writes nothing is a failure, not a missing file returned', async () => {
  if (platform === 'win32') return;
  const toolDir = mkdtempSync(join(SCRATCH, 'azw3-silent-'));
  const tool = join(toolDir, 'ebook-convert');
  writeFileSync(tool, '#!/bin/sh\nexit 0\n');
  chmodSync(tool, 0o755);
  const epub = join(mkdtempSync(join(SCRATCH, 'azw3-work-')), 'book.epub');
  writeFileSync(epub, 'fake epub bytes');

  await expect(toAzw3(epub, { tool: () => tool })).rejects.toThrow('produced no .azw3');
  expect(existsSync(azw3Sibling(epub))).toBe(false);
});

test('toAzw3 with no tool at all is CalibreMissingError', async () => {
  await expect(toAzw3(join(SCRATCH, 'never.epub'), { tool: () => null })).rejects.toThrow(CalibreMissingError);
});

async function minimalEpub(): Promise<string> {
  const dir = mkdtempSync(join(SCRATCH, 'test-'));
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
