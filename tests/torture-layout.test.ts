import { describe, test, expect } from 'bun:test';
import { spawnSync } from 'node:child_process';

export interface LayoutRun {
  styles: string[];
  text: string;
}
export interface LayoutRow {
  line: number;
  x: number;
  runs: LayoutRun[];
  underline: boolean;
}
export interface LayoutPage {
  page: number;
  rows: LayoutRow[];
}

/**
 * The generator's layout, as data. Page PLACEMENT is the thing most likely
 * to rot silently: a speech that must start at line 50 still "passes" every
 * output-shaped test at line 48, while proving nothing about the page break
 * it was written to straddle.
 */
export function emitLayout(kind: string): LayoutPage[] {
  const run = spawnSync('python3', ['tools/make-fixture.py', '--emit-layout', kind], {
    encoding: 'utf8',
  });
  if (run.status !== 0) throw new Error(`make-fixture.py failed: ${run.stderr}`);
  return JSON.parse(run.stdout);
}

describe('--emit-layout', () => {
  test('screenplay lays out onto more than one page, numbered from 1', () => {
    const pages = emitLayout('screenplay');
    expect(pages.length).toBeGreaterThan(1);
    expect(pages[0].page).toBe(1);
    expect(pages.map((p) => p.page)).toEqual(pages.map((_, i) => i + 1));
  });

  test('every row carries a line number, an x position and at least one run', () => {
    for (const page of emitLayout('screenplay')) {
      for (const row of page.rows) {
        expect(typeof row.line).toBe('number');
        expect(typeof row.x).toBe('number');
        expect(row.runs.length).toBeGreaterThan(0);
      }
    }
  });

  test('the title page carries the invented author, not a real one', () => {
    const first = emitLayout('screenplay')[0];
    const text = first.rows.flatMap((r) => r.runs.map((run) => run.text));
    expect(text).toContain('A. N. Placeholder');
  });
});
