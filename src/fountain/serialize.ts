// ScreenplayElement[] → Fountain text.
// Fountain forcing syntax is used defensively (@cue, > transition, !action)
// so fountain-js re-parses our output without relying on its own guesswork.
import type { ParsedScreenplay, ScreenplayElement } from '../parser/types';

export interface TitleMeta {
  title?: string;
  author?: string;
}

const BY_LINE = /\b(written by|screenplay by|by)\b/i;
const MORE_PAREN = /^\(\s*MORE\s*\)$/i;
const CONTD = /\(\s*CONT'?D\.?\s*\)/i;
// Leading chars that carry Fountain meaning at line start; ! forces action.
const NEEDS_FORCE = /^[!.>=~@#]/;

/** Title-case an ALL-CAPS string; leave mixed-case text untouched. */
function humanizeCaps(text: string): string {
  if (text !== text.toUpperCase()) return text;
  return text
    .toLowerCase()
    .replace(/\b\p{L}/gu, (c) => c.toUpperCase());
}

/**
 * Pull title/author from detected title-page elements: readable elements
 * before the by-line form the title, the first readable element after it
 * (or the by-line's own remainder) is the author.
 */
export function extractTitleMeta(elements: ScreenplayElement[]): TitleMeta {
  const titlePage = elements.filter((el) => el.isTitlePage && el.isReadable);
  if (titlePage.length === 0) return {};

  const byIdx = titlePage.findIndex((el) => BY_LINE.test(el.text));
  if (byIdx === -1) {
    return { title: humanizeCaps(titlePage[0].text.trim()) };
  }

  const titleParts = titlePage.slice(0, byIdx).map((el) => el.text.trim()).filter(Boolean);
  const title = titleParts.length > 0 ? humanizeCaps(titleParts.join(' ')) : undefined;

  // Author inline in the by-line ("written by Jane Doe") or the next element.
  const byText = titlePage[byIdx].text;
  const match = BY_LINE.exec(byText)!;
  const inline = byText
    .slice(match.index + match[1].length)
    .replace(/^[\s/:–—-]+/, '')
    .trim();
  const author = inline || titlePage[byIdx + 1]?.text.trim() || undefined;

  return { title, author };
}

/** True when this element belongs in the Fountain body. */
function isBody(el: ScreenplayElement): boolean {
  return !el.isTitlePage && el.isReadable && el.type !== 'page-number';
}

/**
 * Pre-passes over body elements:
 * 1. drop "(MORE)" page-break markers;
 * 2. drop "(CONT'D)" cues that directly continue the previous speech
 *    (page-break splits) so the dialogue rejoins as one speech;
 * 3. demote cues with no following dialogue to action.
 */
function prepare(elements: ScreenplayElement[]): ScreenplayElement[] {
  const body = elements.filter(isBody).filter((el) => !(el.type === 'parenthetical' && MORE_PAREN.test(el.text)));

  const merged: ScreenplayElement[] = [];
  for (const el of body) {
    const prev = merged[merged.length - 1];
    if (
      el.type === 'character' &&
      CONTD.test(el.text) &&
      prev &&
      (prev.type === 'dialogue' || prev.type === 'parenthetical') &&
      prev.character === el.character
    ) {
      continue; // same speech continues — drop the repeated cue
    }
    merged.push(el);
  }

  return merged.map((el, i) => {
    const next = merged[i + 1];
    if (el.type === 'character' && !(next && (next.type === 'dialogue' || next.type === 'parenthetical'))) {
      return { ...el, type: 'action' as const };
    }
    return el;
  });
}

/** Serialize a parsed screenplay to Fountain text. */
export function toFountain(screenplay: ParsedScreenplay, meta?: TitleMeta): string {
  const out: string[] = [];

  if (meta?.title || meta?.author) {
    const head: string[] = [];
    if (meta.title) head.push(`Title: ${meta.title}`);
    if (meta.author) {
      head.push('Credit: Written by');
      head.push(`Author: ${meta.author}`);
    }
    out.push(head.join('\n'));
  }

  // Blocks joined by blank lines; an open dialogue block accumulates
  // cue/parenthetical/dialogue lines until a non-dialogue element closes it.
  let block: string[] | null = null;
  const closeBlock = () => {
    if (block && block.length > 0) out.push(block.join('\n'));
    block = null;
  };

  for (const el of prepare(screenplay.elements)) {
    const text = el.text.trim();
    if (!text) continue;

    switch (el.type) {
      case 'character':
        closeBlock();
        block = [`@${text}`];
        break;
      case 'parenthetical':
      case 'dialogue':
        if (block) {
          block.push(text);
        } else {
          out.push(text); // stray dialogue without a cue reads as action
        }
        break;
      case 'scene':
        closeBlock();
        out.push(el.sceneNumber ? `${text} #${el.sceneNumber}#` : text);
        break;
      case 'transition':
        closeBlock();
        out.push(`> ${text}`);
        break;
      default: // action, mini-slug
        closeBlock();
        out.push(NEEDS_FORCE.test(text) ? `!${text}` : text);
    }
  }
  closeBlock();

  return out.join('\n\n') + '\n';
}
