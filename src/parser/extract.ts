// Ported from nightwatch src/lib/tableread/parser/extract.ts, adapted for
// headless Bun/Node: legacy pdf.js build, no browser worker.
import type { RawLine } from './types';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';

/**
 * Extract raw lines from a PDF buffer.
 * Each line has: text, indent (0-100%), y position, page number.
 * Indent is normalized as percentage of page width — this makes the
 * parser work across different PDF generators and page sizes.
 *
 * @param maxPages - if set, only the first N pages are parsed.
 */
export async function extractLines(pdfBytes: Uint8Array, maxPages?: number): Promise<RawLine[]> {
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

  return allLines;
}

interface TextItem {
  str: string;
  transform: number[];
}

function groupItemsIntoLines(
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
    const lineItems = lineMap.get(y)!;
    // Sort items left-to-right by X position
    lineItems.sort((a, b) => a.transform[4] - b.transform[4]);

    // Join items into text, inserting space for gaps > 5 points
    let text = '';
    let prevEndX = -1;

    for (const item of lineItems) {
      const x = item.transform[4];
      if (prevEndX >= 0 && x - prevEndX > 5) {
        text += ' ';
      }
      text += item.str;
      // Approximate end X (rough, but works for gap detection)
      prevEndX = x + item.str.length * 6;
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
