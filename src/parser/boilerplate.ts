/**
 * Production-draft page furniture — watermarks, revision slugs, draft stamps,
 * page marks — routed into the "page-number" element type, which every
 * consumer (playback batching, RSVP, emotion inference, reader display)
 * already skips. Elements are re-typed, never removed, so indices/resume
 * positions/audio hashes are untouched. Spec: 2026-07-21 design doc.
 */
import type { ScreenplayElement } from './types';

const COLOR = '(?:\\d+(?:st|nd|rd|th)\\s+)?(?:white|blue|pink|yellow|green|goldenrod|buff|salmon|cherry|tan|gray|grey)';
const DATE = '\\(?\\s*(?:\\d{1,2}[\\/.-]\\d{1,2}[\\/.-]\\d{2,4}|mm\\/dd\\/yy)\\s*\\)?';
const PAGE_MARK = '[A-Z]?\\d{1,3}\\.(?:\\d{1,3})?';
// A color word alone is never a slug (color-named character cues like
// "CHERRY" must survive) — it needs a Rev./Revision suffix or a date.
const REV_SLUG = `${COLOR}\\s*(?:rev(?:ision)?\\.?\\s*(?:${DATE})?|${DATE})`;
const DRAFT_STAMP =
  '(?:(?:first|second|third|fourth|fifth|final|revised|production|network|studio)\\s+draft|shooting\\s+script|production\\s+draft)';

// A line is boilerplate only when slugs/stamps/dates/page-marks consume the
// WHOLE line (any repetition, any order) — a sentence containing these words
// never matches.
const BOILERPLATE_LINE = new RegExp(
  `^(?:\\s*(?:${REV_SLUG}|${DRAFT_STAMP}|${DATE}|${PAGE_MARK})[\\s—–-]*)+$`,
  'i',
);

/** Pattern layer: revision slugs, draft stamps, header dates, page marks. */
export function isBoilerplateLine(text: string): boolean {
  const t = text.trim();
  if (!t || t.length > 120) return false;
  return BOILERPLATE_LINE.test(t);
}

/** Candidates for recurrence suppression: short standalone non-dialogue lines. */
const RECUR_MAX_LEN = 60;
const RECUR_MIN_PAGES = 3;
const RECUR_PAGE_FRACTION = 0.4;

/**
 * Recurrence layer (the watermark killer): any candidate whose normalized
 * text appears on >= max(3, 40% of pages) distinct pages is re-typed to
 * "page-number". Pure and idempotent; never mutates its input.
 */
export function suppressBoilerplate(
  elements: ScreenplayElement[],
  pageCount: number,
): ScreenplayElement[] {
  const threshold = Math.max(RECUR_MIN_PAGES, Math.ceil(pageCount * RECUR_PAGE_FRACTION));
  const pagesByText = new Map<string, Set<number>>();
  const isCandidate = (e: ScreenplayElement) =>
    (e.type === 'action' || e.type === 'page-number') &&
    e.text.trim().length > 0 &&
    e.text.trim().length <= RECUR_MAX_LEN;
  const norm = (s: string) => s.trim().replace(/\s+/g, ' ').toLowerCase();

  for (const e of elements) {
    if (!isCandidate(e)) continue;
    const key = norm(e.text);
    let pages = pagesByText.get(key);
    if (!pages) pagesByText.set(key, (pages = new Set()));
    pages.add(e.pageNum);
  }

  return elements.map((e) => {
    if (e.type !== 'action') return e;
    // Pattern layer: slugs embedding per-page-varying page marks never recur
    // verbatim, so the recurrence count alone misses them — catch directly.
    if (isBoilerplateLine(e.text)) return { ...e, type: 'page-number' as const };
    if (!isCandidate(e)) return e;
    const pages = pagesByText.get(norm(e.text));
    return pages && pages.size >= threshold ? { ...e, type: 'page-number' as const } : e;
  });
}
