// Screenplay parser types.
// Ported from nightwatch (src/lib/tableread/parser + src/types/tableread.ts).

export type ElementType =
  | "scene" | "character" | "dialogue" | "action"
  | "parenthetical" | "transition" | "page-number" | "mini-slug";

export interface ScreenplayElement {
  type: ElementType;
  text: string;
  id: string;
  pageNum: number;
  isTitlePage: boolean;
  isReadable: boolean;
  character?: string;
  baseCharacter?: string;
  ageModifier?: string;
  ageValue?: string | number;
  /** Scene number from shooting scripts (e.g., "2.2.", "1A."), attached to scene elements */
  sceneNumber?: string;
  /** text with fountain emphasis markers from PDF font styles (*i*, **b**) */
  styledText?: string;
  /** cue of the RIGHT column of a simultaneous (dual) exchange */
  dualRight?: boolean;
}

export interface CharacterInfo {
  name: string;
  baseName: string;
  dialogueCount: number;
  firstAppearance: number;
}

export interface SceneInfo {
  heading: string;
  sceneNumber: number;
  elementIndex: number;
  pageNum: number;
}

export interface ParsedScreenplay {
  elements: ScreenplayElement[];
  characters: CharacterInfo[];
  scenes: SceneInfo[];
  pageCount: number;
}

// Raw line extracted from PDF
export interface RawLine {
  text: string;
  indent: number; // 0-100 normalized percentage
  y: number;
  pageNum: number;
  /** text with fountain emphasis markers, present only when styles differ */
  styled?: string;
  /** cue line opening the right column of a dual-dialogue region */
  dualRight?: boolean;
}

// Grouped text block
export interface TextBlock {
  lines: RawLine[];
  text: string;
  styledText?: string;
  dualRight?: boolean;
  indent: number; // first line indent
  minIndent: number;
  maxIndent: number;
  pageNum: number;
  yPosition: number;
}

// Indent ranges for element classification
export const INDENT_RANGES = {
  ACTION_MAX: 20,
  DIALOGUE_MIN: 25,
  DIALOGUE_MAX: 35,
  CHARACTER_MIN: 35,
  CHARACTER_MAX: 50,
  TRANSITION_MIN: 55,
  PAGE_NUMBER_MIN: 65,
} as const;
