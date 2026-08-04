import type {
  ParsedScreenplay,
  ScreenplayElement,
  CharacterInfo,
  SceneInfo,
  RawLine,
} from './types';
import { groupBlocks } from './group';
import { classifyBlock, attachSceneNumbers } from './classify';
import { detectTitlePages } from './title-page';
import { suppressBoilerplate } from './boilerplate';
import { rescueCues } from './rescue';

/**
 * Classify already-extracted lines into a structured screenplay — the pure
 * post-extraction pipeline, split out so callers that need the raw lines
 * (e.g. scanned-PDF detection) don't load the PDF twice.
 */
export function parseLines(lines: RawLine[]): ParsedScreenplay {
  // Element IDs are scoped to this call via a local closure — not a
  // module-level counter — so concurrent calls (e.g. two screenplays
  // uploaded at once) never interleave or reset each other's ID sequence.
  let elementCounter = 0;
  const nextId = () => `elem${elementCounter++}`;

  // Step 2: Group into text blocks
  const blocks = groupBlocks(lines);

  // Step 3: Classify each block (stateless — passes prev element)
  let prevElement: ScreenplayElement | null = null;
  const elements: ScreenplayElement[] = [];

  for (const block of blocks) {
    const element = classifyBlock(block, prevElement, nextId);
    elements.push(element);
    // Page furniture is TRANSPARENT to classification context. A cue can be
    // the last line of a page with its speech resuming after the printed page
    // number, and letting that number reset the speaker splits the speech:
    // the continuation classifies as action and the cue is left with nothing
    // under it. Device-confirmed on a Kindle (proof sheet, speech 37).
    //
    // This is not "attach whatever follows furniture to the last speaker":
    // classifyBlock still decides by indent band, so action after a page
    // number stays action. It only stops furniture from erasing the context
    // that a genuine continuation line depends on.
    if (element.type !== 'page-number') prevElement = element;
  }

  // Step 4: Attach scene numbers to scene headings (shooting scripts)
  attachSceneNumbers(elements);

  // Step 5: Detect title pages and front matter
  const withTitlePages = detectTitlePages(elements);

  // Step 5.5: Suppress recurring page furniture (watermarks) — re-types to
  // page-number; must run before metadata so counts stay consistent.
  const pageCountForSuppression = Math.max(...withTitlePages.map((el) => el.pageNum), 1);
  const suppressed = suppressBoilerplate(withTitlePages, pageCountForSuppression);

  // Step 5.6: Rescue cues the text heuristics rejected. Placement is
  // deliberate. AFTER suppressBoilerplate, because suppression only re-types
  // elements that are still `action` — a recurring watermark that happened to
  // match a character name would otherwise be rescued to `character` first and
  // become permanently immune to suppression. BEFORE extractCharacters, so
  // rescued speeches reach the dialogue counts. It also needs `isTitlePage`,
  // which only exists after step 5.
  // Steps 4/5/5.5 are all length-preserving (attachSceneNumbers mutates in
  // place; detectTitlePages copies and reassigns by index; suppressBoilerplate
  // is a 1:1 map), so blocks[i] still pairs with suppressed[i].
  rescueCues(suppressed, blocks);

  // Step 5.7: a speech split by a page boundary is ONE speech.
  //
  // When a speech runs over a page in the source PDF, its halves arrive as
  // two dialogue elements with printed page furniture between them. Giving
  // them the same speaker (see the page-number transparency above) is not
  // enough: they still serialize as two fountain lines and render as two
  // paragraphs, so the book shows a hard break mid-sentence. Device-confirmed
  // on a Kindle.
  //
  // Registry 8's (MORE)/(CONT'D) rejoin only fires when the script PRINTS
  // that furniture. Final Draft and Highland do; celtx does not, and shows 9
  // of these seams. This is the case that rejoin cannot see.
  //
  // Must run AFTER rescueCues: steps 4 through 5.6 are length-preserving so
  // blocks[i] still pairs with suppressed[i], and this pass is the first that
  // changes the element count.
  const merged = mergeSplitSpeeches(suppressed);

  // Step 6: Build metadata
  const characters = extractCharacters(merged);
  const scenes = extractScenes(merged);
  const pageCount = Math.max(...merged.map((el) => el.pageNum), 1);

  return { elements: merged, characters, scenes, pageCount };
}

