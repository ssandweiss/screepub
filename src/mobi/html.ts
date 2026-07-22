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
  const closeSpeech = () => {
    if (speech) {
      out.push(`<blockquote>${speech.join('<br/>')}</blockquote>`);
      speech = null;
    }
  };

  for (const t of tokens.filter((t) => !t.is_title)) {
    const text = t.text ?? '';
    switch (t.type) {
      case 'scene_heading':
        closeSpeech();
        out.push(`<p><b>${esc(text)}</b></p>`);
        break;
      case 'action':
      case 'lyrics':
        closeSpeech();
        out.push(`<p>${inline(esc(text))}</p>`);
        break;
      case 'dialogue_begin':
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
        closeSpeech();
        break;
      case 'transition':
        closeSpeech();
        out.push(`<p align="right">${esc(text.replace(/^>\s*/, ''))}</p>`);
        break;
      case 'centered':
        closeSpeech();
        out.push(`<center>${esc(text)}</center>`);
        break;
      case 'synopsis': {
        const pg = /^pg\s+(\S+)$/.exec(text.trim());
        if (pg) {
          closeSpeech();
          out.push(`<p align="right"><font size="-2">${esc(pg[1])}.</font></p>`);
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
