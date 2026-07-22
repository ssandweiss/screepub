// Reflowable screenplay stylesheet, Kindle-safe.
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
export const SCREENPLAY_CSS = `
html, body {
  margin: 0;
  padding: 0;
}

body {
  font-family: "Courier Prime", "Courier New", Courier, monospace;
}

h2.scene-heading {
  font-size: 1em;
  font-weight: bold;
  text-transform: uppercase;
  margin: 1.6em 0 1em 0;
  page-break-after: avoid;
  break-after: avoid;
}

p {
  margin: 0;
  text-indent: 0;
}

p.action {
  margin: 1em 0;
}

p.mini-slug {
  font-weight: bold;
  text-transform: uppercase;
  margin: 1.4em 0 1em 0;
  page-break-after: avoid;
  break-after: avoid;
}

/* Print geometry, reflowed: dialogue is a narrow column (58% of the body
   column in print; symmetric 20% margins ≈ 60% here). Cue and parenthetical
   indent WITHIN the column as percentages of it (print: cue +1.2" and
   parenthetical +0.6" into the 3.5" column). */
.dialogue-block {
  margin-top: 1em;
  margin-bottom: 1em;
  margin-left: 20%;
  margin-right: 20%;
}

/* A cue must never orphan from its dialogue at a page break. */
p.character {
  margin-left: 33%;
  page-break-after: avoid;
  break-after: avoid;
}

p.parenthetical {
  margin-left: 17%;
  margin-right: 8%;
}

p.dialogue {
  margin: 0;
}

p.transition {
  text-align: right;
  text-transform: uppercase;
  margin: 1em 0;
}

p.centered {
  text-align: center;
  margin: 1em 0;
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
