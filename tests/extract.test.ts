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

  test('legitimately repeated words at different positions are kept', () => {
    const lines = groupItemsIntoLines(
      [item('No.', 100, 700), item('No.', 140, 700)],
      612,
      1,
    );
    expect(lines[0].text).toBe('No. No.');
  });
});
