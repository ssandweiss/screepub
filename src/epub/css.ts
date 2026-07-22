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
  margin: 0.8em 0;
}

p.mini-slug {
  font-weight: bold;
  text-transform: uppercase;
  margin: 1.2em 0 0.6em 0;
  page-break-after: avoid;
  break-after: avoid;
}

.dialogue-block {
  margin: 0.8em 0;
}

/* A cue must never orphan from its dialogue at a page break. */
p.character {
  margin-left: 3.5em;
  page-break-after: avoid;
  break-after: avoid;
}

p.parenthetical {
  margin-left: 2.5em;
  margin-right: 1.5em;
  page-break-after: avoid;
  break-after: avoid;
}

p.dialogue {
  margin-left: 1.5em;
  margin-right: 1em;
}

p.transition {
  text-align: right;
  text-transform: uppercase;
  margin: 0.8em 0;
}

p.centered {
  text-align: center;
  margin: 0.8em 0;
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
