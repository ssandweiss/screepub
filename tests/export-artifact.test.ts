import { afterAll, test, expect } from 'bun:test';
import { mkdtempSync, writeFileSync, readFileSync, readdirSync, existsSync, utimesSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DEFAULT_FORMAT_OPTIONS } from '../src/options';
import { mobiSibling, availableFormats, freshKindleArtifact, CannotRegenerateError } from '../src/export/artifact';
import { kfxSibling, KfxToolchainNotReadyError } from '../src/export/kfx';
import { CalibreMissingError, CalibreFailedError } from '../src/export/calibre';

const SCRATCH = mkdtempSync(join(tmpdir(), 'screepub-export-artifact-'));
afterAll(() => rmSync(SCRATCH, { recursive: true, force: true }));

function scratch(): string {
  return mkdtempSync(join(SCRATCH, 'test-'));
}

test('the MOBI sibling shares the EPUB directory and stem', () => {
  expect(mobiSibling(join('/tmp', 'lib', 'Script.epub'))).toBe(join('/tmp', 'lib', 'Script.mobi'));
});

test('EPUB is always available; Kindle needs Calibre or an existing .mobi', () => {
  const dir = scratch();
  const epub = join(dir, 'Script.epub');
  writeFileSync(epub, 'epub');

  expect(availableFormats(epub, false)).toEqual(['epub']);
  expect(availableFormats(epub, true)).toEqual(['epub', 'kindle']);

  writeFileSync(mobiSibling(epub), 'mobi');
  expect(availableFormats(epub, false)).toEqual(['epub', 'kindle']);
});

test('a fresh .mobi beside the EPUB is reused rather than rebuilt', async () => {
  const dir = scratch();
  const epub = join(dir, 'Script.epub');
  writeFileSync(epub, 'epub');
  const mobi = mobiSibling(epub);
  writeFileSync(mobi, 'existing-mobi');
  // This filesystem's mtime resolution is coarse enough that two
  // back-to-back writeFileSync calls can land on the identical mtime, and
  // per freshness.ts a tie counts as STALE. Force an unambiguous ordering
  // (matching export-freshness.test.ts's convention) so this test exercises
  // "fresh" rather than racing the filesystem clock.
  const now = new Date();
  utimesSync(epub, new Date(now.getTime() - 10_000), new Date(now.getTime() - 10_000));
  utimesSync(mobi, now, now);

  const out = await freshKindleArtifact({
    epub,
    fountainPath: null,
    format: DEFAULT_FORMAT_OPTIONS,
    calibreAvailable: false,
    kfxReady: false,
  });
  expect(out).toBe(mobi);
  expect(readFileSync(mobi, 'utf8')).toBe('existing-mobi');
});

test('a missing .mobi with no .fountain to rebuild from is an honest error', async () => {
  const dir = scratch();
  const epub = join(dir, 'Script.epub');
  writeFileSync(epub, 'epub'); // written AFTER nothing — no .mobi exists at all
  await expect(
    freshKindleArtifact({
      epub,
      fountainPath: null,
      format: DEFAULT_FORMAT_OPTIONS,
      calibreAvailable: false,
      kfxReady: false,
    }),
  ).rejects.toThrow(CannotRegenerateError);
});

test('the MOBI branch rebuilds from the .fountain and writes a .mobi', async () => {
  const dir = scratch();
  const fountain = join(dir, 'Script.fountain');
  writeFileSync(fountain, 'Title: Test\n\nINT. ROOM - DAY\n\nA line of action.\n');
  const epub = join(dir, 'Script.epub');
  writeFileSync(epub, 'stale');

  const out = await freshKindleArtifact({
    epub,
    fountainPath: fountain,
    format: DEFAULT_FORMAT_OPTIONS,
    calibreAvailable: false,
    kfxReady: false,
  });
  expect(out).toBe(mobiSibling(epub));
  expect(existsSync(out)).toBe(true);
  // Documented side effect: this branch rewrites the EPUB in place.
  expect(readFileSync(epub, 'utf8')).not.toBe('stale');
});

test('the rebuild writes through temp files and leaves none behind', async () => {
  // Both outputs go to a hidden temp sibling and are renamed into place, so
  // an interrupted rebuild cannot leave a truncated .mobi at the final path
  // — which, being NEWER than the EPUB, the staleness rung would trust as
  // fresh forever. The crash itself isn't reproducible in a test; what is
  // testable is that the mechanism ran and cleaned up after itself.
  const dir = scratch();
  const fountain = join(dir, 'Script.fountain');
  writeFileSync(fountain, 'Title: Test\n\nINT. ROOM - DAY\n\nA line of action.\n');
  const epub = join(dir, 'Script.epub');
  writeFileSync(epub, 'stale');

  const out = await freshKindleArtifact({
    epub,
    fountainPath: fountain,
    format: DEFAULT_FORMAT_OPTIONS,
    calibreAvailable: false,
    kfxReady: false,
  });

  expect(readdirSync(dir).filter((f) => f.endsWith('.tmp'))).toEqual([]);
  // Both outputs arrived complete at their final paths. (Their mtimes can
  // still tie on a coarse-resolution filesystem, which freshness.ts counts
  // as stale — a rebuild, never a truncated file trusted as fresh.)
  expect(readFileSync(epub, 'utf8')).not.toBe('stale');
  expect(readFileSync(out).length).toBeGreaterThan(0);
});

