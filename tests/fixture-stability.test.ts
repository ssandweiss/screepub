import { afterAll, describe, test, expect } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const SCRATCH = mkdtempSync(join(tmpdir(), 'screepub-fixture-stability-'));
afterAll(() => rmSync(SCRATCH, { recursive: true, force: true }));

// The committed fixtures are generated, not hand-made, and every kind in
// tools/make-fixture.py shares its layout and PDF-emission code. Without
// this, a refactor for one kind could silently change screenplay.pdf and
// every integration test would quietly start asserting against different
// input. (torture.pdf is not pinned here; its placement is checked through
// --emit-layout instead.)
//
// python3 is a REAL dependency of this suite, deliberately. No
// skip-if-missing guard: this repo already fixed the case where integration
// tests self-skipped and therefore never ran in CI. A test that quietly
// skips reads as coverage while providing none.
describe('committed fixtures regenerate byte-identically', () => {
  const COMMITTED = {
    screenplay: 'tests/fixtures/screenplay.pdf',
    prose: 'tests/fixtures/prose.pdf',
    blank: 'tests/fixtures/blank-pages.pdf',
    // The invented feature the README and site pictures show. Regenerated
    // byte for byte like the others, so a generator refactor cannot quietly
    // change what the pictures are of.
    demo: 'tests/fixtures/field-station.pdf',
  } as const;

  for (const [kind, committed] of Object.entries(COMMITTED)) {
    test(kind, () => {
      const dir = mkdtempSync(join(SCRATCH, 'fixture-'));
      const out = join(dir, `${kind}.pdf`);
      const run = spawnSync('python3', ['tools/make-fixture.py', kind, out], {
        encoding: 'utf8',
      });
      expect(run.stderr).toBe('');
      expect(run.status).toBe(0);
      expect(readFileSync(out)).toEqual(readFileSync(committed));
    });
  }
});
