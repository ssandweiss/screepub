import { describe, test, expect } from 'bun:test';
import { existsSync } from 'node:fs';
import JSZip from 'jszip';
import {
  convertPdf,
  convertFountain,
  ScannedPdfError,
  NotAScreenplayError,
} from '../src/convert';

const FIXTURES = new URL('../fixtures/', import.meta.url).pathname;
const hasFixtures = existsSync(`${FIXTURES}final-draft.pdf`);

async function fixture(name: string): Promise<Uint8Array> {
  return new Uint8Array(await Bun.file(`${FIXTURES}${name}`).arrayBuffer());
}

describe.skipIf(!hasFixtures)('convertPdf on real scripts', () => {
  test('Final Draft script converts end-to-end', async () => {
    const result = await convertPdf(await fixture('final-draft.pdf'));
    expect(result.meta.title).toBe('Step Back, Doors Closing');
    expect(result.meta.author).toBe('Carter Ward');
    expect(result.screenplay!.scenes.length).toBeGreaterThan(50);
    expect(result.fountainText).toContain('INT. AIRLINER - NIGHT');
    // EPUB is a valid zip with one chapter per scene (+ Opening if any)
    const zip = await JSZip.loadAsync(result.epub);
    const opf = await zip.file('OEBPS/package.opf')!.async('string');
    expect(opf).toContain('<dc:title>Step Back, Doors Closing</dc:title>');
  }, 60000);

  test('image-only PDF raises ScannedPdfError', async () => {
    expect(convertPdf(await fixture('scanned.pdf'))).rejects.toThrow(ScannedPdfError);
  }, 60000);

  test('non-screenplay PDF raises NotAScreenplayError', async () => {
    expect(convertPdf(await fixture('pitchdeck.pdf'))).rejects.toThrow(NotAScreenplayError);
  }, 60000);

  test('title/author overrides win over detection', async () => {
    const result = await convertPdf(await fixture('final-draft.pdf'), {
      title: 'Override Title',
      author: 'Override Author',
    });
    expect(result.meta.title).toBe('Override Title');
    expect(result.meta.author).toBe('Override Author');
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
