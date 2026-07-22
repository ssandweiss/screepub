import { describe, test, expect } from 'bun:test';
import { Fountain } from 'fountain-js';
import JSZip from 'jszip';
import { tokensToBody } from '../src/epub/html';
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

describe('screenplay CSS', () => {
  test('dialogue block is a centered narrow column', () => {
    const block = SCREENPLAY_CSS.match(/\.dialogue-block\s*{[^}]*}/)![0];
    expect(block).toContain('margin-left: auto');
    expect(block).toContain('margin-right: auto');
    expect(block).toMatch(/max-width:\s*\d+em/);
  });

  test('cues keep with their dialogue and sit deeper in the column', () => {
    const cue = SCREENPLAY_CSS.match(/p\.character\s*{[^}]*}/)![0];
    expect(cue).toContain('break-after: avoid');
    expect(cue).toMatch(/margin-left:\s*\d+(\.\d+)?em/);
  });

  test('elements are separated by at least a full blank line', () => {
    const action = SCREENPLAY_CSS.match(/p\.action\s*{[^}]*}/)![0];
    expect(action).toMatch(/margin:\s*1(\.\d+)?em 0/);
    const block = SCREENPLAY_CSS.match(/\.dialogue-block\s*{[^}]*}/)![0];
    expect(block).toMatch(/margin-top:\s*1(\.\d+)?em/);
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
