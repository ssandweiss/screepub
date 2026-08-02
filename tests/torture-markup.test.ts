import { describe, test, expect } from 'bun:test';
import { spawnSync } from 'node:child_process';

function parseMarkup(s: string): { plain: string; spans: [number, number, string][] } {
  const run = spawnSync('python3', ['tools/make-fixture.py', '--parse-markup', s], {
    encoding: 'utf8',
  });
  if (run.status !== 0) throw new Error(run.stderr.trim());
  return JSON.parse(run.stdout);
}

describe('inline markup', () => {
  test('strips markers and records offsets into the PLAIN text', () => {
    const r = parseMarkup('a {b}bold{/b} c');
    expect(r.plain).toBe('a bold c');
    expect(r.spans).toEqual([[2, 6, 'b']]);
  });

  test('handles two styles over the same run', () => {
    const r = parseMarkup('{b}{i}both{/i}{/b}');
    expect(r.plain).toBe('both');
    expect(r.spans.map((s) => s[2]).sort()).toEqual(['b', 'i']);
  });

  test('text with no markup is returned unchanged', () => {
    const r = parseMarkup('plain text');
    expect(r.plain).toBe('plain text');
    expect(r.spans).toEqual([]);
  });

  // A typo buried in 14 sheets of content must fail at generation, not
  // produce a fixture that quietly tests nothing.
  test('an unclosed marker is an error, not silently dropped', () => {
    expect(() => parseMarkup('a {b}bold')).toThrow();
  });

  test('an unmatched closer is an error', () => {
    expect(() => parseMarkup('a bold{/b}')).toThrow();
  });
});
