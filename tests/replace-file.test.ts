import { afterAll, test, expect } from 'bun:test';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
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
});
