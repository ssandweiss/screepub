import { describe, test, expect, beforeEach } from 'bun:test';
import { classifyBlock, resetCounter, attachSceneNumbers, normalizeCueName } from '../src/parser/classify';
import { rescueCues } from '../src/parser/rescue';
import { groupBlocks } from '../src/parser/group';
import { detectTitlePages } from '../src/parser/title-page';
import type { ScreenplayElement } from '../src/parser/types';
import type { Fmt, TextBlock, RawLine } from '../src/parser/types';

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

    test('inline dual-margin scene numbers strip and attach (SIGNAL LOST)', () => {
      // Some generators print the shooting-script number in both margins of
      // the heading row itself, joined into one line by extraction.
      const block = makeBlock({ text: '2 EXT. DESERT HIGHWAY - WIDE - ESTABLISHING 2', indent: 9 });
      const result = classifyBlock(block, null);
      expect(result.type).toBe('scene');
      expect(result.text).toBe('EXT. DESERT HIGHWAY - WIDE - ESTABLISHING');
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
      const block = makeBlock({ text: "DEV (CONT'D)", indent: 40 });
      const result = classifyBlock(block, null);
      expect(result.type).toBe('character');
      expect(result.character).toBe('DEV');
    });

    test('character with O.S. extension', () => {
      const block = makeBlock({ text: 'DETECTIVE JONES (O.S.)', indent: 40 });
      const result = classifyBlock(block, null);
      expect(result.type).toBe('character');
      expect(result.character).toBe('DETECTIVE JONES');
    });

    // Dotted names: a period in abbreviation position is part of the name,
    // not sentence punctuation. The old "periods only in ellipsis" guard
    // rejected every bare dotted cue ("MR. SMITH") while the extension
    // branch let "MR. SMITH (V.O.)" through — recognition depended on
    // incidental punctuation, the same asymmetry as the (O.S) bug below.
    test('honorific with a period is a character name', () => {
      const block = makeBlock({ text: 'MR. HENDERSON', indent: 40 });
      const result = classifyBlock(block, null);
      expect(result.type).toBe('character');
      expect(result.character).toBe('MR. HENDERSON');
    });

    test('dotted initials are a character name', () => {
      const block = makeBlock({ text: 'J.J.', indent: 40 });
      const result = classifyBlock(block, null);
      expect(result.type).toBe('character');
    });

    test('trailing single-letter initial is a character name', () => {
      const block = makeBlock({ text: 'ANNA B.', indent: 40 });
      const result = classifyBlock(block, null);
      expect(result.type).toBe('character');
    });

    test('initials plus surname are a character name', () => {
      const block = makeBlock({ text: 'E.B. WHITE', indent: 40 });
      const result = classifyBlock(block, null);
      expect(result.type).toBe('character');
    });

    test('dotted honorific with an extension still works', () => {
      const block = makeBlock({ text: 'DR. WHO (V.O.)', indent: 40 });
      const result = classifyBlock(block, null);
      expect(result.type).toBe('character');
      expect(result.character).toBe('DR. WHO');
    });

    // The guard's real job survives: a period closing a longer final word
    // is sentence punctuation — all-caps action prose that drifted into
    // the cue band must not become a phantom speaker (registry §9e).
    test('an all-caps sentence at cue indent is not a character', () => {
      const block = makeBlock({ text: 'HE STOPS.', indent: 40 });
      const result = classifyBlock(block, null);
      expect(result.type).not.toBe('character');
    });

    test('a shouted word with a period is not a character', () => {
      const block = makeBlock({ text: 'STOP.', indent: 40 });
      const result = classifyBlock(block, null);
      expect(result.type).not.toBe('character');
    });

    // Writers routinely drop the closing period — THE LAST VIDEO STORE
    // has the same speaker as both "RADIO VOICE (O.S)" and "RADIO VOICE
    // (O.S.)". The
    // unpunctuated form used to fall through the extension branch and then
    // hit the "periods only in ellipsis" guard, so the cue AND its speech
    // both landed as action.
    test('character with a period-less O.S extension', () => {
      const block = makeBlock({ text: 'RADIO VOICE (O.S)', indent: 40 });
      const result = classifyBlock(block, null);
      expect(result.type).toBe('character');
      expect(result.character).toBe('RADIO VOICE');
    });

    test('character with a period-less V.O extension', () => {
      const block = makeBlock({ text: 'SARAH (V.O)', indent: 40 });
      const result = classifyBlock(block, null);
      expect(result.type).toBe('character');
      expect(result.character).toBe('SARAH');
    });

    test('character with a period-less O.C extension', () => {
      const block = makeBlock({ text: 'DEV (O.C)', indent: 40 });
      const result = classifyBlock(block, null);
      expect(result.type).toBe('character');
      expect(result.character).toBe('DEV');
    });

    test('both spellings of one speaker yield the same character name', () => {
      const dotted = classifyBlock(makeBlock({ text: 'RADIO VOICE (O.S.)', indent: 40 }), null);
      const bare = classifyBlock(makeBlock({ text: 'RADIO VOICE (O.S)', indent: 40 }), null);
      expect(bare.character).toBe(dotted.character);
      expect(bare.baseCharacter).toBe(dotted.baseCharacter);
    });

    // PAPER BOATS types MARGO’S MOM with a curly apostrophe. The name
    // pattern allowed only the straight ', so every bare instance fell to
    // action — while "MARGO’S MOM (O.S.)" passed, because an extension takes
    // a different branch that never reaches CHARACTER_NAME.
    test('character name with a curly apostrophe', () => {
      const block = makeBlock({ text: 'MARGO’S MOM', indent: 40 });
      const result = classifyBlock(block, null);
      expect(result.type).toBe('character');
      expect(result.character).toBe('MARGO’S MOM');
    });

    test('character name with a straight apostrophe still works', () => {
      const block = makeBlock({ text: "MARGO'S DAD", indent: 40 });
      const result = classifyBlock(block, null);
      expect(result.type).toBe('character');
      expect(result.character).toBe("MARGO'S DAD");
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
    // Extraction measures indent from the PAGE edge, so the real action
    // margin is 15-18 across every generator — not the 0-4 the first
    // implementation assumed. These blocks sit where real ones do.
    const slug = (text: string, indent = 17) => classifyBlock(makeBlock({ text, indent }), null);

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

    // A mini-slug serializes as a forced slugline (".LATER"). fountain-js
    // promotes a forced line back to a FULL scene heading — section, TOC
    // entry and all — whenever the text also matches its unforced-heading
    // shape, which is wider than this file's SCENE_HEADING (EST., the space
    // forms, bare I/E). Minting a mini-slug from one of those would round-trip
    // into a scene. See PRIMARY_SLUG.
    test('an EST. slug is not a mini-slug — it would promote on re-parse', () => {
      expect(classifyBlock(makeBlock({ text: 'EST. THE HOUSE', indent: 2 }), null).type).toBe('action');
    });

    test('the space forms and bare I/E are not mini-slugs either', () => {
      expect(classifyBlock(makeBlock({ text: 'INT HOUSE - DAY', indent: 2 }), null).type).toBe('action');
      expect(classifyBlock(makeBlock({ text: 'EXT YARD - NIGHT', indent: 2 }), null).type).toBe('action');
      expect(classifyBlock(makeBlock({ text: 'I/E CAR - DAY', indent: 2 }), null).type).toBe('action');
      expect(classifyBlock(makeBlock({ text: 'INT/EXT CAR - DAY', indent: 2 }), null).type).toBe('action');
    });

    test('a word that merely starts with those letters stays a mini-slug', () => {
      // The opener needs its dot or space: ESTABLISHING is not EST.
      expect(classifyBlock(makeBlock({ text: 'ESTABLISHING SHOT', indent: 2 }), null).type).toBe('mini-slug');
      expect(classifyBlock(makeBlock({ text: 'INTO THE WOODS', indent: 2 }), null).type).toBe('mini-slug');
    });

    // The same widened exclusion at the real action margin, and with an
    // unpaired shooting-script number pushing the opener off the anchor.
    test('the widened heading exclusion holds at the action margin too', () => {
      expect(slug('EST. THE HOUSE').type).toBe('action');
      expect(slug('I/E CAR - DAY').type).toBe('action');
      expect(slug('ESTABLISHING SHOT').type).toBe('mini-slug');
    });

    // ── accepted shapes, at the real action margin ────────
    test('a bare location slug at the action margin', () => {
      expect(slug('IN THE PROJECTION BOOTH').type).toBe('mini-slug');
    });

    test('a one-word position slug', () => {
      expect(slug('UPSTAIRS').type).toBe('mini-slug');
    });

    test('a montage bracket, bare', () => {
      expect(slug('END OF MONTAGE').type).toBe('mini-slug');
    });

    test('a colon-terminated slug', () => {
      expect(slug('QUICK MONTAGE:').type).toBe('mini-slug');
    });

    test('a slug with an internal dash', () => {
      expect(slug('MONTAGE - VARIOUS').type).toBe('mini-slug');
    });

    test('a time slug', () => {
      expect(slug('ANOTHER MOMENT:').type).toBe('mini-slug');
    });

    // ── the danger set: sound effects and shouted beats ───
    test('a period-terminated sound effect stays action', () => {
      expect(slug('THUD.').type).toBe('action');
    });

    test('a shouted beat stays action', () => {
      expect(slug('CRASH!').type).toBe('action');
    });

    test('a repeated sound effect stays action', () => {
      expect(slug('BEEP. BEEP.').type).toBe('action');
    });

    test('a one-word bang stays action', () => {
      expect(slug('DING!').type).toBe('action');
    });

    test('an all-caps action sentence stays action', () => {
      expect(slug('GLASSES CLINK ON THE FAR SIDE OF THE ROOM.').type).toBe('action');
    });

    test('a line broken off mid-thought with a dash stays action', () => {
      expect(slug('HANDS TREMBLE AS THE LATCH GIVES-').type).toBe('action');
    });

    test('a revision-starred production note stays action', () => {
      expect(slug('***SHOT ON THE SECOND CAMERA***').type).toBe('action');
    });

    // ── transitions must not become headings ──────────────
    test("Fountain's own transition rule wins: anything ending in TO:", () => {
      expect(slug('DISSOLVE TO:').type).toBe('action');
      expect(slug('SMASH CUT TO:').type).toBe('action');
    });

    test('a camera-prefixed line is still vetoed at priority 7', () => {
      expect(slug('FADE IN:').type).toBe('action');
    });

    // ── the priority-7 decision, recorded as behavior ─────
    test('a THE-prefixed slug stays action — priority 7 keeps its veto', () => {
      // Deliberate recall loss. "THE DOOR OPENS." and "THE KITCHEN" are
      // the same shape one period apart, so the pronoun veto stays.
      expect(slug('THE PROJECTION BOOTH').type).toBe('action');
      expect(slug('THE DOOR OPENS').type).toBe('action');
    });

    // ── shape guards ──────────────────────────────────────
    test('a wrapped multi-line block is never a slug', () => {
      // Deliberately opens on a NON-pronoun word: "THE ..." would be vetoed
      // at priority 7 and the test would pass without the single-line guard.
      const block = makeBlock({
        text: 'LANTERNS SWING OVER THE COUNTER AND NOBODY SPEAKS',
        indent: 17,
        lines: [
          { text: 'LANTERNS SWING OVER THE', indent: 17, y: 100, pageNum: 1 },
          { text: 'COUNTER AND NOBODY SPEAKS', indent: 17, y: 88, pageNum: 1 },
        ],
      });
      expect(classifyBlock(block, null).type).toBe('action');
      // Guard against the test passing for the wrong reason: the same text on
      // ONE line is a slug, so only the line count can be deciding it.
      expect(slug('LANTERNS SWING OVER THE COUNTER AND NOBODY SPEAKS').type).toBe('mini-slug');
    });

    test('the action-band ceiling holds: a right-flush line is never a slug', () => {
      // Nothing else stops this one. TRANSITION needs a trailing colon,
      // the cue band ends at 50, and priority 7 only runs below ACTION_MAX.
      expect(slug('SMASH TO BLACK', 60).type).toBe('action');
      expect(slug('SMASH TO BLACK', 17).type).toBe('mini-slug');
    });

    test('a bare parenthetical with no active character is never a slug', () => {
      // Priority 6 needs a speaker, so this falls all the way to 9.
      expect(slug('(BEAT)').type).toBe('action');
      expect(slug('(SILENCE)').type).toBe('action');
    });

    test('mixed case is never a slug', () => {
      expect(slug('In the projection booth').type).toBe('action');
      expect(slug('Dev CROSSES TO THE COUNTER').type).toBe('action');
    });

    test('a digit-dominated registration line is never a slug', () => {
      expect(slug('WGA 1234567 555-0100').type).toBe('action');
    });

    test('an unpaired shooting-script heading is never a slug', () => {
      // The dual-margin strip needs matching numbers; when they mismatch
      // the heading survives whole and must not read as a micro-heading.
      expect(slug('2 EXT. WOODS - DAY 3', 9).type).toBe('action');
    });

    test('an over-long line is never a slug', () => {
      expect(slug('MONTAGE - EVERY DOORWAY IN THE BUILDING, ONE AFTER ANOTHER').type).toBe('action');
    });

    // ── band non-interference ─────────────────────────────
    test('the rule never fires in the cue band', () => {
      // 35-50 is the cue band; a bare uppercase word there is a character.
      expect(classifyBlock(makeBlock({ text: 'LATER', indent: 40 }), null).type).toBe('character');
      expect(classifyBlock(makeBlock({ text: 'UPSTAIRS', indent: 43 }), null).type).toBe('character');
    });

    test('the rule never fires in the speech band', () => {
      const cue = classifyBlock(makeBlock({ text: 'MARGO', indent: 43 }), null);
      const speech = classifyBlock(makeBlock({ text: 'UPSTAIRS', indent: 29 }), cue);
      expect(speech.type).toBe('dialogue');
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

  // classifyBlock marks a shooting-script number by setting `sceneNumber` on
  // the page-number element itself; attachSceneNumbers only promotes what was
  // marked. It deliberately does NOT re-test the text, because by this point a
  // bare page number ("1.") and a bare scene number are the same type carrying
  // the same shape of text. See the pipeline tests for the end-to-end path
  // through the real classifier.
  test('shooting-script scene number before scene heading is attached', () => {
    const elements: ScreenplayElement[] = [
      makeElement({ text: '2.2.', type: 'page-number', sceneNumber: '2.2.' }),
      makeElement({ text: 'INT. KITCHEN - DAY', type: 'scene' }),
    ];
    attachSceneNumbers(elements);
    expect(elements[1].sceneNumber).toBe('2.2.');
  });

  test('an unmarked page number before a scene heading is NOT attached', () => {
    const elements: ScreenplayElement[] = [
      makeElement({ text: '2.', type: 'page-number' }),
      makeElement({ text: 'INT. KITCHEN - DAY', type: 'scene' }),
    ];
    attachSceneNumbers(elements);
    expect(elements[1].sceneNumber).toBeUndefined();
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
    const block = makeBlock({ text: 'MARGO/DEV', indent: 40 });
    const result = classifyBlock(block, null);
    expect(result.type).toBe('character');
    expect(result.character).toBe('MARGO/DEV');
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
    const cue = classifyBlock(makeBlock({ text: 'MARGO/DEV', indent: 40 }), null);
    const paren = classifyBlock(makeBlock({ text: '(singing along)', indent: 30 }), cue);
    expect(paren.type).toBe('parenthetical');
    const line = classifyBlock(makeBlock({ text: 'I never wanted that', indent: 30 }), paren);
    expect(line.type).toBe('dialogue');
    expect(line.character).toBe('MARGO/DEV');
  });
});

describe('normalizeCueName', () => {
  test('straightens curly apostrophes', () => {
    expect(normalizeCueName('MARGO’S MOM')).toBe("MARGO'S MOM");
  });
  test('upper-cases', () => {
    expect(normalizeCueName('dev')).toBe('DEV');
  });
  test('strips a trailing extension', () => {
    expect(normalizeCueName('MARGO’S MOM (O.S.)')).toBe("MARGO'S MOM");
    expect(normalizeCueName("DEV (CONT'D)")).toBe('DEV');
  });
  test('collapses internal whitespace and trims', () => {
    expect(normalizeCueName('  RADIO   VOICE  ')).toBe('RADIO VOICE');
  });
  test('leaves an ordinary name alone', () => {
    expect(normalizeCueName('KARINA')).toBe('KARINA');
  });
});

describe('rescueCues', () => {
  // elements[i] pairs with blocks[i]; only indent is read off the block.
  const el = (over: Partial<ScreenplayElement> & { type: string; text: string }) =>
    ({ id: 'x', pageNum: 1, isTitlePage: false, isReadable: true, ...over }) as ScreenplayElement;
  const blk = (indent: number) => makeBlock({ text: '', indent });

  test('promotes a lowercase cue when the name is in the roster', () => {
    const elements = [
      el({ type: 'character', text: 'DEV', character: 'DEV', baseCharacter: 'DEV' }),
      el({ type: 'dialogue', text: 'Hello.', character: 'DEV' }),
      el({ type: 'action', text: 'dev' }),
      el({ type: 'action', text: 'Oh, right. The back room again.' }),
    ];
    rescueCues(elements, [blk(40), blk(30), blk(40), blk(30)]);
    expect(elements[2].type).toBe('character');
    expect(elements[2].baseCharacter).toBe('DEV');
    expect(elements[3].type).toBe('dialogue');
    expect(elements[3].character).toBe('DEV');
  });

  test('promotes a curly-apostrophe cue seen once with an extension', () => {
    const elements = [
      el({ type: 'character', text: 'MARGO’S MOM (O.S.)', character: 'MARGO’S MOM', baseCharacter: 'MARGO’S MOM' }),
      el({ type: 'dialogue', text: 'Hi.', character: 'MARGO’S MOM' }),
      el({ type: 'action', text: 'MARGO’S MOM' }),
      el({ type: 'action', text: 'Put the rewinder back where it lives.' }),
    ];
    rescueCues(elements, [blk(40), blk(30), blk(40), blk(30)]);
    expect(elements[2].type).toBe('character');
    expect(elements[3].type).toBe('dialogue');
  });

  test('does NOT promote a name absent from the roster', () => {
    const elements = [
      el({ type: 'character', text: 'DEV', character: 'DEV', baseCharacter: 'DEV' }),
      el({ type: 'dialogue', text: 'Hi.', character: 'DEV' }),
      el({ type: 'action', text: 'STRANGER' }),
      el({ type: 'action', text: 'Some line.' }),
    ];
    rescueCues(elements, [blk(40), blk(30), blk(40), blk(30)]);
    expect(elements[2].type).toBe('action');
  });

  test('does NOT promote outside the character indent band', () => {
    const elements = [
      el({ type: 'character', text: 'DEV', character: 'DEV', baseCharacter: 'DEV' }),
      el({ type: 'dialogue', text: 'Hi.', character: 'DEV' }),
      el({ type: 'action', text: 'DEV' }),
      el({ type: 'action', text: 'Some line.' }),
    ];
    rescueCues(elements, [blk(40), blk(30), blk(10), blk(30)]);
    expect(elements[2].type).toBe('action');
  });

  test('does NOT promote when the next line is not dialogue-indent', () => {
    const elements = [
      el({ type: 'character', text: 'DEV', character: 'DEV', baseCharacter: 'DEV' }),
      el({ type: 'dialogue', text: 'Hi.', character: 'DEV' }),
      el({ type: 'action', text: 'DEV' }),
      el({ type: 'action', text: 'Some action at action indent.' }),
    ];
    rescueCues(elements, [blk(40), blk(30), blk(40), blk(10)]);
    expect(elements[2].type).toBe('action');
  });

  test('retypes the whole speech run and stops at the boundary', () => {
    const elements = [
      el({ type: 'character', text: 'DEV', character: 'DEV', baseCharacter: 'DEV' }),
      el({ type: 'dialogue', text: 'Hi.', character: 'DEV' }),
      el({ type: 'action', text: 'dev' }),
      el({ type: 'action', text: 'Line one.' }),
      el({ type: 'action', text: 'Line two.' }),
      el({ type: 'action', text: 'She leaves the room.' }),
    ];
    rescueCues(elements, [blk(40), blk(30), blk(40), blk(30), blk(30), blk(10)]);
    expect(elements[3].type).toBe('dialogue');
    expect(elements[4].type).toBe('dialogue');
    expect(elements[5].type).toBe('action');
  });

  test('does not swallow a following missed cue that sits in the overlap', () => {
    const elements = [
      el({ type: 'character', text: 'DEV', character: 'DEV', baseCharacter: 'DEV' }),
      el({ type: 'dialogue', text: 'Hi.', character: 'DEV' }),
      el({ type: 'character', text: 'MARGO', character: 'MARGO', baseCharacter: 'MARGO' }),
      el({ type: 'dialogue', text: 'Hey.', character: 'MARGO' }),
      el({ type: 'action', text: 'dev' }),
      el({ type: 'action', text: 'Line for Dev.' }),
      el({ type: 'action', text: 'MARGO' }),          // second missed cue, indent 35
      el({ type: 'action', text: 'Line for Margo.' }),
    ];
    rescueCues(elements, [blk(40), blk(30), blk(40), blk(30), blk(40), blk(30), blk(35), blk(30)]);
    expect(elements[4].type).toBe('character');
    expect(elements[5].type).toBe('dialogue');
    expect(elements[5].character).toBe('DEV');
    // The second cue must NOT have been eaten as Dev's dialogue.
    expect(elements[6].type).toBe('character');
    expect(elements[6].character).toBe('MARGO');
    expect(elements[7].character).toBe('MARGO');
  });

  test('no roster means no rescues and no crash', () => {
    const elements = [
      el({ type: 'action', text: 'DEV' }),
      el({ type: 'action', text: 'Some line.' }),
    ];
    rescueCues(elements, [blk(40), blk(30)]);
    expect(elements[0].type).toBe('action');
  });
});

describe('font shifts and block boundaries', () => {
  const ln = (text: string, y: number, fmt?: Fmt): RawLine =>
    ({ text, indent: 10, y, pageNum: 1, fmt });

  test('a block takes the fmt every one of its lines agrees on', () => {
    const blocks = groupBlocks([
      ln('A chyron line', 700, { family: 'sans' }),
      ln('and its second line', 688, { family: 'sans' }),
    ]);
    expect(blocks).toHaveLength(1);
    expect(blocks[0].fmt).toEqual({ family: 'sans' });
  });

  test('lines that disagree leave the block unmarked', () => {
    const blocks = groupBlocks([
      ln('A chyron line', 700, { family: 'sans' }),
      ln('and a plain one', 688, undefined),
    ]);
    // They also do not merge: the fmt change is a block break.
    expect(blocks).toHaveLength(2);
    expect(blocks[0].fmt).toEqual({ family: 'sans' });
    expect(blocks[1].fmt).toBeUndefined();
  });

  test('an fmt change breaks a block that would otherwise merge', () => {
    // Same indent, same page, 12pt apart: without the fmt these are one block.
    const blocks = groupBlocks([
      ln('plain action', 700),
      ln('SHOUTED IN ANOTHER FACE', 688, { family: 'sans' }),
      ln('plain again', 676),
    ]);
    expect(blocks.map((b) => b.text)).toEqual([
      'plain action',
      'SHOUTED IN ANOTHER FACE',
      'plain again',
    ]);
  });

  test('a size change breaks a block just like a family change', () => {
    const blocks = groupBlocks([
      ln('plain action', 700),
      ln('INSERT: THE CARD', 688, { size: '+1' }),
    ]);
    expect(blocks).toHaveLength(2);
    expect(blocks[1].fmt).toEqual({ size: '+1' });
  });

  test('lines with the same fmt still merge normally', () => {
    const blocks = groupBlocks([
      ln('one', 700, { family: 'sans', size: '+1' }),
      ln('two', 688, { family: 'sans', size: '+1' }),
    ]);
    expect(blocks).toHaveLength(1);
  });

  test('fmt rides from block to element without touching classification', () => {
    // fmt is never a classification input: the parser stays option-free.
    const block = groupBlocks([ln('CHYRON: LIVE.', 700, { family: 'sans' })])[0];
    resetCounter();
    const el = classifyBlock(block, null);
    expect(el.type).toBe('action');
    expect(el.fmt).toEqual({ family: 'sans' });
  });
});
