import { afterAll, test, expect } from 'bun:test';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { partialPathFor, replaceFile } from '../src/replace-file';

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
  // Real failures, not mocked ones: a directory as the source, which the
  // copy refuses, and a source that has gone. The old delete-then-copy lost
  // the reader's copy to both.
  for (const source of ['a directory', 'gone']) {
    const dir = temp('replace');
    const src = join(dir, 'not-a-book');
    if (source === 'a directory') mkdirSync(src);
    const dest = join(dir, 'b.azw3');
    const old = Buffer.from([0x00, 0xff, 0x10, 0x42, 0x0a, 0x0d]);
    writeFileSync(dest, old);
    expect(() => replaceFile(src, dest)).toThrow();
    expect(readFileSync(dest).equals(old), `${source}: the old copy changed`).toBe(true);
    expect(readdirSync(dir).filter((f) => f !== 'not-a-book')).toEqual(['b.azw3']);
  }
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
  expect(() => replaceFile(src, dest)).toThrow(`rename '${dest}'`);
  expect(readdirSync(dir).sort()).toEqual(['a.txt', 'b.txt']);
  expect(readFileSync(join(dest, 'inside.txt'), 'utf8')).toBe('kept');
});

test('a partial copy left by an earlier send that died is written over, not tripped on', () => {
  const dir = temp('replace');
  const src = join(dir, 'a.txt');
  const dest = join(dir, 'b.txt');
  writeFileSync(src, 'v2');
  writeFileSync(dest, 'v1');
  writeFileSync(partialPathFor(dest), 'half of v');
  replaceFile(src, dest);
  expect(readFileSync(dest, 'utf8')).toBe('v2');
  expect(readdirSync(dir).sort()).toEqual(['a.txt', 'b.txt']);
});

// The partial's name used to be the book's own with 18 characters added, so
// a book named with 238 to 255 characters, which copied fine before, failed:
// FAT32 and exFAT (and APFS) stop a name at 255.

test('a book with a 250-character name still goes across', () => {
  const dir = temp('replace');
  const src = join(dir, 'a.txt');
  writeFileSync(src, 'v1');
  const dest = join(dir, `${'x'.repeat(245)}.azw3`);
  replaceFile(src, dest);
  expect(readFileSync(dest, 'utf8')).toBe('v1');
});

test('the partial is short, hidden, beside the book, and the same one for the same book', () => {
  const dest = join('/Volumes', 'Kindle', 'documents', `${'x'.repeat(245)}.azw3`);
  const partial = partialPathFor(dest);
  expect(dirname(partial)).toBe(dirname(dest));
  expect(basename(partial)).toMatch(/^\.screepub-[0-9a-f]{8}\.partial$/);
  expect(partialPathFor(dest)).toBe(partial);
  expect(partialPathFor(join(dirname(dest), 'Another.azw3'))).not.toBe(partial);
});

// cli-devices.ts hands a failed copy's message to the reader as it is, so
// the message must name the book, never the hidden file it went through.

test('a failed copy names the book it was writing, with the system’s code, never the partial', () => {
  const dir = temp('replace');
  const dest = join(dir, 'Field Station.azw3');
  writeFileSync(dest, 'old');
  let thrown: unknown;
  try {
    replaceFile(join(dir, 'gone.azw3'), dest);
  } catch (err) {
    thrown = err;
  }
  const error = thrown as NodeJS.ErrnoException;
  expect(error).toBeInstanceOf(Error);
  expect(error.code).toBe('ENOENT');
  expect(error.message).toStartWith('ENOENT');
  expect(error.message).toContain(dest);
  expect(error.message).not.toContain('.screepub-');
  expect(error.message).not.toContain('partial');
});

test('a clean-up that fails too does not hide why the copy failed', () => {
  // A directory where the partial goes: the copy onto it fails (EISDIR),
  // and taking it away fails as well, since it is not empty. The copy's
  // failure is the one that says what went wrong.
  const dir = temp('replace');
  const src = join(dir, 'a.txt');
  writeFileSync(src, 'v1');
  const dest = join(dir, 'b.txt');
  writeFileSync(dest, 'old');
  mkdirSync(partialPathFor(dest));
  writeFileSync(join(partialPathFor(dest), 'inside'), 'x');
  let thrown: unknown;
  try {
    replaceFile(src, dest);
  } catch (err) {
    thrown = err;
  }
  expect((thrown as NodeJS.ErrnoException).code).toBe('EISDIR');
  expect((thrown as Error).message).toContain(dest);
  expect(readFileSync(dest, 'utf8')).toBe('old');
});
