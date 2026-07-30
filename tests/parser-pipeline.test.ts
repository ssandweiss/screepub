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
