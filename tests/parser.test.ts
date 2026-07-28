import { describe, test, expect, beforeEach } from 'bun:test';
import { classifyBlock, resetCounter, attachSceneNumbers, normalizeCueName } from '../src/parser/classify';
import { groupBlocks } from '../src/parser/group';
import { detectTitlePages } from '../src/parser/title-page';
import type { ScreenplayElement } from '../src/parser/types';
import type { TextBlock, RawLine } from '../src/parser/types';

// ── Helpers ──────────────────────────────────────────────

function makeBlock(overrides: Partial<TextBlock> & { text: string; indent: number }): TextBlock {
  const { text, indent, pageNum = 1, yPosition = 100, lines, minIndent, maxIndent } = overrides;
  return {
    lines: lines ?? [{ text, indent, y: yPosition, pageNum }],
    text,
    indent,
    minIndent: minIndent ?? indent,
    maxIndent: maxIndent ?? indent,
    pageNum,
    yPosition,
  };
}

function makeLine(overrides: Partial<RawLine> & { text: string }): RawLine {
  return {
    indent: 0,
    y: 100,
    pageNum: 1,
    ...overrides,
  };
}

// ── classify.ts ──────────────────────────────────────────

describe('classifyBlock', () => {
  beforeEach(() => {
    resetCounter();
  });

  describe('scene headings', () => {
    test('INT. prefix classified as scene', () => {
      const block = makeBlock({ text: 'INT. KITCHEN - DAY', indent: 10 });
      const result = classifyBlock(block, null);
      expect(result.type).toBe('scene');
      expect(result.text).toBe('INT. KITCHEN - DAY');
    });

    test('EXT. prefix classified as scene', () => {
      const block = makeBlock({ text: 'EXT. PARK - NIGHT', indent: 10 });
      const result = classifyBlock(block, null);
      expect(result.type).toBe('scene');
    });

    test('INT./EXT. prefix classified as scene', () => {
      const block = makeBlock({ text: 'INT./EXT. CAR - MOVING - DAY', indent: 10 });
      const result = classifyBlock(block, null);
      expect(result.type).toBe('scene');
    });

    test('I/E. prefix classified as scene', () => {
      const block = makeBlock({ text: 'I/E. HOUSE - CONTINUOUS', indent: 10 });
      const result = classifyBlock(block, null);
      expect(result.type).toBe('scene');
    });

    test('scene heading at any indent is still scene', () => {
      const block = makeBlock({ text: 'INT. OFFICE - DAY', indent: 40 });
      const result = classifyBlock(block, null);
      expect(result.type).toBe('scene');
    });

    test('inline dual-margin scene numbers strip and attach (OUT THERE)', () => {
      // Some generators print the shooting-script number in both margins of
      // the heading row itself, joined into one line by extraction.
      const block = makeBlock({ text: '2 EXT. OREGON WOODS - HIGH AND WIDE - ESTABLISHING 2', indent: 9 });
      const result = classifyBlock(block, null);
      expect(result.type).toBe('scene');
      expect(result.text).toBe('EXT. OREGON WOODS - HIGH AND WIDE - ESTABLISHING');
      expect(result.sceneNumber).toBe('2');
    });

    test('inline dual-margin numbers with letter suffix attach too', () => {
      const block = makeBlock({ text: '12A INT. HALLWAY - CONTINUOUS 12A', indent: 9 });
      const result = classifyBlock(block, null);
      expect(result.type).toBe('scene');
      expect(result.sceneNumber).toBe('12A');
    });

    test('mismatched margin numbers do not strip', () => {
      const block = makeBlock({ text: '2 EXT. WOODS - DAY 3', indent: 9 });
      const result = classifyBlock(block, null);
      expect(result.type).toBe('action');
    });
  });

  describe('character names', () => {
    test('uppercase name at character indent', () => {
      const block = makeBlock({ text: 'JACK', indent: 40 });
      const result = classifyBlock(block, null);
      expect(result.type).toBe('character');
      expect(result.character).toBe('JACK');
      expect(result.baseCharacter).toBe('JACK');
    });

    test('character with V.O. extension', () => {
      const block = makeBlock({ text: 'SARAH (V.O.)', indent: 40 });
      const result = classifyBlock(block, null);
      expect(result.type).toBe('character');
      expect(result.character).toBe('SARAH');
    });

    test("character with CONT'D extension", () => {
      const block = makeBlock({ text: "MIKE (CONT'D)", indent: 40 });
      const result = classifyBlock(block, null);
      expect(result.type).toBe('character');
      expect(result.character).toBe('MIKE');
    });

    test('character with O.S. extension', () => {
      const block = makeBlock({ text: 'DETECTIVE JONES (O.S.)', indent: 40 });
      const result = classifyBlock(block, null);
      expect(result.type).toBe('character');
      expect(result.character).toBe('DETECTIVE JONES');
    });

    // Writers routinely drop the closing period — METEOR ANNE has the same
    // speaker as both "REALITY HOST (O.S)" and "REALITY HOST (O.S.)". The
    // unpunctuated form used to fall through the extension branch and then
    // hit the "periods only in ellipsis" guard, so the cue AND its speech
    // both landed as action.
    test('character with a period-less O.S extension', () => {
      const block = makeBlock({ text: 'REALITY HOST (O.S)', indent: 40 });
      const result = classifyBlock(block, null);
      expect(result.type).toBe('character');
      expect(result.character).toBe('REALITY HOST');
    });

    test('character with a period-less V.O extension', () => {
      const block = makeBlock({ text: 'SARAH (V.O)', indent: 40 });
      const result = classifyBlock(block, null);
      expect(result.type).toBe('character');
      expect(result.character).toBe('SARAH');
    });

    test('character with a period-less O.C extension', () => {
      const block = makeBlock({ text: 'MIKE (O.C)', indent: 40 });
      const result = classifyBlock(block, null);
      expect(result.type).toBe('character');
      expect(result.character).toBe('MIKE');
    });

    test('both spellings of one speaker yield the same character name', () => {
      const dotted = classifyBlock(makeBlock({ text: 'REALITY HOST (O.S.)', indent: 40 }), null);
      const bare = classifyBlock(makeBlock({ text: 'REALITY HOST (O.S)', indent: 40 }), null);
      expect(bare.character).toBe(dotted.character);
      expect(bare.baseCharacter).toBe(dotted.baseCharacter);
    });

    // MAN OF HER DREAMS types ANNA’S MOM with a curly apostrophe. The name
    // pattern allowed only the straight ', so every bare instance fell to
    // action — while "ANNA’S MOM (O.S.)" passed, because an extension takes
    // a different branch that never reaches CHARACTER_NAME.
    test('character name with a curly apostrophe', () => {
      const block = makeBlock({ text: 'ANNA’S MOM', indent: 40 });
      const result = classifyBlock(block, null);
      expect(result.type).toBe('character');
      expect(result.character).toBe('ANNA’S MOM');
    });

    test('character name with a straight apostrophe still works', () => {
      const block = makeBlock({ text: "ANNA'S DAD", indent: 40 });
      const result = classifyBlock(block, null);
      expect(result.type).toBe('character');
      expect(result.character).toBe("ANNA'S DAD");
    });

    test('rejects character name at action indent', () => {
      const block = makeBlock({ text: 'JACK', indent: 10 });
      const result = classifyBlock(block, null);
      expect(result.type).not.toBe('character');
    });

    test('rejects lowercase text at character indent', () => {
      const block = makeBlock({ text: 'Jack walks in', indent: 40 });
      const result = classifyBlock(block, null);
      expect(result.type).not.toBe('character');
    });

    test('rejects names with punctuation (!?;,)', () => {
      const block = makeBlock({ text: 'JACK!', indent: 40 });
      const result = classifyBlock(block, null);
      expect(result.type).not.toBe('character');
    });

    test('rejects company names', () => {
      const block = makeBlock({ text: 'ACME INC', indent: 40 });
      const result = classifyBlock(block, null);
      expect(result.type).not.toBe('character');
    });
  });

  describe('age variants', () => {
    test('YOUNG prefix extracts age modifier', () => {
      const block = makeBlock({ text: 'YOUNG JACK', indent: 40 });
      const result = classifyBlock(block, null);
      expect(result.type).toBe('character');
      expect(result.baseCharacter).toBe('JACK');
      expect(result.ageModifier).toBe('YOUNG');
      expect(result.ageValue).toBe('young');
    });

    test('OLD prefix extracts age modifier', () => {
      const block = makeBlock({ text: 'OLD JACK', indent: 40 });
      const result = classifyBlock(block, null);
      expect(result.type).toBe('character');
      expect(result.baseCharacter).toBe('JACK');
      expect(result.ageModifier).toBe('OLD');
    });

    test('LITTLE prefix extracts child age', () => {
      const block = makeBlock({ text: 'LITTLE SARAH', indent: 40 });
      const result = classifyBlock(block, null);
      expect(result.type).toBe('character');
      expect(result.baseCharacter).toBe('SARAH');
      expect(result.ageModifier).toBe('LITTLE');
      expect(result.ageValue).toBe('child');
    });
  });

  describe('dialogue', () => {
    test('text at dialogue indent after character is dialogue', () => {
      const charBlock = makeBlock({ text: 'JACK', indent: 40 });
      const charElement = classifyBlock(charBlock, null);

      const dialBlock = makeBlock({ text: 'Hello there.', indent: 30 });
      const result = classifyBlock(dialBlock, charElement);
      expect(result.type).toBe('dialogue');
      expect(result.character).toBe('JACK');
    });

    test('dialogue after dialogue preserves character', () => {
      const charBlock = makeBlock({ text: 'SARAH', indent: 40 });
      const charElement = classifyBlock(charBlock, null);

      const dial1Block = makeBlock({ text: 'First line.', indent: 30 });
      const dial1 = classifyBlock(dial1Block, charElement);

      const dial2Block = makeBlock({ text: 'Second line.', indent: 30 });
      const result = classifyBlock(dial2Block, dial1);
      expect(result.type).toBe('dialogue');
      expect(result.character).toBe('SARAH');
    });

    test('dialogue after action has no character (defaults to action)', () => {
      const actionBlock = makeBlock({ text: 'Jack walks in.', indent: 10 });
      const actionElement = classifyBlock(actionBlock, null);

      const dialBlock = makeBlock({ text: 'Hello there.', indent: 30 });
      const result = classifyBlock(dialBlock, actionElement);
      // No active character, so it defaults to action
      expect(result.type).toBe('action');
    });
  });

  describe('parentheticals', () => {
    test('parenthetical after character', () => {
      const charBlock = makeBlock({ text: 'JACK', indent: 40 });
      const charElement = classifyBlock(charBlock, null);

      const parenBlock = makeBlock({ text: '(whispering)', indent: 30 });
      const result = classifyBlock(parenBlock, charElement);
      expect(result.type).toBe('parenthetical');
      expect(result.character).toBe('JACK');
    });

    test('parenthetical after dialogue preserves character', () => {
      const charBlock = makeBlock({ text: 'SARAH', indent: 40 });
      const charElement = classifyBlock(charBlock, null);

      const dialBlock = makeBlock({ text: 'Wait...', indent: 30 });
      const dial = classifyBlock(dialBlock, charElement);

      const parenBlock = makeBlock({ text: '(beat)', indent: 30 });
      const result = classifyBlock(parenBlock, dial);
      expect(result.type).toBe('parenthetical');
      expect(result.character).toBe('SARAH');
    });

    test('parenthetical without active character is not parenthetical', () => {
      const parenBlock = makeBlock({ text: '(whispering)', indent: 30 });
      const result = classifyBlock(parenBlock, null);
      expect(result.type).not.toBe('parenthetical');
    });
  });

  describe('action', () => {
    test('text at low indent classified as action', () => {
      const block = makeBlock({ text: 'The door slams shut.', indent: 10 });
      const result = classifyBlock(block, null);
      expect(result.type).toBe('action');
    });

    test('possessive start detected as action', () => {
      const block = makeBlock({ text: "Jack's eyes widen.", indent: 10 });
      const result = classifyBlock(block, null);
      expect(result.type).toBe('action');
    });

    test('pronoun start detected as action', () => {
      const block = makeBlock({ text: 'She turns around slowly.', indent: 10 });
      const result = classifyBlock(block, null);
      expect(result.type).toBe('action');
    });

    test('verb pattern detected as action', () => {
      const block = makeBlock({ text: 'The stranger walks into the room.', indent: 10 });
      const result = classifyBlock(block, null);
      expect(result.type).toBe('action');
    });
  });

  describe('transitions', () => {
    test('CUT TO: at high indent classified as transition', () => {
      const block = makeBlock({ text: 'CUT TO:', indent: 60 });
      const result = classifyBlock(block, null);
      expect(result.type).toBe('transition');
    });

    test('FADE TO: classified as transition', () => {
      const block = makeBlock({ text: 'FADE TO:', indent: 60 });
      const result = classifyBlock(block, null);
      expect(result.type).toBe('transition');
    });

    test('transition requires high indent', () => {
      const block = makeBlock({ text: 'CUT TO:', indent: 10 });
      const result = classifyBlock(block, null);
      // At low indent, matches action by camera pattern
      expect(result.type).not.toBe('transition');
    });
  });

  describe('page numbers', () => {
    test('number at high indent classified as page-number', () => {
      const block = makeBlock({ text: '42', indent: 70 });
      const result = classifyBlock(block, null);
      expect(result.type).toBe('page-number');
    });

    test('number with period at high indent', () => {
      const block = makeBlock({ text: '42.', indent: 70 });
      const result = classifyBlock(block, null);
      expect(result.type).toBe('page-number');
    });

    test('bare number at low indent is still page-number', () => {
      const block = makeBlock({ text: '42', indent: 10 });
      const result = classifyBlock(block, null);
      expect(result.type).toBe('page-number');
    });

    test('bare number at center indent is page-number', () => {
      const block = makeBlock({ text: '42', indent: 45 });
      const result = classifyBlock(block, null);
      expect(result.type).toBe('page-number');
    });

    test('dashed page number format "- 42 -"', () => {
      const block = makeBlock({ text: '- 42 -', indent: 45 });
      const result = classifyBlock(block, null);
      expect(result.type).toBe('page-number');
    });

    test('"Page 42" format is page-number', () => {
      const block = makeBlock({ text: 'Page 42', indent: 45 });
      const result = classifyBlock(block, null);
      expect(result.type).toBe('page-number');
    });

    test('"p. 42" format is page-number', () => {
      const block = makeBlock({ text: 'p. 42', indent: 45 });
      const result = classifyBlock(block, null);
      expect(result.type).toBe('page-number');
    });

    test('number with surrounding whitespace is page-number', () => {
      const block = makeBlock({ text: '  42  ', indent: 70 });
      const result = classifyBlock(block, null);
      expect(result.type).toBe('page-number');
    });

    test('revision slug classified as page-number', () => {
      const block = makeBlock({ text: 'Blue Rev. (6/12/26) 15.15', indent: 5, pageNum: 15 });
      const result = classifyBlock(block, null);
      expect(result.type).toBe('page-number');
    });

    test('color-named character cue is NOT boilerplate', () => {
      const block = makeBlock({ text: 'CHERRY', indent: 40 });
      const result = classifyBlock(block, null);
      expect(result.type).toBe('character');
      expect(result.character).toBe('CHERRY');
    });
  });

  describe('mini-slugs', () => {
    test('short uppercase text at low indent', () => {
      const block = makeBlock({ text: 'LATER', indent: 2 });
      const result = classifyBlock(block, null);
      expect(result.type).toBe('mini-slug');
    });

    test('long uppercase text at low indent', () => {
      const block = makeBlock({ text: 'MOMENTS LATER', indent: 2 });
      const result = classifyBlock(block, null);
      expect(result.type).toBe('mini-slug');
    });

    test('scene heading prefix not treated as mini-slug', () => {
      const block = makeBlock({ text: 'INT. OFFICE', indent: 2 });
      const result = classifyBlock(block, null);
      expect(result.type).toBe('scene');
    });
  });

  describe('element IDs', () => {
    test('sequential IDs are assigned', () => {
      const block1 = makeBlock({ text: 'INT. KITCHEN - DAY', indent: 10 });
      const block2 = makeBlock({ text: 'JACK', indent: 40 });
      const el1 = classifyBlock(block1, null);
      const el2 = classifyBlock(block2, el1);
      expect(el1.id).toBe('elem0');
      expect(el2.id).toBe('elem1');
    });

    test('resetCounter resets ID sequence', () => {
      const block = makeBlock({ text: 'INT. OFFICE - DAY', indent: 10 });
      classifyBlock(block, null);
      resetCounter();
      const result = classifyBlock(block, null);
      expect(result.id).toBe('elem0');
    });
  });
});

