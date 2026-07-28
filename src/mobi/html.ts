// fountain-js tokens → MOBI 6 HTML. The old MOBI renderer speaks a small
// HTML-3.2-ish dialect: no CSS, indents via <blockquote>, alignment via
// attributes. Screenplay mapping keeps structure readable on e-ink:
// bold sluglines, blockquoted speeches with bold cues, right-flush
// transitions. (The EPUB path stays the high-fidelity rendering; this is
// the dependency-free USB sideload format.)
import type { Token } from 'fountain-js';

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

export function tokensToMobiHtml(tokens: Token[], meta: MobiMeta): string {
  const out: string[] = [];
  out.push('<html><head></head><body>');

  // Title page
  out.push('<center>');
  out.push(`<br/><br/><br/><b><font size="+2">${esc(meta.title)}</font></b>`);
  if (meta.author) out.push(`<br/><br/>Written by<br/>${esc(meta.author)}`);
  out.push('</center>');
  out.push('<mbp:pagebreak/>');

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
      case 'scene_heading':
        closeSpeech();
        push(`<p><b>${esc(text)}</b></p>`);
        break;
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
