import { describe, test, expect } from 'bun:test';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const REPO = new URL('..', import.meta.url).pathname;
const APP = join(REPO, 'app');
const MANIFEST_PATH = join(REPO, 'tools', 'frozen-app-manifest.json');
const README = join(APP, 'README-FROZEN.md');

/**
 * app/ is FROZEN — see app/README-FROZEN.md and piece F1 of
 * docs/superpowers/specs/2026-09-14-retire-swiftui-design.md. It is still
 * the shipping Mac app, so it is not deleted; but no new Swift is written
 * against it, because its replacement has never been built or run on a Mac
 * and 171 of kit-check's 264 check sites are the only coverage anything in
 * this repository has for the behaviour they assert.
 *
 * WHERE THIS GUARD DRAWS ITS LINE, AND WHY
 *
 * Two obvious designs are both wrong:
 *
 *   - Counting files only. Swapping one file for another passes. So does
 *     appending eight hundred lines to ContentView.swift. That is a guard
 *     that cannot fail for the thing it exists to prevent.
 *   - Hashing every byte. A trailing-whitespace fix, a typo in a doc
 *     comment, or a reflowed comment paragraph fails it. Nobody wants that
 *     failure, so the manifest gets regenerated reflexively, and the reflex
 *     is what a real extension would then ride in on.
 *
 * The line here is: the freeze forbids GROWTH and RESHUFFLING; it permits
 * IN-PLACE REPAIR. So the manifest pins
 *
 *   (a) the exact set of .swift paths — a swap, an addition or a rename
 *       fails, and
 *   (b) each file's count of non-blank, non-comment lines — new behaviour
 *       needs new lines and fails; comment and whitespace edits do not.
 *
 * A one-line bug-compatibility fix that changes a line without adding one
 * passes, which is exactly the activity the freeze still allows. (Swift
 * block comments would be counted as code by this line-oriented strip;
 * app/ contains none, and the error direction is safe — commenting a block
 * out would make the count fall, not silently hide code.)
 *
 * AND: THE MANIFEST IS NOT THE LAST WORD.
 *
 * Regenerating tools/frozen-app-manifest.json is the obvious way to make
 * any failure here go away, which would make this a speed bump rather than
 * a guard. So the two numbers that matter — how many Swift files app/ has
 * and how many lines of code they hold — are ALSO pinned below, in this
 * source file, as a ceiling the manifest itself is checked against. A
 * regenerated manifest that is larger than the frozen app still fails.
 * Making that failure go away means editing this file and saying why in
 * the commit, which is a deliberate, reviewable act — the point.
 *
 * The ceiling is one-directional: app/ may shrink. F3 deletes it outright,
 * and any legitimate step toward that (porting a file's behaviour to src/
 * and removing it here) lowers both numbers and passes untouched.
 */
const FROZEN_FILE_CEILING = 32;
const FROZEN_CODE_LINE_CEILING = 4840;

type Manifest = { files: Record<string, number> };
const manifest = JSON.parse(readFileSync(MANIFEST_PATH, 'utf8')) as Manifest;

/** Non-blank, non-comment lines: what a reviewer of a frozen app must read. */
function codeLines(text: string): number {
  return text
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && !l.startsWith('//')).length;
}

// Recursive and rooted at app/, not at app/Sources/: app/make-icon.swift and
// app/Packages/KFXKit/ both live outside Sources/, and a new sub-package
// dropped beside them is precisely the "one more small thing in Swift"
// shape this guard exists to catch. `.build` is `swift build` OUTPUT, never
// source a person wrote, and is gitignored for that reason.
const onDisk = (readdirSync(APP, { recursive: true }) as string[])
  .filter((f) => f.endsWith('.swift'))
  .filter((f) => !f.split(/[\\/]/).includes('.build'))
  .sort();

// bun's toEqual() prints a contextual diff, so guidance smuggled into the
// compared value is not shown to the person who broke the test. The two
// assertions that can fail for an interesting reason therefore build their
// own message, and the message says what to do INSTEAD of regenerating the
// manifest — because "regenerate it" is the wrong answer to both.
const FIX = [
  '',
  'app/ is frozen — read app/README-FROZEN.md before doing anything here.',
  '',
  'If you are ADDING or CHANGING Swift: do not. New behaviour lands in src/',
  'and is driven from the Tauri app in desktop/ (ADR',
  'docs/adr/2026-09-12-cross-platform-tauri.md, piece F). A defect fix that',
  'changes a line without adding one passes this guard untouched; if yours',
  'needs new lines, it is not a bug-compatibility fix.',
  '',
  'If you are REMOVING Swift as part of actually retiring the app (piece F3,',
  'and only once its three gates are met), drop the file from',
  'tools/frozen-app-manifest.json in the same commit. Deletion is the one',
  'direction this guard does not fight: the ceilings in this test forbid',
  'growth only.',
].join('\n');

