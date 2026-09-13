import { test, expect } from 'bun:test';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { isKindleVolume, kindleVolumeName, copyToKindleVolume } from '../src/device/kindle';

/** Mirrors kit-check's tempDir(): a uniquely-rooted directory whose own name
 * is the "volume name" under test. */
function volume(name: string, subdirs: string[] = []): string {
  const dir = join(mkdtempSync(join(tmpdir(), 'screepub-test-')), name);
  mkdirSync(dir, { recursive: true });
  for (const sub of subdirs) mkdirSync(join(dir, sub), { recursive: true });
  return dir;
}

test('volume named Kindle with documents/ is detected', () => {
  expect(isKindleVolume(volume('Kindle', ['documents']))).toBe(true);
});

test('unnamed volume with documents/ + system/ is detected', () => {
  expect(isKindleVolume(volume('NO NAME', ['documents', 'system']))).toBe(true);
});

test('volume without documents/ is rejected', () => {
  expect(isKindleVolume(volume('Kindle-empty'))).toBe(false);
});

test('generic thumb drive is rejected', () => {
  expect(isKindleVolume(volume('USB STICK', ['documents']))).toBe(false);
});

test('a documents/ FILE does not make it a Kindle', () => {
  const dir = volume('Kindle-file');
  writeFileSync(join(dir, 'documents'), 'not a directory');
  expect(isKindleVolume(dir)).toBe(false);
});

test('copy lands in documents/, preserves content, and overwrites on re-copy', () => {
  const vol = volume('Kindle', ['documents']);
  const src = join(vol, '..', 'Test.epub');
  writeFileSync(src, 'v1');

  const dest = copyToKindleVolume(src, vol);
  expect(dest.endsWith(join('Kindle', 'documents', 'Test.epub'))).toBe(true);
  expect(readFileSync(dest, 'utf8')).toBe('v1');

  writeFileSync(src, 'v2');
  copyToKindleVolume(src, vol);
  expect(readFileSync(dest, 'utf8')).toBe('v2');
});

test('the volume name is its own directory name', () => {
  expect(kindleVolumeName(volume('Kindle', ['documents']))).toBe('Kindle');
});
