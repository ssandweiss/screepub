// fountain-js tokens → XHTML body files. Scenes flow continuously as
// anchored <section>s inside one file — a spine boundary forces a page break
// in every reader, so files split only when a size budget is exceeded.
import type { Token } from 'fountain-js';

export interface BodyFile {
  /** filename-safe id, e.g. "body001" */
  id: string;
  /** complete XHTML document */
  xhtml: string;
}

export interface TocEntry {
  title: string;
  /** href relative to OEBPS/, e.g. "text/body001.xhtml#sc-001" */
  href: string;
}

export interface BookBody {
  files: BodyFile[];
  toc: TocEntry[];
}

/** Keep each body file comfortably under Kindle's per-flow size warnings. */
const DEFAULT_MAX_FILE_BYTES = 250_000;

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

/** Render body tokens (no title-page tokens) of one scene section. */
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

interface SceneSection {
  anchor: string;
  title: string;
  html: string;
}

/**
 * Split body tokens into anchored scene sections, then pack sections into
 * as few files as the size budget allows. Content before the first scene
 * heading becomes an "Opening" section.
 */
export function tokensToBody(
  tokens: Token[],
  opts: { maxFileBytes?: number } = {},
): BookBody {
  const maxBytes = opts.maxFileBytes ?? DEFAULT_MAX_FILE_BYTES;
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

  const sections: SceneSection[] = groups.map((g, i) => {
    const anchor = `sc-${String(i + 1).padStart(3, '0')}`;
    return {
      anchor,
      title: g.title,
      html: `<section class="scene" id="${anchor}">\n${renderTokens(g.tokens)}</section>\n`,
    };
  });

  // Pack sections into files, starting a new file only when the budget
  // would be exceeded (a file always holds at least one section).
  const files: BodyFile[] = [];
  const toc: TocEntry[] = [];
  let pending: SceneSection[] = [];
  let pendingBytes = 0;

  const flush = () => {
    if (pending.length === 0) return;
    const id = `body${String(files.length + 1).padStart(3, '0')}`;
    for (const s of pending) toc.push({ title: s.title, href: `text/${id}.xhtml#${s.anchor}` });
    files.push({ id, xhtml: xhtmlDoc(pending[0].title, pending.map((s) => s.html).join('')) });
    pending = [];
    pendingBytes = 0;
  };

  for (const s of sections) {
    const size = Buffer.byteLength(s.html, 'utf8');
    if (pending.length > 0 && pendingBytes + size > maxBytes) flush();
    pending.push(s);
    pendingBytes += size;
  }
  flush();

  return { files, toc };
}
