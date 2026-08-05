import { describe, test, expect } from 'bun:test';
import { fmtClasses, fmtSizeStep, stripNotes } from '../src/fountain/notes';

describe('stripNotes', () => {
  test('a leading note and the newline it sat on both go', () => {
    expect(stripNotes('[[fmt: sans]]\nCHYRON: LIVE.')).toBe('CHYRON: LIVE.');
  });

  test('an inline note and its extra space go', () => {
    expect(stripNotes('[[fmt: sans]] Read it back.')).toBe('Read it back.');
  });

  test('a note in the middle of a line goes', () => {
    // Pre-existing wart this fixes: any hand-written note used to render as
    // literal text, which the Fountain spec says is wrong.
    expect(stripNotes('He leaves [[check this]] quickly.')).toBe('He leaves quickly.');
  });

  test('newlines inside a multi-line token survive', () => {
    // A lyrics/verse dialogue token carries its own line breaks.
    expect(stripNotes('[[fmt: +1]] one\ntwo\nthree')).toBe('one\ntwo\nthree');
  });

  test('text with no notes is returned untouched, character for character', () => {
    const s = '  double  spaced  and\n  indented  ';
    expect(stripNotes(s)).toBe(s);
  });

  test('an unterminated bracket is left alone rather than eating the line', () => {
    expect(stripNotes('He said [[ and stopped')).toBe('He said [[ and stopped');
  });
});

describe('fmtClasses', () => {
  test('a family note yields its class', () => {
    expect(fmtClasses('[[fmt: sans]]\nX')).toBe(' fmt-sans');
  });

  test('all four families and all three sizes map', () => {
    for (const [word, cls] of [['mono', 'fmt-mono'], ['serif', 'fmt-serif'],
                               ['sans', 'fmt-sans'], ['cursive', 'fmt-cursive'],
                               ['-1', 'fmt-minus1'], ['+1', 'fmt-plus1'],
                               ['+2', 'fmt-plus2']]) {
      expect(fmtClasses(`[[fmt: ${word}]]\nX`), word).toBe(` ${cls}`);
    }
  });

  test('family and size together yield both classes', () => {
    expect(fmtClasses('[[fmt: sans +2]]\nX')).toBe(' fmt-sans fmt-plus2');
  });

  test('only a LEADING note counts', () => {
    expect(fmtClasses('Text first [[fmt: sans]]')).toBe('');
  });

  test('a non-fmt note yields no classes', () => {
    expect(fmtClasses('[[a production note]]\nX')).toBe('');
  });

  test('malformed content is ignored word by word, never thrown', () => {
    expect(fmtClasses('[[fmt: teal +9 sans]]\nX')).toBe(' fmt-sans');
    expect(fmtClasses('[[fmt:]]\nX')).toBe('');
    expect(fmtClasses('[[fmt: ]]\nX')).toBe('');
  });
});

describe('fmtSizeStep', () => {
  test('reads the size word out of a leading note', () => {
    expect(fmtSizeStep('[[fmt: sans +2]]\nX')).toBe('+2');
    expect(fmtSizeStep('[[fmt: -1]]\nX')).toBe('-1');
  });

  test('a family-only note has no size step', () => {
    expect(fmtSizeStep('[[fmt: sans]]\nX')).toBeUndefined();
  });

  test('no note at all has no size step', () => {
    expect(fmtSizeStep('Plain action.')).toBeUndefined();
  });
});
