import { describe, test, expect } from 'bun:test';
import { Fountain } from 'fountain-js';
import { extractTitleMeta, toFountain } from '../src/fountain/serialize';
import type { ScreenplayElement, ParsedScreenplay } from '../src/parser/types';

let idCounter = 0;
function el(over: Partial<ScreenplayElement> & { text: string; type: ScreenplayElement['type'] }): ScreenplayElement {
  return {
    id: `t${idCounter++}`,
    pageNum: 1,
    isTitlePage: false,
    isReadable: true,
    ...over,
  };
}

function screenplay(elements: ScreenplayElement[]): ParsedScreenplay {
  return { elements, characters: [], scenes: [], pageCount: 1 };
}

// ── extractTitleMeta ─────────────────────────────────────

describe('extractTitleMeta', () => {
  test('title joins readable elements before by-line, author follows it', () => {
    const meta = extractTitleMeta([
      el({ text: 'MOONQUAKE', type: 'action', isTitlePage: true }),
      el({ text: 'JAMBOREE', type: 'action', isTitlePage: true }),
      el({ text: 'Written by', type: 'action', isTitlePage: true }),
      el({ text: 'Fenwick Sprocket & Tallulah Quibble', type: 'action', isTitlePage: true }),
      el({ text: '© 2025 Placeholder Pictures', type: 'action', isTitlePage: true, isReadable: false }),
      el({ text: 'INT. HOUSE - DAY', type: 'scene', pageNum: 2 }),
    ]);
    expect(meta.title).toBe('Moonquake Jamboree');
    expect(meta.author).toBe('Fenwick Sprocket & Tallulah Quibble');
  });

  test('inline by-line "written by / Name" yields author from same element', () => {
    const meta = extractTitleMeta([
      el({ text: 'ZEPPELIN PICNIC', type: 'action', isTitlePage: true }),
      el({ text: 'written by Barnaby Fictitious', type: 'action', isTitlePage: true }),
    ]);
    expect(meta.title).toBe('Zeppelin Picnic');
    expect(meta.author).toBe('Barnaby Fictitious');
  });

  test('no title-page elements yields empty meta', () => {
    const meta = extractTitleMeta([el({ text: 'INT. HOUSE - DAY', type: 'scene' })]);
    expect(meta.title).toBeUndefined();
    expect(meta.author).toBeUndefined();
  });

  test('non-readable contact info is never the author', () => {
    const meta = extractTitleMeta([
      el({ text: 'GARGOYLE BRUNCH', type: 'action', isTitlePage: true }),
      el({ text: 'By', type: 'action', isTitlePage: true }),
      el({ text: 'Imaginaria Nobody', type: 'action', isTitlePage: true }),
      el({ text: 'imaginaria@example.com', type: 'action', isTitlePage: true, isReadable: false }),
    ]);
    expect(meta.author).toBe('Imaginaria Nobody');
  });
});

// ── toFountain ───────────────────────────────────────────

