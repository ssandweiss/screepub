import { describe, test, expect } from 'bun:test';
import { readFileSync } from 'node:fs';

// The manifest is the single source of truth for what the torture fixture
// proves. This test exists so the answer to "does the fixture still cover
// the registry?" is enforced rather than remembered: a new registry entry
// with no decision recorded against it fails the suite.
//
// It does NOT require covered: true. "covered": false with a reason IS a
// decision. Silence is not.

interface Row {
  entry: string;
  title: string;
  covered: boolean;
  page?: number;
  side?: 'source' | 'device' | 'both';
  how?: string;
  why?: string;
}

const manifest: Row[] = JSON.parse(readFileSync('tools/torture-manifest.json', 'utf8'));

/** Entry numbers, read from the registry's own ### headings. */
function registryEntries(): string[] {
  const md = readFileSync('docs/formatting-options-log.md', 'utf8');
  return [...md.matchAll(/^### (\d+[a-z]?)\./gm)].map((m) => m[1]);
}

describe('torture fixture coverage manifest', () => {
  test('the registry is non-empty and parses', () => {
    // Guards the whole file: if the heading shape ever changes, every other
    // assertion here would pass vacuously against an empty list.
    expect(registryEntries().length).toBeGreaterThan(20);
  });

  test('every registry entry has a row, covered or explicitly not', () => {
    const rows = new Set(manifest.map((r) => r.entry));
    const missing = registryEntries().filter((e) => !rows.has(e));
    expect(missing).toEqual([]);
  });

  test('no row names an entry the registry does not have', () => {
    const entries = new Set(registryEntries());
    const orphans = manifest.map((r) => r.entry).filter((e) => !entries.has(e));
    expect(orphans).toEqual([]);
  });

  test('no entry is listed twice', () => {
    const seen = manifest.map((r) => r.entry);
    expect(seen.length).toBe(new Set(seen).size);
  });

  test('covered rows say where, which side, and how', () => {
    for (const row of manifest.filter((r) => r.covered)) {
      expect(typeof row.page, `entry ${row.entry} page`).toBe('number');
      expect(['source', 'device', 'both'], `entry ${row.entry} side`).toContain(row.side);
      expect((row.how ?? '').length, `entry ${row.entry} how`).toBeGreaterThan(0);
    }
  });

  test('uncovered rows say why, and claim nothing else', () => {
    for (const row of manifest.filter((r) => !r.covered)) {
      expect((row.why ?? '').length, `entry ${row.entry} why`).toBeGreaterThan(0);
      expect(row.page, `entry ${row.entry} should not claim a page`).toBeUndefined();
    }
  });
});
