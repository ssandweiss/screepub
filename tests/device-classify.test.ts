import { test, expect } from 'bun:test';
import { mkdtempSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { classify, volumeName } from '../src/device/classify';

function volume(name: string, subdirs: string[] = []): string {
  const dir = join(mkdtempSync(join(tmpdir(), 'screepub-test-')), name);
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
