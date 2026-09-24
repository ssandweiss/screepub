/**
 * The ONE definition of what a character cue looks like as TEXT.
 *
 * There were three, and they disagreed. `isLikelyCharacterName` in
 * classify.ts carried forty lines of accumulated rules; `isCueShaped` in
 * extract.ts, used only by dual-dialogue detection, carried three; and
 * `rescueCues` reasons from the document's roster instead. The first two
 * disagreeing is not hypothetical, it shipped: a script whose lead is named
 * "Q" rendered every ordinary Q cue correctly, because the classifier
 * accepts a one-letter name, while the dual detector rejected it and
 * collapsed an entire scene into interleaved action.
 *
 * Same doctrine CLAUDE.md already applies to slug.ts and notes.ts: one copy
 * of a discriminator that both callers import, because two copies drift.
 *
 * WHAT BELONGS HERE AND WHAT DOES NOT. This answers about text only.
 * Geometry stays with the caller, because the callers genuinely differ:
 * classify checks the cue indent band itself, while the dual detector has
 * already had its geometry settled upstream by clusterSplit, which demands
 * a left cluster inside 42% of the page and a right one past 48%. Pushing
 * an indent argument in here would force the dual path to invent a fake
 * one, which is how the second definition got written in the first place.
 *
 * A NOTE ON WHERE THIS IS HEADED. Every rule below is a veto, and vetoes
 * are unbounded: there is always another way for a real cue to look wrong,
 * which is why this list grew by accretion and why each addition can
 * overrule the geometric signal. The intended direction is to let the
 * document's own roster carry more of the decision, so a token the script
 * repeatedly treats as a speaker is a cue regardless of shape. `rescueCues`
 * is that idea already, positioned as a mop-up. Unifying first is what
 * makes that change measurable: one definition to move, one corpus diff to
 * read.
 */

/** Names longer than this are prose that drifted into the cue band. */
const MAX_LENGTH = 50;
/** The same, measured after extensions like "(CONT'D)" are stripped. */
const MAX_NAME_LENGTH = 30;

// Allows shared cues (MARGO/DEV), numbered (COP #2), and paired (MOM & DAD).
const CHARACTER_NAME = /^[A-Z][A-Z0-9\s'’\/&#.-]*(\s*\([^)]+\))*\.{0,3}$/;
const COMPANY_NAME = /\b(LLC|LLP|INC|CORP|CO|LTD)\.?$/i;
/** Sentence punctuation a cue never carries. */
const PUNCTUATION_EXCLUDE = /[!?;,]/;
// The closing period is optional: writers routinely type "(O.S)" for
// "(O.S.)", and a script can spell the SAME speaker both ways. Without the
// `\.?` the unpunctuated form misses this pattern, then trips the
// "periods only in ellipsis" guard below — so the cue and the speech under
// it both fall through to action.
const DIALOGUE_EXTENSIONS =
  /\((?:V\.O\.?|O\.S\.?|O\.C\.?|CONT'D|CONT\.|INTO PHONE|FILTERED|PRE-LAP)\)/i;
/** Every trailing parenthetical on a cue: "JACK (V.O.) (CONT'D)" -> "JACK".
 *  classify.ts strips a cue's name with this same one. Global, but only ever
 *  handed to `replace`, which resets lastIndex itself: never `.test()` or
 *  `.exec()` it, or a shared lastIndex leaks from one call into the next. */
export const CHARACTER_EXTENSIONS = /(\s*\([^)]+\))+\s*$/g;

/**
 * Is this text shaped like a character cue? Says nothing about where it
 * sits — see the note above.
 */
export function isCueText(text: string): boolean {
  const t = text.trim();
  if (!t || t.length > MAX_LENGTH) return false;
  if (PUNCTUATION_EXCLUDE.test(t)) return false;

  // A cue wearing an extension is judged on the name alone: "JACK (CONT'D)"
  // is a cue even though the parenthetical is mixed case.
  if (DIALOGUE_EXTENSIONS.test(t)) {
    const nameOnly = t.replace(CHARACTER_EXTENSIONS, '').trim();
    const upper = (nameOnly.match(/[A-Z]/g) ?? []).length;
    const letters = (nameOnly.match(/[A-Za-z]/g) ?? []).length;
    return letters > 0 && upper / letters > 0.7;
  }

  const upper = (t.match(/[A-Z]/g) ?? []).length;
  const letters = (t.match(/[A-Za-z]/g) ?? []).length;
  if (letters === 0 || upper / letters < 0.8) return false;

  // Periods: legitimate only in abbreviation position. Mid-name a period may
  // cap a 1-4 letter run ("MR. SMITH", "E.B. WHITE", "CAPT. MILLER"); at the
  // END only single-letter initials qualify ("ANNA B.", "J.J."). A period
  // closing a longer final word is sentence punctuation, i.e. all-caps
  // action prose drifting into the cue band. This discrimination matters at
  // the dialogue/cue band overlap: a shouted "STOP." must not become a
  // phantom speaker that swallows the next line as its speech (registry 9e).
  const undotted = t.replace(/\.{3}/g, ' ');
  if (undotted.includes('.')) {
    const tokens = undotted.trim().split(/\s+/);
    const abbrevChain = /^(?:[A-Z0-9]{1,4}\.)+$/;
    const initialsOnly = /^(?:[A-Z0-9]\.)+$/;
    for (let i = 0; i < tokens.length; i++) {
      if (!tokens[i]!.includes('.')) continue;
      const shape = i === tokens.length - 1 ? initialsOnly : abbrevChain;
      if (!shape.test(tokens[i]!)) return false;
    }
  }

  if (!CHARACTER_NAME.test(t)) return false;
  if (COMPANY_NAME.test(t)) return false;
  return t.replace(CHARACTER_EXTENSIONS, '').trim().length <= MAX_NAME_LENGTH;
}