function fail(title: string, lines: string[]): never {
  throw new Error([title, ...lines.map((l) => '  ' + l), FIX].join('\n'));
}

describe('app/ is frozen', () => {
  test('the Swift file list matches the committed manifest exactly', () => {
    // Set equality, not a count: a file swapped for another is the failure a
    // count-based guard sleeps through.
    const pinned = new Set(Object.keys(manifest.files));
    const seen = new Set(onDisk);
    const added = onDisk.filter((f) => !pinned.has(f));
    const gone = [...pinned].filter((f) => !seen.has(f)).sort();
    if (added.length || gone.length) {
      fail('app/ no longer holds the Swift files the freeze pinned.', [
        ...added.map((f) => `NEW (not in the manifest): app/${f}`),
        ...gone.map((f) => `GONE (still in the manifest): app/${f}`),
      ]);
    }
    expect(added.length + gone.length).toBe(0);
  });

  test('the manifest is not vacuous — it describes the app that is actually there', () => {
    // If app/ were emptied, or the manifest replaced with {}, the test above
    // would still pass as long as the two agreed. These are the anchors that
    // say the frozen thing is the Mac app and not a husk.
    expect(onDisk).toContain('Sources/KitCheck/main.swift');
    expect(onDisk).toContain('Sources/ScreepubApp/Theme.swift');
    expect(onDisk.length).toBeGreaterThan(20);
    expect(manifest.files['Sources/KitCheck/main.swift']).toBeGreaterThan(1000);
  });

  test('no frozen file has gained or lost lines of code', () => {
    const drifted: string[] = [];
    for (const f of onDisk) {
      const pinned = manifest.files[f];
      if (pinned === undefined) continue; // reported by the test above
      const now = codeLines(readFileSync(join(APP, f), 'utf8'));
      if (now !== pinned) {
        drifted.push(`app/${f}: ${pinned} code lines when frozen, ${now} now (${now > pinned ? '+' : ''}${now - pinned})`);
      }
    }
    if (drifted.length) fail('Frozen Swift files changed size.', drifted);
    expect(drifted).toEqual([]);
  });

  test('the manifest itself cannot be regenerated upward past the frozen ceiling', () => {
    const entries = Object.values(manifest.files);
    const total = entries.reduce((a, b) => a + b, 0);
    if (entries.length > FROZEN_FILE_CEILING || total > FROZEN_CODE_LINE_CEILING) {
      fail('The manifest now claims MORE Swift than app/ held when it was frozen.', [
        `files: ${entries.length}, ceiling ${FROZEN_FILE_CEILING}`,
        `code lines: ${total}, ceiling ${FROZEN_CODE_LINE_CEILING}`,
        'Regenerating tools/frozen-app-manifest.json does not answer this test:',
        'the ceilings live in tests/frozen-app.test.ts precisely so that',
        '"just regenerate the manifest" cannot be the fix for growth.',
      ]);
    }
    expect(entries.length).toBeLessThanOrEqual(FROZEN_FILE_CEILING);
    expect(total).toBeLessThanOrEqual(FROZEN_CODE_LINE_CEILING);
  });
});

describe('app/README-FROZEN.md', () => {
  const text = readFileSync(README, 'utf8');

  test('names the ADR that froze it and the directory that replaces it', () => {
    expect(text).toContain('docs/adr/2026-09-12-cross-platform-tauri.md');
    expect(text).toContain('desktop/');
  });

  test('names what app/ is still the only coverage for', () => {
    // The whole reason a reader may not delete this directory yet. If these
    // stop being true — the behaviour gets ported to src/ — this test should
    // be changed deliberately, at the same time as the README.
    for (const subject of ['UpdateCheck', 'UpdateInstall', 'ResultActions', 'AppleBooks']) {
      expect(text).toContain(subject);
    }
    expect(text).toContain('KFX_Output_plugin.zip');
  });

  test('points at the manifest that enforces the freeze', () => {
    expect(text).toContain('tools/frozen-app-manifest.json');
  });
});