// ── group.ts ─────────────────────────────────────────────

describe('groupBlocks', () => {
  test('contiguous lines with same indent form one block', () => {
    const lines: RawLine[] = [
      makeLine({ text: 'First line of action.', indent: 10, y: 700 }),
      makeLine({ text: 'Second line of action.', indent: 10, y: 688 }),
    ];
    const blocks = groupBlocks(lines);
    expect(blocks).toHaveLength(1);
    expect(blocks[0].text).toBe('First line of action. Second line of action.');
  });

  test('scene heading starts new block', () => {
    const lines: RawLine[] = [
      makeLine({ text: 'Some action text.', indent: 10, y: 700 }),
      makeLine({ text: 'INT. KITCHEN - DAY', indent: 10, y: 688 }),
    ];
    const blocks = groupBlocks(lines);
    expect(blocks).toHaveLength(2);
    expect(blocks[0].text).toBe('Some action text.');
    expect(blocks[1].text).toBe('INT. KITCHEN - DAY');
  });

  test('large Y gap breaks block', () => {
    const lines: RawLine[] = [
      makeLine({ text: 'First block.', indent: 10, y: 700 }),
      makeLine({ text: 'Second block.', indent: 10, y: 650 }),
    ];
    const blocks = groupBlocks(lines);
    expect(blocks).toHaveLength(2);
  });

  test('page break starts new block', () => {
    const lines: RawLine[] = [
      makeLine({ text: 'Page one text.', indent: 10, y: 100, pageNum: 1 }),
      makeLine({ text: 'Page two text.', indent: 10, y: 700, pageNum: 2 }),
    ];
    const blocks = groupBlocks(lines);
    expect(blocks).toHaveLength(2);
  });

  test('indent change breaks block', () => {
    const lines: RawLine[] = [
      makeLine({ text: 'Action text.', indent: 10, y: 700 }),
      makeLine({ text: 'Dialogue text.', indent: 30, y: 688 }),
    ];
    const blocks = groupBlocks(lines);
    expect(blocks).toHaveLength(2);
  });

  test('character indent starts new block', () => {
    const lines: RawLine[] = [
      makeLine({ text: 'Some dialogue.', indent: 30, y: 700 }),
      makeLine({ text: 'JACK', indent: 40, y: 688 }),
    ];
    const blocks = groupBlocks(lines);
    expect(blocks).toHaveLength(2);
  });

  test('cleans ellipsis artifacts from character names', () => {
    const lines: RawLine[] = [
      makeLine({ text: 'JACK...', indent: 40, y: 700 }),
    ];
    const blocks = groupBlocks(lines);
    expect(blocks[0].text).toBe('JACK');
  });

  test('block inherits pageNum and yPosition from first line', () => {
    const lines: RawLine[] = [
      makeLine({ text: 'Line one.', indent: 10, y: 500, pageNum: 3 }),
      makeLine({ text: 'Line two.', indent: 10, y: 488, pageNum: 3 }),
    ];
    const blocks = groupBlocks(lines);
    expect(blocks[0].pageNum).toBe(3);
    expect(blocks[0].yPosition).toBe(500);
  });

  test('block tracks min and max indent', () => {
    const lines: RawLine[] = [
      makeLine({ text: 'Line one.', indent: 10, y: 700 }),
      makeLine({ text: 'Line two.', indent: 11, y: 688 }),
    ];
    const blocks = groupBlocks(lines);
    expect(blocks[0].minIndent).toBe(10);
    expect(blocks[0].maxIndent).toBe(11);
  });
});

