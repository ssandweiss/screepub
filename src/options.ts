// Formatting options — the single knob surface shared by the CLI
// (--options file.json) and the Mac app's Settings panel. Registry with
// rationale for each: docs/formatting-options-log.md.

export interface FormatOptions {
  /** start each scene on a new page (registry #1) */
  scenePageBreaks: boolean;
  /** dialogue column side margins, % of screen (registry #2) */
  dialogueSideMarginPct: number;
  /** cue indent, % of the dialogue column (registry #2) */
  cueIndentPct: number;
  /** parenthetical indent, % of the dialogue column (registry #2) */
  parentheticalIndentPct: number;
  /** blank space between elements, em (registry #3) */
  elementSpacingEm: number;
  /** slugline + first block ride together across page breaks (registry #5a) */
  keepSceneHeadingWithScene: boolean;
  /** body typeface (registry #6) */
  fontFamily: 'courier' | 'serif' | 'sans';
  /** merge (MORE)/(CONT'D) page-break splits into one speech (registry #8) */
  rejoinSplitDialogue: boolean;
  /** (CONT'D) handling: auto = strip stale + re-add per the standard rule
   * (same speaker continues through action, reset each scene);
   * strip = remove all; keep = leave as written (registry #8a) */
  contdMode: 'auto' | 'strip' | 'keep';
  /** cue/parenthetical alignment: centered reads naturally on reflowable
   * screens; indented reproduces print's fixed offsets (registry #2b) */
  cueAlignment: 'centered' | 'indented';
  /** generated title page (registry #11) */
  includeTitlePage: boolean;
  /** shooting-script scene numbers in headings (registry #13) */
  showSceneNumbers: boolean;
}

export const DEFAULT_FORMAT_OPTIONS: FormatOptions = {
  scenePageBreaks: false,
  dialogueSideMarginPct: 20,
  cueIndentPct: 33,
  parentheticalIndentPct: 17,
  elementSpacingEm: 1,
  keepSceneHeadingWithScene: true,
  fontFamily: 'courier',
  rejoinSplitDialogue: true,
  contdMode: 'auto',
  cueAlignment: 'centered',
  includeTitlePage: true,
  showSceneNumbers: false,
};

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** Merge a partial (e.g. parsed from --options JSON) over the defaults,
 * clamping numeric knobs and ignoring unknown keys/invalid values. */
export function resolveFormatOptions(partial?: Record<string, unknown>): FormatOptions {
  const d = DEFAULT_FORMAT_OPTIONS;
  const p = partial ?? {};
  const bool = (key: keyof FormatOptions): boolean =>
    typeof p[key] === 'boolean' ? (p[key] as boolean) : (d[key] as boolean);
  const num = (key: keyof FormatOptions, lo: number, hi: number): number =>
    typeof p[key] === 'number' && Number.isFinite(p[key])
      ? clamp(p[key] as number, lo, hi)
      : (d[key] as number);

  const font = p.fontFamily;
  const contd = p.contdMode;
  const align = p.cueAlignment;
  return {
    scenePageBreaks: bool('scenePageBreaks'),
    dialogueSideMarginPct: num('dialogueSideMarginPct', 0, 30),
    cueIndentPct: num('cueIndentPct', 0, 60),
    parentheticalIndentPct: num('parentheticalIndentPct', 0, 40),
    elementSpacingEm: num('elementSpacingEm', 0.4, 2),
    keepSceneHeadingWithScene: bool('keepSceneHeadingWithScene'),
    fontFamily: font === 'serif' || font === 'sans' || font === 'courier' ? font : d.fontFamily,
    rejoinSplitDialogue: bool('rejoinSplitDialogue'),
    contdMode: contd === 'strip' || contd === 'keep' || contd === 'auto' ? contd : d.contdMode,
    cueAlignment: align === 'indented' || align === 'centered' ? align : d.cueAlignment,
    includeTitlePage: bool('includeTitlePage'),
    showSceneNumbers: bool('showSceneNumbers'),
  };
}
