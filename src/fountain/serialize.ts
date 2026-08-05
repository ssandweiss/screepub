// ScreenplayElement[] → Fountain text.
// Fountain forcing syntax is used defensively (@cue, > transition, !action)
// so fountain-js re-parses our output without relying on its own guesswork.
import type { ParsedScreenplay, ScreenplayElement } from '../parser/types';
import type { FormatOptions } from '../options';
import { DEFAULT_FORMAT_OPTIONS } from '../options';

export interface TitleMeta {
  title?: string;
  author?: string;
}

const BY_LINE = /\b(written by|screenplay by|by)\b/i;
const MORE_PAREN = /^\(\s*MORE\s*\)$/i;
const CONTD = /\(\s*CONT['’]?D\.?\s*\)/i;
// Leading chars that carry Fountain meaning at line start; ! forces action.
const NEEDS_FORCE = /^[!.>=~@#]/;

/**
 * A block's font shift as a Fountain note (registry #18).
 *
 * Notes are the one channel the format guarantees is BOTH lossless through a
 * tokenizer and invisible in output, so a tool that has never heard of
 * Screepub ignores this and a reader never sees it. Emitted unconditionally:
 * the `.fountain` is the app's cache boundary, so it must be byte-stable under
 * settings flips — `preserveFontShifts` gates rendering, not serialization.
 */
function fmtNote(fmt: ScreenplayElement['fmt']): string | null {
  if (!fmt) return null;
  const parts = [fmt.family, fmt.size].filter(Boolean);
  return parts.length > 0 ? `[[fmt: ${parts.join(' ')}]]` : null;
}

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
function prepare(elements: ScreenplayElement[], rejoin: boolean): ScreenplayElement[] {
  // "(MORE)" page-break markers can classify as parenthetical, action, or
  // dialogue depending on the template's indents — drop them by text alone.
  const body = elements.filter(isBody).filter((el) => !MORE_PAREN.test(el.text.trim()));

  const merged: ScreenplayElement[] = [];
  for (const el of body) {
    const prev = merged[merged.length - 1];
    if (
      rejoin &&
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

/**
 * Sheet→printed-page offset: the PDF's own printed page numbers (stripped
 * as furniture but still typed 'page-number') anchor the numbering, so
 * markers match the script's pagination — the title page never counts.
 * The mode wins because margin scene numbers pollute with random offsets.
 */
function printedPageOffset(elements: ScreenplayElement[]): number | null {
  const counts = new Map<number, number>();
  for (const el of elements) {
    if (el.type !== 'page-number') continue;
    const m = /^(\d{1,3})\.?$/.exec(el.text.trim());
    if (!m) continue;
    const offset = parseInt(m[1], 10) - el.pageNum;
    counts.set(offset, (counts.get(offset) ?? 0) + 1);
  }
  let best: number | null = null;
  let bestCount = 0;
  for (const [offset, count] of counts) {
    if (count > bestCount) {
      best = offset;
      bestCount = count;
    }
  }
  return best;
}

/** Serialize a parsed screenplay to Fountain text. */
export function toFountain(
  screenplay: ParsedScreenplay,
  meta?: TitleMeta,
  format: FormatOptions = DEFAULT_FORMAT_OPTIONS,
): string {
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

  const pageOffset = format.showPageMarkers ? printedPageOffset(screenplay.elements) ?? 0 : 0;
  let lastMarkedPage = Number.NEGATIVE_INFINITY;

  // Blocks joined by blank lines; an open dialogue block accumulates
  // cue/parenthetical/dialogue lines until a non-dialogue element closes it.
  // lastSpeaker powers contdMode 'auto': same speaker continuing through
  // action gets (CONT'D); scene and transition boundaries reset it.
  let lastSpeaker: string | null = null;
  let block: string[] | null = null;
  const closeBlock = () => {
    if (block && block.length > 0) out.push(block.join('\n'));
    block = null;
  };

  for (const el of prepare(screenplay.elements, format.rejoinSplitDialogue)) {
    const text = el.text.trim();
    if (!text) continue;

    // Page markers land only at block boundaries — never inside a speech
    // (a page turning mid-speech defers its marker to the next block).
    if (
      format.showPageMarkers &&
      el.type !== 'dialogue' &&
      el.type !== 'parenthetical' &&
      el.pageNum > lastMarkedPage
    ) {
      const label = el.pageNum + pageOffset;
      if (label >= 1 && lastMarkedPage !== Number.NEGATIVE_INFINITY) {
        closeBlock();
        out.push(`= pg ${label}`);
      }
      lastMarkedPage = el.pageNum;
    }

    switch (el.type) {
      case 'character': {
        closeBlock();
        let cueText = text.replace(/\s+/g, ' ');
        if (format.contdMode !== 'keep') {
          cueText = cueText.replace(CONTD, '').replace(/\s+/g, ' ').trim();
          if (format.contdMode === 'auto' && el.character && el.character === lastSpeaker) {
            cueText = `${cueText} (CONT'D)`;
          }
        }
        const caret = el.dualRight && format.dualDialogue === 'sideBySide' ? ' ^' : '';
        block = [`@${cueText}${caret}`];
        lastSpeaker = el.character ?? null;
        break;
      }
      case 'parenthetical':
        // markers would break "(...)" recognition — always plain
        if (block) block.push(text);
        else out.push(text);
        break;
      case 'dialogue': {
        const line = (el.styledText ?? el.text).trim();
        const note = fmtNote(el.fmt);
        const withNote = note ? `${note} ${line}` : line;
        if (block) block.push(withNote);
        else out.push(withNote); // stray dialogue without a cue reads as action
        break;
      }
      case 'scene':
        closeBlock();
        lastSpeaker = null;
        out.push(el.sceneNumber ? `${text} #${el.sceneNumber}#` : text);
        break;
      case 'transition':
        closeBlock();
        lastSpeaker = null;
        out.push(`> ${text}`);
        break;
      case 'mini-slug':
        // A secondary slugline ("LATER", "THE KITCHEN") is a heading, and
        // Fountain's word for a heading that doesn't open INT./EXT. is the
        // forced form. Plain text would not survive the round trip: bare
        // "LATER" re-parses as action (the mini-slug styling never applied)
        // and "BACK TO:" as a transition. Stays PLAIN — emphasis markers
        // would break slug recognition, same rule as cues and parentheticals.
        //
        // A LEADING DOT is the only text the dot-force can't carry
        // (fountain-js's rule is `^\s*\.(?!\.+)`), so ".45 ON THE COUNTER"
        // falls back to forced action; every other marker rides through the
        // dot intact and keeps its heading treatment.
        //
        // Resets lastSpeaker like scene and transition do: a mini-slug is a
        // cut in time or place, so the speaker after it is starting fresh
        // and must not inherit a (CONT'D) from before it (#8a).
        closeBlock();
        lastSpeaker = null;
        out.push(/^\./.test(text) ? `!${text}` : `.${text}`);
        break;
      default: {
        // action — the only type left, and the only one here besides dialogue
        // allowed to carry a styled variant or an fmt note (a future type
        // falls back to plain and unmarked).
        closeBlock();
        const body = el.type === 'action' ? (el.styledText ?? el.text).trim() : text;
        const forced = NEEDS_FORCE.test(body) ? `!${body}` : body;
        const note = el.type === 'action' ? fmtNote(el.fmt) : null;
        // Glued directly above with a single newline and NO blank line: that
        // is what makes fountain-js fold the note into the block's own token
        // instead of emitting a standalone one.
        out.push(note ? `${note}\n${forced}` : forced);
      }
    }
  }
  closeBlock();

  return out.join('\n\n') + '\n';
}