// ── title-page.ts ────────────────────────────────────────

describe('detectTitlePages', () => {
  function makeElement(overrides: Partial<ScreenplayElement> & { text: string; type: ScreenplayElement['type'] }): ScreenplayElement {
    return {
      id: 'test',
      pageNum: 1,
      isTitlePage: false,
      isReadable: true,
      ...overrides,
    };
  }

  test('elements before first scene on page 1 are marked as title page', () => {
    const elements: ScreenplayElement[] = [
      makeElement({ text: 'MY SCREENPLAY', type: 'action', pageNum: 1 }),
      makeElement({ text: 'Written by', type: 'action', pageNum: 1 }),
      makeElement({ text: 'John Doe', type: 'action', pageNum: 1 }),
      makeElement({ text: 'INT. KITCHEN - DAY', type: 'scene', pageNum: 2 }),
    ];
    const result = detectTitlePages(elements);
    expect(result[0].isTitlePage).toBe(true);
    expect(result[1].isTitlePage).toBe(true);
    expect(result[2].isTitlePage).toBe(true);
    expect(result[3].isTitlePage).toBe(false);
  });

  test('title and by-line are readable', () => {
    const elements: ScreenplayElement[] = [
      makeElement({ text: 'MY SCREENPLAY', type: 'action', pageNum: 1 }),
      makeElement({ text: 'Written by', type: 'action', pageNum: 1 }),
      makeElement({ text: 'INT. KITCHEN - DAY', type: 'scene', pageNum: 2 }),
    ];
    const result = detectTitlePages(elements);
    expect(result[0].isReadable).toBe(true);
    expect(result[1].isReadable).toBe(true);
  });

  test('contact info after by-line is not readable', () => {
    const elements: ScreenplayElement[] = [
      makeElement({ text: 'MY SCREENPLAY', type: 'action', pageNum: 1 }),
      makeElement({ text: 'Written by', type: 'action', pageNum: 1 }),
      makeElement({ text: 'John Doe', type: 'action', pageNum: 1 }),
      makeElement({ text: 'john@email.com', type: 'action', pageNum: 1 }),
      makeElement({ text: 'Phone: (555) 123-4567', type: 'action', pageNum: 1 }),
      makeElement({ text: 'Draft 2', type: 'action', pageNum: 1 }),
      makeElement({ text: 'INT. KITCHEN - DAY', type: 'scene', pageNum: 2 }),
    ];
    const result = detectTitlePages(elements);
    expect(result[2].isReadable).toBe(true);  // Author name
    expect(result[3].isReadable).toBe(false); // Email
    expect(result[4].isReadable).toBe(false); // Phone
    expect(result[5].isReadable).toBe(false); // Draft
  });

  test('front matter on pages 2+ is readable', () => {
    const elements: ScreenplayElement[] = [
      makeElement({ text: 'MY SCREENPLAY', type: 'action', pageNum: 1 }),
      makeElement({ text: 'Written by Author', type: 'action', pageNum: 1 }),
      makeElement({ text: 'For my mother.', type: 'action', pageNum: 2 }),
      makeElement({ text: 'INT. KITCHEN - DAY', type: 'scene', pageNum: 3 }),
    ];
    const result = detectTitlePages(elements);
    expect(result[2].isTitlePage).toBe(false);
    expect(result[2].isReadable).toBe(true);
  });

  test('no changes when first element is scene', () => {
    const elements: ScreenplayElement[] = [
      makeElement({ text: 'INT. KITCHEN - DAY', type: 'scene', pageNum: 1 }),
      makeElement({ text: 'JACK', type: 'character', pageNum: 1 }),
    ];
    const result = detectTitlePages(elements);
    expect(result[0].isTitlePage).toBe(false);
    expect(result[1].isTitlePage).toBe(false);
  });

  test('returns elements unchanged when no scene found', () => {
    const elements: ScreenplayElement[] = [
      makeElement({ text: 'Just some text', type: 'action', pageNum: 1 }),
    ];
    const result = detectTitlePages(elements);
    expect(result[0].isTitlePage).toBe(false);
  });

  test('copyright is detected as contact info', () => {
    const elements: ScreenplayElement[] = [
      makeElement({ text: 'MY SCREENPLAY', type: 'action', pageNum: 1 }),
      makeElement({ text: 'by Author', type: 'action', pageNum: 1 }),
      makeElement({ text: 'Copyright 2024', type: 'action', pageNum: 1 }),
      makeElement({ text: 'INT. KITCHEN - DAY', type: 'scene', pageNum: 2 }),
    ];
    const result = detectTitlePages(elements);
    expect(result[2].isReadable).toBe(false);
  });

  test('WGA registration is detected as contact info', () => {
    const elements: ScreenplayElement[] = [
      makeElement({ text: 'MY SCREENPLAY', type: 'action', pageNum: 1 }),
      makeElement({ text: 'Screenplay by Author', type: 'action', pageNum: 1 }),
      makeElement({ text: 'WGA Registration #12345', type: 'action', pageNum: 1 }),
      makeElement({ text: 'INT. KITCHEN - DAY', type: 'scene', pageNum: 2 }),
    ];
    const result = detectTitlePages(elements);
    expect(result[2].isReadable).toBe(false);
  });
});