/**
 * Join the halves of a speech that a page boundary split in two.
 *
 * Two dialogue elements merge only when they name the SAME character and
 * nothing but page furniture sits between them. Keying on the character
 * matters: a page break between two people's lines would otherwise fuse
 * their speeches into one. Anything real in between (action, a heading, a
 * new cue) ends the run, so this can only rejoin what one page turn
 * separated.
 *
 * The furniture elements are kept, not dropped: `showPageMarkers` (registry
 * 13a) re-surfaces them, and this pass has no business deciding that.
 */
function mergeSplitSpeeches(elements: ScreenplayElement[]): ScreenplayElement[] {
  const out: ScreenplayElement[] = [];
  // The last dialogue element pushed, and whether only furniture has been
  // seen since. Reset by anything that is neither.
  let openSpeech: ScreenplayElement | null = null;

  for (const el of elements) {
    if (el.type === 'page-number') {
      out.push(el);
      continue;
    }

    if (
      el.type === 'dialogue' &&
      openSpeech !== null &&
      el.character !== undefined &&
      el.character === openSpeech.character &&
      // ONLY across a page boundary. A speech may legitimately hold two
      // paragraphs separated by a blank line, and those arrive as two
      // dialogue elements on the SAME page. Merging those would destroy a
      // break the writer put there. The defect this fixes is specifically a
      // page turn cutting one paragraph in half.
      el.pageNum !== openSpeech.pageNum
    ) {
      // A source line break inside one speech is a wrap, not a paragraph:
      // join with a space so the sentence reads continuously.
      openSpeech.text = `${openSpeech.text} ${el.text}`;
      if (openSpeech.styledText !== undefined || el.styledText !== undefined) {
        openSpeech.styledText =
          `${openSpeech.styledText ?? openSpeech.text} ${el.styledText ?? el.text}`;
      }
      continue;
    }

    out.push(el);
    openSpeech = el.type === 'dialogue' ? el : null;
  }

  return out;
}

// attachSceneNumbers lives in classify.ts — it shares the private
// SCENE_NUMBER pattern and stays unit-testable without this file's pdf.js
// import chain.

function extractCharacters(elements: ScreenplayElement[]): CharacterInfo[] {
  const charMap = new Map<string, { dialogueCount: number; firstAppearance: number }>();

  for (let i = 0; i < elements.length; i++) {
    const el = elements[i];
    // A centered title lands at ~38% indent — inside the cue band — and
    // classifies as a character. detectTitlePages already flagged it;
    // the roster must honor the flag or the title becomes a "speaker".
    if (el.isTitlePage) continue;
    if (el.type === 'character' && el.baseCharacter) {
      const base = el.baseCharacter;
      const existing = charMap.get(base);
      if (!existing) {
        charMap.set(base, { dialogueCount: 0, firstAppearance: i });
      }
    }
    if (el.type === 'dialogue' && el.character) {
      const base = el.character;
      const existing = charMap.get(base);
      if (existing) {
        existing.dialogueCount++;
      } else {
        charMap.set(base, { dialogueCount: 1, firstAppearance: i });
      }
    }
  }

  return [...charMap.entries()]
    .map(([name, info]) => ({
      name,
      baseName: name,
      dialogueCount: info.dialogueCount,
      firstAppearance: info.firstAppearance,
    }))
    .sort((a, b) => b.dialogueCount - a.dialogueCount);
}

function extractScenes(elements: ScreenplayElement[]): SceneInfo[] {
  let sceneNumber = 0;
  return elements
    .map((el, idx) => ({ el, idx }))
    .filter(({ el }) => el.type === 'scene')
    .map(({ el, idx }) => ({
      heading: el.text,
      sceneNumber: ++sceneNumber,
      elementIndex: idx,
      pageNum: el.pageNum,
    }));
}
