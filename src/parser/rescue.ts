import type { ScreenplayElement, TextBlock } from './types';
import { INDENT_RANGES } from './types';
import { normalizeCueName } from './classify';

/**
 * Second pass: promote `action` elements back to `character` when the
 * document's own evidence says they are cues.
 *
 * Classification is geometric, but `isLikelyCharacterName` layers text
 * heuristics on top that can overrule position — a dropped period, a smart
 * quote, a missed shift key. Each rejection costs TWO elements, because
 * with no active character the speech underneath falls to action too.
 *
 * Every name this rescues is already recognized elsewhere in the same
 * script, so the roster is the corroboration. It cannot invent characters.
 *
 * `elements[i]` pairs with `blocks[i]` — parseLines pushes exactly one
 * element per block, in order. Mutates `elements` in place.
 */
export function rescueCues(elements: ScreenplayElement[], blocks: TextBlock[]): void {
  const roster = new Map<string, string>(); // normalized -> established baseCharacter
  for (const el of elements) {
    if (el.type === 'character' && el.baseCharacter) {
      roster.set(normalizeCueName(el.baseCharacter), el.baseCharacter);
    }
  }
  if (roster.size === 0) return;

  const indentOf = (i: number) => blocks[i]?.indent ?? -1;
  const inCueBand = (i: number) =>
    indentOf(i) >= INDENT_RANGES.CHARACTER_MIN && indentOf(i) <= INDENT_RANGES.CHARACTER_MAX;
  const inSpeechBand = (i: number) =>
    indentOf(i) >= INDENT_RANGES.DIALOGUE_MIN && indentOf(i) <= INDENT_RANGES.DIALOGUE_MAX;

  for (let i = 0; i < elements.length - 1; i++) {
    const el = elements[i];
    if (el.type !== 'action') continue;
    if (!inCueBand(i)) continue;

    const established = roster.get(normalizeCueName(el.text ?? ''));
    if (!established) continue;

    // A cue is only a cue if a speech follows it.
    const next = elements[i + 1];
    if (!next || next.type !== 'action' || !inSpeechBand(i + 1)) continue;

    el.type = 'character';
    el.character = established;
    el.baseCharacter = established;

    for (let j = i + 1; j < elements.length; j++) {
      if (elements[j].type !== 'action' || !inSpeechBand(j)) break;
      // Don't swallow the NEXT missed cue: the bands overlap at 35, so a
      // cue sitting exactly there is in both. Consuming it as dialogue
      // would merge two speakers and put it beyond rescue.
      if (inCueBand(j) && roster.has(normalizeCueName(elements[j].text ?? ''))) break;
      elements[j].type = 'dialogue';
      elements[j].character = established;
    }
  }
}