// ── index.ts: attachSceneNumbers ─────────────────────────

describe('attachSceneNumbers', () => {
  function makeElement(overrides: Partial<ScreenplayElement> & { text: string; type: ScreenplayElement['type'] }): ScreenplayElement {
    return {
      id: 'test',
      pageNum: 1,
      isTitlePage: false,
      isReadable: true,
      ...overrides,
    };
  }

  test('shooting-script scene number before scene heading is attached', () => {
    const elements: ScreenplayElement[] = [
      makeElement({ text: '2.2.', type: 'page-number' }),
      makeElement({ text: 'INT. KITCHEN - DAY', type: 'scene' }),
    ];
    attachSceneNumbers(elements);
    expect(elements[1].sceneNumber).toBe('2.2.');
  });

  test('revision slug before scene heading is NOT attached as scene number', () => {
    const elements: ScreenplayElement[] = [
      makeElement({ text: 'Blue Rev. (6/12/26)', type: 'page-number' }),
      makeElement({ text: 'INT. KITCHEN - DAY', type: 'scene' }),
    ];
    attachSceneNumbers(elements);
    expect(elements[1].sceneNumber).toBeUndefined();
  });
});

// ── Integration: classify pipeline ───────────────────────

describe('classify pipeline integration', () => {
  beforeEach(() => {
    resetCounter();
  });

  test('full sequence: scene -> character -> dialogue -> action', () => {
    const blocks: TextBlock[] = [
      makeBlock({ text: 'INT. KITCHEN - DAY', indent: 10 }),
      makeBlock({ text: 'JACK', indent: 40 }),
      makeBlock({ text: 'What are we having for dinner?', indent: 30 }),
      makeBlock({ text: 'Sarah enters from the hallway.', indent: 10 }),
    ];

    let prev: ScreenplayElement | null = null;
    const elements: ScreenplayElement[] = [];
    for (const block of blocks) {
      const el = classifyBlock(block, prev);
      elements.push(el);
      prev = el;
    }

    expect(elements[0].type).toBe('scene');
    expect(elements[1].type).toBe('character');
    expect(elements[2].type).toBe('dialogue');
    expect(elements[3].type).toBe('action');
  });

  test('character -> parenthetical -> dialogue sequence', () => {
    const blocks: TextBlock[] = [
      makeBlock({ text: 'SARAH', indent: 40 }),
      makeBlock({ text: '(whispering)', indent: 30 }),
      makeBlock({ text: 'Did you hear that?', indent: 30 }),
    ];

    let prev: ScreenplayElement | null = null;
    const elements: ScreenplayElement[] = [];
    for (const block of blocks) {
      const el = classifyBlock(block, prev);
      elements.push(el);
      prev = el;
    }

    expect(elements[0].type).toBe('character');
    expect(elements[1].type).toBe('parenthetical');
    expect(elements[1].character).toBe('SARAH');
    expect(elements[2].type).toBe('dialogue');
    expect(elements[2].character).toBe('SARAH');
  });

  test('action resets character context', () => {
    const blocks: TextBlock[] = [
      makeBlock({ text: 'JACK', indent: 40 }),
      makeBlock({ text: 'Hello.', indent: 30 }),
      makeBlock({ text: 'The door opens.', indent: 10 }),
      makeBlock({ text: 'More text here.', indent: 30 }),
    ];

    let prev: ScreenplayElement | null = null;
    const elements: ScreenplayElement[] = [];
    for (const block of blocks) {
      const el = classifyBlock(block, prev);
      elements.push(el);
      prev = el;
    }

    expect(elements[0].type).toBe('character');
    expect(elements[1].type).toBe('dialogue');
    expect(elements[1].character).toBe('JACK');
    expect(elements[2].type).toBe('action');
    // After action, no active character
    expect(elements[3].type).toBe('action'); // not dialogue, since no character
  });

  test('scene heading resets character context', () => {
    const blocks: TextBlock[] = [
      makeBlock({ text: 'JACK', indent: 40 }),
      makeBlock({ text: 'Hello.', indent: 30 }),
      makeBlock({ text: 'INT. BEDROOM - NIGHT', indent: 10 }),
      makeBlock({ text: 'Some text.', indent: 30 }),
    ];

    let prev: ScreenplayElement | null = null;
    const elements: ScreenplayElement[] = [];
    for (const block of blocks) {
      const el = classifyBlock(block, prev);
      elements.push(el);
      prev = el;
    }

    expect(elements[2].type).toBe('scene');
    // After scene, no active character
    expect(elements[3].type).toBe('action');
  });

  test('multiple character switches', () => {
    const blocks: TextBlock[] = [
      makeBlock({ text: 'JACK', indent: 40 }),
      makeBlock({ text: "I don't think so.", indent: 30 }),
      makeBlock({ text: 'SARAH', indent: 40 }),
      makeBlock({ text: 'Why not?', indent: 30 }),
    ];

    let prev: ScreenplayElement | null = null;
    const elements: ScreenplayElement[] = [];
    for (const block of blocks) {
      const el = classifyBlock(block, prev);
      elements.push(el);
      prev = el;
    }

    expect(elements[1].character).toBe('JACK');
    expect(elements[3].character).toBe('SARAH');
  });
});