describe('toFountain', () => {
  test('emits title block when meta present', () => {
    const out = toFountain(screenplay([el({ text: 'INT. HOUSE - DAY', type: 'scene' })]), {
      title: 'My Script',
      author: 'Jane Doe',
    });
    expect(out).toStartWith('Title: My Script\nCredit: Written by\nAuthor: Jane Doe\n\n');
  });

  test('scene, cue, parenthetical, dialogue, action serialize with blank-line separation', () => {
    const out = toFountain(
      screenplay([
        el({ text: 'INT. KITCHEN - DAY', type: 'scene' }),
        el({ text: 'JACK', type: 'character', character: 'JACK' }),
        el({ text: '(whispering)', type: 'parenthetical', character: 'JACK' }),
        el({ text: 'Hello there.', type: 'dialogue', character: 'JACK' }),
        el({ text: 'The door slams.', type: 'action' }),
      ]),
    );
    expect(out).toBe(
      'INT. KITCHEN - DAY\n\n@JACK\n(whispering)\nHello there.\n\nThe door slams.\n',
    );
  });

  test('page-number elements and non-readable elements are skipped', () => {
    const out = toFountain(
      screenplay([
        el({ text: '42.', type: 'page-number' }),
        el({ text: 'Blue Rev. (6/12/26)', type: 'page-number' }),
        el({ text: 'Some action.', type: 'action' }),
        el({ text: 'skip me', type: 'action', isReadable: false }),
      ]),
    );
    expect(out).toBe('Some action.\n');
  });

  test('title-page elements are excluded from body', () => {
    const out = toFountain(
      screenplay([
        el({ text: 'MY TITLE', type: 'action', isTitlePage: true }),
        el({ text: 'INT. HOUSE - DAY', type: 'scene' }),
      ]),
    );
    expect(out).toBe('INT. HOUSE - DAY\n');
  });

  test('scene numbers serialize as #N#', () => {
    const out = toFountain(
      screenplay([el({ text: 'INT. LAB - NIGHT', type: 'scene', sceneNumber: '1A.' })]),
    );
    expect(out).toBe('INT. LAB - NIGHT #1A.#\n');
  });

  test('transitions are forced with >', () => {
    const out = toFountain(screenplay([el({ text: 'SMASH CUT TO:', type: 'transition' })]));
    expect(out).toBe('> SMASH CUT TO:\n');
  });

  test('action starting with . or > is forced with !', () => {
    const out = toFountain(
      screenplay([
        el({ text: '.45 on the table.', type: 'action' }),
        el({ text: '> ominous graffiti', type: 'action' }),
      ]),
    );
    expect(out).toBe('!.45 on the table.\n\n!> ominous graffiti\n');
  });

  test('mini-slugs pass through as standalone lines', () => {
    const out = toFountain(screenplay([el({ text: 'LATER', type: 'mini-slug' })]));
    expect(out).toBe('LATER\n');
  });

  test('(MORE) parentheticals are dropped', () => {
    const out = toFountain(
      screenplay([
        el({ text: 'JACK', type: 'character', character: 'JACK' }),
        el({ text: 'I was saying—', type: 'dialogue', character: 'JACK' }),
        el({ text: '(MORE)', type: 'parenthetical', character: 'JACK' }),
      ]),
    );
    expect(out).toBe('@JACK\nI was saying—\n');
  });

  test("(CONT'D) cue after page break merges into the same speech", () => {
    const out = toFountain(
      screenplay([
        el({ text: 'JACK', type: 'character', character: 'JACK', pageNum: 1 }),
        el({ text: 'First half of speech', type: 'dialogue', character: 'JACK', pageNum: 1 }),
        el({ text: '(MORE)', type: 'parenthetical', character: 'JACK', pageNum: 1 }),
        el({ text: '3.', type: 'page-number', pageNum: 2 }),
        el({ text: "JACK (CONT'D)", type: 'character', character: 'JACK', pageNum: 2 }),
        el({ text: 'and the second half.', type: 'dialogue', character: 'JACK', pageNum: 2 }),
      ]),
    );
    expect(out).toBe('@JACK\nFirst half of speech\nand the second half.\n');
  });

  test("(CONT'D) cue after intervening action keeps its own cue", () => {
    const out = toFountain(
      screenplay([
        el({ text: 'JACK', type: 'character', character: 'JACK' }),
        el({ text: 'Look at this.', type: 'dialogue', character: 'JACK' }),
        el({ text: 'He points at the wall.', type: 'action' }),
        el({ text: "JACK (CONT'D)", type: 'character', character: 'JACK' }),
        el({ text: 'See what I mean?', type: 'dialogue', character: 'JACK' }),
      ]),
    );
    expect(out).toBe(
      "@JACK\nLook at this.\n\nHe points at the wall.\n\n@JACK (CONT'D)\nSee what I mean?\n",
    );
  });

  test('cue with no following dialogue is demoted to action', () => {
    const out = toFountain(
      screenplay([
        el({ text: 'ORPHAN CUE', type: 'character', character: 'ORPHAN CUE' }),
        el({ text: 'The lights go out.', type: 'action' }),
      ]),
    );
    expect(out).toBe('ORPHAN CUE\n\nThe lights go out.\n');
  });
});

// ── round-trip through fountain-js ───────────────────────

