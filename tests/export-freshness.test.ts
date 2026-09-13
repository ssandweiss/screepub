import { test, expect } from 'bun:test';
import { mkdtempSync, writeFileSync, utimesSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { needsRegeneration } from '../src/export/freshness';

function pair(artifactAge: number | null, epubAge: number | null) {
  const dir = mkdtempSync(join(tmpdir(), 'screepub-test-'));
  const epub = join(dir, 'book.epub');
  const artifact = join(dir, 'book.mobi');
  const now = Date.now() / 1000;
  writeFileSync(epub, 'epub');
  if (epubAge !== null) utimesSync(epub, now - epubAge, now - epubAge);
  if (artifactAge !== null) {
    writeFileSync(artifact, 'mobi');
    utimesSync(artifact, now - artifactAge, now - artifactAge);
  }
  return { epub, artifact };
}

test('a missing artifact needs regeneration', () => {
  const { epub, artifact } = pair(null, 10);
  expect(needsRegeneration(artifact, epub)).toBe(true);
});

test('an artifact older than its EPUB needs regeneration', () => {
  const { epub, artifact } = pair(100, 10);
  expect(needsRegeneration(artifact, epub)).toBe(true);
});

test('an artifact newer than its EPUB is fresh', () => {
  const { epub, artifact } = pair(10, 100);
  expect(needsRegeneration(artifact, epub)).toBe(false);
});

test('identical mtimes count as STALE, not fresh', () => {
  // copyItem, `rsync -t`, Time Machine restores and archive extraction can
  // all reproduce identical mtimes. Ties must fail toward regenerating.
  const { epub, artifact } = pair(50, 50);
  expect(needsRegeneration(artifact, epub)).toBe(true);
});

test('an unreadable EPUB makes a present artifact stale, not fresh', () => {
  // The EPUB side must fail closed toward the FUTURE. If it fell back to the
  // distant past instead, a deleted or unmounted EPUB would compare as older
  // than everything and a stale artifact would be reported fresh.
  const { artifact } = pair(10, 100);
  expect(needsRegeneration(artifact, join(tmpdir(), 'screepub-does-not-exist.epub'))).toBe(true);
});