describe('hybrid and non-standard character cues', () => {
  test('shared cue with slash is a character', () => {
    const block = makeBlock({ text: 'CLEO/PANNI', indent: 40 });
    const result = classifyBlock(block, null);
    expect(result.type).toBe('character');
    expect(result.character).toBe('CLEO/PANNI');
  });

  test('numbered cue is a character', () => {
    const block = makeBlock({ text: 'COP #2', indent: 40 });
    const result = classifyBlock(block, null);
    expect(result.type).toBe('character');
  });

  test('ampersand cue is a character', () => {
    const block = makeBlock({ text: 'MOM & DAD', indent: 40 });
    const result = classifyBlock(block, null);
    expect(result.type).toBe('character');
  });

  test('shared cue carries dialogue context', () => {
    const cue = classifyBlock(makeBlock({ text: 'CLEO/PANNI', indent: 40 }), null);
    const paren = classifyBlock(makeBlock({ text: '(scream singing)', indent: 30 }), cue);
    expect(paren.type).toBe('parenthetical');
    const line = classifyBlock(makeBlock({ text: 'I want you so badly', indent: 30 }), paren);
    expect(line.type).toBe('dialogue');
    expect(line.character).toBe('CLEO/PANNI');
  });
});

describe('normalizeCueName', () => {
  test('straightens curly apostrophes', () => {
    expect(normalizeCueName('ANNA’S MOM')).toBe("ANNA'S MOM");
  });
  test('upper-cases', () => {
    expect(normalizeCueName('mike')).toBe('MIKE');
  });
  test('strips a trailing extension', () => {
    expect(normalizeCueName('ANNA’S MOM (O.S.)')).toBe("ANNA'S MOM");
    expect(normalizeCueName("MIKE (CONT'D)")).toBe('MIKE');
  });
  test('collapses internal whitespace and trims', () => {
    expect(normalizeCueName('  REALITY   HOST  ')).toBe('REALITY HOST');
  });
  test('leaves an ordinary name alone', () => {
    expect(normalizeCueName('KARINA')).toBe('KARINA');
  });
});
