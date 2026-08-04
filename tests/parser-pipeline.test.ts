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

  test('a suppressed mini-slug is hidden on the same terms as action', () => {
    // page-number is the suppressor's sink and every consumer skips it. One
    // rule for both types, so a mark that types action on one page and
    // mini-slug on the next cannot come out hidden here and visible there.
    expect([...typesOf(pages(10, 'PROPERTY OF THE STUDIO', all(10)), 'PROPERTY OF THE STUDIO')])
      .toEqual(['page-number']);
  });

  test('a mini-slug that legitimately repeats under the threshold survives', () => {
    // 3 of 20 pages against a threshold of 8. Mini-slugs do repeat, so the
    // threshold is what has to hold — and it does: the widest page-spread of
    // any real mini-slug in the corpus is 14%, against a 40% bar.
    expect([...typesOf(pages(20, 'LATER', [4, 9, 15]), 'LATER')]).toEqual(['mini-slug']);
  });
});

describe('scene numbers vs page numbers', () => {
  // Both arrive as `page-number` elements, because a standalone shooting-script
  // scene number is deliberately typed that way so it stays hidden
  // (classify.ts, "Shooting script scene numbers"). attachSceneNumbers then
  // promotes it onto the following heading.
  //
  // The trap: a BARE page number like "1." is caught by PAGE_NUMBER_BARE at
  // priority 1 and is textually indistinguishable from a scene number, so any
  // page that OPENS with a scene heading used to donate its page number to
  // that scene. Ordinary scripts do that constantly.

  function pageOpeningOnHeading(numberText: string): RawLine[] {
    return [
      line(numberText, 87, 740, 2), // top-right gutter, first thing on page 2
      line('INT. ARCHIVE - NIGHT', 18, 700, 2),
      line('Someone is already here.', 18, 676, 2),
      line('BUNNY', 44, 640, 2),
      line('You came back.', 26, 628, 2),
    ];
  }

  test('a bare page number is NOT absorbed as a scene number', () => {
    const { elements } = parseLines(pageOpeningOnHeading('2.'));
    const scene = elements.find((e) => e.type === 'scene');
    expect(scene).toBeDefined();
    expect(scene!.sceneNumber).toBeUndefined();
  });

  test('a shooting-script scene number IS still attached', () => {
    // The documented path must keep working: this is why the rule exists.
    const { elements } = parseLines(pageOpeningOnHeading('1A.'));
    const scene = elements.find((e) => e.type === 'scene');
    expect(scene).toBeDefined();
    expect(scene!.sceneNumber).toBe('1A.');
  });

  test('a compound shooting-script number is still attached', () => {
    const { elements } = parseLines(pageOpeningOnHeading('2.2.'));
    const scene = elements.find((e) => e.type === 'scene');
    expect(scene!.sceneNumber).toBe('2.2.');
  });

  test('the page number is still stripped from the body either way', () => {
    const { elements } = parseLines(pageOpeningOnHeading('2.'));
    expect(elements.some((e) => e.type === 'page-number' && e.text === '2.')).toBe(true);
  });
});

describe('page furniture between a cue and its dialogue', () => {
  // A cue as the LAST line of a page, its speech resuming on the next page,
  // with the printed page number in between. Found on a real Kindle: speech
  // thirty-seven of the proof sheet rendered as "BUNNY Speech thirty-seven."
  // in one run instead of a cue and a speech.
  //
  // Page furniture is stripped from the output, so it must not influence
  // structure. Letting it reset the speaker breaks the speech in half.
  function cueStrandedAtPageEnd(): RawLine[] {
    return [
      line('BUNNY', 44, 72, 1),        // last line of page 1
      line('13.', 87, 756, 2),         // printed page number, top of page 2
      line('Speech thirty-seven. Short.', 29, 720, 2),
      line('CASSIUS', 44, 696, 2),
      line('And the reply.', 29, 684, 2),
    ];
  }

  test('dialogue after the page number still belongs to the cue', () => {
    const { elements } = parseLines(cueStrandedAtPageEnd());
    const speech = elements.find((e) => e.text.startsWith('Speech thirty-seven'));
    expect(speech).toBeDefined();
    expect(speech!.type).toBe('dialogue');
    expect(speech!.character).toBe('BUNNY');
  });

  test('the cue itself still classifies as a character', () => {
    const { elements } = parseLines(cueStrandedAtPageEnd());
    expect(elements.find((e) => e.text === 'BUNNY')?.type).toBe('character');
  });

  test('the page number is still stripped', () => {
    const { elements } = parseLines(cueStrandedAtPageEnd());
    expect(elements.find((e) => e.text === '13.')?.type).toBe('page-number');
  });

  test('furniture does not invent a speaker where there was none', () => {
    // Action after a page number must stay action: transparency must not
    // become "attach anything that follows furniture to the last speaker".
    const { elements } = parseLines([
      line('BUNNY', 44, 72, 1),
      line('Her line.', 29, 60, 1),
      line('13.', 87, 756, 2),
      line('She crosses to the window.', 18, 720, 2),
    ]);
    const act = elements.find((e) => e.text.startsWith('She crosses'));
    expect(act!.type).toBe('action');
  });
});
