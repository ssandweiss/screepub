import type { ScreenplayElement } from './types';

const BY_LINE = /\b(by|written by|screenplay by)\b/i;
const CONTACT_INFO = /(email|phone|@|\.com|draft|copyright|©|wga|all rights|production)/i;

/**
 * Detect title pages and front matter.
 * Everything before the first scene heading is analyzed.
 * Page 1: title + author readable, contact info skipped.
 * Pages 2+ before first scene: front matter, all readable.
 */
export function detectTitlePages(elements: ScreenplayElement[]): ScreenplayElement[] {
  const firstSceneIdx = elements.findIndex((el) => el.type === 'scene');
  if (firstSceneIdx <= 0) return elements;

  const result = [...elements];
  let foundByLine = false;

  for (let i = 0; i < firstSceneIdx; i++) {
    const el = result[i];
    const isPage1 = el.pageNum === 1;

    if (isPage1) {
      // Title page logic
      if (!foundByLine) {
        // Title and "by" line are readable
        if (BY_LINE.test(el.text)) foundByLine = true;
        result[i] = { ...el, isTitlePage: true, isReadable: true };
      } else {
        // After "by" line: skip contact info
        const isContact = CONTACT_INFO.test(el.text);
        result[i] = { ...el, isTitlePage: true, isReadable: !isContact };
      }
    } else {
      // Pages 2+ before first scene: front matter (dedications, quotes)
      result[i] = { ...el, isTitlePage: false, isReadable: true };
    }
  }

  return result;
}
