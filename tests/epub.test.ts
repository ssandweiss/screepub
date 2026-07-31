import { describe, test, expect } from 'bun:test';
import { readFileSync } from 'node:fs';
import { Fountain } from 'fountain-js';
import JSZip from 'jszip';
import { tokensToBody, tokensToPreviewHtml } from '../src/epub/html';
import { buildEpub } from '../src/epub/build';
import { SCREENPLAY_CSS } from '../src/epub/css';
import { ruleFor, eachRule } from './css-rules';
import { DEFAULT_FORMAT_OPTIONS } from '../src/options';
// Stage-2's copy, straight from the module that owns it — both renderers
// import it from here, so the test reads the same definition they do.
import { PRIMARY_SLUG } from '../src/fountain/slug';
import { PRIMARY_SLUG as PARSER_PRIMARY_SLUG } from '../src/parser/classify';

const SAMPLE = `INT. KITCHEN - DAY

Jack enters, exhausted.

@JACK
(tired)
Long day. 5 < 6 & "quotes" too.

EXT. YARD - NIGHT #2#

The stars come out.

> FADE OUT.
`;

function sampleTokens() {
  return new Fountain().parse(SAMPLE, true).tokens;
}

// ── tokensToBody ─────────────────────────────────────────

describe('tokensToBody', () => {
  test('scenes flow together in a single body file — no per-scene files', () => {
    const body = tokensToBody(sampleTokens());
    expect(body.files).toHaveLength(1);
    expect(body.files[0].id).toBe('body001');
    expect(body.files[0].xhtml).toContain('INT. KITCHEN - DAY');
    expect(body.files[0].xhtml).toContain('EXT. YARD - NIGHT');
  });

  test('each scene is an anchored section for TOC navigation', () => {
    const body = tokensToBody(sampleTokens());
    expect(body.files[0].xhtml).toContain('<section class="scene" id="sc-001">');
    expect(body.files[0].xhtml).toContain('<section class="scene" id="sc-002">');
    expect(body.toc).toEqual([
      { title: 'INT. KITCHEN - DAY', href: 'text/body001.xhtml#sc-001' },
      { title: 'EXT. YARD - NIGHT', href: 'text/body001.xhtml#sc-002' },
    ]);
  });

  test('oversized scripts split into multiple files at scene boundaries', () => {
    const body = tokensToBody(sampleTokens(), { maxFileBytes: 400 });
    expect(body.files.length).toBeGreaterThan(1);
    expect(body.files.map((f) => f.id)).toEqual(['body001', 'body002']);
    // TOC follows scenes into their files
    expect(body.toc[0].href).toContain('body001.xhtml#sc-001');
    expect(body.toc[1].href).toContain('body002.xhtml#sc-002');
  });

  test('scene heading leads its scene bare — the keep is the CSS chain, not a wrapper', () => {
    const [file] = tokensToBody(sampleTokens()).files;
    expect(file.xhtml).toMatch(
      /<section class="scene" id="sc-001">\s*<h2 class="scene-heading">INT\. KITCHEN - DAY<\/h2>\s*<p class="action">Jack enters, exhausted\.<\/p>/,
    );
    expect(file.xhtml).not.toMatch(/<div class="keep-together">\s*<h2/);
  });

  test('a dialogue block follows its heading directly — no outer wrapper', () => {
    const tokens = new Fountain().parse('INT. CAR - DAY\n\n@DEV\nDrive.\n\nThey drive.\n', true).tokens;
    const [file] = tokensToBody(tokens).files;
    expect(file.xhtml).toMatch(
      /<h2 class="scene-heading">INT\. CAR - DAY<\/h2>\s*<div class="dialogue-block">/,
    );
    expect(file.xhtml).not.toMatch(/<div class="keep-together">\s*<h2/);
  });

  test('heading-only scene renders bare without error', () => {
    const tokens = new Fountain().parse('INT. VOID - DAY\n\nEXT. VOID - NIGHT\n\nStars.\n', true).tokens;
    const [file] = tokensToBody(tokens).files;
    expect(file.xhtml).toMatch(
      /<section class="scene" id="sc-001">\s*<h2 class="scene-heading">INT\. VOID - DAY<\/h2>\s*<\/section>/,
    );
  });

  test('opening content without a heading renders directly in its section', () => {
    const tokens = new Fountain().parse('Cold open action.\n\nINT. LAB - DAY\n\nWork.\n', true).tokens;
    const [file] = tokensToBody(tokens).files;
    expect(file.xhtml).toMatch(/<section class="scene" id="sc-001">\s*<p class="action">Cold open action\.<\/p>/);
  });

  test('dialogue renders inside a dialogue block with cue/paren/line classes', () => {
    const [file] = tokensToBody(sampleTokens()).files;
    expect(file.xhtml).toContain('<div class="dialogue-block">');
    expect(file.xhtml).toContain('<p class="character">JACK</p>');
    expect(file.xhtml).toContain('<p class="parenthetical">(tired)</p>');
  });

  test('special characters are XML-escaped', () => {
    const [file] = tokensToBody(sampleTokens()).files;
    expect(file.xhtml).toContain('5 &lt; 6 &amp; &quot;quotes&quot; too.');
  });

  test('transition strips the forcing prefix', () => {
    const [file] = tokensToBody(sampleTokens()).files;
    expect(file.xhtml).toContain('<p class="transition">FADE OUT.</p>');
  });

  test('content before the first scene heading becomes an Opening section', () => {
    const tokens = new Fountain().parse('Some cold-open action.\n\nINT. LAB - DAY\n\nWork.\n', true).tokens;
    const body = tokensToBody(tokens);
    expect(body.files[0].xhtml).toContain('Some cold-open action.');
    expect(body.toc[0].title).toBe('Opening');
    expect(body.toc[1].title).toBe('INT. LAB - DAY');
  });

  test('script with no scene headings yields one section', () => {
    const body = tokensToBody(new Fountain().parse('Just action.\n\nMore action.\n', true).tokens);
    expect(body.files).toHaveLength(1);
    expect(body.files[0].xhtml).toContain('Just action.');
    expect(body.toc).toHaveLength(1);
  });
});

