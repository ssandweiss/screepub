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
// - Keep-with-next chain kept minimal (heading, cue) — every avoid link
//   grows the unbreakable chunk renderers push, causing bottom-of-page gaps.
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

  return `
html, body {
  margin: 0;
  padding: 0;
}

body {
  font-family: ${FONT_STACKS[o.fontFamily]};
}
${sceneBreak}
/* Slugline + the scene's first block ride together across page breaks —
   if the pair doesn't fit at a page bottom, both move to the next page.
   Container-level inside-avoid is the KDP-documented keep-together form. */
.keep-together {
  page-break-inside: avoid;
  break-inside: avoid;
}

h2.scene-heading {
  font-size: 1em;
  font-weight: bold;
  text-transform: uppercase;
  margin: ${em(gap * 1.6)} 0 ${em(gap)} 0;
  page-break-after: avoid;
  break-after: avoid;
}

span.scene-number {
  font-weight: normal;
}

span.underline {
  text-decoration: underline;
}

/* Original PDF page numbers — small, right-flush, out of the way. */
p.page-marker {
  text-align: right;
  font-size: 0.75em;
  color: #777777;
  margin: 1em 0 0 0;
}

p {
  margin: 0;
  text-indent: 0;
}

p.action {
  margin: ${em(gap)} 0;
  text-align: ${bodyAlign};
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
  margin-right: ${o.dialogueSideMarginPct}%;
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

p.transition {
  text-align: right;
  text-transform: uppercase;
  margin: ${em(gap)} 0;
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
