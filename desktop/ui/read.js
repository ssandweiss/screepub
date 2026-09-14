// Read: the converted script, keeping its shape, with its scene rail.
//
// The engine produces this document (tokensToPreviewHtml) and its stylesheet
// (src/epub/css.ts). The reader renders exactly those, so a formatting
// decision cannot disagree between this window and the EPUB a reader
// actually gets. Nothing here styles a screenplay: there is no rule below
// for a slugline, a cue or a line of dialogue, and there must never be one.
//
// HOW, and why it is not simpler than this — all four routes were measured
// in a real window before this was written:
//
//   * The window's CSP is `default-src 'self'`, which blocks every inline
//     style, INCLUDING a <style> inside an <iframe srcdoc>: srcdoc frames
//     inherit the parent's policy. Leaving the engine's <style> in place
//     renders an unstyled script with no error anywhere.
//   * CSSOM is not blocked. So the <style> is lifted out of the document
//     and its text is adopted as a constructed stylesheet instead — same
//     bytes, same rules, nothing rewritten.
//   * The sheet must be constructed in the FRAME's realm. A CSSStyleSheet
//     built in this document is rejected when adopted into another.
//   * The asset protocol renders but is cross-origin: the parent cannot
//     script the frame (no place-keeping, no rail) and the frame cannot
//     reach the bundled fonts. Rejected.
//
// The frame is an iframe rather than a div because the engine's stylesheet
// has `html, body` rules, and an iframe is the only container that has an
// html and a body of its own to give them.
//
// The file is in two halves, the way convert.js is. Everything this surface
// DECIDES — what the rail says, where the reader is, what to render when
// there is nothing to read, how the engine's document is taken apart — is a
// pure exported function above the line, tested directly. Below the line is
// drawing, which holds no rule of its own and rides on the live run.
import { el, clear } from './dom.js';

// ---------------------------------------------------------------- decisions

/** The faces the engine's CSS asks for by name. Nothing inside the frame
 *  knows where those files are, so the reader says — the same four files
 *  style.css declares for the window itself, latin and latin-ext, so an
 *  accented name is not a different typeface inside the frame than outside
 *  it. This adds a face; it changes no rule the engine wrote. */
export const FONT_CSS = `
@font-face { font-family: "Courier Prime"; font-style: normal; font-weight: 400;
  src: url(fonts/courier-prime-400-latin.woff2) format("woff2"); }
@font-face { font-family: "Courier Prime"; font-style: normal; font-weight: 400;
  src: url(fonts/courier-prime-400-latin-ext.woff2) format("woff2");
  unicode-range: U+0100-02BA, U+1E00-1E9F, U+2C60-2C7F, U+A720-A7FF; }
@font-face { font-family: "Courier Prime"; font-style: normal; font-weight: 700;
  src: url(fonts/courier-prime-700-latin.woff2) format("woff2"); }
@font-face { font-family: "Courier Prime"; font-style: normal; font-weight: 700;
  src: url(fonts/courier-prime-700-latin-ext.woff2) format("woff2");
  unicode-range: U+0100-02BA, U+1E00-1E9F, U+2C60-2C7F, U+A720-A7FF; }
`;

/** The two tokens the frame needs by value rather than by name: a custom
 *  property declared on this document does not cascade into another one. */
export const PAPER_TOKENS = ['ink', 'paper'];

/** What a reading device supplies on top of a book: the page margins and
 *  the theme it is read in. The engine's stylesheet sets NEITHER on purpose
 *  — `html, body { margin: 0; padding: 0 }` leaves margins to the device,
 *  and a background on html or body is the one thing an EPUB must never
 *  carry (it makes the KFX converter synthesize a wrapper block and every
 *  keep in the book dies silently). So this layer exists for the same reason
 *  a Kindle has one, it is applied the way a Kindle applies it — last, over
 *  the book's own sheet — and it goes no further than a margin and a colour.
 *  A token that did not resolve is left out rather than written as blank. */
export function deviceCss(tokens) {
  const value = (name) => String(tokens?.[name] ?? '').trim();
  const ink = value('ink');
  const paper = value('paper');
  const colours = [
    ink === '' ? null : `color: ${ink};`,
    paper === '' ? null : `background: ${paper};`,
  ].filter((part) => part !== null).join(' ');
  return `html { ${colours} }\nbody { padding: 1.6em 7%; }\n`;
}

/** The whole sheet the frame adopts, in the order a device applies it: the
 *  faces first, then the book's own stylesheet UNTOUCHED, then the device
 *  layer over it. The engine's bytes are neither rewritten nor overridden
 *  by anything except the margin and the theme above. */
export function sheetText(engineCss, tokens) {
  return `${FONT_CSS}\n${String(engineCss ?? '')}\n${deviceCss(tokens)}`;
}