// ── dual dialogue height fallback ────────────────────────

describe('dual dialogue height fallback', () => {
  const dualScript = (line: string) =>
    `INT. HALL - DAY\n\n@JACK\n${line}\n\n@JILL ^\nAlso talking here.\n`;

  test('a short exchange stays a side-by-side table', () => {
    const tokens = new Fountain().parse(dualScript('Quick word.'), true).tokens;
    const [file] = tokensToBody(tokens).files;
    expect(file.xhtml).toContain('<table class="dual-dialogue">');
  });

  test('a tall exchange emits sequential speeches instead of an unbreakable table', () => {
    const tokens = new Fountain().parse(dualScript('word '.repeat(120).trim()), true).tokens;
    const [file] = tokensToBody(tokens).files;
    expect(file.xhtml).not.toContain('<table class="dual-dialogue">');
    expect(file.xhtml).toContain('<p class="character">JACK</p>');
    expect(file.xhtml).toContain('<p class="character">JILL</p>');
    // each speech is a full dialogue block whose cue opens the keep, and
    // JACK's speech still precedes JILL's
    expect(file.xhtml).toMatch(
      /<div class="dialogue-block">\s*<div class="keep-together">\s*<p class="character">JACK<\/p>[\s\S]*?<div class="dialogue-block">\s*<div class="keep-together">\s*<p class="character">JILL<\/p>/,
    );
    const blocks = file.xhtml.match(/<div class="dialogue-block">/g) ?? [];
    expect(blocks.length).toBe(2);
  });

  // Measured against this script shape: the taller column costs one line for
  // the cue plus ceil((N + 1) / EST_CHARS_PER_DUAL_LINE) for the dialogue
  // (the + 1 is the cell's trailing newline), so the flip lands between 329
  // and 330. Change either constant and this pair fails.
  test('the table/sequential flip sits exactly where the constants put it', () => {
    const render = (n: number) =>
      tokensToBody(new Fountain().parse(dualScript('x'.repeat(n)), true).tokens).files[0].xhtml;
    expect(render(329)).toContain('<table class="dual-dialogue">');
    expect(render(330)).not.toContain('<table class="dual-dialogue">');
  });
});

