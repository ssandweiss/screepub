import { describe, test, expect, afterAll } from 'bun:test';
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { bundleEntries, findEntry } from '../tools/bundle-archive';
import {
  bundleDirFor,
  discoverArtifact,
  kindsForOs,
  verifyBundleFile,
  type BundleKind,
} from '../tools/build-app-bundle';
import { smokeBundle } from '../tools/smoke-bundle';

const OUT = mkdtempSync(join(tmpdir(), 'screepub-bundle-e2e-'));
afterAll(() => rmSync(OUT, { recursive: true, force: true }));

const VERSION = (JSON.parse(readFileSync('package.json', 'utf8')) as { version: string }).version;

/** The bundle a previous `cargo tauri build` left in the tree, or
 *  undefined. Gated rather than built: this suite must not spawn cargo, and
 *  a Rust build plus three and a half minutes of bundling inside `bun test`
 *  is a suite nobody runs. CI's desktop.yml builds the bundle and then
 *  calls smoke-bundle.ts directly, which is where the real per-push
 *  coverage lives. */
function builtBundle(kind: BundleKind): string | undefined {
  const dir = bundleDirFor(kind);
  if (!existsSync(dir)) return undefined;
  try {
    return discoverArtifact(dir, kind);
  } catch {
    return undefined;
  }
}

const LINUX_KINDS = kindsForOs('linux');
const AVAILABLE = LINUX_KINDS.map((k) => ({ kind: k, path: builtBundle(k) })).filter(
  (row): row is { kind: BundleKind; path: string } => row.path !== undefined,
);

describe('a real Linux bundle, when one has been built', () => {
  test.skipIf(AVAILABLE.length === 0)('every bundle on disk passes the production verifier', () => {
    // Not a tautology: verifyBundleFile checks a size floor and the
    // container magic, and the next test proves it rejects a file that
    // fails them.
    for (const { kind, path } of AVAILABLE) {
      expect(() => verifyBundleFile(path, kind)).not.toThrow();
      expect(statSync(path).size).toBeGreaterThan(kind.floorBytes);
    }
  });

  test.skipIf(AVAILABLE.length === 0)(
    'the verifier rejects a truncated copy of that same bundle',
    () => {
      // The mutation that makes the test above evidence rather than
      // decoration. Writes to scratch; the real artifact is untouched.
      const { kind, path } = AVAILABLE[0]!;
      const copy = join(OUT, `truncated${kind.ext}`);
      writeFileSync(copy, readFileSync(path).subarray(0, 4096));
      expect(() => verifyBundleFile(copy, kind)).toThrow(/floor/);
    },
  );

  test.skipIf(AVAILABLE.length === 0)(
    'each bundle carries the engine, the licence and the notices',
    () => {
      for (const { path } of AVAILABLE) {
        const entries = bundleEntries(path);
        // The engine is the reason the bundle is 44 MB; anything small here
        // is a stub that would pass an existence check.
        expect(findEntry(entries, 'usr/bin/screepub-engine').size).toBeGreaterThan(20_000_000);
        // The AGPL requires the licence to travel with the work, and the
        // compiled engine embeds Apache-2.0 and MIT libraries.
        expect(findEntry(entries, 'usr/lib/Screepub/LICENSE').size).toBeGreaterThan(1000);
        expect(findEntry(entries, 'usr/lib/Screepub/THIRD-PARTY-NOTICES.md').size).toBeGreaterThan(
          100,
        );
      }
    },
  );

  test.skipIf(AVAILABLE.length === 0)(
    'the launcher entry carries a human comment and claims no file type',
    () => {
      for (const { path } of AVAILABLE) {
        const entry = findEntry(bundleEntries(path), 'usr/share/applications/Screepub.desktop');
        const text = new TextDecoder().decode(entry.data);
        // No MimeType=: task 6 opened a real bundle and found the association
        // inert (no %f in Exec=, no argv handling in main.rs), so it is
        // withdrawn rather than left promising an empty window.
        expect(`the entry claims a MIME type: ${text.includes('MimeType=')}`).toBe(
          'the entry claims a MIME type: false',
        );
        expect(text).toContain('Categories=Office;');
        expect(text).toMatch(/^Comment=.{20,}$/m);
        // The contributor-facing crate description must not have leaked in.
        expect(text).not.toContain('no logic lives here');
      }
    },
  );

  test.skipIf(AVAILABLE.length === 0)(
    'the engine inside runs, reports package.json’s version, and converts the fixture',
    () => {
      // The real thing: the bundled engine executes and produces an EPUB.
      // package.json's version, not tauri.conf.json's -- the engine is
      // built from the former and the split is deliberate on a branch.
      for (const { path } of AVAILABLE) {
        const work = mkdtempSync(join(OUT, 'run-'));
        smokeBundle(path, 'tests/fixtures/screenplay.pdf', work, VERSION);
      }
    },
    300000,
  );

  test.skipIf(AVAILABLE.length === 0)(
    'and it refuses a version that is not the one inside',
    () => {
      const { path } = AVAILABLE[0]!;
      const work = mkdtempSync(join(OUT, 'wrong-'));
      expect(() => smokeBundle(path, 'tests/fixtures/screenplay.pdf', work, '9.9.9')).toThrow(
        /9\.9\.9/,
      );
    },
    300000,
  );

  test('the gate itself is honest about what it found', () => {
    // Always runs. On a machine with no bundle this prints the skip reason
    // rather than leaving six silent skips that look like passes.
    if (AVAILABLE.length === 0) {
      console.log(
        'app-bundle-e2e: no bundle under desktop/src-tauri/target/release/bundle; ' +
          'run `cargo tauri build --bundles deb,rpm` to exercise these tests locally. ' +
          'CI covers this path in desktop.yml, which builds and then calls ' +
          'tools/smoke-bundle.ts directly.',
      );
    }
    expect(AVAILABLE.length).toBeLessThanOrEqual(LINUX_KINDS.length);
  });
});
