import type {
  ParsedScreenplay,
  ScreenplayElement,
  CharacterInfo,
  SceneInfo,
} from './types';
import { extractLines } from './extract';
import { groupBlocks } from './group';
import { classifyBlock, attachSceneNumbers } from './classify';
import { detectTitlePages } from './title-page';
import { suppressBoilerplate } from './boilerplate';

/**
 * Parse a PDF buffer into a structured screenplay.
 * Pipeline: extract lines -> group blocks -> classify elements -> detect title pages -> build metadata.
 */
export async function parse(pdfBytes: Uint8Array): Promise<ParsedScreenplay> {
  // Element IDs are scoped to this parse() call via a local closure — not a
  // module-level counter — so concurrent parse() calls (e.g. two screenplays
  // uploaded at once) never interleave or reset each other's ID sequence.
  let elementCounter = 0;
  const nextId = () => `elem${elementCounter++}`;

  // Step 1: Extract raw lines from PDF
  const lines = await extractLines(pdfBytes);

  // Step 2: Group into text blocks
  const blocks = groupBlocks(lines);

  // Step 3: Classify each block (stateless — passes prev element)
  let prevElement: ScreenplayElement | null = null;
  const elements: ScreenplayElement[] = [];

  for (const block of blocks) {
    const element = classifyBlock(block, prevElement, nextId);
    elements.push(element);
    prevElement = element;
  }

  // Step 4: Attach scene numbers to scene headings (shooting scripts)
  attachSceneNumbers(elements);

  // Step 5: Detect title pages and front matter
  const withTitlePages = detectTitlePages(elements);

  // Step 5.5: Suppress recurring page furniture (watermarks) — re-types to
  // page-number; must run before metadata so counts stay consistent.
  const pageCountForSuppression = Math.max(...withTitlePages.map((el) => el.pageNum), 1);
  const suppressed = suppressBoilerplate(withTitlePages, pageCountForSuppression);

  // Step 6: Build metadata
  const characters = extractCharacters(suppressed);
  const scenes = extractScenes(suppressed);
  const pageCount = Math.max(...suppressed.map((el) => el.pageNum), 1);

  return { elements: suppressed, characters, scenes, pageCount };
}

// attachSceneNumbers lives in classify.ts — it shares the private
// SCENE_NUMBER pattern and stays unit-testable without this file's pdf.js
// import chain.

function extractCharacters(elements: ScreenplayElement[]): CharacterInfo[] {
  const charMap = new Map<string, { dialogueCount: number; firstAppearance: number }>();

  for (let i = 0; i < elements.length; i++) {
    const el = elements[i];
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