/** The engine's document, minus the stylesheet the CSP will not run.
 *  The parser is passed in rather than reached for so this can be exercised
 *  without a browser; the window hands it a real DOMParser. */
export function splitPreview(previewHtml, parser) {
  const parsed = parser.parseFromString(String(previewHtml ?? ''), 'text/html');
  const styleEl = parsed.querySelector('style');
  const css = styleEl === null ? '' : String(styleEl.textContent ?? '');
  if (styleEl !== null) styleEl.remove();
  // The engine writes XHTML with an XML prolog. Taking the document element
  // and re-declaring the doctype drops the prolog, which a text/html parse
  // would otherwise leave in front of the doctype and put the frame into
  // quirks mode — where the engine's vertical rhythm is not what it renders.
  return { css, html: `<!doctype html>${parsed.documentElement.outerHTML}` };
}

/** What the surface has to show. `blank` is not hypothetical: scriptFrom()
 *  normalises a missing preview to an empty string, so an engine that
 *  answered without one lands here rather than on an empty white frame. */
export function readerState(script) {
  if (script === null || script === undefined) return 'closed';
  const html = typeof script.previewHtml === 'string' ? script.previewHtml.trim() : '';
  return html === '' ? 'blank' : 'ready';
}

/** An empty reader is an invitation, not a blank panel. */
export const NOTICES = {
  closed: {
    slug: 'Int. the reader - before page one',
    line: 'Nothing is open yet. Convert a script and it arrives here whole — '
      + 'scenes still scenes, cues still fixed to their lines — set exactly as '
      + 'the e-book will set it.',
    way: 'Convert a script',
  },
  blank: {
    slug: 'Int. the reader - no pages came back',
    line: 'The engine converted this script but sent no pages to read. The book '
      + 'itself is fine and can still be sent; converting again is the way to '
      + 'get the pages back.',
    way: 'Convert it again',
  },
};

/** The word the engine's own table of contents uses for the run of script
 *  before the first slugline (src/epub/html.ts). The rail says what the
 *  book says. */
export const OPENING = 'Opening';

/** A slugline reads in two parts: where, and when. Splitting it at the LAST
 *  separator keeps a compound place whole — "INT./EXT. DELIVERY VAN -
 *  MOVING - LATER" is a van that is moving, later — and lets the rail set
 *  the time of day quietly beside the place instead of running one wall of
 *  identical capitals down the margin. A heading with no separator is all
 *  place; a scene with no heading is the book's Opening. */
export function sceneLabel(heading) {
  const whole = String(heading ?? '').replace(/\s+/g, ' ').trim();
  if (whole === '') return { place: OPENING, time: null };
  const separator = /\s[-–—]\s/g;
  let cut = -1;
  for (const match of whole.matchAll(separator)) cut = match.index;
  if (cut <= 0) return { place: whole, time: null };
  const place = whole.slice(0, cut).trim();
  const time = whole.slice(cut + 3).trim();
  if (place === '' || time === '') return { place: whole, time: null };
  return { place, time };
}

/** The rail, from the engine's own scene sections in the engine's own order.
 *  Not from a second parse of the fountain: two parsers is two answers about
 *  what a scene is. */
export function railEntries(scenes) {
  if (!Array.isArray(scenes)) return [];
  return scenes
    .filter((scene) => typeof scene?.id === 'string' && scene.id !== '')
    .map((scene) => ({ id: scene.id, ...sceneLabel(scene.heading) }));
}

/** The dash a slugline is written with, put back between the halves the rail
 *  sets in different inks. */
export const SEPARATOR = '\u2013';

export function railCount(total) {
  return total === 1 ? '1 scene' : `${total} scenes`;
}

export const NO_SCENES = 'No scene headings in this script.';

/** Where the reader is, as a scene and a fraction into it — never as a pixel
 *  offset. Tune re-renders on every knob, and a knob that changes the type
 *  size changes every pixel in the document: a remembered scrollY would put
 *  the reader somewhere else in the script and look like a scroll jump. A
 *  scene and a fraction survive the reflow, because that is what the reader
 *  was actually looking at.
 *  `marks` are the sections in document order: { id, top, height }. */
export function readerPlace(marks, scrollTop) {
  if (!Array.isArray(marks) || marks.length === 0) return null;
  const at = Number.isFinite(scrollTop) ? Math.max(0, scrollTop) : 0;
  let found = marks[0];
  for (const mark of marks) {
    if (mark.top <= at) found = mark;
    else break;
  }
  const height = found.height > 0 ? found.height : 1;
  const into = Math.min(1, Math.max(0, (at - found.top) / height));
  return { id: found.id, into };
}

/** The same place, in the reflowed document's pixels. A place whose scene is
 *  gone — the script was re-converted and lost a heading — is the top, which
 *  is the only honest answer. */
