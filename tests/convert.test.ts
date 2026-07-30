import { describe, test, expect } from 'bun:test';
import { existsSync } from 'node:fs';
import JSZip from 'jszip';
import {
  convertPdf,
  convertFountain,
  ScannedPdfError,
  NotAScreenplayError,
} from '../src/convert';

// Committed, invented, and safe to publish — see tools/make-fixture.py.
const PUBLIC = new URL('./fixtures/', import.meta.url).pathname;
// Real scripts are confidential and gitignored; they add coverage locally
// but nothing here may assert anything that identifies one.
const PRIVATE = new URL('../fixtures/', import.meta.url).pathname;
const hasPrivate = existsSync(`${PRIVATE}final-draft.pdf`);

async function bytes(path: string): Promise<Uint8Array> {
  return new Uint8Array(await Bun.file(path).arrayBuffer());
}

describe('convertPdf', () => {
  test('screenplay PDF converts end-to-end', async () => {
    const result = await convertPdf(await bytes(`${PUBLIC}screenplay.pdf`));
    expect(result.meta.title).toBe('The Last Video Store');
    expect(result.meta.author).toBe('A. N. Placeholder');
    expect(result.screenplay!.scenes.length).toBe(5);
    expect(result.fountainText).toContain('INT. THE LAST VIDEO STORE - NIGHT');
    // EPUB is a valid zip with one chapter per scene (+ Opening if any)
    const zip = await JSZip.loadAsync(result.epub);
    const opf = await zip.file('OEBPS/package.opf')!.async('string');
    expect(opf).toContain('<dc:title>The Last Video Store</dc:title>');
  }, 60000);

  test('image-only PDF raises ScannedPdfError', async () => {
    // The await is load-bearing: unawaited, .rejects resolves after the
    // test body and the assertion can never fail the test.
    await expect(convertPdf(await bytes(`${PUBLIC}blank-pages.pdf`)))
      .rejects.toThrow(ScannedPdfError);
  }, 60000);

  test('non-screenplay PDF raises NotAScreenplayError', async () => {
    await expect(convertPdf(await bytes(`${PUBLIC}prose.pdf`)))
      .rejects.toThrow(NotAScreenplayError);
  }, 60000);

  test('title/author overrides win over detection', async () => {
    const result = await convertPdf(await bytes(`${PUBLIC}screenplay.pdf`), {
      title: 'Override Title',
      author: 'Override Author',
    });
    expect(result.meta.title).toBe('Override Title');
    expect(result.meta.author).toBe('Override Author');
  }, 60000);
});

// Shape only — a feature-length script exercises paths the 5-page fixture
// cannot (page-break interruptions, CONT'D runs, a deep character roster).
describe.skipIf(!hasPrivate)('convertPdf on a full-length script', () => {
  test('converts with a plausible scene and character count', async () => {
    const result = await convertPdf(await bytes(`${PRIVATE}final-draft.pdf`));
    expect(result.screenplay!.scenes.length).toBeGreaterThan(50);
    expect(result.meta.title).not.toBe('Untitled Screenplay');
    expect(result.warnings).toEqual([]);
  }, 60000);
});

describe('convertFountain', () => {
  const SRC = `Title: Direct Input\nAuthor: Someone\n\nINT. VOID - DAY\n\nText appears.\n\n@VOICE\nHello.\n`;

  test('fountain text converts to EPUB with metadata from title block', async () => {
    const result = await convertFountain(SRC);
    expect(result.meta.title).toBe('Direct Input');
    expect(result.meta.author).toBe('Someone');
    const zip = await JSZip.loadAsync(result.epub);
    const ch = await zip.file('OEBPS/text/body001.xhtml')!.async('string');
    expect(ch).toContain('INT. VOID - DAY');
    expect(ch).toContain('<p class="character">VOICE</p>');
  });

  test('untitled fountain falls back to a default title', async () => {
    const result = await convertFountain('INT. SOMEWHERE - DAY\n\nAction.\n');
    expect(result.meta.title).toBe('Untitled Screenplay');
  });
});

describe('convertFountain previewHtml', () => {
  test('returns the preview document', async () => {
    const src = 'Title: T\n\nINT. LAB - DAY\n\nBeakers bubble.\n\nELI\nEureka.\n';
    const result = await convertFountain(src, {});
    expect(result.previewHtml).toContain('class="dialogue-block"');
    expect(result.previewHtml).toContain('<style>');
  });
});
