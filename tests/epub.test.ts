import { describe, test, expect } from 'bun:test';
import { Fountain } from 'fountain-js';
import JSZip from 'jszip';
import { tokensToBody, tokensToPreviewHtml } from '../src/epub/html';
import { buildEpub } from '../src/epub/build';
import { SCREENPLAY_CSS } from '../src/epub/css';

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

  test('opening content without a heading gets no keep-together wrapper', () => {
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

// ── screenplay CSS geometry ──────────────────────────────

describe('screenplay CSS (Kindle-safe geometry)', () => {
  test('dialogue column narrows with % side margins — never max-width (Kindle strips it)', () => {
    const block = SCREENPLAY_CSS.match(/\.dialogue-block\s*{[^}]*}/)![0];
    expect(block).toMatch(/margin-left:\s*\d+%/);
    expect(block).toMatch(/margin-right:\s*\d+%/);
    expect(SCREENPLAY_CSS).not.toContain('max-width');
  });

  test('cue keeps with its dialogue and centers in the column by default', () => {
    const cue = SCREENPLAY_CSS.match(/p\.character\s*{[^}]*}/)![0];
    expect(cue).toContain('break-after: avoid');
    expect(cue).toContain('text-align: center');
  });

  test('parenthetical centers in the column by default', () => {
    const paren = SCREENPLAY_CSS.match(/p\.parenthetical\s*{[^}]*}/)![0];
    expect(paren).toContain('text-align: center');
  });

  test('vertical rhythm is em-based: a full blank line between elements', () => {
    const action = SCREENPLAY_CSS.match(/p\.action\s*{[^}]*}/)![0];
    expect(action).toMatch(/margin:\s*1(\.\d+)?em 0/);
    const block = SCREENPLAY_CSS.match(/\.dialogue-block\s*{[^}]*}/)![0];
    expect(block).toMatch(/margin-top:\s*1(\.\d+)?em/);
  });

  test('body text keeps device-default line height (Enhanced Typesetting owns it)', () => {
    const body = SCREENPLAY_CSS.match(/(^|\n)body\s*{[^}]*}/)![0];
    expect(body).not.toContain('line-height');
  });

  test('keep-with-next chain is minimal: heading and cue only, not parenthetical', () => {
    const paren = SCREENPLAY_CSS.match(/p\.parenthetical\s*{[^}]*}/)![0];
    expect(paren).not.toContain('break-after');
    const heading = SCREENPLAY_CSS.match(/h2\.scene-heading\s*{[^}]*}/)![0];
    expect(heading).toContain('break-after: avoid');
  });

  test('page markers float out of the flow so they cost no line', () => {
    expect(SCREENPLAY_CSS).not.toMatch(/p\.page-marker\s*{/);
    const marker = SCREENPLAY_CSS.match(/span\.page-marker\s*{[^}]*}/)![0];
    expect(marker).toContain('float: right');
    // horizontal geometry in % per the CSS invariants
    expect(marker).toMatch(/margin-left:\s*\d+%/);
  });

  test('keep-together container uses break-inside avoid (the KDP-documented form)', () => {
    const keep = SCREENPLAY_CSS.match(/\.keep-together\s*{[^}]*}/)![0];
    expect(keep).toContain('page-break-inside: avoid');
    expect(keep).toContain('break-inside: avoid');
  });

  test('transitions may end a page but never begin one', () => {
    const t = SCREENPLAY_CSS.match(/p\.transition\s*{[^}]*}/)![0];
    expect(t).toContain('page-break-before: avoid');
    expect(t).toContain('break-before: avoid');
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
    expect(SCREENPLAY_CSS.match(/table\.dual-dialogue\s*{[^}]*}/)![0]).toContain('page-break-inside: avoid');
    expect(SCREENPLAY_CSS.match(/table\.dual-dialogue td\s*{[^}]*}/)![0]).toContain('width: 50%');
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
