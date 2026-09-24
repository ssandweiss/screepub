import { afterAll, test, expect } from 'bun:test';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { replaceFile } from '../src/replace-file';

const SCRATCH = mkdtempSync(join(tmpdir(), 'screepub-replace-file-'));
afterAll(() => rmSync(SCRATCH, { recursive: true, force: true }));

function temp(name: string): string {
  const dir = join(mkdtempSync(join(SCRATCH, 'test-')), name);
  mkdirSync(dir, { recursive: true });
  return dir;
}

test('replaceFile copies to a destination that does not exist', () => {
  const dir = temp('replace');
  const src = join(dir, 'a.txt');
  writeFileSync(src, 'v1');
  replaceFile(src, join(dir, 'b.txt'));
  expect(readFileSync(join(dir, 'b.txt'), 'utf8')).toBe('v1');
});

test('replaceFile overwrites an existing destination', () => {
  const dir = temp('replace');
  const src = join(dir, 'a.txt');
  const dest = join(dir, 'b.txt');
  writeFileSync(src, 'v1');
  writeFileSync(dest, 'old');
  replaceFile(src, dest);
  expect(readFileSync(dest, 'utf8')).toBe('v1');
  // Nothing of the copy's own is left beside the book.
  expect(readdirSync(dir).sort()).toEqual(['a.txt', 'b.txt']);
});

// Every USB send goes through replaceFile. A reader that is nearly full, or
// a cable that drops mid-copy, used to lose the book outright: the old copy
// was deleted first and the new one never arrived. A copy that fails must
// leave the reader exactly as it was.

test('a copy that fails leaves the old copy byte for byte, and nothing beside it', () => {
  const dir = temp('replace');
  // A directory as the source: a real failure, not a mocked one, that
  // every platform refuses at the copy.
  const src = join(dir, 'not-a-book');
  mkdirSync(src);
  const dest = join(dir, 'b.azw3');
  const old = Buffer.from([0x00, 0xff, 0x10, 0x42, 0x0a, 0x0d]);
  writeFileSync(dest, old);
  expect(() => replaceFile(src, dest)).toThrow();
  expect(readFileSync(dest).equals(old)).toBe(true);
  expect(readdirSync(dir).sort()).toEqual(['b.azw3', 'not-a-book']);
});

test('a copy that lands but cannot be put in place is taken away again', () => {
  // The rename is the step after the copy: a directory standing at the
  // destination refuses it on every platform. The copy it wrote first must
  // not be left behind on the reader.
  const dir = temp('replace');
  const src = join(dir, 'a.txt');
  writeFileSync(src, 'v1');
  const dest = join(dir, 'b.txt');
  mkdirSync(dest);
  writeFileSync(join(dest, 'inside.txt'), 'kept');
  expect(() => replaceFile(src, dest)).toThrow();
  expect(readdirSync(dir).sort()).toEqual(['a.txt', 'b.txt']);
  expect(readFileSync(join(dest, 'inside.txt'), 'utf8')).toBe('kept');
});

test('a partial copy left by an earlier send that died is written over, not tripped on', () => {
  const dir = temp('replace');
  const src = join(dir, 'a.txt');
  const dest = join(dir, 'b.txt');
  writeFileSync(src, 'v2');
  writeFileSync(dest, 'v1');
  writeFileSync(join(dir, '.b.txt.screepub-partial'), 'half of v');
  replaceFile(src, dest);
  expect(readFileSync(dest, 'utf8')).toBe('v2');
  expect(readdirSync(dir).sort()).toEqual(['a.txt', 'b.txt']);
});
