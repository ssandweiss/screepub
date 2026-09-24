import { describe, test, expect } from 'bun:test';
import { isCueText } from '../src/parser/cue';
import { isLikelyCharacterName } from '../src/parser/classify';
import { INDENT_RANGES } from '../src/parser/types';

// ── ONE definition of what a character cue looks like ────────────────
//
// There used to be three, and they disagreed. `isLikelyCharacterName` in
// classify.ts carried forty lines of accumulated rules; `isCueShaped` in
// extract.ts, used only by dual-dialogue detection, carried three; and
// rescueCues reasons from the roster instead. The first two disagreeing is
// not hypothetical — it shipped. A script whose lead is named "Q" rendered
// every ordinary Q cue correctly, because the classifier accepts a
// one-letter name, while the dual detector rejected it and collapsed a
// whole scene into interleaved action.
//
// This is the same doctrine CLAUDE.md already applies to slug.ts and
// notes.ts: one copy of a discriminator both callers import, because two
// copies drift. The drift here cost a scene.
//
// What legitimately differs between callers is GEOMETRY, not shape. The
// classifier checks the indent band itself; the dual detector has already
// had its geometry settled upstream by clusterSplit, which demands a left
// cluster inside 42% of the page and a right one past 48%. So the shared
// function answers about TEXT only and each caller keeps its own position
// test.
describe('isCueText: the single definition', () => {
  const IN_BAND = INDENT_RANGES.CHARACTER_MIN + 1;

  const CUES = [
    'JACK',
    'Q',                        // the one that cost us a scene
    'MR. WILTON',
    'ELDERLY MAN #3',
    "JACK (CONT'D)",
    'ALANI',
    'J.J.',
    'ANNA B.',
    'KATE EX WIFE',
  ];

  const NOT_CUES = [
    'STOP.',                    // a shout in the dialogue band, registry 9e
    'What are you saying?',
    'He gazes around, rubs the fabric between his fingers.',
    'ACME PRODUCTIONS LLC',
    'Hey!',
    '',
  ];

  for (const t of CUES) {
    test(`accepts ${JSON.stringify(t)}`, () => expect(isCueText(t)).toBe(true));
  }
  for (const t of NOT_CUES) {
    test(`rejects ${JSON.stringify(t)}`, () => expect(isCueText(t)).toBe(false));
  }

  // The invariant that matters more than any single row above: the
  // classifier must not grow a private opinion again. Given an indent
  // inside the cue band, it has to answer exactly what the shared function
  // answers, for every string either of them will ever see.
  test('the classifier agrees with the shared definition, in band', () => {
    for (const t of [...CUES, ...NOT_CUES]) {
      expect(isLikelyCharacterName(t, IN_BAND)).toBe(isCueText(t));
    }
  });

  test('geometry stays with the caller: out of band is never a cue', () => {
    // isCueText says nothing about position, on purpose. The classifier is
    // what refuses a perfectly cue-shaped name sitting in the action margin.
    expect(isCueText('JACK')).toBe(true);
    expect(isLikelyCharacterName('JACK', INDENT_RANGES.CHARACTER_MIN - 5)).toBe(false);
  });
});
