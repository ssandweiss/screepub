// Adapted from an earlier table-read parser by the same author, reworked for
// headless Bun/Node: modern pdf.js build + DOM shims, no browser worker.
import './pdfjs-shims';
import type { RawLine } from './types';
import { getDocument } from 'pdfjs-dist/build/pdf.mjs';

/**
 * Extract raw lines from a PDF buffer.
 * Each line has: text, indent (0-100%), y position, page number.
 * Indent is normalized as percentage of page width — this makes the
 * parser work across different PDF generators and page sizes.
 */

/**
 * Extract lines AND the true page count in a single document load.
 * NOTE: pdf.js transfers the underlying ArrayBuffer to its worker — the
 * caller's `pdfBytes` is detached afterwards. Pass a copy if you still need it.
 */
/// Called once per page as extraction advances. `pages` is the number of
/// pages this run will actually visit (so it honors `maxPages`), which makes
/// `page / pages` a usable fraction from the very first tick.
export type PageProgress = (page: number, pages: number) => void;

export async function extractDocument(
  pdfBytes: Uint8Array,
  maxPages?: number,
  onProgress?: PageProgress,
): Promise<{ lines: RawLine[]; pageCount: number }> {
  const pdf = await getDocument({ data: pdfBytes }).promise;
  const allLines: RawLine[] = [];

  const lastPage = maxPages ? Math.min(pdf.numPages, maxPages) : pdf.numPages;
  for (let pageNum = 1; pageNum <= lastPage; pageNum++) {
    const page = await pdf.getPage(pageNum);
    const viewport = page.getViewport({ scale: 1.0 });
    const textContent = await page.getTextContent();
    await stampFontStyles(page, textContent.items);

    const pageLines = groupItemsIntoLines(textContent.items, viewport.width, pageNum);
    allLines.push(...pageLines);
    // After the work, not before: a tick means "page N is done", so the
    // fraction never claims progress the parser has not actually made.
    onProgress?.(pageNum, lastPage);
  }

  return { lines: allLines, pageCount: pdf.numPages };
}

interface TextItem {
  str: string;
  transform: number[];
  fontName?: string;
  italic?: boolean;
  bold?: boolean;
  /** actual rendered width from pdf.js — much more accurate than the
   * len*6 estimate (which false-splits names like "Marlowe" → "Mar lowe") */
  width?: number;
}

const endX = (item: TextItem) => item.transform[4] + (item.width ?? item.str.length * 6);

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

  // Group items by Y coordinate, clustering within a small tolerance —
  // baselines drift inside one visual line (one generator prints "(CONT'D)"
  // a point above its cue name) while real line spacing is ~12pt.
  const Y_TOLERANCE = 2;
  const clusters: { y: number; items: TextItem[] }[] = [];
  for (const item of [...textItems].sort((a, b) => b.transform[5] - a.transform[5])) {
    const last = clusters[clusters.length - 1];
    if (last && last.y - item.transform[5] <= Y_TOLERANCE) {
      last.items.push(item);
    } else {
      clusters.push({ y: item.transform[5], items: [item] });
    }
  }

  // Right-margin zone where revision stars live (Final Draft puts them at
  // ~94% of page width). Star-only items there are production markup, not
  // text — left in, a bare "*" line classifies as action and resets the
  // active-character context, fragmenting revised dialogue.
  const revisionMarginX = pageWidth * 0.8;

  const lines: LineItems[] = [];
  for (const { y, items: clusterItems } of clusters) {
    // Drop empty items (marked-content markers) and right-margin revision
    // stars — both would corrupt joining/classification below.
    const lineItems = clusterItems
      .filter((item) => item.str !== '')
      .filter((item) => !(/^\*+$/.test(item.str) && item.transform[4] >= revisionMarginX));
    if (lineItems.length === 0) continue;
    lineItems.sort((a, b) => a.transform[4] - b.transform[4]);
    lines.push({ y: Math.round(y), items: lineItems });
  }

  return deinterleaveDualDialogue(lines, pageWidth, pageNum);
}

interface LineItems {
  y: number;
  items: TextItem[];
}

/**
 * Mark each item bold/italic from its font's PostScript name (e.g.
 * "CourierPrime-Italic"). getOperatorList() forces font resolution into
 * page.commonObjs — getTextContent alone doesn't load fonts. Best-effort:
 * failures leave items unstyled.
 */