describe('fountain-js round-trip', () => {
  test('serialized output tokenizes back to the same structure', () => {
    const out = toFountain(
      screenplay([
        el({ text: 'INT. KITCHEN - DAY', type: 'scene', sceneNumber: '7' }),
        el({ text: 'Jack enters.', type: 'action' }),
        el({ text: 'JACK (V.O.)', type: 'character', character: 'JACK' }),
        el({ text: '(tired)', type: 'parenthetical', character: 'JACK' }),
        el({ text: 'Long day.', type: 'dialogue', character: 'JACK' }),
        el({ text: 'FADE OUT.', type: 'transition' }),
      ]),
      { title: 'Round Trip', author: 'Tester' },
    );
    const { tokens } = new Fountain().parse(out, true);
    const types = tokens.map((t) => t.type);
    expect(types).toEqual([
      'title', 'credit', 'author',
      'scene_heading', 'action',
      'dialogue_begin', 'character', 'parenthetical', 'dialogue', 'dialogue_end',
      'transition',
    ]);
    const scene = tokens.find((t) => t.type === 'scene_heading')!;
    expect(scene.scene_number).toBe('7');
    const cue = tokens.find((t) => t.type === 'character')!;
    expect(cue.text).toBe('JACK (V.O.)');
  });
});

// ── regression: real-PDF artifacts ───────────────────────

describe('PDF artifact handling', () => {
  test('(MORE) is dropped regardless of classified type', () => {
    const out = toFountain(
      screenplay([
        el({ text: 'JACK', type: 'character', character: 'JACK' }),
        el({ text: 'Speech before break', type: 'dialogue', character: 'JACK' }),
        el({ text: '(MORE)', type: 'action' }),
        el({ text: "JACK (CONT'D)", type: 'character', character: 'JACK' }),
        el({ text: 'speech after break.', type: 'dialogue', character: 'JACK' }),
      ]),
    );
    expect(out).toBe('@JACK\nSpeech before break\nspeech after break.\n');
  });

  test("curly-apostrophe (CONT’D) cue merges across page break", () => {
    const out = toFountain(
      screenplay([
        el({ text: 'DEV', type: 'character', character: 'DEV' }),
        el({ text: 'First part', type: 'dialogue', character: 'DEV' }),
        el({ text: 'DEV (CONT’D)', type: 'character', character: 'DEV' }),
        el({ text: 'second part.', type: 'dialogue', character: 'DEV' }),
      ]),
    );
    expect(out).toBe('@DEV\nFirst part\nsecond part.\n');
  });

  test('cue internal whitespace is normalized', () => {
    const out = toFountain(
      screenplay([
        el({ text: 'MIDDLE SEAT  PASSENGER  (V.O.)', type: 'character', character: 'MIDDLE SEAT PASSENGER' }),
        el({ text: 'Hm.', type: 'dialogue', character: 'MIDDLE SEAT PASSENGER' }),
      ]),
    );
    expect(out).toBe('@MIDDLE SEAT PASSENGER (V.O.)\nHm.\n');
  });
});

// ── inline emphasis pass-through ─────────────────────────

describe('styled text emission', () => {
  test('dialogue and action emit their styled variant', () => {
    const out = toFountain(
      screenplay([
        el({ text: 'The sign reads DANGER.', type: 'action', styledText: 'The sign reads **DANGER**.' }),
        el({ text: 'JACK', type: 'character', character: 'JACK' }),
        el({ text: 'I want insurance now.', type: 'dialogue', character: 'JACK', styledText: 'I want *insurance* now.' }),
      ]),
    );
    expect(out).toContain('The sign reads **DANGER**.');
    expect(out).toContain('I want *insurance* now.');
  });

  test('parentheticals and cues stay plain (markers would break recognition)', () => {
    const out = toFountain(
      screenplay([
        el({ text: 'JACK', type: 'character', character: 'JACK', styledText: '**JACK**' }),
        el({ text: '(scream singing)', type: 'parenthetical', character: 'JACK', styledText: '*(scream singing)*' }),
        el({ text: 'La la la', type: 'dialogue', character: 'JACK' }),
      ]),
    );
    expect(out).toContain('@JACK\n(scream singing)\nLa la la');
  });
});
