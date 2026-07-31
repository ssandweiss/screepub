// fountain-js tokens → MOBI 6 HTML. The old MOBI renderer speaks a small
// HTML-3.2-ish dialect: no CSS, indents via <blockquote>, alignment via
// attributes. Screenplay mapping keeps structure readable on e-ink:
// bold sluglines, blockquoted speeches with bold cues, right-flush
// transitions. (The EPUB path stays the high-fidelity rendering; this is
// the dependency-free USB sideload format.)
// This dialect has exactly one fragmentation primitive: <mbp:pagebreak/>.
// It is wired to scenePageBreaks (registry #1), before PRIMARY scene
// headings only — a mini-slug is a micro-heading inside the current
// scene, not a new scene (registry #5b), so breaking before one would be
// wrong the same way it would be in the EPUB's section.scene handling.
// The other knob this dialect reads is includeTitlePage (#11). What it
// cannot reach is the CSS ones: it ships no stylesheet (#8c), so every
// keep, margin and alignment knob is EPUB territory. Stage-1 knobs (#8,
// #8a, #10a's mode, #13a's markers) arrive already baked into the
// .fountain and need nothing here.
import type { Token } from 'fountain-js';
import type { FormatOptions } from '../options';
import { isMiniSlug } from '../fountain/slug';

export interface MobiMeta {
  title: string;
  author?: string;
}

function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Fountain inline emphasis → old-MOBI tags, applied AFTER escaping. */
function inline(escaped: string): string {
  return escaped
    .replace(/\*\*\*(?!\s)([^*]+?)(?<!\s)\*\*\*/g, '<b><i>$1</i></b>')
    .replace(/\*\*(?!\s)([^*]+?)(?<!\s)\*\*/g, '<b>$1</b>')
    .replace(/\*(?!\s)([^*]+?)(?<!\s)\*/g, '<i>$1</i>')
    .replace(/_(?!\s)([^_]+?)(?<!\s)_/g, '<u>$1</u>');
}

export function tokensToMobiHtml(
  tokens: Token[],
  meta: MobiMeta,
  format: FormatOptions,
): string {
  const out: string[] = [];
  out.push('<html><head></head><body>');

  // Body content emitted since the last page break. It gates the scene
  // break below: a break is only wanted where there is something to break
  // AWAY from, so the first scene of a book gets none (the title page's
  // own break, or the start of the file, already put it at the top of a
  // page) while a scene that follows opening action does — matching the
  // EPUB, where section.scene's page-break-before separates exactly that.
  let sinceBreak = false;
  const breakPage = () => {
    out.push('<mbp:pagebreak/>');
    sinceBreak = false;
  };

  // Title page (registry #11's MOBI arm — gated like the EPUB's, which
  // drops the file, its manifest item, spine itemref and nav landmark).
  if (format.includeTitlePage) {
    out.push('<center>');
    out.push(`<br/><br/><br/><b><font size="+2">${esc(meta.title)}</font></b>`);
    if (meta.author) out.push(`<br/><br/>Written by<br/>${esc(meta.author)}`);
    out.push('</center>');
    breakPage();
  }

  // Body: dialogue blocks accumulate into a single <blockquote>.
  let speech: string[] | null = null;
  let dual: { left: string[]; right: string[]; side: 'left' | 'right' } | null = null;
  // Page markers ride inside the NEXT block instead of taking a line of
  // their own — same rule as the EPUB, minus the EPUB3 semantics (no
  // epub:type/role/id here). There is no stylesheet in this dialect to hang
  // a float on, so the number reads as a small prefix at the head of the
  // block; <font size="-2"> is how this file expresses "small".
  let pendingMarker: string | null = null;
  const push = (s: string) => {
    if (pendingMarker) {
      const open = /^<(p|blockquote|center|table|div|h[1-6])\b[^>]*>/.exec(s);
      if (open) {
        s = s.slice(0, open[0].length) + pendingMarker + s.slice(open[0].length);
        pendingMarker = null;
      }
    }
    out.push(s);
    sinceBreak = true;
  };
  const closeSpeech = () => {
    if (speech) {
      push(`<blockquote>${speech.join('<br/>')}</blockquote>`);
      speech = null;
    }
  };

  for (const t of tokens.filter((t) => !t.is_title)) {
    const text = t.text ?? '';
    switch (t.type) {
      case 'scene_heading': {
        closeSpeech();
        // The only break primitive this dialect has (registry #1's MOBI
        // arm), and only before a PRIMARY scene heading — a mini-slug
        // stays inside the scene it appears in (registry #5b). breakPage,
        // not push(): a pending page marker belongs to the heading block,
        // never to the break itself.
        if (format.scenePageBreaks && !isMiniSlug(t) && sinceBreak) breakPage();
        push(`<p><b>${esc(text)}</b></p>`);
        break;
      }
      case 'action':
      case 'lyrics':
        closeSpeech();
        push(`<p>${inline(esc(text))}</p>`);
        break;
      case 'dual_dialogue_begin':
        dual = { left: [], right: [], side: 'left' };
        break;
      case 'dual_dialogue_end':
        if (dual) {
          push(
            `<table width="100%"><tr><td width="50%">${dual.left.join('<br/>')}</td><td width="50%">${dual.right.join('<br/>')}</td></tr></table>`,
          );
          dual = null;
        }
        break;
      case 'dialogue_begin':
        if (dual) dual.side = (t as { dual?: string }).dual === 'right' ? 'right' : 'left';
        speech = [];
        break;
      case 'character':
        if (speech) speech.push(`<b>${esc(text)}</b>`);
        break;
      case 'parenthetical':
        if (speech) speech.push(`<i>${esc(text)}</i>`);
        break;
      case 'dialogue':
        if (speech) speech.push(inline(esc(text)).replace(/\n/g, '<br/>'));
        break;
      case 'dialogue_end':
        if (dual && speech) {
          dual[dual.side].push(...speech);
          speech = null;
        } else {
          closeSpeech();
        }
        break;
      case 'transition':
        closeSpeech();
        push(`<p align="right">${esc(text.replace(/^>\s*/, ''))}</p>`);
        break;
      case 'centered':
        closeSpeech();
        push(`<center>${esc(text)}</center>`);
        break;
      case 'synopsis': {
        // Emits no block of its own: it waits for the next one. That also
        // means a marker no longer splits a speech's blockquote in two.
        const pg = /^pg\s+(\S+)$/.exec(text.trim());
        if (pg) {
          pendingMarker = `<span class="page-marker"><font size="-2">${esc(pg[1])}.</font></span>`;
        }
        break;
      }
      default:
        break;
    }
  }
  closeSpeech();

  out.push('</body></html>');
  return out.join('\n');
}
