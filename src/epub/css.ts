// Reflowable screenplay stylesheet, Kindle-safe, parameterized by
// FormatOptions (docs/formatting-options-log.md is the knob registry).
//
// Geometry rules (see docs/screenplay-format-reference.md for the math):
// - HORIZONTAL structure in % — Kindle strips max-width and prescribes
//   percentage side margins; % scales with screen width.
// - VERTICAL rhythm in em — scales with the reader's font size; print's
//   one-blank-Courier-line between elements = 1em.
// - No line-height/font-size overrides on body text — Enhanced Typesetting
//   owns within-paragraph spacing (the reader's own setting).
// - NO background-color on html or body, ever — the KFX converter then
//   synthesizes a wrapper block of its own and every keep in the book
//   dies silently. It is the SYNTHESIZED wrapper that breaks them, not
//   nesting: our own keeps sit two divs deep and held on device (#8b).
// - CSS value SYNTAX stays CSS-2.1-vintage — no min()/clamp()/var(), which
//   can blank a whole book on Adobe RMSDK. CSS3 PROPERTIES that degrade
//   harmlessly are fine; opacity on span.page-marker is the precedent.
//
// Break control is deliberately small: every avoid link grows the
// unbreakable chunk a renderer pushes, which reads as a bottom-of-page
// gap. The whole inventory, one line each — add nothing without a reason
// good enough to write here, and the guard test in tests/epub.test.ts
// will make you.
//     break-after: avoid   h2.scene-heading (gated: keepSceneHeadingWithScene, on)
//     break-after: avoid   p.character
//     break-after: avoid   p.mini-slug (live: secondary sluglines, registry #5b)
//     break-before: avoid  p.transition
//     break-inside: avoid  .keep-together (the cue keep)
//     break-inside: avoid  table.dual-dialogue
//     break-inside: avoid  .dialogue-block (gated: keepSpeechesWhole, off)
// Two mechanisms sit outside that list and cost less than an avoid link:
//     page-break-before: always  section.scene (gated: scenePageBreaks, off)
//       — ends a page rather than refusing to, so it grows no chunk.
//     widows/orphans on p.action and p.dialogue (gated: printSplitMinimums,
//       on, registry #17) — bounded to about one line per seam, and the one
//       rule here whose OFF state emits a value (1) rather than nothing.
// And the column-spelling shadow rule, which re-lists the wrapper keeps
// above in -webkit-column-break-inside for engines that honor only that
// spelling. It is a second spelling of existing keeps, not a new one, but
// it does newly make those wrappers unbreakable on engines where nothing
// kept before, with the same gap cost. Its selector list is DERIVED from
// the keep set (see columnKeeps below), so it cannot drift.
//
// Which renderer honors what, with sources: docs/device-map.md §6.
import type { FormatOptions } from '../options';
import { DEFAULT_FORMAT_OPTIONS } from '../options';

const FONT_STACKS: Record<FormatOptions['fontFamily'], string> = {
  courier: '"Courier Prime", "Courier New", Courier, monospace',
  serif: 'serif',
  sans: 'sans-serif',
};

const em = (v: number) => `${Number(v.toFixed(2))}em`;