export function scrollTarget(marks, place) {
  if (!Array.isArray(marks) || place === null || place === undefined) return 0;
  const mark = marks.find((candidate) => candidate.id === place.id);
  if (mark === undefined) return 0;
  const height = mark.height > 0 ? mark.height : 0;
  return Math.max(0, Math.round(mark.top + height * place.into));
}

// ------------------------------------------------------------------ drawing

let ctx = null;
let pane = null;
let frame = null;
let rail = null;
let railButtons = new Map();
let marks = [];
let place = null;
let sheetCss = '';
let markedId = null;
let ticking = false;
let watching = null;
let darkQuery = null;

export function mount(node, context) {
  pane = node;
  ctx = context;
  draw();
}

/** The script on screen changed, or went away. */
export function scriptChanged() {
  place = null;
  draw();
}

export function show() {
  if (frame === null) return;
  // Two things are finishable only now. A frame drawn while the pane was
  // hidden had no layout, so the rail could not be measured and the place
  // could not be restored. And a frame that HAS been read is coming back
  // from display:none, after which — measured in the live window — the frame
  // reports the scroll position it had but paints the document somewhere
  // else. Re-asserting the place is what puts the two back together.
  measure();
  restore();
}

/** Leaving the surface hides the pane, and a hidden iframe can lose the
 *  scroll position of the document inside it. Taking the place while it is
 *  still on screen is what makes coming back land where it left. */
export function hide() {
  keep();
}

/** Re-renders the frame from a fresh preview document, keeping the reader
 *  where they were. Called by Tune on every re-render. */
export function render(previewHtml) {
  if (frame === null) {
    draw();
    return;
  }
  keep();
  // The observer belongs to the document being replaced.
  unwatch();
  const parts = splitPreview(previewHtml, new DOMParser());
  sheetCss = parts.css;
  frame.setAttribute('srcdoc', parts.html);
}

function draw() {
  clear(pane);
  // Whatever was on screen is being thrown away, the frame's document with
  // it; the observer watching that document must go first.
  unwatch();
  frame = null;
  rail = null;
  railButtons = new Map();
  marks = [];
  markedId = null;

  const state = readerState(ctx.state.script);
  if (state !== 'ready') {
    drawNotice(NOTICES[state]);
    return;
  }

  const script = ctx.state.script;
  pane.append(
    el('div', { class: 'read-head' },
      el('h2', { class: 'read-title' }, script.title),
      script.author ? el('p', { class: 'read-by' }, `by ${script.author}`) : null),
  );

  rail = el('nav', { class: 'scene-rail', 'aria-label': 'Scenes' });
  frame = el('iframe', {
    class: 'script-frame',
    title: script.title,
    // Same origin so the parent can keep the reader's place and build the
    // rail from the document the engine wrote. Nothing more is granted, so
    // nothing inside the document can run.
    sandbox: 'allow-same-origin',
  });
  frame.addEventListener('load', dress);

  pane.append(el('div', { class: 'reader' }, frame, rail));
  render(script.previewHtml);
}

function drawNotice(notice) {
  pane.append(
    el('h2', { class: 'slug' }, notice.slug),
    el('p', { class: 'prose' }, notice.line),
    el('div', { class: 'read-ways' },
      el('button', {
        type: 'button',
        class: 'btn btn-outline',
        onclick: () => ctx.goTo('convert'),
      }, notice.way)),
  );
}

/** The frame has a document. Give it the sheet, the rail and the place. */
function dress() {
  const doc = frame.contentDocument;
  const win = frame.contentWindow;
  if (!doc || !win) return;
  // An iframe with no src loads about:blank BEFORE the srcdoc that replaces
  // it, and fires `load` for both. Dressing the empty one would build a rail
  // with no scenes in it and hang a scroll listener on a document that is
  // about to be thrown away. A document readerState() let through always has
  // sections in it, so an empty body is the one that is not ours.
  if (doc.body === null || doc.body.childElementCount === 0) return;

  adopt();
  // The theme is the device layer, and the device layer changes when the
  // desktop does. Re-adopting is the whole of it.
  if (darkQuery === null) {
    darkQuery = matchMedia('(prefers-color-scheme: dark)');
    darkQuery.addEventListener('change', () => {
      if (frame?.contentDocument) adopt();
    });
  }

  measure();
  buildRail(doc);
  restore();

  watch(doc, win);
}

/** Where the reader is, as they read: the rail marks the scene on screen,
 *  which is what makes it a place in the script rather than a list of links.
 *
 *  It is an observer and not a scroll listener because a scroll listener does
 *  not work here, which was measured rather than assumed. In this window a
 *  sandboxed srcdoc frame delivers NO scroll event to the parent — not on the
 *  frame's window, its document, its documentElement or its body — while
 *  `scrollY` reads correctly from the parent the whole time. So a reader
 *  wired to 'scroll' renders perfectly and leaves its mark on scene one
 *  forever. An IntersectionObserver CONSTRUCTED IN THE FRAME'S REALM does
 *  fire, and at exactly the right moments: a section leaves the viewport's
 *  top edge at precisely the scroll position where the next one becomes the
 *  scene being read.
 *
 *  Which scene that is, is still readerPlace()'s answer and not the
 *  observer's — the observer only says WHEN to ask, so there are never two
 *  opinions about where the reader is. */
