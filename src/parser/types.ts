// Screenplay parser types.
// Adapted from an earlier table-read parser by the same author.

export type ElementType =
  | "scene" | "character" | "dialogue" | "action"
  | "parenthetical" | "transition" | "page-number" | "mini-slug";

/** Coarse font-family buckets. Deliberately four: a screenplay's own face,
 * and the three kinds of thing a chyron/insert/letter is ever set in. */
export type FamilyBucket = 'mono' | 'serif' | 'sans' | 'cursive';

/** Coarse size steps relative to the document's dominant size. */
export type SizeStep = '-1' | '+1' | '+2';

/** A block-level font shift. At least one field is always present. */
export interface Fmt {
  family?: FamilyBucket;
  size?: SizeStep;
}

/** Characters of one line set in one (bucket, size) pair. Runs whose font
 * never resolved are omitted, so shares below are over resolved characters. */
export interface FontRun {
  bucket: FamilyBucket;
  size: number;
  chars: number;
}

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
  /** per-run font tallies, consumed by the document-dominant pass */
  fonts?: FontRun[];
  /** block-level font shift relative to the document's dominant font */
  fmt?: Fmt;
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
} as const;
