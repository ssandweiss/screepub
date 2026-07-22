import type { ScreenplayElement } from './types';
import type { TextBlock } from './types';
import { INDENT_RANGES } from './types';
import { isBoilerplateLine } from './boilerplate';

// Regex patterns ported from v2 spec
const SCENE_HEADING = /^(INT\.|EXT\.|INT\.\/EXT\.|I\/E\.)/;
const TRANSITION = /^[A-Z\s]+:$/;
const PAGE_NUMBER_BARE = /^\d+\.?$/;
const PAGE_NUMBER_DASHED = /^-\s*\d+\s*-$/;
const PAGE_NUMBER_LABELED = /^(?:page|p\.)\s*\d+\.?$/i;
// Shooting script scene numbers: "2.2.", "1A.", "42.", "1-A.", "A1.", "1A", "2.2"
const SCENE_NUMBER = /^\d+[A-Z]?(?:[.\-](?:\d+[A-Z]?|[A-Z]))*\.?$/;
const PARENTHETICAL = /^\([^)]+\)$/;
const PARENTHETICAL_TRUNCATED = /^\([^)]+\)\.{3}$/;
// Allows shared cues (CLEO/PANNI), numbered (COP #2), and paired (MOM & DAD).
const CHARACTER_NAME = /^[A-Z][A-Z0-9\s'\/&#-]*(\s*\([^)]+\))*\.{0,3}$/;
const COMPANY_NAME = /\b(LLC|LLP|INC|CORP|CO|LTD)\.?$/i;
const PUNCTUATION_EXCLUDE = /[!?;,]/;
const DIALOGUE_EXTENSIONS =
  /\((?:V\.O\.|O\.S\.|O\.C\.|CONT'D|CONT\.|INTO PHONE|FILTERED|PRE-LAP)\)/i;
const CHARACTER_EXTENSIONS = /(\s*\([^)]+\))+\s*$/g;

const ACTION_POSSESSIVE = /^[A-Z][a-z]+['\u2019]s /;
const ACTION_PRONOUNS = /^(He |She |They |It |The |A |An |His |Her |Their |Its )/i;
const ACTION_VERBS =
  /(walks|turns|looks|stands|sits|moves|enters|exits|fades|drifts|floats|pays|rises)/i;
const ACTION_CAMERA = /^(INT\.|EXT\.|FADE|CUT|ANGLE|CLOSE|WIDE|PAN|ZOOM)/;

// Age variant patterns
const AGE_PREFIX = /^(YOUNG|OLD|OLDER|YOUNGER)\s+(.+)$/;
const AGE_DECADE = /^(.+?)\s*\(\s*(TWENTIES|THIRTIES|FORTIES|FIFTIES|SIXTIES|SEVENTIES|EIGHTIES)\s*\)/i;
const AGE_NUMBER = /^(.+?)\s*[(,]\s*(?:AGE\s+)?(\d+)/i;
const AGE_STAGE = /^(.+?)\s*\(\s*(CHILD|TEEN|ADULT|ELDERLY)\s*\)/i;
const AGE_LITTLE = /^(LITTLE|BABY)\s+(.+)$/;

// Fallback counter used only when classifyBlock is called directly without an
// explicit `nextId` (e.g. unit tests exercising classification in isolation).
// Real parses (parse() in index.ts) thread their own closure-scoped counter
// through `nextId` instead, so concurrent parse() calls never share state.
let defaultElementCounter = 0;

export function resetCounter(): void {
  defaultElementCounter = 0;
}

/**
 * Classify a text block into a screenplay element type.
 * Stateless — takes prevElement instead of tracking internal state.
 * Priority chain: page-number -> scene -> transition -> character -> parenthetical -> action -> dialogue -> mini-slug -> default
 */
export function classifyBlock(
  block: TextBlock,
  prevElement: ScreenplayElement | null,
  nextId: () => string = () => `elem${defaultElementCounter++}`,
): ScreenplayElement {
  const { text, indent } = block;
  const id = nextId();
  const base: ScreenplayElement = { id, type: 'action', text, styledText: block.styledText, pageNum: block.pageNum, isTitlePage: false, isReadable: true };

  // Get current character from previous element chain
  const currentCharacter = getActiveCharacter(prevElement);

  // Priority 1: Page number
  // Bare numbers (e.g. "42", "42.") are page numbers at any indent — a standalone
  // number block is almost never meaningful dialogue or action.
  // Dashed ("- 42 -") and labeled ("Page 42") formats require moderate indent.
  const trimmed = text.trim();
  if (PAGE_NUMBER_BARE.test(trimmed)) {
    return { ...base, type: 'page-number' };
  }
  if (PAGE_NUMBER_DASHED.test(trimmed) || PAGE_NUMBER_LABELED.test(trimmed)) {
    return { ...base, type: 'page-number' };
  }
  // Shooting script scene numbers (e.g., "2.2.", "1A.", "42A") — classified as
  // page-number so they're hidden. The parser pipeline attaches them to the
  // following scene heading element as `sceneNumber`.
  if (SCENE_NUMBER.test(trimmed) && trimmed.length <= 10) {
    return { ...base, type: 'page-number' };
  }

  // Priority 1.5: production-draft furniture (revision slugs, draft stamps,
  // header dates) — routed to page-number so every consumer skips it.
  if (isBoilerplateLine(trimmed)) {
    return { ...base, type: 'page-number' };
  }

  // Priority 2: Scene heading (no indent check — most reliable)
  if (SCENE_HEADING.test(text)) {
    return { ...base, type: 'scene' };
  }

  // Priority 3: Transition
  if (indent > INDENT_RANGES.TRANSITION_MIN && TRANSITION.test(text)) {
    return { ...base, type: 'transition' };
  }

  // Priority 4: Truncated character name
  if (text.endsWith('...') && indent >= INDENT_RANGES.CHARACTER_MIN && indent <= INDENT_RANGES.CHARACTER_MAX) {
    const stripped = text.replace(/\.{3}$/, '');
    if (isLikelyCharacterName(stripped, indent)) {
      const { name, baseName, ageModifier, ageValue } = extractCharacterInfo(stripped);
      return { ...base, type: 'character', text: stripped, character: name, baseCharacter: baseName, ageModifier, ageValue };
    }
  }

  // Priority 5: Character name
  if (indent >= INDENT_RANGES.CHARACTER_MIN && indent <= INDENT_RANGES.CHARACTER_MAX && isLikelyCharacterName(text, indent)) {
    const { name, baseName, ageModifier, ageValue } = extractCharacterInfo(text);
    return { ...base, type: 'character', character: name, baseCharacter: baseName, ageModifier, ageValue };
  }

  // Priority 6: Parenthetical
  if (currentCharacter && indent >= INDENT_RANGES.DIALOGUE_MIN && indent <= 40 &&
    (PARENTHETICAL.test(text) || PARENTHETICAL_TRUNCATED.test(text))) {
    return { ...base, type: 'parenthetical', character: currentCharacter };
  }

  // Priority 7: Action by pattern
  if (indent < INDENT_RANGES.ACTION_MAX && isActionByPattern(text)) {
    return { ...base, type: 'action' };
  }

  // Priority 8: Dialogue (requires active character)
  if (currentCharacter && indent >= INDENT_RANGES.DIALOGUE_MIN && indent <= INDENT_RANGES.DIALOGUE_MAX &&
    !SCENE_HEADING.test(text) && !TRANSITION.test(text)) {
    return { ...base, type: 'dialogue', character: currentCharacter };
  }

  // Priority 9: Mini-slug
  if (indent < 5 && text === text.toUpperCase() && text.length >= 2 && text.length <= 40 &&
    !SCENE_HEADING.test(text) && !PARENTHETICAL.test(text)) {
    return { ...base, type: 'mini-slug' };
  }

  // Priority 10: Default to action
  return { ...base, type: 'action' };
}

/**
 * Attach scene numbers from shooting scripts to the following scene heading.
 * A page-number element immediately before a scene element is a scene number
 * — but only when its text actually matches the scene-number shape (revision
 * slugs and other boilerplate also classify as page-number and must never
 * become scene numbers). Lives here (not index.ts) so it shares the private
 * SCENE_NUMBER pattern and stays unit-testable without index.ts's pdf.js
 * import, which cannot load in the bun:test environment.
 * Mutates elements in place — sets `sceneNumber` on the scene element.
 */
export function attachSceneNumbers(elements: ScreenplayElement[]): void {
  for (let i = 0; i < elements.length - 1; i++) {
    if (
      elements[i].type === 'page-number' &&
      elements[i + 1].type === 'scene' &&
      SCENE_NUMBER.test(elements[i].text.trim())
    ) {
      elements[i + 1].sceneNumber = elements[i].text.trim();
    }
  }
}

function getActiveCharacter(prevElement: ScreenplayElement | null): string | null {
  if (!prevElement) return null;
  if (prevElement.type === 'character') return prevElement.character ?? null;
  if (prevElement.type === 'dialogue' || prevElement.type === 'parenthetical') {
    return prevElement.character ?? null;
  }
  // Action/scene/transition reset character context
  return null;
}

function isLikelyCharacterName(text: string, indent: number): boolean {
  if (indent < INDENT_RANGES.CHARACTER_MIN || indent > INDENT_RANGES.CHARACTER_MAX) return false;
  if (text.length > 50) return false;
  if (PUNCTUATION_EXCLUDE.test(text)) return false;

  // Check for dialogue extensions
  if (DIALOGUE_EXTENSIONS.test(text)) {
    const nameOnly = text.replace(CHARACTER_EXTENSIONS, '').trim();
    const upperCount = (nameOnly.match(/[A-Z]/g) || []).length;
    const letterCount = (nameOnly.match(/[A-Za-z]/g) || []).length;
    return letterCount > 0 && upperCount / letterCount > 0.7;
  }

  // Uppercase ratio check (>=80%)
  const upperCount = (text.match(/[A-Z]/g) || []).length;
  const letterCount = (text.match(/[A-Za-z]/g) || []).length;
  if (letterCount === 0 || upperCount / letterCount < 0.8) return false;

  // Periods only in ellipsis
  const periodCount = (text.match(/\./g) || []).length;
  if (periodCount > 0 && !text.includes('...') && !DIALOGUE_EXTENSIONS.test(text)) return false;

  if (!CHARACTER_NAME.test(text)) return false;
  if (COMPANY_NAME.test(text)) return false;

  // Length without extensions
  const nameOnly = text.replace(CHARACTER_EXTENSIONS, '').trim();
  if (nameOnly.length > 30) return false;

  return true;
}

function extractCharacterInfo(text: string): {
  name: string;
  baseName: string;
  ageModifier?: string;
  ageValue?: string | number;
} {
  // Strip extensions: "JACK (V.O.) (CONT'D)" -> "JACK"
  const name = text.replace(CHARACTER_EXTENSIONS, '').trim();
  const { baseName, ageModifier, ageValue } = extractAgeVariant(name);
  return { name, baseName, ageModifier, ageValue };
}

function extractAgeVariant(name: string): {
  baseName: string;
  ageModifier?: string;
  ageValue?: string | number;
} {
  let match = AGE_PREFIX.exec(name);
  if (match) return { baseName: match[2], ageModifier: match[1], ageValue: match[1].toLowerCase() };

  match = AGE_DECADE.exec(name);
  if (match) {
    const decades: Record<string, string> = {
      twenties: '20s', thirties: '30s', forties: '40s', fifties: '50s',
      sixties: '60s', seventies: '70s', eighties: '80s',
    };
    return { baseName: match[1], ageValue: decades[match[2].toLowerCase()] || match[2] };
  }

  match = AGE_NUMBER.exec(name);
  if (match) return { baseName: match[1], ageValue: parseInt(match[2], 10) };

  match = AGE_STAGE.exec(name);
  if (match) return { baseName: match[1], ageValue: match[2].toLowerCase() };

  match = AGE_LITTLE.exec(name);
  if (match) return { baseName: match[2], ageModifier: match[1], ageValue: 'child' };

  return { baseName: name };
}

function isActionByPattern(text: string): boolean {
  return (
    ACTION_POSSESSIVE.test(text) ||
    ACTION_PRONOUNS.test(text) ||
    ACTION_VERBS.test(text) ||
    ACTION_CAMERA.test(text)
  );
}
