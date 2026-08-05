import { describe, test, expect, beforeAll } from 'bun:test';
import { extractDocument } from '../src/parser/extract';
import { parseLines } from '../src/parser/index';
import type { ElementType, ParsedScreenplay } from '../src/parser/types';

// Source-side assertions against the committed torture fixture. Device-side
// behavior (keeps, orphan control, transitions never beginning a page) can
// only be looked at on hardware: see `bun tools/device-checklist.ts`.

let doc: ParsedScreenplay;
let styledAll: string;

beforeAll(async () => {
  const bytes = await Bun.file('tests/fixtures/torture.pdf').arrayBuffer();
  // getDocument TRANSFERS the buffer, so this Uint8Array is single-use.
  const { lines } = await extractDocument(new Uint8Array(bytes));
  doc = parseLines(lines);
  styledAll = doc.elements.map((e) => e.styledText ?? e.text).join('\n');
});

describe('the proof sheet parses', () => {
  test('every content element type the parser knows appears at least once', () => {
    const seen = new Set(doc.elements.map((e) => e.type));
    const required: ElementType[] = ['scene', 'character', 'dialogue', 'action',
                                     'parenthetical', 'transition', 'mini-slug'];
    for (const t of required) {
      expect(seen).toContain(t);
    }
  });

  test('the saturation cast is the roster, and the title is not in it', () => {
    const names = doc.characters.map((c) => c.name);
    for (const who of ['BUNNY', 'CASSIUS', 'ODILE', 'WREN']) {
      expect(names).toContain(who);
    }
    // A centered title lands in the cue indent band; detectTitlePages flags
    // it and the roster must honor the flag.
    expect(names).not.toContain('THE PROOF SHEET');
  });

  test('a dotted abbreviation name is a character, not action', () => {
    expect(doc.characters.map((c) => c.name)).toContain('DR. E. T. MARCHETTI');
  });

  test('the dual exchange marks its right column', () => {
    expect(doc.elements.some((e) => e.dualRight)).toBe(true);
  });

  test('no element mixes text from both dual columns', () => {
    const mixed = doc.elements.filter(
      (e) => e.text.includes('LEFTMARK') && e.text.includes('RIGHTMARK'),
    );
    expect(mixed).toEqual([]);
  });

  test('the dual-margin scene number is attached, not left in the heading', () => {
    const el = doc.elements.find((e) => e.sceneNumber === '42');
    expect(el).toBeDefined();
    expect(el!.type).toBe('scene');
    expect(el!.text).not.toContain('42');
  });

  test('mini-slugs are micro-headings, not scenes', () => {
    const mini = doc.elements.filter((e) => e.type === 'mini-slug');
    expect(mini.map((e) => e.text)).toContain('INDEX CARDS');
    // A mini-slug must NOT become a scene: it serializes as a forced
    // slugline, and a scene would mint a section and a TOC entry.
    expect(doc.scenes.map((s) => s.heading)).not.toContain('INDEX CARDS');
  });

  test('cue extensions are tolerated with and without their closing period', () => {
    const parens = doc.elements
      .filter((e) => e.type === 'parenthetical')
      .map((e) => e.text);
    expect(parens).toContain('(O.S.)');
    expect(parens).toContain('(V.O)');
    expect(parens).toContain('(O.C)');
  });

  test('the long speech really does cross a page boundary', () => {
    // If it stopped fitting on one page, the (MORE)/(CONT'D) rejoin is no
    // longer being exercised and this fixture silently stops proving it.
    const anchor = doc.elements.find((e) => e.text.includes('MORE-ANCHOR'));
    expect(anchor).toBeDefined();
    const anchorPage = anchor!.pageNum;
    const lastOfSpeech = [...doc.elements]
      .filter((e) => e.type === 'dialogue' && e.character === anchor!.character)
      .pop();
    expect(lastOfSpeech!.pageNum).toBeGreaterThanOrEqual(anchorPage);
  });
});

describe('rich formatting', () => {
  test('bold, italic and bold-italic all reach styledText', () => {
    expect(styledAll).toContain('**DO NOT LAMINATE**');
    expect(styledAll).toContain('*again*');
    expect(styledAll).toContain('***both bold and italic***');
  });

  test('a styled run keeps its emphasis across a wrap boundary', () => {
    const el = doc.elements.find((e) => e.text.includes('crosses the wrap boundary'));
    expect(el).toBeDefined();
    expect(el!.styledText).toContain('**');
  });

  test('a punctuation-only styled item never wraps alone', () => {
    // Registry 9d: a lone styled comma must not become "*,*".
    expect(styledAll).not.toContain('**,**');
    expect(styledAll).not.toContain('*,*');
  });

  test('a drawn underline reaches styledText as underscores', () => {
    const el = doc.elements.find((e) => e.text.includes('underlined'));
    expect(el).toBeDefined();
    // The plain text must still be clean: classification never sees markers.
    expect(el!.text).toBe('This word is underlined with drawn vector art.');
    expect(el!.styledText).toBe('This word is _underlined_ with drawn vector art.');
  });

  // Three rules the detector must REJECT, each caught by a different filter,
  // each drawn beside the real underline on the same page. A loosened
  // threshold shows up here as a stray underscore rather than as silence.
  test('a strikethrough is not an underline', () => {
    const el = doc.elements.find((e) => e.text.includes('struck through'));
    expect(el).toBeDefined();
    expect(el!.styledText ?? el!.text).not.toContain('_');
  });

  test('a table border below the text band is not an underline', () => {
    const el = doc.elements.find((e) => e.text.includes('below this cell'));
    expect(el).toBeDefined();
    expect(el!.styledText ?? el!.text).not.toContain('_');
  });

  test('a page-wide rule is furniture, not an underline', () => {
    const el = doc.elements.find((e) => e.text.includes('this whole line'));
    expect(el).toBeDefined();
    expect(el!.styledText ?? el!.text).not.toContain('_');
  });
});

describe('defects this fixture surfaced', () => {
  // FIXED. This fixture found it: attachSceneNumbers used to promote any
  // page-number element whose text matched SCENE_NUMBER, and a bare "1."
  // matches, so every page OPENING on a scene heading donated its page
  // number to that scene. screenplay.pdf never exposed it because its pages
  // start mid-scene. classifyBlock now marks the shooting-script case at
  // classification time, where the two are still distinguishable.
  test('a page number is not absorbed as a scene number', () => {
    const openers = doc.elements.filter(
      (e) => e.type === 'scene' && e.text === 'INT. ARCHIVE BASEMENT - NIGHT',
    );
    expect(openers.length).toBeGreaterThan(0);
    for (const scene of openers) {
      expect(scene.sceneNumber).toBeUndefined();
    }
  });

  test('the genuine shooting-script number still attaches', () => {
    const el = doc.elements.find((e) => e.sceneNumber === '42');
    expect(el).toBeDefined();
    expect(el!.type).toBe('scene');
  });
});
