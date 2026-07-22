import { describe, test, expect } from 'bun:test';
import { groupItemsIntoLines } from '../src/parser/extract';

function item(str: string, x: number, y: number) {
  return { str, transform: [1, 0, 0, 1, x, y] };
}

describe('groupItemsIntoLines', () => {
  test('items on one Y join into a single line with indent %', () => {
    const lines = groupItemsIntoLines([item('Hello', 61, 700), item('world', 120, 700)], 612, 1);
    expect(lines).toHaveLength(1);
    expect(lines[0].text).toBe('Hello world');
    expect(lines[0].indent).toBe(10); // 61/612
  });

  test('double-printed text at the same position is deduplicated', () => {
    // Final Draft double-prints (MORE) and (CONT'D) cue lines at identical
    // coordinates; naive joining yields "(MORE)(MORE)".
    const lines = groupItemsIntoLines(
      [item('(MORE)', 300, 80), item('(MORE)', 300, 80)],
      612,
      1,
    );
    expect(lines[0].text).toBe('(MORE)');
  });

  test('duplicates separated by an empty zero-width item still deduplicate', () => {
    // Final Draft emits "(MORE)", "", "(MORE)" — the empty item must not
    // break duplicate adjacency.
    const lines = groupItemsIntoLines(
      [item('(MORE)', 252, 63), item('', 252, 63), item('(MORE)', 252, 63)],
      612,
      1,
    );
    expect(lines[0].text).toBe('(MORE)');
  });

  test('right-margin revision stars on their own line are dropped', () => {
    // Revised drafts mark changed lines with * in the right margin; a bare
    // star line must not become an element (it would reset dialogue context).
    const lines = groupItemsIntoLines(
      [item('Hey! Careful with the counters,', 180, 700), item('*', 575, 688)],
      612,
      1,
    );
    expect(lines).toHaveLength(1);
    expect(lines[0].text).toBe('Hey! Careful with the counters,');
  });

  test('right-margin revision star on the same line as text is dropped', () => {
    const lines = groupItemsIntoLines(
      [item('He walks out.', 110, 700), item('*', 575, 700)],
      612,
      1,
    );
    expect(lines[0].text).toBe('He walks out.');
  });

  test('asterisk emphasis inside body text is kept', () => {
    const lines = groupItemsIntoLines([item('***THIS SCENE IS FILMED***', 110, 700)], 612, 1);
    expect(lines[0].text).toBe('***THIS SCENE IS FILMED***');
  });

  test('dual dialogue de-interleaves into left speech then right speech', () => {
    // p48 of Meteor Anne: MELVIN ‖ ANNE speaking simultaneously in two
    // columns. Naive Y-joining interleaves the columns into garbage.
    const lines = groupItemsIntoLines(
      [
        item('MELVIN', 180, 700), item('ANNE', 400, 700),
        item('try this again.', 150, 688), item('maybe if you got better', 380, 688),
        item('at lying.', 380, 676), // right column runs one line longer
        item('They stare at each other.', 108, 640), // back to normal action
      ],
      612,
      1,
    );
    expect(lines.map((l) => l.text)).toEqual([
      'MELVIN',
      'try this again.',
      'ANNE',
      'maybe if you got better',
      'at lying.',
      'They stare at each other.',
    ]);
    expect(lines[0].indent).toBe(40); // cue zone
    expect(lines[1].indent).toBe(30); // dialogue zone
    expect(lines[2].indent).toBe(40);
    expect(lines[4].indent).toBe(30);
  });

  test('dual body lines with narrow gaps still split at the cue-anchored boundary', () => {
    // Real Meteor Anne p48 failure: long dialogue lines close the
    // inter-column gap, so splitting must use the boundary fixed by the
    // dual-cue line, not per-line gap detection.
    const lines = groupItemsIntoLines(
      [
        item('MELVIN', 180, 700), item('ANNE', 400, 700),
        item("Let's go to break and we'll", 150, 688), item('Huh? Yes a slight delay.', 340, 688),
      ],
      612,
      1,
    );
    expect(lines.map((l) => l.text)).toEqual([
      'MELVIN',
      "Let's go to break and we'll",
      'ANNE',
      'Huh? Yes a slight delay.',
    ]);
  });

  test('a second dual-cue pair starts a new pair of speeches', () => {
    const lines = groupItemsIntoLines(
      [
        item('MELVIN', 180, 700), item('ANNE', 400, 700),
        item('try this again.', 150, 688), item('maybe if you got', 380, 688),
        item("MELVIN (CONT'D)", 170, 664), item('ANNE', 400, 664),
        item('No. Stop.', 150, 652), item('You stop!', 380, 652),
      ],
      612,
      1,
    );
    expect(lines.map((l) => l.text)).toEqual([
      'MELVIN', 'try this again.', 'ANNE', 'maybe if you got',
      "MELVIN (CONT'D)", 'No. Stop.', 'ANNE', 'You stop!',
    ]);
  });

  test('two-column title-page furniture is not treated as dual dialogue', () => {
    const lines = groupItemsIntoLines(
      [item('646-761-2994', 72, 700), item('October 28, 2024', 400, 700)],
      612,
      1,
    );
    expect(lines).toHaveLength(1);
    expect(lines[0].text).toBe('646-761-2994 October 28, 2024');
  });

  test('legitimately repeated words at different positions are kept', () => {
    const lines = groupItemsIntoLines(
      [item('No.', 100, 700), item('No.', 140, 700)],
      612,
      1,
    );
    expect(lines[0].text).toBe('No. No.');
  });
});

describe('dual-margin scene numbers', () => {
  test('duplicated margin numbers collapse to one token', () => {
    // Shooting scripts print the scene number in BOTH margins on the
    // slugline's row: "2        2" must become "2", which then attaches
    // to the following scene heading.
    const lines = groupItemsIntoLines(
      [item('2', 54, 700), item('2', 576, 700), item('INT. FOYER - DAY', 108, 676)],
      612,
      1,
    );
    expect(lines.map((l) => l.text)).toEqual(['2', 'INT. FOYER - DAY']);
  });

  test('lettered scene numbers collapse too', () => {
    const lines = groupItemsIntoLines([item('12A.', 54, 700), item('12A.', 570, 700)], 612, 1);
    expect(lines[0].text).toBe('12A.');
  });

  test('distinct numbers on one line are left alone', () => {
    const lines = groupItemsIntoLines([item('1', 54, 700), item('2', 576, 700)], 612, 1);
    expect(lines[0].text).toBe('1 2');
  });
});
