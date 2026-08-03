import { describe, test, expect } from 'bun:test';
import { groupItemsIntoLines, extractDocument } from '../src/parser/extract';

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

  test("continuation suffix printed 1pt above its cue joins the cue line", () => {
    // Night Shift's generator prints "(CONT'D)" as a separate item one
    // point higher than the character name; exact-Y bucketing split it into
    // its own line, which then serialized as a stray "(CONT'D)" paragraph.
    const lines = groupItemsIntoLines(
      [item("(CONT'D)", 290, 268), item('MARGO', 250, 267), item('You look totally wiped.', 180, 255)],
      612,
      1,
    );
    expect(lines).toHaveLength(2);
    expect(lines[0].text).toBe("MARGO (CONT'D)");
    expect(lines[1].text).toBe('You look totally wiped.');
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
      [item('Hey! Careful with those tapes,', 180, 700), item('*', 575, 688)],
      612,
      1,
    );
    expect(lines).toHaveLength(1);
    expect(lines[0].text).toBe('Hey! Careful with those tapes,');
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
    // p48 of The Last Video Store: MARGO ‖ DEV speaking simultaneously
    // in two columns. Naive Y-joining interleaves them into garbage.
    const lines = groupItemsIntoLines(
      [
        item('MARGO', 180, 700), item('DEV', 400, 700),
        item('rewind it again.', 150, 688), item('maybe if you were faster', 380, 688),
        item('at closing.', 380, 676), // right column runs one line longer
        item('They stare at the screen.', 108, 640), // back to normal action
      ],
      612,
      1,
    );
    expect(lines.map((l) => l.text)).toEqual([
      'MARGO',
      'rewind it again.',
      'DEV',
      'maybe if you were faster',
      'at closing.',
      'They stare at the screen.',
    ]);
    expect(lines[0].indent).toBe(40); // cue zone
    expect(lines[1].indent).toBe(30); // dialogue zone
    expect(lines[2].indent).toBe(40);
    expect(lines[4].indent).toBe(30);
  });

  test('dual body lines with narrow gaps still split at the cue-anchored boundary', () => {
    // The real p48 failure in The Last Video Store: long dialogue lines
    // close the inter-column gap, so splitting must use the boundary fixed
    // by the dual-cue line, not per-line gap detection.
    const lines = groupItemsIntoLines(
      [
        item('MARGO', 180, 700), item('DEV', 400, 700),
        item("Let's lock up and then we'll", 150, 688), item('What? Sure, in a minute.', 340, 688),
      ],
      612,
      1,
    );
    expect(lines.map((l) => l.text)).toEqual([
      'MARGO',
      "Let's lock up and then we'll",
      'DEV',
      'What? Sure, in a minute.',
    ]);
  });

  test('a second dual-cue pair starts a new pair of speeches', () => {
    const lines = groupItemsIntoLines(
      [
        item('MARGO', 180, 700), item('DEV', 400, 700),
        item('rewind it again.', 150, 688), item('maybe if you were', 380, 688),
        item("MARGO (CONT'D)", 170, 664), item('DEV', 400, 664),
        item('No. Wait.', 150, 652), item('You wait!', 380, 652),
      ],
      612,
      1,
    );
    expect(lines.map((l) => l.text)).toEqual([
      'MARGO', 'rewind it again.', 'DEV', 'maybe if you were',
      "MARGO (CONT'D)", 'No. Wait.', 'DEV', 'You wait!',
    ]);
  });

  test('two-column title-page furniture is not treated as dual dialogue', () => {
    const lines = groupItemsIntoLines(
      [item('212-555-0134', 72, 700), item('October 28, 2024', 400, 700)],
      612,
      1,
    );
    expect(lines).toHaveLength(1);
    expect(lines[0].text).toBe('212-555-0134 October 28, 2024');
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

describe('whitespace normalization', () => {
  test('padded italic spans and authored doubles collapse to single spaces', () => {
    // Italicized words extract as separate items padded with spaces
    // ("need some  paperwork  here"); HTML collapses them anyway, so the
    // fountain should match what the reader renders.
    const lines = groupItemsIntoLines(
      [item('need some ', 110, 700), item(' paperwork ', 220, 700), item(' here', 340, 700)],
      612,
      1,
    );
    expect(lines[0].text).toBe('need some paperwork here');
  });
});

describe('inline style detection', () => {
  const styled = (str: string, x: number, y: number, flags: { italic?: boolean; bold?: boolean }) =>
    ({ str, transform: [1, 0, 0, 1, x, y], ...flags });

  test('an italic run inside a plain line gains fountain emphasis markers', () => {
    const lines = groupItemsIntoLines(
      [styled('need some ', 110, 700, {}), styled('paperwork', 220, 700, { italic: true }), styled(' here', 340, 700, {})],
      612,
      1,
    );
    expect(lines[0].text).toBe('need some paperwork here');
    expect(lines[0].styled).toBe('need some *paperwork* here');
  });

  test('bold and bold-italic runs use ** and ***', () => {
    const lines = groupItemsIntoLines(
      [styled('a ', 110, 700, {}), styled('big', 200, 700, { bold: true }), styled(' loud', 300, 700, { bold: true, italic: true })],
      612,
      1,
    );
    expect(lines[0].styled).toBe('a **big** ***loud***');
  });

  test('a fully italic line wraps whole', () => {
    const lines = groupItemsIntoLines([styled('I never wanted that', 200, 700, { italic: true })], 612, 1);
    expect(lines[0].styled).toBe('*I never wanted that*');
  });

  test('punctuation-only styled items never wrap alone', () => {
    const lines = groupItemsIntoLines(
      [styled('by Nora Vance', 110, 700, {}), styled(',', 189, 700, { italic: true }), styled(' the b-side', 195, 700, {})],
      612,
      1,
    );
    expect(lines[0].text).toBe('by Nora Vance, the b-side');
    expect(lines[0].styled).toBeUndefined();
  });

  test('uniform plain lines carry no styled variant', () => {
    const lines = groupItemsIntoLines([styled('Just action.', 110, 700, {})], 612, 1);
    expect(lines[0].styled).toBeUndefined();
  });
});

describe('dual dialogue marking', () => {
  test('the right column cue line carries the dualRight flag', () => {
    const lines = groupItemsIntoLines(
      [
        item('MARGO', 180, 700), item('DEV', 400, 700),
        item('rewind it again.', 150, 688), item('maybe if you were faster', 380, 688),
      ],
      612,
      1,
    );
    expect(lines[0].text).toBe('MARGO');
    expect(lines[0].dualRight).toBeUndefined();
    expect(lines[2].text).toBe('DEV');
    expect(lines[2].dualRight).toBe(true);
  });
});

describe('extractDocument progress', () => {
  // The app showed an indeterminate spinner during conversion because the
  // engine reported nothing until it was finished. Page extraction is the
  // long stage and already counts pages, so it is where a real fraction
  // comes from.
  const bytes = async () =>
    new Uint8Array(await Bun.file('tests/fixtures/screenplay.pdf').arrayBuffer());

  test('reports one progress tick per page, with the total', async () => {
    const ticks: { page: number; pages: number }[] = [];
    // getDocument transfers the buffer, so each call needs its own bytes.
    const { pageCount } = await extractDocument(await bytes(), undefined, (page, pages) =>
      ticks.push({ page, pages }),
    );

    expect(pageCount).toBe(5);
    expect(ticks).toHaveLength(5);
    expect(ticks.map((t) => t.page)).toEqual([1, 2, 3, 4, 5]);
    // Every tick carries the same total so a fraction is computable from
    // the first one, without waiting to learn the denominator.
    expect(ticks.every((t) => t.pages === 5)).toBe(true);
  });

  test('is optional: extraction works with no callback', async () => {
    const { pageCount, lines } = await extractDocument(await bytes());
    expect(pageCount).toBe(5);
    expect(lines.length).toBeGreaterThan(0);
  });
});
