import { describe, test, expect } from 'bun:test';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

// The judgment-free half of docs/release-notes-template.md. These terms are
// wrong in reader-facing copy under every circumstance, so a machine can
// hold the line without Claude and without anyone remembering.
//
// Deliberately EXCLUDES "EPUB", "MOBI" and "orphaned lines": the approved
// 0.5.0 notes use all three correctly, because the reader has a file with
// that extension in front of them or recognizes the print term. The real
// rule is "name a format only where the reader must act on it", which a
// word list cannot express, so the list carries only the absolutes and the
// template carries the principle.
const BANNED = [
  'kepub',
  'sideload',
  'ragged-right',
  'keep-together',
  'rendering engine',
  'stylesheet',
  '—', // em dash: house rule for user-facing copy
];

const RELEASES_DIR = join(import.meta.dir, '..', 'docs', 'releases');
const WORD_CAP = 350;

const releaseFiles = () => readdirSync(RELEASES_DIR).filter((f) => f.endsWith('.md'));

describe('release notes stay readable', () => {
  test('there is at least one release note to check', () => {
    // Guards the loop below: an empty directory would make every other
    // assertion vacuously true.
    expect(releaseFiles().length).toBeGreaterThan(0);
  });

  for (const file of releaseFiles()) {
    const text = () => readFileSync(join(RELEASES_DIR, file), 'utf8');

    test(`${file} uses no jargon from the banned list`, () => {
      const found = BANNED.filter((term) => text().toLowerCase().includes(term.toLowerCase()));
      expect(found).toEqual([]);
    });

    test(`${file} stays under the ${WORD_CAP}-word cap`, () => {
      expect(text().split(/\s+/).filter(Boolean).length).toBeLessThanOrEqual(WORD_CAP);
    });
  }
});
