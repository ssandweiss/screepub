import { describe, test, expect } from 'bun:test';
import { Fountain } from 'fountain-js';
import JSZip from 'jszip';
import { tokensToChapters } from '../src/epub/html';
import { buildEpub } from '../src/epub/build';

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

// ── tokensToChapters ─────────────────────────────────────

describe('tokensToChapters', () => {
  test('splits into one chapter per scene heading', () => {
    const chapters = tokensToChapters(sampleTokens());
    expect(chapters).toHaveLength(2);
    expect(chapters[0].title).toBe('INT. KITCHEN - DAY');
    expect(chapters[1].title).toBe('EXT. YARD - NIGHT');
  });

  test('chapter ids are stable and filename-safe', () => {
    const chapters = tokensToChapters(sampleTokens());
    expect(chapters[0].id).toBe('ch001');
    expect(chapters[1].id).toBe('ch002');
  });

  test('dialogue renders inside a dialogue block with cue/paren/line classes', () => {
    const [ch1] = tokensToChapters(sampleTokens());
    expect(ch1.xhtml).toContain('<div class="dialogue-block">');
    expect(ch1.xhtml).toContain('<p class="character">JACK</p>');
    expect(ch1.xhtml).toContain('<p class="parenthetical">(tired)</p>');
    expect(ch1.xhtml).toContain('</div>');
  });

  test('special characters are XML-escaped', () => {
    const [ch1] = tokensToChapters(sampleTokens());
    expect(ch1.xhtml).toContain('5 &lt; 6 &amp; &quot;quotes&quot; too.');
    expect(ch1.xhtml).not.toContain('5 < 6 &');
  });

  test('transition strips the forcing prefix and gets its class', () => {
    const chapters = tokensToChapters(sampleTokens());
    expect(chapters[1].xhtml).toContain('<p class="transition">FADE OUT.</p>');
    expect(chapters[1].xhtml).not.toContain('&gt; FADE OUT');
  });

  test('scene heading is an h2 with visible scene number preserved', () => {
    const chapters = tokensToChapters(sampleTokens());
    expect(chapters[0].xhtml).toContain('<h2 class="scene-heading"');
    expect(chapters[1].title).toBe('EXT. YARD - NIGHT');
  });

  test('content before the first scene heading becomes an opening chapter', () => {
    const tokens = new Fountain().parse('Some cold-open action.\n\nINT. LAB - DAY\n\nWork.\n', true).tokens;
    const chapters = tokensToChapters(tokens);
    expect(chapters).toHaveLength(2);
    expect(chapters[0].title).toBe('Opening');
    expect(chapters[0].xhtml).toContain('Some cold-open action.');
  });

  test('script with no scene headings yields a single chapter', () => {
    const tokens = new Fountain().parse('Just action.\n\nMore action.\n', true).tokens;
    const chapters = tokensToChapters(tokens);
    expect(chapters).toHaveLength(1);
    expect(chapters[0].xhtml).toContain('Just action.');
  });
});

// ── buildEpub ────────────────────────────────────────────

describe('buildEpub', () => {
  async function build() {
    const chapters = tokensToChapters(sampleTokens());
    const bytes = await buildEpub({ title: 'Test Script', author: 'Jane Doe' }, chapters);
    const zip = await JSZip.loadAsync(bytes);
    return { bytes, zip };
  }

  test('mimetype is first, stored uncompressed, with exact content', async () => {
    const { bytes } = await build();
    // Zip local file header: filename at offset 30; stored mimetype must be
    // the very first entry per OCF spec.
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
    expect(opf).toMatch(/<itemref idref="titlepage"\/>\s*<itemref idref="ch001"\/>\s*<itemref idref="ch002"\/>/);
  });

  test('nav.xhtml lists every scene with a working link', async () => {
    const { zip } = await build();
    const nav = await zip.file('OEBPS/nav.xhtml')!.async('string');
    expect(nav).toContain('<a href="text/ch001.xhtml">INT. KITCHEN - DAY</a>');
    expect(nav).toContain('<a href="text/ch002.xhtml">EXT. YARD - NIGHT</a>');
  });

  test('title page renders title and author', async () => {
    const { zip } = await build();
    const tp = await zip.file('OEBPS/titlepage.xhtml')!.async('string');
    expect(tp).toContain('Test Script');
    expect(tp).toContain('Jane Doe');
  });

  test('every chapter file exists and is well-formed XHTML', async () => {
    const { zip } = await build();
    for (const id of ['ch001', 'ch002']) {
      const doc = await zip.file(`OEBPS/text/${id}.xhtml`)!.async('string');
      expect(doc).toContain('<?xml version="1.0" encoding="UTF-8"?>');
      expect(doc).toContain('xmlns="http://www.w3.org/1999/xhtml"');
      expect(doc).toContain('<link rel="stylesheet"');
    }
  });

  test('stylesheet ships in the package', async () => {
    const { zip } = await build();
    const css = await zip.file('OEBPS/style.css')!.async('string');
    expect(css).toContain('.character');
    expect(css).toContain('break-after: avoid');
  });
});
