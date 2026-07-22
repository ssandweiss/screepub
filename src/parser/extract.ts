// Ported from nightwatch src/lib/tableread/parser/extract.ts, adapted for
// headless Bun/Node: modern pdf.js build + DOM shims, no browser worker.
import './pdfjs-shims';
import type { RawLine } from './types';
import { getDocument } from 'pdfjs-dist/build/pdf.mjs';

/**
 * Extract raw lines from a PDF buffer.
 * Each line has: text, indent (0-100%), y position, page number.
 * Indent is normalized as percentage of page width — this makes the
 * parser work across different PDF generators and page sizes.
 *
 * @param maxPages - if set, only the first N pages are parsed.
 */
export async function extractLines(pdfBytes: Uint8Array, maxPages?: number): Promise<RawLine[]> {
  return (await extractDocument(pdfBytes, maxPages)).lines;
}

/**
 * Extract lines AND the true page count in a single document load.
 * NOTE: pdf.js transfers the underlying ArrayBuffer to its worker — the
 * caller's `pdfBytes` is detached afterwards. Pass a copy if you still need it.
 */
export async function extractDocument(
  pdfBytes: Uint8Array,
  maxPages?: number,
): Promise<{ lines: RawLine[]; pageCount: number }> {
  const pdf = await getDocument({ data: pdfBytes }).promise;
  const allLines: RawLine[] = [];

  const lastPage = maxPages ? Math.min(pdf.numPages, maxPages) : pdf.numPages;
  for (let pageNum = 1; pageNum <= lastPage; pageNum++) {
    const page = await pdf.getPage(pageNum);
    const viewport = page.getViewport({ scale: 1.0 });
    const textContent = await page.getTextContent();

    const pageLines = groupItemsIntoLines(textContent.items, viewport.width, pageNum);
    allLines.push(...pageLines);
  }

  return { lines: allLines, pageCount: pdf.numPages };
}

interface TextItem {
  str: string;
  transform: number[];
}

export function groupItemsIntoLines(
  items: unknown[],
  pageWidth: number,
  pageNum: number
): RawLine[] {
  // Filter to actual text items (not marked content)
  const textItems = items.filter(
    (item): item is TextItem => 'str' in (item as Record<string, unknown>) && 'transform' in (item as Record<string, unknown>)
  );

  if (textItems.length === 0) return [];

  // Group items by Y coordinate (same line = same rounded Y)
  const lineMap = new Map<number, TextItem[]>();

  for (const item of textItems) {
    const y = Math.round(item.transform[5]);
    const existing = lineMap.get(y) ?? [];
    existing.push(item);
    lineMap.set(y, existing);
  }

  // Sort lines top-to-bottom (higher Y = higher on page in PDF coords)
  const sortedYs = [...lineMap.keys()].sort((a, b) => b - a);

  const lines: RawLine[] = [];

  for (const y of sortedYs) {
    // Drop empty items (marked-content markers) — they carry no text and
    // would break duplicate-adjacency detection below.
    const lineItems = lineMap.get(y)!.filter((item) => item.str !== '');
    if (lineItems.length === 0) continue;
    // Sort items left-to-right by X position
    lineItems.sort((a, b) => a.transform[4] - b.transform[4]);

    // Join items into text, inserting space for gaps > 5 points
    let text = '';
    let prevEndX = -1;
    let prevX = Number.NaN;
    let prevStr = '';

    for (const item of lineItems) {
      const x = item.transform[4];
      // Double-printed text (Final Draft renders (MORE)/(CONT'D) lines twice
      // at identical coordinates) — drop the exact-overlap duplicate.
      if (item.str === prevStr && Math.abs(x - prevX) < 2) {
        continue;
      }
      if (prevEndX >= 0 && x - prevEndX > 5) {
        text += ' ';
      }
      text += item.str;
      // Approximate end X (rough, but works for gap detection)
      prevEndX = x + item.str.length * 6;
      prevX = x;
      prevStr = item.str;
    }

    text = text.trim();
    if (!text) continue;

    // Normalize indent as percentage of page width
    const firstX = lineItems[0].transform[4];
    const indent = Math.round((firstX / pageWidth) * 100);

    lines.push({ text, indent, y, pageNum });
  }

  return lines;
}

export async function getPageCount(pdfBytes: Uint8Array): Promise<number> {
  const pdf = await getDocument({ data: pdfBytes }).promise;
  return pdf.numPages;
}
