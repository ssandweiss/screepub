// Reflowable screenplay stylesheet. All structural indents are in em so the
// layout scales with the reader's font size — fixed-inch indents are what
// break consumer converters. Indents stay modest so narrow screens at large
// font sizes never overflow.
export const SCREENPLAY_CSS = `
html, body {
  margin: 0;
  padding: 0;
}

body {
  font-family: "Courier Prime", "Courier New", Courier, monospace;
  line-height: 1.45;
  widows: 2;
  orphans: 2;
}

h2.scene-heading {
  font-size: 1em;
  font-weight: bold;
  text-transform: uppercase;
  margin: 1.6em 0 0.8em 0;
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

/* Print geometry, reflowed: dialogue is a narrow column centered on the
   page (2.5"-margin column on paper), with the cue and parenthetical
   indented WITHIN that column (cue +1.2", parenthetical +0.5" in print;
   ≈7em / 3em in 12pt Courier). max-width degrades gracefully on phones. */
.dialogue-block {
  margin-top: 1em;
  margin-bottom: 1em;
  margin-left: auto;
  margin-right: auto;
  max-width: 21em;
}

/* A cue must never orphan from its dialogue at a page break. */
p.character {
  margin-left: 7em;
  page-break-after: avoid;
  break-after: avoid;
}

p.parenthetical {
  margin-left: 3em;
  margin-right: 3em;
  page-break-after: avoid;
  break-after: avoid;
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