async function stampFontStyles(
  page: { getOperatorList(): Promise<unknown>; commonObjs: { get(id: string): unknown } },
  items: unknown[],
): Promise<void> {
  try {
    await page.getOperatorList();
  } catch {
    return;
  }
  const byFont = new Map<string, { italic: boolean; bold: boolean }>();
  for (const raw of items) {
    const item = raw as TextItem;
    if (!item.fontName || byFont.has(item.fontName)) continue;
    let flags = { italic: false, bold: false };
    try {
      const font = page.commonObjs.get(item.fontName) as { name?: string } | null;
      const name = String(font?.name ?? '');
      flags = { italic: /italic|oblique/i.test(name), bold: /bold|black|heavy/i.test(name) };
    } catch {
      // unresolved font — leave plain
    }
    byFont.set(item.fontName, flags);
  }
  for (const raw of items) {
    const item = raw as TextItem;
    const flags = item.fontName ? byFont.get(item.fontName) : undefined;
    if (flags) {
      item.italic = flags.italic;
      item.bold = flags.bold;
    }
  }
}

/** Join sorted items into text: spaces at >5pt gaps, exact-overlap dedup
 * (Final Draft double-prints (MORE)/(CONT'D) furniture). */
function joinItems(items: TextItem[]): string {
  let text = '';
  let prevEndX = -1;
  let prevX = Number.NaN;
  let prevStr = '';

  for (const item of items) {
    const x = item.transform[4];
    if (item.str === prevStr && Math.abs(x - prevX) < 2) {
      continue;
    }
    if (prevEndX >= 0 && x - prevEndX > 5) {
      text += ' ';
    }
    text += item.str;
    prevEndX = endX(item);
    prevX = x;
    prevStr = item.str;
  }
  // Items carry their own padding (italic spans especially) — collapse
  // runs so the fountain matches what HTML whitespace-collapsing renders.
  return text.replace(/ {2,}/g, ' ').trim();
}

const EMPHASIS_MARK: Record<string, string> = { i: '*', b: '**', bi: '***' };

/**
 * Join a line producing both plain text and (when fonts vary) a styled
 * variant with fountain emphasis markers. Punctuation-only items never
 * carry style — a lone italic comma must not become "*,*".
 */
function joinLine(items: TextItem[]): { text: string; styled?: string } {
  interface Run { str: string; gapBefore: boolean; style: string }
  const runs: Run[] = [];
  let prevEndX = -1;
  let prevX = Number.NaN;
  let prevStr = '';
  for (const item of items) {
    const x = item.transform[4];
    if (item.str === prevStr && Math.abs(x - prevX) < 2) continue;
    const hasWord = /[\p{L}\p{N}]{2}/u.test(item.str);
    const style = hasWord ? `${item.bold ? 'b' : ''}${item.italic ? 'i' : ''}` : '';
    runs.push({ str: item.str, gapBefore: prevEndX >= 0 && x - prevEndX > 5, style });
    prevEndX = endX(item);
    prevX = x;
    prevStr = item.str;
  }

  let plain = '';
  for (const r of runs) plain += (r.gapBefore && plain ? ' ' : '') + r.str;
  plain = plain.replace(/ {2,}/g, ' ').trim();
  if (!runs.some((r) => r.style)) return { text: plain };

  const groups: { style: string; text: string }[] = [];
  for (const r of runs) {
    const piece = (r.gapBefore ? ' ' : '') + r.str;
    const last = groups[groups.length - 1];
    if (last && last.style === r.style) last.text += piece;
    else groups.push({ style: r.style, text: piece });
  }
  let styled = '';
  for (const g of groups) {
    const clean = g.text.replace(/ {2,}/g, ' ');
    const core = clean.trim();
    if (!g.style || !core) {
      styled += clean;
      continue;
    }
    const mark = EMPHASIS_MARK[g.style] ?? '*';
    const lead = clean.match(/^\s*/)![0];
    const trail = clean.match(/\s*$/)![0];
    styled += `${lead}${mark}${core}${mark}${trail}`;
  }
  styled = styled.replace(/ {2,}/g, ' ').trim();
  return { text: plain, styled: styled !== plain ? styled : undefined };
}

interface ClusterSplit {
  leftText: string;
  rightText: string;
  leftItems: TextItem[];
  rightItems: TextItem[];
}

/** Split a line's items at the widest internal gap into two columns, when
 * the geometry looks like side-by-side text. Reliable only on short lines
 * (cue pairs) — long body lines close the gap, see the boundary pass. */
function clusterSplit(items: TextItem[], pageWidth: number): ClusterSplit | null {
  if (items.length < 2) return null;
  let gapIdx = -1;
  let gapSize = 0;
  for (let i = 1; i < items.length; i++) {
    const gap = items[i].transform[4] - endX(items[i - 1]);
    if (gap > gapSize) {
      gapSize = gap;
      gapIdx = i;
    }
  }
  if (gapIdx < 0 || gapSize < pageWidth * 0.12) return null;
  const left = items.slice(0, gapIdx);
  const right = items.slice(gapIdx);
  if (left[0].transform[4] > pageWidth * 0.42) return null;
  if (right[0].transform[4] < pageWidth * 0.48) return null;
  const leftText = joinItems(left);
  const rightText = joinItems(right);
  if (!leftText || !rightText) return null;
  return { leftText, rightText, leftItems: left, rightItems: right };
}

