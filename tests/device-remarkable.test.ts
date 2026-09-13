import { test, expect, afterAll } from 'bun:test';
import { mkdtempSync, writeFileSync, truncateSync, openSync, closeSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  REMARKABLE_ENDPOINT,
  REMARKABLE_MAX_UPLOAD_BYTES,
  probeRemarkable,
  uploadToRemarkable,
  remarkableAccepts,
} from '../src/device/remarkable';

/** Records the request sequence, mirroring kit-check's StubRemarkable. The
 * real interface's /upload writes into the LAST-LISTED folder, so "upload to
 * root" is only true if root is listed immediately before the POST. */
function stub() {
  const requests: string[] = [];
  let documentsStatus = 200;
  const server = Bun.serve({
    port: 0,
    async fetch(req) {
      const path = new URL(req.url).pathname;
      requests.push(`${req.method} ${path}`);
      if (req.method === 'POST') await req.arrayBuffer();
      const status = path.startsWith('/documents') ? documentsStatus : 200;
      return new Response('[]', { status });
    },
  });
  return {
    requests,
    url: `http://127.0.0.1:${server.port}`,
    reset: () => requests.splice(0, requests.length),
    setDocumentsStatus: (s: number) => { documentsStatus = s; },
    stop: () => server.stop(true),
  };
}

const s = stub();
afterAll(() => s.stop());

function book(): string {
  const path = join(mkdtempSync(join(tmpdir(), 'screepub-test-')), 'Script.epub');
  writeFileSync(path, 'epub');
  return path;
}

test('the fixed USB endpoint is the documented address', () => {
  expect(REMARKABLE_ENDPOINT).toBe('http://10.11.99.1');
});

test('upload lists the root folder immediately before posting', async () => {
  s.reset();
  await uploadToRemarkable(book(), s.url);
  expect(s.requests).toEqual(['GET /documents/', 'POST /upload']);
});

test('probe asks for the documents listing, not the bare root', async () => {
  s.reset();
  expect(await probeRemarkable(s.url)).toBe(true);
  expect(s.requests).toEqual(['GET /documents/']);
});

test('a failed root listing aborts the send with no blind POST', async () => {
  s.reset();
  s.setDocumentsStatus(500);
  await expect(uploadToRemarkable(book(), s.url)).rejects.toThrow();
  expect(s.requests).not.toContain('POST /upload');
  s.setDocumentsStatus(200);
});

test('a file over the 100 MB cap is rejected before any network request', async () => {
  s.reset();
  const big = join(mkdtempSync(join(tmpdir(), 'screepub-test-')), 'big.epub');
  closeSync(openSync(big, 'w'));
  truncateSync(big, REMARKABLE_MAX_UPLOAD_BYTES + 1); // sparse: instant to make
  await expect(uploadToRemarkable(big, s.url)).rejects.toThrow('100 MB');
  expect(s.requests).toEqual([]);
});

test('only PDF and EPUB are accepted', async () => {
  s.reset();
  const azw3 = join(mkdtempSync(join(tmpdir(), 'screepub-test-')), 'Script.azw3');
  writeFileSync(azw3, 'x');
  await expect(uploadToRemarkable(azw3, s.url)).rejects.toThrow('azw3');
  expect(s.requests).toEqual([]);
});

test('probe reports false when nothing is serving', async () => {
  expect(await probeRemarkable('http://127.0.0.1:1', 500)).toBe(false);
});

test('remarkableAccepts is the one copy of the PDF/EPUB rule', () => {
  expect(remarkableAccepts('/tmp/Script.pdf')).toBe(true);
  expect(remarkableAccepts('/tmp/Script.epub')).toBe(true);
  // Case and a dotted stem must not fool it: the extension is the LAST dot.
  expect(remarkableAccepts('/tmp/Script.EPUB')).toBe(true);
  expect(remarkableAccepts('/tmp/Draft.epub.azw3')).toBe(false);
  expect(remarkableAccepts('/tmp/Script.azw3')).toBe(false);
  expect(remarkableAccepts('/tmp/Script.mobi')).toBe(false);
  // No extension at all is not an accepted extension.
  expect(remarkableAccepts('/tmp/Script')).toBe(false);
});
