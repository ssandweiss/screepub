import { describe, test, expect } from 'bun:test';
import { parseLines } from '../src/parser/index';
import type { RawLine } from '../src/parser/types';

// The first direct tests of the post-extraction pipeline (parseLines):
// everything else exercises it only through fixture PDFs.

function line(text: string, indent: number, y: number, pageNum: number): RawLine {
  return { text, indent, y, pageNum };
}

/// A miniature script as extracted lines. The title page is the trap: a
/// centered uppercase title lands at ~38% indent, square inside the
/// character-cue band (35-50), and used to walk straight into the roster.
function miniature(): RawLine[] {
  return [
    // page 1 — title page, centered lines
    line('THE MOTH ARCHIVE', 38, 500, 1),
    line('written by', 44, 452, 1),
    line('A. N. Placeholder', 39, 428, 1),
    // page 2 — the script proper
    line('INT. READING ROOM - NIGHT', 17, 700, 2),
    line('The lamp flickers, thinks better of it, and holds.', 17, 676, 2),
    line('NOOR', 43, 652, 2),
    line('Box forty-one. No label, no date, no excuse.', 29, 640, 2),
    line('ELIAS', 43, 616, 2),
    line('Sign it or say why not.', 29, 604, 2),
    line('INT. STAIRWELL NINE - LATER', 17, 580, 2),
    line('Coffee in enamel cups. Nobody drinks; everybody holds.', 17, 556, 2),
    line('NOOR', 43, 532, 2),
    line('Lock the cage. Leave the light.', 29, 520, 2),
  ];
}

describe('parseLines metadata', () => {
  test('a title landing in the cue indent band stays out of the roster', () => {
    const sp = parseLines(miniature());
    const names = sp.characters.map((c) => c.name);
    expect([...names].sort()).toEqual(['ELIAS', 'NOOR']);
    expect(names).not.toContain('THE MOTH ARCHIVE');
  });

  test('dialogue counts drive the roster order', () => {
    const sp = parseLines(miniature());
    expect(sp.characters[0].name).toBe('NOOR');
    expect(sp.characters[0].dialogueCount).toBe(2);
  });

  test('scenes and pages come out of the same pass', () => {
    const sp = parseLines(miniature());
    expect(sp.scenes.length).toBe(2);
    expect(sp.pageCount).toBe(2);
  });
});

/// Classification (priority 9) runs BEFORE suppressBoilerplate, so anything
/// the mini-slug rule claims leaves the recurrence layer's view. A left-flush
/// all-caps watermark is mini-slug-shaped, and it recurs by definition — the
/// two passes have to be told about each other or every page grows a heading.
describe('mini-slugs and the recurrence suppressor', () => {
  /// `slugOnPages` pages carry `mark` at the action margin; every page also
  /// carries a heading and a line of action so the doc has a real page count.
  function pages(pageCount: number, mark: string, markOnPages: number[]): RawLine[] {
    const lines: RawLine[] = [];
    for (let p = 1; p <= pageCount; p++) {
      if (markOnPages.includes(p)) lines.push(line(mark, 17, 720, p));
      lines.push(line(`INT. ROOM ${p} - DAY`, 17, 660, p));
      lines.push(line(`Someone crosses the floor on page ${p}.`, 17, 600, p));
    }
    return lines;
  }
  const all = (n: number) => Array.from({ length: n }, (_, i) => i + 1);
  const typesOf = (ls: RawLine[], text: string) =>
    new Set(parseLines(ls).elements.filter((e) => e.text === text).map((e) => e.type));

  test('a per-page watermark does not escape into a heading on every page', () => {
    // 10 pages, threshold max(3, 40%) = 4. Before mini-slug was a recurrence
    // candidate this rendered ten bold micro-headings.
    expect(typesOf(pages(10, 'CONFIDENTIAL', all(10)), 'CONFIDENTIAL')).not.toContain('mini-slug');
  });

  test('a suppressed mini-slug is demoted to action, never deleted', () => {
    // page-number is the suppressor's usual sink and every consumer skips it.
    // A mini-slug demotes one step only, so the words stay in the book.
    expect([...typesOf(pages(10, 'PROPERTY OF THE STUDIO', all(10)), 'PROPERTY OF THE STUDIO')])
      .toEqual(['action']);
  });

  test('a mini-slug that legitimately repeats under the threshold survives', () => {
    // 3 of 20 pages against a threshold of 8. Mini-slugs repeat by design —
    // this is the reason they demote to action instead of vanishing.
    expect([...typesOf(pages(20, 'LATER', [4, 9, 15]), 'LATER')]).toEqual(['mini-slug']);
  });
});