// --- Strengthening tests beyond the brief's five: these exercise ladder
// PRECEDENCE (kfxReady > calibreAvailable > mobi rebuild). Calibre and
// Kindle Previewer are both absent on this Linux machine, so the
// Calibre-dependent branches cannot be driven to a successful conversion
// here — but precedence can still be proven either by a successful,
// calibre-free reuse of an existing fresh artifact, or by an honest
// CalibreMissingError showing the right branch was reached.

test('a fresh .kfx is reused without touching Calibre, even when calibreAvailable is also true', async () => {
  const dir = scratch();
  const epub = join(dir, 'Script.epub');
  writeFileSync(epub, 'epub');
  const kfx = kfxSibling(epub);
  writeFileSync(kfx, 'existing-kfx');
  // Make sure the .kfx is unambiguously newer than the EPUB regardless of
  // filesystem mtime resolution (this filesystem can give back-to-back
  // writeFileSync calls the identical mtime, which needsRegeneration
  // treats as stale).
  const now = new Date();
  utimesSync(epub, new Date(now.getTime() - 10_000), new Date(now.getTime() - 10_000));
  utimesSync(kfx, now, now);

  const out = await freshKindleArtifact({
    epub,
    fountainPath: null,
    format: DEFAULT_FORMAT_OPTIONS,
    calibreAvailable: true,
    kfxReady: true,
  });
  // A wrong implementation that checked calibreAvailable before kfxReady, or
  // that ignored kfxReady's freshness check, would either call toAzw3 (which
  // throws here, since Calibre is absent) or call toKfx unconditionally.
  expect(out).toBe(kfx);
  expect(readFileSync(kfx, 'utf8')).toBe('existing-kfx');
});

test('kfxReady with a stale .kfx attempts a KFX rebuild rather than silently reusing calibre or the stale file', async () => {
  const dir = scratch();
  const epub = join(dir, 'Script.epub');
  writeFileSync(epub, 'epub');
  // No .kfx at all yet, so needsRegeneration must report stale/missing and
  // the implementation must attempt toKfx — which needs Calibre — rather
  // than silently falling through to the calibreAvailable (AZW3) branch or
  // returning a nonexistent .kfx path.
  //
  // Precedence, asserted without depending on what is installed: reaching
  // the Calibre/KFX branch throws CalibreMissingError (tool absent),
  // KfxToolchainNotReadyError (Calibre present but no Kindle Previewer or
  // plugin — every Linux machine, and the toolchain guard toKfx restored
  // from KFXToolchain.convert), or CalibreFailedError (whole toolchain
  // present, placeholder input rejected as not a zip). Falling through to
  // the MOBI branch would instead throw CannotRegenerateError — that is the
  // regression this pins.
  const error = await freshKindleArtifact({
    epub,
    fountainPath: null,
    format: DEFAULT_FORMAT_OPTIONS,
    calibreAvailable: true,
    kfxReady: true,
  }).catch((e) => e);
  expect(error).toBeInstanceOf(Error);
  expect(error).not.toBeInstanceOf(CannotRegenerateError);
  expect(
    [CalibreMissingError, CalibreFailedError, KfxToolchainNotReadyError].some(
      (C) => error instanceof C,
    ),
  ).toBe(true);
});

test('calibreAvailable is used over an existing fresh .mobi, not reused as a shortcut', async () => {
  const dir = scratch();
  const epub = join(dir, 'Script.epub');
  writeFileSync(epub, 'epub');
  const mobi = mobiSibling(epub);
  writeFileSync(mobi, 'existing-mobi');
  const now = new Date();
  utimesSync(mobi, now, now);

  // calibreAvailable=true means the AZW3 branch is always taken (it's fresh
  // by construction) — a wrong implementation might instead notice a fresh
  // .mobi already satisfies "kindle" and reuse it, skipping Calibre
  // entirely. Same environment-independent precedence assertion as above:
  // the correct branch surfaces as CalibreMissingError or
  // CalibreFailedError, never CannotRegenerateError (which would mean
  // execution fell through to the MOBI branch instead).
  const error = await freshKindleArtifact({
    epub,
    fountainPath: null,
    format: DEFAULT_FORMAT_OPTIONS,
    calibreAvailable: true,
    kfxReady: false,
  }).catch((e) => e);
  expect(error).toBeInstanceOf(Error);
  expect(error).not.toBeInstanceOf(CannotRegenerateError);
  expect(
    [CalibreMissingError, CalibreFailedError, KfxToolchainNotReadyError].some(
      (C) => error instanceof C,
    ),
  ).toBe(true);
});