// ── screenplay CSS geometry ──────────────────────────────

describe('screenplay CSS (Kindle-safe geometry)', () => {
  test('dialogue column narrows with % side margins — never max-width (Kindle strips it)', () => {
    const block = ruleFor(SCREENPLAY_CSS, '.dialogue-block');
    expect(block).toMatch(/margin-left:\s*\d+%/);
    expect(block).toMatch(/margin-right:\s*\d+%/);
    expect(SCREENPLAY_CSS).not.toContain('max-width');
  });

  test('cue keeps with its dialogue and centers in the column by default', () => {
    const cue = ruleFor(SCREENPLAY_CSS, 'p.character');
    expect(cue).toContain('break-after: avoid');
    expect(cue).toContain('text-align: center');
  });

  test('parenthetical centers in the column by default', () => {
    const paren = ruleFor(SCREENPLAY_CSS, 'p.parenthetical');
    expect(paren).toContain('text-align: center');
  });

  test('vertical rhythm is em-based: a full blank line between elements', () => {
    const action = ruleFor(SCREENPLAY_CSS, 'p.action');
    expect(action).toMatch(/margin:\s*1(\.\d+)?em 0/);
    const block = ruleFor(SCREENPLAY_CSS, '.dialogue-block');
    expect(block).toMatch(/margin-top:\s*1(\.\d+)?em/);
  });

  test('body text keeps device-default line height (Enhanced Typesetting owns it)', () => {
    const body = ruleFor(SCREENPLAY_CSS, 'body');
    expect(body).not.toContain('line-height');
  });

  test('keep-with-next chain is minimal: heading and cue only, not parenthetical', () => {
    const paren = ruleFor(SCREENPLAY_CSS, 'p.parenthetical');
    expect(paren).not.toContain('break-after');
    const heading = ruleFor(SCREENPLAY_CSS, 'h2.scene-heading');
    // both spellings: the legacy prefixed property AND the modern standalone
    expect(heading).toContain('page-break-after: avoid');
    expect(heading).toMatch(/[^-]break-after: avoid/);
  });

  test('page markers float out of the flow so they cost no line', () => {
    expect(SCREENPLAY_CSS).not.toMatch(/p\.page-marker\s*{/);
    const marker = ruleFor(SCREENPLAY_CSS, 'span.page-marker');
    expect(marker).toContain('float: right');
    // horizontal geometry in % per the CSS invariants
    expect(marker).toMatch(/margin-left:\s*\d+%/);
  });

  test('keep-together container uses break-inside avoid (the KDP-documented form)', () => {
    const keep = ruleFor(SCREENPLAY_CSS, '.keep-together');
    expect(keep).toContain('page-break-inside: avoid');
    expect(keep).toContain('break-inside: avoid');
  });

  test('transitions may end a page but never begin one', () => {
    const t = ruleFor(SCREENPLAY_CSS, 'p.transition');
    expect(t).toContain('page-break-before: avoid');
    expect(t).toContain('break-before: avoid');
  });

  // Selectors carrying a given mechanism, in stylesheet order. Both pins
  // below sweep every rule through the SAME parser ruleFor uses, so a
  // grouped selector wrapped across lines reads as its whole list rather
  // than its last member (see eachRule's comment for the bug that idiom
  // caused).
  const selectorsCarrying = (re: RegExp) =>
    eachRule(SCREENPLAY_CSS).filter((r) => re.test(r.body)).map((r) => r.selector);

  // Every avoid link grows the chunk a renderer pushes, so the inventory is
  // deliberately closed and written out in the css.ts header. Pin it: a new
  // keep cannot slip in without this failing and sending its author to the
  // header comment. Default options, so the two gated-off entries
  // (`.dialogue-block`, `section.scene`) are absent by design.
  //
  // Six of the seven entries carry BOTH spellings of their avoid, hence the
  // twelve declarations. The seventh is the column-spelling shadow rule
  // (-webkit-column-break-inside, css.ts), which re-lists two selectors
  // already named above for multicol-paginating engines; it matches neither
  // `page-break-inside` nor `break-inside`, so it adds an entry without
  // adding to the count.
  test('the avoid inventory is closed — seven entries, twelve declarations', () => {
    const declarations =
      SCREENPLAY_CSS.match(/^\s*(?:page-)?break-(?:after|before|inside):\s*avoid;/gm) ?? [];
    expect(declarations).toHaveLength(12);

    expect(selectorsCarrying(/:\s*avoid;/)).toEqual([
      '.keep-together',
      '.keep-together, table.dual-dialogue',
      'h2.scene-heading',
      'p.mini-slug',
      'p.character',
      'table.dual-dialogue',
      'p.transition',
    ]);
  });

  // widows/orphans (registry #17) is a separate, gated mechanism outside
  // the avoid-link inventory above — pin it too, the same way, so it
  // cannot spread to a third selector (e.g. p.parenthetical) without this
  // failing and sending its author to the css.ts header comment.
  test('widows/orphans carry on exactly two selectors: p.action and p.dialogue', () => {
    expect(selectorsCarrying(/\b(?:widows|orphans):\s*\d+;/)).toEqual(['p.action', 'p.dialogue']);
  });
});

// ── buildEpub ────────────────────────────────────────────

describe('buildEpub', () => {
  async function build() {
    const body = tokensToBody(sampleTokens());
    const bytes = await buildEpub({ title: 'Test Script', author: 'Jane Doe' }, body);
    const zip = await JSZip.loadAsync(bytes);
    return { bytes, zip };
  }

  test('mimetype is first, stored uncompressed, with exact content', async () => {
    const { bytes } = await build();
    const head = new TextDecoder().decode(bytes.slice(0, 100));
    expect(head).toContain('mimetypeapplication/epub+zip');
  });

  test('container.xml points at the package document', async () => {
    const { zip } = await build();
    const container = await zip.file('META-INF/container.xml')!.async('string');
    expect(container).toContain('full-path="OEBPS/package.opf"');
  });

  test('package.opf carries metadata, manifest, and spine in reading order', async () => {
    const { zip } = await build();
    const opf = await zip.file('OEBPS/package.opf')!.async('string');
    expect(opf).toContain('<dc:title>Test Script</dc:title>');
    expect(opf).toContain('<dc:creator>Jane Doe</dc:creator>');
    expect(opf).toContain('properties="nav"');
    expect(opf).toMatch(/<itemref idref="titlepage"\/>\s*<itemref idref="body001"\/>/);
  });

  test('OPF declares the ibooks prefix and specified-fonts meta', async () => {
    const { zip } = await build();
    const opf = await zip.file('OEBPS/package.opf')!.async('string');
    expect(opf).toContain(
      'prefix="ibooks: http://vocabulary.itunes.apple.com/rdf/ibooks/vocabulary-extensions-1.0/"',
    );
    expect(opf).toContain('<meta property="ibooks:specified-fonts">true</meta>');
  });

  test('nav.xhtml lists every scene with an anchored link', async () => {
    const { zip } = await build();
    const nav = await zip.file('OEBPS/nav.xhtml')!.async('string');
    expect(nav).toContain('<a href="text/body001.xhtml#sc-001">INT. KITCHEN - DAY</a>');
    expect(nav).toContain('<a href="text/body001.xhtml#sc-002">EXT. YARD - NIGHT</a>');
  });

  test('nav.xhtml carries a hidden page-list when the script has markers', async () => {
    const tokens = new Fountain().parse(
      'INT. A - DAY\n\n= pg 12\n\nShe waits.\n\n= pg 13\n\nHe leaves.\n', true,
    ).tokens;
    const body = tokensToBody(tokens);
    const zip = await JSZip.loadAsync(await buildEpub({ title: 'Test Script' }, body));
    const nav = await zip.file('OEBPS/nav.xhtml')!.async('string');
    expect(nav).toContain('<nav epub:type="page-list" hidden="hidden">');
    expect(nav).toContain('<a href="text/body001.xhtml#pg12">12</a>');
    expect(nav).toContain('<a href="text/body001.xhtml#pg13">13</a>');
    // page-list follows landmarks
    expect(nav.indexOf('page-list')).toBeGreaterThan(nav.indexOf('landmarks'));
  });

  test('no page-list nav at all when the script has no markers', async () => {
    const { zip } = await build();
    const nav = await zip.file('OEBPS/nav.xhtml')!.async('string');
    expect(nav).not.toContain('page-list');
  });

  test('title page renders title and author', async () => {
    const { zip } = await build();
    const tp = await zip.file('OEBPS/titlepage.xhtml')!.async('string');
    expect(tp).toContain('Test Script');
    expect(tp).toContain('Jane Doe');
  });

  test('body file is well-formed XHTML with the stylesheet linked', async () => {
    const { zip } = await build();
    const doc = await zip.file('OEBPS/text/body001.xhtml')!.async('string');
    expect(doc).toContain('<?xml version="1.0" encoding="UTF-8"?>');
    expect(doc).toContain('xmlns="http://www.w3.org/1999/xhtml"');
    expect(doc).toContain('<link rel="stylesheet"');
  });
});

// ── cue keeps with its first dialogue line ───────────────

describe('cue keep-with-dialogue wrapper', () => {
  test('cue + parenthetical + first line share an unbreakable wrapper', () => {
    const tokens = new Fountain().parse(
      'INT. A - DAY\n\nHi.\n\n@JACK\n(tired)\nFirst line of speech.\nSecond line of speech.\n', true,
    ).tokens;
    const [file] = tokensToBody(tokens).files;
    expect(file.xhtml).toMatch(
      /<div class="dialogue-block">\s*<div class="keep-together">\s*<p class="character">JACK<\/p>\s*<p class="parenthetical">\(tired\)<\/p>\s*<p class="dialogue">First line of speech\.<\/p>\s*<\/div>\s*<p class="dialogue">Second line of speech\.<\/p>\s*<\/div>/,
    );
  });

  test('single-line speech wraps without leftovers', () => {
    const tokens = new Fountain().parse('INT. A - DAY\n\nHi.\n\n@JACK\nOnly line.\n', true).tokens;
    const [file] = tokensToBody(tokens).files;
    expect(file.xhtml).toMatch(
      /<div class="dialogue-block">\s*<div class="keep-together">\s*<p class="character">JACK<\/p>\s*<p class="dialogue">Only line\.<\/p>\s*<\/div>\s*<\/div>/,
    );
  });
});

// ── inline emphasis rendering ────────────────────────────

describe('inline emphasis in XHTML', () => {
  test('fountain emphasis renders as em/strong/underline', () => {
    const tokens = new Fountain().parse(
      'INT. A - DAY\n\nThe sign reads ***DO NOT ENTER*** and **STOP** and *slow* and _underlined_.\n', true,
    ).tokens;
    const [file] = tokensToBody(tokens).files;
    expect(file.xhtml).toContain('<strong><em>DO NOT ENTER</em></strong>');
    expect(file.xhtml).toContain('<strong>STOP</strong>');
    expect(file.xhtml).toContain('<em>slow</em>');
    expect(file.xhtml).toContain('<span class="underline">underlined</span>');
  });

  test('escaping still applies inside emphasized text', () => {
    const tokens = new Fountain().parse('INT. A - DAY\n\nA *5 < 6* case.\n', true).tokens;
    const [file] = tokensToBody(tokens).files;
    expect(file.xhtml).toContain('<em>5 &lt; 6</em>');
  });

  test('stray asterisk-free text is untouched', () => {
    const tokens = new Fountain().parse('INT. A - DAY\n\nPlain 2 * 3 math.\n', true).tokens;
    const [file] = tokensToBody(tokens).files;
    expect(file.xhtml).toContain('Plain 2 * 3 math.');
  });
});

// ── page markers render ──────────────────────────────────

describe('page markers in XHTML', () => {
  test('a marker rides inside the next block, not in a paragraph of its own', () => {
    const tokens = new Fountain().parse(
      'INT. A - DAY\n\nAction.\n\n= pg 47\n\nAnne crosses the room.\n', true,
    ).tokens;
    const [file] = tokensToBody(tokens).files;
    expect(file.xhtml).not.toContain('<p class="page-marker">');
    expect(file.xhtml).toMatch(/<span[^>]*class="page-marker"[^>]*>47\.<\/span>/);
    // immediately inside the following paragraph's opening tag
    expect(file.xhtml).toMatch(
      /<p class="action"><span[^>]*class="page-marker"[^>]*>47\.<\/span>Anne crosses the room\./,
    );
  });

  test('the marker span is the EPUB3 pagination anchor', () => {
    const tokens = new Fountain().parse('INT. A - DAY\n\n= pg 47\n\nAction.\n', true).tokens;
    const [file] = tokensToBody(tokens).files;
    expect(file.xhtml).toContain('epub:type="pagebreak"');
    expect(file.xhtml).toContain('role="doc-pagebreak"');
    expect(file.xhtml).toContain('id="pg47"');
    expect(file.xhtml).toContain('title="47"');
  });

  test('a trailing marker with no block to ride in is dropped', () => {
    const tokens = new Fountain().parse('INT. A - DAY\n\nAnne crosses the room.\n\n= pg 48\n', true).tokens;
    const [file] = tokensToBody(tokens).files;
    expect(file.xhtml).not.toContain('page-marker');
  });

  test('a marker at a scene seam rides into the next heading, not lost', () => {
    const tokens = new Fountain().parse(
      'INT. A - DAY\n\nAction.\n\n= pg 12\n\nINT. B - NIGHT\n\nMore.\n', true,
    ).tokens;
    const [file] = tokensToBody(tokens).files;
    expect(file.xhtml).toMatch(
      /<h2 class="scene-heading"><span[^>]*class="page-marker"[^>]*>12\.<\/span>INT\. B - NIGHT<\/h2>/,
    );
  });

  test('ordinary synopsis lines stay invisible', () => {
    const tokens = new Fountain().parse('INT. A - DAY\n\n= Jack discovers the truth\n\nAction.\n', true).tokens;
    const [file] = tokensToBody(tokens).files;
    expect(file.xhtml).not.toContain('discovers the truth');
  });

  test('page-list records every marker, in document order', () => {
    const tokens = new Fountain().parse(
      'INT. A - DAY\n\n= pg 12\n\nShe waits.\n\n= pg 13\n\nHe leaves.\n', true,
    ).tokens;
    const body = tokensToBody(tokens);
    expect(body.pageList).toEqual([
      { label: '12', href: 'text/body001.xhtml#pg12' },
      { label: '13', href: 'text/body001.xhtml#pg13' },
    ]);
  });

  test('every page-list href resolves to an id in the file it names', () => {
    const tokens = new Fountain().parse(
      'INT. A - DAY\n\n= pg 12\n\nShe waits a long while by the window.\n\n'
      + 'INT. B - NIGHT\n\n= pg 13\n\nHe leaves without a word to anyone.\n', true,
    ).tokens;
    const body = tokensToBody(tokens, { maxFileBytes: 400 });
    expect(body.files.length).toBeGreaterThan(1);
    for (const p of body.pageList) {
      const [name, fragment] = p.href.split('#');
      const file = body.files.find((f) => name === `text/${f.id}.xhtml`);
      expect(file).toBeTruthy();
      expect(file!.xhtml).toContain(`id="${fragment}"`);
    }
    // the second marker followed its scene into the second file
    expect(body.pageList[1].href).toBe('text/body002.xhtml#pg13');
  });

  test('a dropped trailing marker never reaches the page-list', () => {
    const tokens = new Fountain().parse('INT. A - DAY\n\nShe waits.\n\n= pg 48\n', true).tokens;
    expect(tokensToBody(tokens).pageList).toEqual([]);
  });

  test('a script without markers has an empty page-list', () => {
    expect(tokensToBody(sampleTokens()).pageList).toEqual([]);
  });
});

// ── dual dialogue side-by-side ───────────────────────────

describe('dual dialogue table rendering', () => {
  const DUAL_SRC = 'INT. A - DAY\n\n@VERA\n(overlapping)\nRead me the last page--\n\n@INFORMANT ^\n--the last page burned.\n\nThey stare.\n';

  test('dual speeches render as a two-cell table', () => {
    const tokens = new Fountain().parse(DUAL_SRC, true).tokens;
    const [file] = tokensToBody(tokens).files;
    expect(file.xhtml).toMatch(
      /<table class="dual-dialogue">\s*<tr>\s*<td>\s*<p class="character">VERA<\/p>\s*<p class="parenthetical">\(overlapping\)<\/p>\s*<p class="dialogue">Read me the last page--<\/p>\s*<\/td>\s*<td>\s*<p class="character">INFORMANT<\/p>\s*<p class="dialogue">--the last page burned\.<\/p>\s*<\/td>\s*<\/tr>\s*<\/table>/,
    );
    expect(file.xhtml).toContain('<p class="action">They stare.</p>');
  });

  test('table style keeps the pair together and splits width evenly', () => {
    expect(ruleFor(SCREENPLAY_CSS, 'table.dual-dialogue')).toContain('page-break-inside: avoid');
    expect(ruleFor(SCREENPLAY_CSS, 'table.dual-dialogue td')).toContain('width: 50%');
  });
});

// ── mini-slugs (secondary sluglines) ─────────────────────

describe('mini-slug rendering', () => {
  // "LATER", "THE KITCHEN" — forced sluglines in Fountain, which is how
  // serialize.ts writes the parser's mini-slug elements.
  const SRC = 'INT. STORE - NIGHT\n\nMargo locks up.\n\n.LATER\n\nThe lights are still on.\n';

  test('a forced non-INT/EXT slug renders as a micro-heading, not a scene heading', () => {
    const [file] = tokensToBody(new Fountain().parse(SRC, true).tokens).files;
    expect(file.xhtml).toContain('<p class="mini-slug">LATER</p>');
    expect(file.xhtml).not.toContain('<h2 class="scene-heading">LATER</h2>');
  });

  test('a mini-slug stays inside its scene — no section, no TOC entry', () => {
    const body = tokensToBody(new Fountain().parse(SRC, true).tokens);
    expect(body.toc).toEqual([
      { title: 'INT. STORE - NIGHT', href: 'text/body001.xhtml#sc-001' },
    ]);
    expect(body.files[0].xhtml).not.toContain('sc-002');
  });

  test('primary sluglines are untouched — INT/EXT/EST/I-E stay scene headings', () => {
    const src = 'INT. A - DAY\n\nOne.\n\nEXT. B - DAY\n\nTwo.\n\nEST. C - DAY\n\nThree.\n\nI/E. D - DAY\n\nFour.\n';
    const body = tokensToBody(new Fountain().parse(src, true).tokens);
    expect(body.files[0].xhtml).not.toContain('mini-slug');
    expect(body.toc.map((t) => t.title)).toEqual([
      'INT. A - DAY', 'EXT. B - DAY', 'EST. C - DAY', 'I/E. D - DAY',
    ]);
  });

  test('a mini-slug can open a script without swallowing the Opening section', () => {
    // Also the documented divergence for hand-written Fountain (README,
    // registry #5b): a dot-forced ".COLD OPEN" is a mini-slug here, not a
    // scene, so it gets no TOC entry. The trade Screepub takes for owning
    // the dot-force as its mini-slug carrier.
    const body = tokensToBody(new Fountain().parse('.COLD OPEN\n\nBlack.\n', true).tokens);
    expect(body.toc).toEqual([{ title: 'Opening', href: 'text/body001.xhtml#sc-001' }]);
    expect(body.files[0].xhtml).toContain('<p class="mini-slug">COLD OPEN</p>');
  });

  test('a numbered mini-slug keeps its number, like a slugline does', () => {
    const tokens = new Fountain().parse('INT. A - DAY\n\nOne.\n\n.LATER #5#\n\nTwo.\n', true).tokens;
    const [file] = tokensToBody(tokens, { format: { ...DEFAULT_FORMAT_OPTIONS, showSceneNumbers: true } }).files;
    expect(file.xhtml).toContain('<p class="mini-slug"><span class="scene-number">5</span> LATER</p>');
  });

  test('PRIMARY_SLUG stays in lockstep with fountain-js', () => {
    // Every opener fountain-js promotes UNFORCED must also promote when it
    // arrives forced, and nothing else may. An upstream rule change breaks
    // this table rather than silently reshuffling headings and TOC entries.
    const cases: [string, boolean][] = [
      ['INT. HOUSE - DAY', true],
      ['INT HOUSE - DAY', true],
      ['EXT. YARD - NIGHT', true],
      ['EST. THE HOUSE', true],
      ['I/E. CAR - DAY', true],
      ['I/E CAR - DAY', true],
      ['INT./EXT. CAR - DAY', true],
      ['INT/EXT CAR - DAY', true],
      ['LATER', false],
      ['THE BACK ROOM', false],
      ['ESTABLISHING SHOT', false],
      ['INTO THE WOODS', false],
      ['BACK TO:', false],
    ];
    for (const [text, promotes] of cases) {
      const unforced = new Fountain().parse(`${text}\n\nAction.\n`, true).tokens;
      expect([text, unforced[0].type === 'scene_heading']).toEqual([text, promotes]);
      const [file] = tokensToBody(new Fountain().parse(`.${text}\n\nAction.\n`, true).tokens).files;
      expect([text, file.xhtml.includes('<h2 class="scene-heading">')]).toEqual([text, promotes]);
      expect([text, file.xhtml.includes('<p class="mini-slug">')]).toEqual([text, !promotes]);
    }
  });

  test('the parser excludes from mini-slug exactly what this promotes', () => {
    // One literal, two layers: classify.ts must not mint a mini-slug that
    // the renderer would turn back into a scene heading.
    expect(PARSER_PRIMARY_SLUG.source).toBe(PRIMARY_SLUG.source);
    expect(PARSER_PRIMARY_SLUG.flags).toBe(PRIMARY_SLUG.flags);
  });

  test('the stylesheet gives it the bold uppercase micro-heading treatment', () => {
    const rule = ruleFor(SCREENPLAY_CSS, 'p.mini-slug');
    expect(rule).toContain('font-weight: bold');
    expect(rule).toContain('text-transform: uppercase');
    // Vertical rhythm in em, per the CSS invariants: more air above than below.
    expect(rule).toMatch(/margin:\s*1\.4em 0 1em 0/);
  });

  test('every class the stylesheet styles is one a renderer emits', () => {
    // The regression this suite exists for: p.mini-slug was styled for
    // months while no code path ever emitted the class.
    const emitted = readFileSync(new URL('../src/epub/html.ts', import.meta.url), 'utf8')
      + readFileSync(new URL('../src/epub/build.ts', import.meta.url), 'utf8');
    // Every class in every selector, descendants included (p.credit inside
    // section.titlepage counts) — comments stripped first, or "e.g." reads
    // as a class named "g".
    const selectors = [...SCREENPLAY_CSS.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/([^{}]+)\{/g)];
    const styled = selectors.flatMap((s) => [...s[1].matchAll(/\.([a-z][a-z0-9-]*)/g)].map((m) => m[1]));
    expect(new Set(styled).size).toBeGreaterThan(12);
    for (const cls of new Set(styled)) {
      expect(emitted).toContain(`class="${cls}"`);
    }
  });
});

// ── tokensToPreviewHtml ───────────────────────────────────

describe('tokensToPreviewHtml', () => {
  const tokens = new Fountain().parse(
    'INT. KITCHEN - DAY\n\nA kettle screams.\n\nMARGO\nTurn it off.\n',
    true,
  ).tokens;

  test('emits one self-contained document with inline css', () => {
    const html = tokensToPreviewHtml(tokens, { dialogueSideMarginPct: 25 });
    expect(html).toContain('class="dialogue-block"');
    expect(html).toContain('<style>');
    expect(html).toContain('margin-left: 25%');
    expect(html).not.toContain('<link');
  });

  test('defaults options when none given', () => {
    const html = tokensToPreviewHtml(tokens);
    expect(html).toContain('margin-left: 20%');
  });

  test('empty tokens still fall back to a styled document', () => {
    const html = tokensToPreviewHtml([]);
    expect(html).toContain('<style>');
  });
});
