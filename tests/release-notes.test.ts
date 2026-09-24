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
  // release.yml's `checks` job fails a tag whose notes name a checksum,
  // because the workflow appends the real ones and two lists on one page
  // both look official. That check runs AFTER the tag is pushed; this one
  // runs in nine seconds.
  'sha256',
  'sha-256',
];

// The other half of that workflow's regex, which a substring list cannot
// express: `grep -niE 'sha-?256|[0-9a-f]{64}'`. A pasted digest with no
// "sha256" anywhere near it used to pass here in nine seconds and then fail
// the tag AFTER notarization -- precisely the round trip the fast check
// exists to spare. Case-insensitive to match grep -i: an upper-case digest
// is the same paste.
const BANNED_PATTERNS: { name: string; re: RegExp }[] = [
  { name: 'a bare 64-hex checksum', re: /[0-9a-f]{64}/i },
];

/** What release.yml would reject, decided here instead. Exported shape kept
 *  trivial on purpose: the test below feeds it copy that never reaches a
 *  release file, so the guard itself is tested and not only the notes. */
export function bannedTerms(text: string): string[] {
  const lower = text.toLowerCase();
  return [
    ...BANNED.filter((term) => lower.includes(term.toLowerCase())),
    ...BANNED_PATTERNS.filter(({ re }) => re.test(text)).map(({ name }) => name),
  ];
}

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
      expect(bannedTerms(text())).toEqual([]);
    });

    test(`${file} stays under the ${WORD_CAP}-word cap`, () => {
      expect(text().split(/\s+/).filter(Boolean).length).toBeLessThanOrEqual(WORD_CAP);
    });
  }
});

describe('the guard covers everything release.yml would reject', () => {
  test('a raw 64-hex digest is caught even with no "sha256" beside it', () => {
    const digest = '3f2b1c0d9e8f7a6b5c4d3e2f1a0b9c8d7e6f5a4b3c2d1e0f9a8b7c6d5e4f3a2b';
    expect(digest.length).toBe(64);
    expect(bannedTerms(`Download it and check the digest: ${digest}`)).toEqual([
      'a bare 64-hex checksum',
    ]);
    // Upper case is the same paste, and grep -i catches it too.
    expect(bannedTerms(digest.toUpperCase()).length).toBe(1);
  });

  test('ordinary prose is not a false positive', () => {
    // Sixty-four consecutive characters from [0-9a-f] do not occur in
    // English; the check must not fire on a long word or a date.
    expect(bannedTerms('Faster conversion, added dedicated Kobo defaults. 2026-09-13.')).toEqual([]);
  });

  test('the named word list still fires', () => {
    expect(bannedTerms('The SHA256 is below.')).toEqual(['sha256']);
  });
});