/** A short, overwhelmingly-uppercase run — the shape of a character cue.
 * Excludes title-page furniture (emails, dates, phone numbers). */
function isCueShaped(text: string): boolean {
  const t = text.trim();
  if (t.length < 2 || t.length > 35) return false;
  const letters = t.match(/\p{L}/gu) ?? [];
  if (letters.length < 2) return false;
  const uppers = t.match(/[A-Z]/g) ?? [];
  return uppers.length / letters.length >= 0.8;
}

// Synthetic indents for de-interleaved dual-dialogue lines: standard cue
// and dialogue zones so the classifier treats each column as an ordinary
// sequential speech.
const DUAL_CUE_INDENT = 40;
const DUAL_BODY_INDENT = 30;

/**
 * Dual dialogue prints two speeches in side-by-side columns. Y-joining
 * would interleave them into garbage, so: detect regions anchored by a
 * dual-cue line (two cue-shaped clusters), collect each column, and emit
 * the left speech followed by the right speech as normal-looking lines.
 */
function deinterleaveDualDialogue(
  lines: LineItems[],
  pageWidth: number,
  pageNum: number
): RawLine[] {
  const out: RawLine[] = [];
  let i = 0;

  while (i < lines.length) {
    const split = clusterSplit(lines[i].items, pageWidth);
    const isDualCue = split !== null && isCueShaped(split.leftText) && isCueShaped(split.rightText);

    if (!isDualCue) {
      // Shooting scripts print the scene number in BOTH margins on the
      // same row — collapse "2   2" / "12A.  12A." to a single token so
      // it classifies and attaches as one scene number.
      const joined = joinLine(lines[i].items);
      const text = joined.text.replace(/^(\d+[A-Z]?\.?)\s+\1$/, '$1');
      if (text) {
        const indent = Math.round((lines[i].items[0].transform[4] / pageWidth) * 100);
        const styled = text === joined.text ? joined.styled : undefined;
        out.push({ text, indent, y: lines[i].y, pageNum, styled });
      }
      i++;
      continue;
    }

    // Dual region. Body lines are partitioned against a column boundary
    // rather than per-line gaps (long lines close the gap between the
    // columns). Geometry facts that shape this: cues sit ~1.2" deeper than
    // their column's text on BOTH sides, and the left column can start at
    // the action margin — so the boundary starts at rightCueX minus that
    // cue offset and refines to the right column's actual text edge as
    // soon as a body line splits cleanly on its own gap.
    let boundary = split.rightItems[0].transform[4] - pageWidth * 0.13;
    let leftBodyMinX: number | null = null;

    const ys: number[] = [lines[i].y];
    const left: string[] = [split.leftText];
    const right: string[] = [split.rightText];
    i++;
    while (i < lines.length) {
      const items = lines[i].items;
      const straddles = items.some(
        (it) => it.transform[4] < boundary - 6 && endX(it) > boundary + 6,
      );
      if (straddles) break; // full-width line — region over

      // Refine toward the right column's true text edge — only ever move
      // LEFT: indented lines (parentheticals) start deeper in the column
      // and must not drag the boundary onto normal dialogue lines.
      const gapSplit = clusterSplit(items, pageWidth);
      if (gapSplit) boundary = Math.min(boundary, gapSplit.rightItems[0].transform[4] - 6);

      const leftItems = items.filter((it) => it.transform[4] < boundary);
      const rightItems = items.filter((it) => it.transform[4] >= boundary);
      const leftText = joinItems(leftItems);
      const rightText = joinItems(rightItems);

      if (leftText && rightText && isCueShaped(leftText) && isCueShaped(rightText)) {
        break; // next simultaneous exchange — new region anchors here
      }
      if (leftText && !rightText && isCueShaped(leftText)) {
        break; // a normal cue or slugline — back to single-column flow
      }
      if (leftText && leftBodyMinX !== null && leftItems[0].transform[4] < leftBodyMinX - 24) {
        break; // text left of the established column edge — not column text
      }

      if (leftText) {
        left.push(leftText);
        leftBodyMinX = Math.min(leftBodyMinX ?? Infinity, leftItems[0].transform[4]);
      }
      if (rightText) right.push(rightText);
      ys.push(lines[i].y);
      i++;
    }

    for (const column of [left, right]) {
      column.forEach((text, k) => {
        if (!text) return;
        out.push({
          text,
          indent: k === 0 ? DUAL_CUE_INDENT : DUAL_BODY_INDENT,
          y: ys[Math.min(k, ys.length - 1)],
          pageNum,
          // the right column's cue marks the pair for fountain's ^ syntax
          dualRight: column === right && k === 0 ? true : undefined,
        });
      });
    }
  }

  return out;
}

