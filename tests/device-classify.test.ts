import { afterAll, test, expect } from 'bun:test';
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { classify, volumeName } from '../src/device/classify';

const SCRATCH = mkdtempSync(join(tmpdir(), 'screepub-device-classify-'));
afterAll(() => rmSync(SCRATCH, { recursive: true, force: true }));

function volume(name: string, subdirs: string[] = []): string {
  const dir = join(mkdtempSync(join(SCRATCH, 'test-')), name);
  mkdirSync(dir, { recursive: true });
  for (const sub of subdirs) mkdirSync(join(dir, sub), { recursive: true });
  return dir;
}

test('volume with a .kobo dir is detected as Kobo', () => {
  expect(classify(volume('KOBOeReader', ['.kobo']))).toBe('kobo');
});

test('volume named tolino is detected as tolino', () => {
  expect(classify(volume('tolino'))).toBe('tolino');
});

test('tolino detection is case-insensitive', () => {
  expect(classify(volume('TOLINO vision'))).toBe('tolino');
});

test('a Kindle volume classifies as kindle', () => {
  expect(classify(volume('Kindle', ['documents']))).toBe('kindle');
});

test('a generic thumb drive classifies as no device', () => {
  expect(classify(volume('USB STICK', ['documents']))).toBeNull();
});

test('a .kobo FILE does not make it a Kobo', () => {
  // Only a directory counts; Swift checks isDirectory explicitly.
  const dir = volume('NotAKobo');
  Bun.write(join(dir, '.kobo'), 'x');
  expect(classify(dir)).toBeNull();
});

test('Kindle wins over a bare name collision', () => {
  // documents/ + system/ is a Kindle even if the name says nothing.
  expect(classify(volume('NO NAME', ['documents', 'system']))).toBe('kindle');
});

test('volumeName is the directory name', () => {
  expect(volumeName(volume('KOBOeReader'))).toBe('KOBOeReader');
});

test('classification order decides an ambiguous volume: Kindle wins over Kobo', () => {
  // documents/ AND a .kobo dir. Swift checks Kindle first, so this is a Kindle.
  expect(classify(volume('Kindle', ['documents', '.kobo']))).toBe('kindle');
});

test('classification order decides an ambiguous volume: Kobo wins over tolino', () => {
  // Named tolino AND carrying .kobo. Swift checks Kobo before the name match.
  expect(classify(volume('tolino', ['.kobo']))).toBe('kobo');
});

test('a Windows drive root names itself by its drive designator, not an empty string', () => {
  // "D:\" has no basename component (path.basename yields '' for it on
  // win32) and is not a vendor's volume label, so it must not surface as ''.
  expect(volumeName('D:\\')).toBe('D:');
});

test('a lowercase Windows drive root names itself by its drive designator too', () => {
  // Same shared predicate as volumes.ts (src/device/paths.ts); the two copies
  // had disagreed on letter case, and the permissive form is the correct one.
  expect(volumeName('d:\\')).toBe('d:');
});

test('a Windows-shaped drive root with a .kobo signature still classifies as Kobo', () => {
  // Name-based detection (tolino) cannot work on a bare drive letter, but
  // signature-based detection (Kindle's documents/, Kobo's .kobo) does not
  // depend on the name at all, so it survives even here. (Backslash is just
  // a literal filename character on this POSIX test host, standing in for
  // the shape of a real Windows drive root.)
  const parent = mkdtempSync(join(SCRATCH, 'test-'));
  const driveRoot = join(parent, 'D:\\');
  mkdirSync(join(driveRoot, '.kobo'), { recursive: true });
  expect(classify(driveRoot)).toBe('kobo');
});
