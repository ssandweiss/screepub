import { describe, test, expect } from 'bun:test';
import { Fountain } from 'fountain-js';
import { extractTitleMeta, toFountain } from '../src/fountain/serialize';
import { tokensToBody } from '../src/epub/html';
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
      el({ text: 'HURRICANE', type: 'action', isTitlePage: true }),
      el({ text: 'PARTY', type: 'action', isTitlePage: true }),
      el({ text: 'Written by', type: 'action', isTitlePage: true }),
      el({ text: 'Elissa Shay & Michael Stratigakis', type: 'action', isTitlePage: true }),
      el({ text: '© 2025 Kontraband', type: 'action', isTitlePage: true, isReadable: false }),
      el({ text: 'INT. HOUSE - DAY', type: 'scene', pageNum: 2 }),
    ]);
    expect(meta.title).toBe('Hurricane Party');
    expect(meta.author).toBe('Elissa Shay & Michael Stratigakis');
  });

  test('inline by-line "written by / Name" yields author from same element', () => {
    const meta = extractTitleMeta([
      el({ text: 'BEFORE DAWN', type: 'action', isTitlePage: true }),
      el({ text: 'written by Dustin Little', type: 'action', isTitlePage: true }),
    ]);
    expect(meta.title).toBe('Before Dawn');
    expect(meta.author).toBe('Dustin Little');
  });

  test('no title-page elements yields empty meta', () => {
    const meta = extractTitleMeta([el({ text: 'INT. HOUSE - DAY', type: 'scene' })]);
    expect(meta.title).toBeUndefined();
    expect(meta.author).toBeUndefined();
  });

  test('non-readable contact info is never the author', () => {
    const meta = extractTitleMeta([
      el({ text: 'STILL LIFE', type: 'action', isTitlePage: true }),
      el({ text: 'By', type: 'action', isTitlePage: true }),
      el({ text: 'Austin Wood', type: 'action', isTitlePage: true }),
      el({ text: 'austin@email.com', type: 'action', isTitlePage: true, isReadable: false }),
    ]);
    expect(meta.author).toBe('Austin Wood');
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

  test('mini-slugs serialize as forced sluglines', () => {
    const out = toFountain(screenplay([el({ text: 'LATER', type: 'mini-slug' })]));
    expect(out).toBe('.LATER\n');
  });

  test('a mini-slug Fountain cannot force stays an action line', () => {
    // A LEADING DOT is the one thing the dot-force can't carry: fountain-js
    // reads "..45 …" as action (its rule is `^\s*\.(?!\.+)`), so the marker
    // would just leak into the text. Nothing else is excluded.
    const out = toFountain(screenplay([el({ text: '.45 ON THE COUNTER', type: 'mini-slug' })]));
    expect(out).toBe('!.45 ON THE COUNTER\n');
  });

  test('other Fountain markers ride through the dot-force intact', () => {
    // ".#2 CAMERA" tokenizes as a scene heading whose text keeps the "#".
    const out = toFountain(screenplay([el({ text: '#2 CAMERA', type: 'mini-slug' })]));
    expect(out).toBe('.#2 CAMERA\n');
    const { tokens } = new Fountain().parse(out, true);
    expect(tokens.map((t) => [t.type, t.text])).toEqual([['scene_heading', '#2 CAMERA']]);
  });

  test("a mini-slug cuts the (CONT'D) chain — it is a cut in time or place", () => {
    const out = toFountain(
      screenplay([
        el({ text: 'MARGO', type: 'character', character: 'MARGO' }),
        el({ text: 'Go home.', type: 'dialogue', character: 'MARGO' }),
        el({ text: 'LATER', type: 'mini-slug' }),
        el({ text: 'MARGO', type: 'character', character: 'MARGO' }),
        el({ text: 'Still here.', type: 'dialogue', character: 'MARGO' }),
      ]),
    );
    expect(out).not.toContain("(CONT'D)");
  });

  test('a mini-slug never becomes a transition on re-parse', () => {
    // Plain "BACK TO:" matches fountain-js's transition rule (".+ TO:") and
    // used to render right-flush; the forced slugline pins it down.
    const { tokens } = new Fountain().parse(
      toFountain(screenplay([el({ text: 'BACK TO:', type: 'mini-slug' })])),
      true,
    );
    expect(tokens.filter((t) => t.type !== 'title_page').map((t) => t.type)).toEqual(['scene_heading']);
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

  test('a parsed mini-slug reaches the EPUB as a mini-slug', () => {
    // The whole seam: parser element → Fountain → tokens → XHTML. The class
    // the stylesheet styles has to be the one the renderer emits.
    const out = toFountain(
      screenplay([
        el({ text: 'INT. KITCHEN - DAY', type: 'scene' }),
        el({ text: 'Jack waits.', type: 'action' }),
        el({ text: 'LATER', type: 'mini-slug' }),
        el({ text: 'Jack is still waiting.', type: 'action' }),
      ]),
    );
    const { tokens } = new Fountain().parse(out, true);
    const body = tokensToBody(tokens);
    expect(body.files[0].xhtml).toContain('<p class="mini-slug">LATER</p>');
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
