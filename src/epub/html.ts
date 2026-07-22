// fountain-js tokens → XHTML chapters, one chapter per scene heading.
import type { Token } from 'fountain-js';

export interface Chapter {
  /** filename-safe id, e.g. "ch001" */
  id: string;
  /** TOC label — scene heading text */
  title: string;
  /** complete XHTML document */
  xhtml: string;
}

export function escapeXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function xhtmlDoc(title: string, body: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops">
<head>
<title>${escapeXml(title)}</title>
<link rel="stylesheet" type="text/css" href="../style.css"/>
</head>
<body>
${body}</body>
</html>
`;
}

/** Render body tokens (no title-page tokens) of one chapter. */
function renderTokens(tokens: Token[]): string {
  const out: string[] = [];
  let inDialogue = false;

  for (const t of tokens) {
    const text = t.text ?? '';
    switch (t.type) {
      case 'scene_heading':
        out.push(`<h2 class="scene-heading">${escapeXml(text)}</h2>\n`);
        break;
      case 'action':
        out.push(`<p class="action">${escapeXml(text)}</p>\n`);
        break;
      case 'dialogue_begin':
        out.push('<div class="dialogue-block">\n');
        inDialogue = true;
        break;
      case 'dialogue_end':
        out.push('</div>\n');
        inDialogue = false;
        break;
      case 'character':
        out.push(`<p class="character">${escapeXml(text)}</p>\n`);
        break;
      case 'parenthetical':
        out.push(`<p class="parenthetical">${escapeXml(text)}</p>\n`);
        break;
      case 'dialogue':
        out.push(`<p class="dialogue">${escapeXml(text)}</p>\n`);
        break;
      case 'transition':
        out.push(`<p class="transition">${escapeXml(text.replace(/^>\s*/, ''))}</p>\n`);
        break;
      case 'centered':
        out.push(`<p class="centered">${escapeXml(text)}</p>\n`);
        break;
      case 'lyrics':
        out.push(`<p class="action">${escapeXml(text)}</p>\n`);
        break;
      default:
        // structural/no-render tokens: title page, page breaks, notes, etc.
        break;
    }
  }
  if (inDialogue) out.push('</div>\n');
  return out.join('');
}

/**
 * Split body tokens at scene headings, one chapter each. Content before the
 * first heading becomes an "Opening" chapter; a script with no headings
 * yields a single chapter.
 */
export function tokensToChapters(tokens: Token[]): Chapter[] {
  const body = tokens.filter((t) => !t.is_title);

  const groups: { title: string; tokens: Token[] }[] = [];
  let current: { title: string; tokens: Token[] } | null = null;

  for (const t of body) {
    if (t.type === 'scene_heading') {
      current = { title: t.text ?? 'Scene', tokens: [t] };
      groups.push(current);
    } else {
      if (!current) {
        current = { title: 'Opening', tokens: [] };
        groups.push(current);
      }
      current.tokens.push(t);
    }
  }

  return groups.map((g, i) => {
    const id = `ch${String(i + 1).padStart(3, '0')}`;
    return { id, title: g.title, xhtml: xhtmlDoc(g.title, renderTokens(g.tokens)) };
  });
}