export function screenplayCss(o: FormatOptions): string {
  const gap = o.elementSpacingEm;
  const sceneBreak = o.scenePageBreaks
    ? '\nsection.scene { page-break-before: always; }\n'
    : '';
  // Screenplays are traditionally ragged-right; explicit `left` overrides
  // a reader that justifies body text by default (stretchy word gaps).
  const bodyAlign = o.justifyText ? 'justify' : 'left';
  // Atomic speeches (registry #8c): opt-in, because an unbreakable block
  // taller than the space left on a page gets pushed whole — bounded
  // white space traded for never splitting a speech. `avoid` yields where
  // it cannot be honored, so a speech taller than a full page still
  // breaks bare even with this on.
  const speechKeep = o.keepSpeechesWhole
    ? '\n  page-break-inside: avoid;\n  break-inside: avoid;'
    : '';
  // Every wrapper keep the stylesheet emits, in one list, so the column
  // spelling below is DERIVED from the keep set rather than a second copy
  // of it kept in sync by hand. A keep missing from here is inert in
  // Apple Books, which honors only that spelling.
  const columnKeeps = ['.keep-together', 'table.dual-dialogue'];
  if (o.keepSpeechesWhole) columnKeeps.push('.dialogue-block');
  // The heading keep is a CHAIN, not a wrapper: break-after on the h2
  // holds it to whatever follows, without making the whole first block
  // unbreakable (the old wrapper pushed half-page chunks; registry #5a).
  const headingKeep = o.keepSceneHeadingWithScene
    ? '\n  page-break-after: avoid;\n  break-after: avoid;'
    : '';
  // Print split minimums, the two-line rule at page edges (registry #17,
  // which carries the device support and the sources). Two facts that
  // belong at this line: CSS's own initial value is already 2, so ON is a
  // DEFENSIVE restatement meant to beat a reading system that packs
  // tighter, not an addition — and both properties inherit, so scoping to
  // these two selectors instead of body is what keeps OFF from loosening
  // p.parenthetical and p.centered as well.
  // Where it actually bites: #8b's always-on cue keep swallows the first
  // dialogue paragraph, so this fires on the TAIL paragraphs of
  // multi-paragraph speeches and on action — plus wherever that keep
  // yields, since `avoid` gives way when a wrapper outgrows the page.
  const minLines = o.printSplitMinimums ? 2 : 1;

  return `
html, body {
  margin: 0;
  padding: 0;
}

body {
  font-family: ${FONT_STACKS[o.fontFamily]};
}
${sceneBreak}
/* The cue keep: cue + parentheticals + first dialogue line share this
   unbreakable wrapper so a cue never strands at a page bottom.
   Container-level inside-avoid is the KDP-documented keep-together form. */
.keep-together {
  page-break-inside: avoid;
  break-inside: avoid;
}

/* Apple Books honors ONLY this older spelling; the Readium family
   (Thorium, Kobo's mobile apps) honors it too. SEPARATE rule on purpose:
   iBooks drops BOTH forms when they share one declaration block. Unguarded
   on purpose: the engines that need it largely predate @supports. */
${columnKeeps.join(', ')} { -webkit-column-break-inside: avoid; }

h2.scene-heading {
  font-size: 1em;
  font-weight: bold;
  text-transform: uppercase;
  margin: ${em(gap * 1.6)} 0 ${em(gap)} 0;${headingKeep}
}

span.scene-number {
  font-weight: normal;
}

span.underline {
  text-decoration: underline;
}

/* Original PDF page numbers — a marginal reference, out of the flow so
   they cost no line. Horizontal in %, per the CSS invariants. Dimming is
   opacity rather than a fixed gray, which would fight dark and sepia
   themes; opacity dims against whatever the theme's text color is, and
   engines lacking it just render full strength (registry #13a). */
span.page-marker {
  float: right;
  font-size: 0.75em;
  opacity: 0.6;
  margin-left: 1%;
}

p {
  margin: 0;
  text-indent: 0;
}

p.action {
  margin: ${em(gap)} 0;
  text-align: ${bodyAlign};
  widows: ${minLines};
  orphans: ${minLines};
}

p.mini-slug {
  font-weight: bold;
  text-transform: uppercase;
  margin: ${em(gap * 1.4)} 0 ${em(gap)} 0;
  page-break-after: avoid;
  break-after: avoid;
}

/* Print geometry, reflowed: dialogue is a narrow column (58% of the body
   column in print). Cue and parenthetical indent WITHIN the column as
   percentages of it (print: cue +1.2" and parenthetical +0.6" into the
   3.5" column). */
.dialogue-block {
  margin-top: ${em(gap)};
  margin-bottom: ${em(gap)};
  margin-left: ${o.dialogueSideMarginPct}%;
  margin-right: ${o.dialogueSideMarginPct}%;${speechKeep}
}

/* A cue must never orphan from its dialogue at a page break. Centered
   alignment reads naturally at any screen width; indented reproduces
   print's fixed offsets (which only optically center on paper). */
p.character {
${o.cueAlignment === 'centered'
    ? '  text-align: center;'
    : `  margin-left: ${o.cueIndentPct}%;`}
  page-break-after: avoid;
  break-after: avoid;
}

/* Deliberately NOT chained forward. Registry #5: every avoid link grows
   the unbreakable chunk a renderer pushes to the next page, and pushed
   chunks are exactly the blank-bottom "weird page break" this file keeps
   being asked to fix. A parenthetical breaks freely on purpose. */
p.parenthetical {
${o.cueAlignment === 'centered'
    ? '  text-align: center;'
    : `  margin-left: ${o.parentheticalIndentPct}%;\n  margin-right: ${Math.round(o.parentheticalIndentPct / 2)}%;`}
}

p.dialogue {
  margin: 0;
  text-align: ${bodyAlign};
  widows: ${minLines};
  orphans: ${minLines};
}

/* Simultaneous speech: two half-width columns, kept on one page. The
   table spans full width (wider than the dialogue column) by design. */
table.dual-dialogue {
  width: 100%;
  border-collapse: collapse;
  margin: ${em(gap)} 0;
  page-break-inside: avoid;
  break-inside: avoid;
}

table.dual-dialogue td {
  width: 50%;
  vertical-align: top;
  padding: 0 2%;
}

/* A transition belongs to the shot before it: it may end a page, never
   begin one (the universal print rule, docs/pagination-reference.md §2 —
   that doc lands from branch worktree-device-map). */
p.transition {
  text-align: right;
  text-transform: uppercase;
  margin: ${em(gap)} 0;
  page-break-before: avoid;
  break-before: avoid;
}

p.centered {
  text-align: center;
  margin: ${em(gap)} 0;
}

/* Title page */
section.titlepage {
  text-align: center;
  margin-top: 20%;
}

section.titlepage h1 {
  font-size: 1.6em;
  text-transform: uppercase;
  font-weight: bold;
  margin-bottom: 2em;
}

section.titlepage p.credit {
  margin: 0.4em 0;
}

section.titlepage p.author {
  font-size: 1.1em;
  margin: 0.4em 0;
}

/* Block font shifts the PDF carried (registry #18), gated by
   preserveFontShifts. Sizes are em, per the vertical-in-em invariant, and
   carry no line-height. A family class sits on the paragraph itself, so it
   locally overrides the body fontFamily option (#6) without !important.
   Values stay CSS-2.1-vintage: RMSDK can blank a whole book on a value
   function it cannot parse. */
.fmt-mono {
  font-family: ${FONT_STACKS.courier};
}

.fmt-serif {
  font-family: ${FONT_STACKS.serif};
}

.fmt-sans {
  font-family: ${FONT_STACKS.sans};
}

.fmt-cursive {
  font-family: "Comic Sans MS", cursive;
}

.fmt-minus1 {
  font-size: 0.85em;
}

.fmt-plus1 {
  font-size: 1.2em;
}

.fmt-plus2 {
  font-size: 1.5em;
}
`.trimStart();
}

export const SCREENPLAY_CSS = screenplayCss(DEFAULT_FORMAT_OPTIONS);