function watch(doc, win) {
  unwatch();
  if (typeof win.IntersectionObserver !== 'function') return;
  watching = new win.IntersectionObserver(() => {
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(() => {
      ticking = false;
      markCurrent();
    });
  }, { threshold: 0 });
  for (const scene of doc.querySelectorAll('section.scene')) watching.observe(scene);
}

function unwatch() {
  if (watching !== null) watching.disconnect();
  watching = null;
}

function adopt() {
  const doc = frame.contentDocument;
  const win = frame.contentWindow;
  if (!doc || !win) return;
  const root = getComputedStyle(document.documentElement);
  const tokens = {};
  for (const name of PAPER_TOKENS) tokens[name] = root.getPropertyValue(`--${name}`);
  const sheet = new win.CSSStyleSheet();
  sheet.replaceSync(sheetText(sheetCss, tokens));
  doc.adoptedStyleSheets = [sheet];
}

/** The sections, where they are now. Re-measured rather than remembered:
 *  the type size, the window width and the format options all move them. */
function measure() {
  const doc = frame?.contentDocument;
  if (!doc || frame.clientHeight === 0) return;
  marks = [...doc.querySelectorAll('section.scene')].map((scene) => ({
    id: scene.id,
    top: scene.offsetTop,
    height: scene.offsetHeight,
  }));
}

/** Take the place while the frame can still say where it is. This runs as
 *  the surface goes away, by which time the pane is ALREADY hidden — so it
 *  must not ask for layout, and does not: `scrollY` still answers, and the
 *  marks were measured while the frame was on screen. */
function keep() {
  const win = frame?.contentWindow;
  if (!win || marks.length === 0) return;
  place = readerPlace(marks, win.scrollY);
}

function restore() {
  const win = frame?.contentWindow;
  if (!win || frame.clientHeight === 0) return;
  if (place !== null) {
    const target = scrollTarget(marks, place);
    // Asked to go where it already says it is, the frame does nothing — and
    // after a display:none round trip "where it says it is" is not where it
    // is drawn. Going to the top first is what makes the second scroll a
    // real one. It is one frame of work and never visible.
    if (win.scrollY === target) win.scrollTo(0, 0);
    win.scrollTo(0, target);
  }
  markCurrent();
}

function buildRail(doc) {
  clear(rail);
  railButtons = new Map();
  const sections = [...doc.querySelectorAll('section.scene')];
  const entries = railEntries(sections.map((scene) => ({
    id: scene.id,
    heading: scene.querySelector('h2.scene-heading')?.textContent,
  })));

  if (entries.length === 0) {
    rail.append(el('p', { class: 'caption' }, NO_SCENES));
    return;
  }

  rail.append(el('p', { class: 'rail-count' }, railCount(entries.length)));
  for (const entry of entries) {
    const target = doc.getElementById(entry.id);
    const button = el('button', {
      type: 'button',
      class: 'scene-link',
      onclick: () => target?.scrollIntoView({
        behavior: ctx.state.reducedMotion ? 'auto' : 'smooth',
        block: 'start',
      }),
    },
    el('span', { class: 'scene-where' }, entry.place),
    // The time of day, set quieter, running on from the place rather than
    // ranged right: a long location wraps, and a time ranged right against a
    // wrapped place lines up with the wrong line of it.
    entry.time ? el('span', { class: 'scene-when' }, ` ${SEPARATOR} ${entry.time}`) : null);
    railButtons.set(entry.id, button);
    rail.append(button);
  }
}

/** Mark the scene the reader is in, and keep that mark inside the rail's own
 *  scroll window without moving anything else on the page. */
function markCurrent() {
  const win = frame?.contentWindow;
  if (!win || railButtons.size === 0) return;
  const at = readerPlace(marks, win.scrollY);
  if (at === null || at.id === markedId) return;
  railButtons.get(markedId)?.classList.remove('scene-link-on');
  railButtons.get(markedId)?.removeAttribute('aria-current');
  markedId = at.id;
  const button = railButtons.get(markedId);
  if (button === undefined) return;
  button.classList.add('scene-link-on');
  button.setAttribute('aria-current', 'true');
  if (button.offsetTop < rail.scrollTop) rail.scrollTop = button.offsetTop;
  const past = button.offsetTop + button.offsetHeight - rail.clientHeight;
  if (past > rail.scrollTop) rail.scrollTop = past;
}
