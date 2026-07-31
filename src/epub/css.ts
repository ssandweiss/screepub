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
// - NO background-color on html or body, ever — it makes the KFX converter
//   synthesize a wrapper block of its own at the top of the document, and
//   every keep in the book then dies silently (MobileRead t=330798, where
//   jhowell frames the rule as "keeps work on top-level blocks only").
//   Authored nesting is NOT what breaks it: the keeps below sit two divs
//   deep inside section.scene and held on device (registry #8b,
//   2026-07-29). The synthesized wrapper is the trap; docs/device-map.md
//   §2.1.
// - CSS value SYNTAX stays CSS-2.1-vintage — no min()/clamp()/var(): Adobe
//   RMSDK (Kobo's EPUB path, tolino) violates CSS error handling and can
//   blank an entire book on a value function it cannot parse. CSS3
//   PROPERTIES that degrade harmlessly are fine — opacity on
//   span.page-marker is the precedent (registry #13a).
// - Break control kept deliberately small — every avoid link grows the
//   unbreakable chunk renderers push, causing bottom-of-page gaps. The
//   whole inventory, one line each:
//     break-after: avoid   h2.scene-heading (gated: keepSceneHeadingWithScene, on)
//     break-after: avoid   p.character
//     break-after: avoid   p.mini-slug (live: secondary sluglines, registry #5b)
//     break-before: avoid  p.transition
//     break-inside: avoid  .keep-together (the cue keep)
//     break-inside: avoid  table.dual-dialogue
//     break-inside: avoid  .dialogue-block (gated: keepSpeechesWhole, off)
//   And a shadow rule, not a new inventory entry: -webkit-column-break-inside:
//   avoid on .keep-together and table.dual-dialogue, the old column
//   spelling Apple Books and the Readium family (Thorium, Kobo's mobile
//   apps) honor instead of the modern one. Lives in its OWN declaration
//   block — iBooks drops both spellings when they share one (BlitzTricks)
//   — so it reads as a distinct entry to the guard test in
//   tests/epub.test.ts, not a change to either selector's existing
//   break-inside rule. Kobo's kepub e-ink renderer is a hoped-for third
//   and NOT a claimed one: it paginates with multicol, which is why the
//   old spelling might reach it, but the only evidence on record says it
//   ignores break CSS and wants file splits (device-map §6, t=346874).
//   What the rule DOES add is cost on the engines that honor it: nothing
//   kept there before, so these two wrappers become their first
//   unbreakable chunks, carrying the same bottom-of-page gaps this bullet
//   opens with.
//   Plus the one FORCED break, which is not an avoid link and so grows no
//   chunk — it ends a page rather than refusing to:
//     page-break-before: always  section.scene (gated: scenePageBreaks, off)
//   And one more mechanism outside the inventory above and outside that
//   forced break: widows/orphans on p.dialogue and p.action (gated:
//   printSplitMinimums, on, registry #17). It is not an avoid link — its
//   cost is bounded to roughly one extra line per page seam, not a whole
//   pushed block — and it is the only one of the rules cataloged in this
//   bullet whose OFF state still emits a value (1) rather than nothing
//   (justifyText, which is no part of this inventory, is the file's other
//   such knob).
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
  // The heading keep is a CHAIN, not a wrapper: break-after on the h2
  // holds it to whatever follows, without making the whole first block
  // unbreakable (the old wrapper pushed half-page chunks; registry #5a).
  const headingKeep = o.keepSceneHeadingWithScene
    ? '\n  page-break-after: avoid;\n  break-after: avoid;'
    : '';
  // Print split minimums (registry #17): the two-line rule at page edges.
  // Honored by KFX (fw 5.12.3+) and RMSDK (Kobo epub, tolino); ignored by
  // KF8/MOBI; unverified on kepub e-ink (patch-lore says it reads them —
  // not confirmed on device here).
  // CSS's own initial value for widows/orphans is already 2, so ON is a
  // DEFENSIVE restatement, not an addition: it exists to beat a reading
  // system whose own stylesheet packs tighter than that. 1 is the
  // documented tight-packing trade for users who hate bottom-of-page gaps.
  // Both properties inherit, so putting them on body would have covered
  // everything; scoping to p.dialogue/p.action only is deliberate — OFF
  // must not loosen p.parenthetical or p.centered too.
  // Interaction with registry #8b (load-bearing): .keep-together is
  // ALWAYS on and wraps cue + parentheticals + the FIRST dialogue
  // paragraph in break-inside: avoid, so a single-paragraph speech does
  // not split and this rule does not fire for it — with the same caveat
  // #8c carries: `avoid` yields where it cannot be honored, so a wrapper
  // taller than the page still breaks bare, and there these minimums are
  // what is left. Its everyday bite is the TAIL paragraphs of
  // multi-paragraph speeches, and action, which #8b never wraps.
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

/* Apple Books and the Readium family (Thorium, Kobo's mobile apps) honor
   the old column spelling; Books honors ONLY it. SEPARATE rule on purpose:
   iBooks drops BOTH forms when they share one declaration block
   (BlitzTricks). Unguarded on purpose: the engines that need it largely
   predate @supports. Kobo's kepub e-ink renderer paginates with multicol
   too, so this MIGHT reach it — untested, and the evidence on record says
   kepub ignores break CSS entirely (device-map §6). */
.keep-together, table.dual-dialogue { -webkit-column-break-inside: avoid; }

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
   they cost no line. Horizontal in %, per the CSS invariants. A hardcoded
   gray fights themed backgrounds (dark, sepia); opacity dims relative to
   the theme's own text color instead, so the marker recedes correctly
   under any theme. Engines without opacity support just render it at full
   strength — a harmless degrade. Enhanced Typesetting lists opacity as
   supported (Guidelines 2026.2 §18.1 — the irony is deliberate: that PDF's
   Appendix B is stale on break and keep CSS, but its supported-properties
   table is still the citable source; docs/device-map.md §2.1). */
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
`.trimStart();
}

export const SCREENPLAY_CSS = screenplayCss(DEFAULT_FORMAT_OPTIONS);
