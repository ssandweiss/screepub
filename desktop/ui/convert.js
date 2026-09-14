// Convert: the drop well, the bar, the result, and the refusal.
// Four states, from brand/components/drop-well.html, progress.html,
// result-card.html and failure-notice.html.
//
// The file is in two halves. Everything this surface DECIDES — what a code
// means, what the bar reads, what the result says, what a drop is — is a
// pure exported function above the line, tested directly by
// tests/desktop-ui.test.ts. Below the line is drawing: it holds no rule of
// its own, so a live run is enough to check it.
import { runEngine, pickScreenplay, onProgress, argv } from './app.js';
import { el, clear, text } from './dom.js';

// ---------------------------------------------------------------- decisions

/** The heading names the CAUSE, not the failure. "Scanned pdf, no text"
 *  tells you what to do next; a generic apology does not. Every code
 *  src/cli-errors.ts can return on the conversion path has an entry, so a
 *  real failure never renders with a blank heading. */
export const HEADINGS = {
  'scanned': 'Int. scanned pdf, no text - day',
  'not-screenplay': 'Int. not a screenplay - day',
  'password': 'Int. locked pdf - day',
  'unreadable': 'Int. unreadable file - day',
  'unsupported-type': 'Int. wrong kind of file - day',
  'bad-options': 'Int. bad settings - day',
  'usage': 'Int. bad settings - day',
  'internal': 'Int. the engine did not answer - day',
};

/** The one guard a reader can meaningfully overrule. The others describe a
 *  file the engine genuinely cannot read, and offering an override on them
 *  would be a lie dressed as a button. */
export const OVERRIDABLE = 'not-screenplay';

/** Shown only if the engine breaks its own contract and sends a failure with
 *  no sentence in it. Every real failure renders the engine's words instead. */
export const NO_MESSAGE = 'The engine refused the file without saying why.';

/** The bar before the engine's first line arrives. */
export const PROGRESS_START = { percent: 0, stage: null, label: 'starting up' };

export function shortcutLabel(platform) {
  return /mac/i.test(String(platform ?? '')) ? '⌘O' : 'Ctrl+O';
}

/** What a failing answer means for the reader. The message is the engine's
 *  own, verbatim: it already says what happened and what to do, and this
 *  window is not better placed to say it. */
export function failureFor(input) {
  // The contract says an object with both fields; a failure whose error is
  // missing or malformed still has to render something a person can act on.
  const error = input === null || input === undefined ? {} : input;
  const raw = typeof error.code === 'string' ? error.code.trim() : '';
  const code = raw === '' ? 'internal' : raw;
  const message = typeof error.message === 'string' ? error.message.trim() : '';
  return {
    code,
    heading: HEADINGS[code] ?? HEADINGS.internal,
    message: message === '' ? NO_MESSAGE : message,
    // Not `code in HEADINGS`: an unknown code is a file the window knows
    // nothing about, and guessing that it can be overridden is a lie.
    canForce: code === OVERRIDABLE,
  };
}

/** The bar's next position, given where it already is and one progress line.
 *  The engine's percent is ALREADY the whole pipeline's: src/convert.ts's
 *  PARSE_SHARE puts page extraction at 0..85 and rendering at 85..100, and
 *  the stage name only says which of the two the reader is waiting on.
 *  (Observed: a 3,601-page script emits parse 6..85 then render 85, render
 *  100.) Re-weighting it here would discount it twice and park the bar at
 *  72% for the whole tail of the parse. So the number is taken as given,
 *  clamped, and never allowed to fall — a late line from the stage that just
 *  ended, an unknown stage and a percent that is not a number are all
 *  ignored rather than drawn. */
export function nextProgress(previous, line) {
  const stage = line?.stage;
  const percent = Number(line?.percent);
  if (stage !== 'parse' && stage !== 'render') return previous;
  if (!Number.isFinite(percent)) return previous;
  const next = Math.min(100, Math.max(0, Math.round(percent)));
  if (next < previous.percent) return previous;
  // Standing still at the same percent is still news if the stage changed:
  // the engine crosses into rendering at 85 without the bar moving.
  if (next === previous.percent && stage === previous.stage) return previous;
  return {
    percent: next,
    stage,
    label: stage === 'parse'
      ? `reading the pages (${next}%)`
      : `building the book (${next}%)`,
  };
}

/** The name at the end of a path, whichever slash the OS used. */
export function fileName(path) {
  const parts = String(path ?? '').split(/[\\/]/).filter((p) => p !== '');
  return parts.length === 0 ? String(path ?? '') : parts[parts.length - 1];
}

/** The book introducing itself. The counts are the fastest way to confirm
 *  the parse was right: a wrong character count means the cues were misread.
 *  A count the engine did not send is left out rather than printed as
 *  "undefined pages". */
export function countLine(answer) {
  const say = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}.`;
  const first = [
    Number.isFinite(answer?.pages) ? say(answer.pages, 'page') : null,
    Number.isFinite(answer?.scenes) ? say(answer.scenes, 'scene') : null,
  ].filter((p) => p !== null).join(' ');
  const second = Number.isFinite(answer?.characters)
    ? say(answer.characters, 'speaking character')
    : '';
  return [first, second].filter((p) => p !== '').join('\n');
}

/** The one object tasks 9–11 read. Everything optional is normalised here,
 *  so no later surface has to guess whether a field is missing or empty. */
export function scriptFrom(path, answer) {
  return {
    path,
    title: answer?.title ?? fileName(path),
    author: answer?.author ?? null,
    pages: answer?.pages ?? null,
    scenes: answer?.scenes ?? null,
    characters: answer?.characters ?? null,
    warnings: Array.isArray(answer?.warnings) ? answer.warnings : [],
    epubPath: answer?.epubPath ?? null,
    fountainPath: answer?.fountainPath ?? null,
    previewHtml: answer?.previewHtml ?? '',
    settings: null,
  };
}

/** Which of the dropped paths this window converts. Tauri hands over
 *  everything that was dragged; one window converts one script. */
export function droppedPath(paths) {
  if (!Array.isArray(paths)) return null;
  return paths.find((p) => typeof p === 'string' && p.trim() !== '') ?? null;
}

// ------------------------------------------------------------------ drawing

let ctx = null;
let pane = null;
let chooseButton = null;
let unlistenProgress = null;
let busy = false;

// The bar's width is the one value the window computes rather than declares,
// and CSP `default-src 'self'` refuses an inline style. A constructed
// stylesheet is the way in that the CSP allows; the number written into it is
// an integer 0..100 from nextProgress() and nothing else.
let fillSheet = null;
function paintFill(percent) {
  if (fillSheet === null) {
    fillSheet = new CSSStyleSheet();
    document.adoptedStyleSheets = [...document.adoptedStyleSheets, fillSheet];
  }
  fillSheet.replaceSync(`.fill { width: ${percent}%; }`);
}

export function mount(node, context) {
  pane = node;
  ctx = context;
  drawWell();
}

export function show() {
  // The well's button is the surface's first stop for a keyboard — but only
  // while the well is the thing on screen.
  if (chooseButton?.isConnected) chooseButton.focus();
}

export function choose() {
  pickFileThenConvert();
}

/** Wired by mount-time listeners in app.js; see main.js. */
export function dragOver(on) {
  pane?.querySelector('.well')?.classList.toggle('well-targeted', on);
}

/** A file arrived from the desktop. */
export function dropPaths(paths) {
  const path = droppedPath(paths);
  if (path !== null) convertPath(path);
}

function icon() {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 26 26');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '1.3');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  for (const d of ['M6 3.5h9l5 5v14H6z', 'M15 3.5v5h5', 'M13 11.5v7', 'M10 15.5l3 3 3-3']) {
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', d);
    svg.append(path);
  }
  return svg;
}

function drawWell() {
  clear(pane);
  chooseButton = el('button', { type: 'button', class: 'well-btn', onclick: choose },
    `Choose PDF…  ${shortcutLabel(navigator.userAgentData?.platform ?? navigator.platform)}`);

  const well = el('div', { class: 'well' },
    el('span', { class: 'well-mark', 'aria-hidden': 'true' }, icon()),
    el('span', { class: 'well-call' }, 'Drop a screenplay PDF'),
    el('span', { class: 'well-or' }, 'or'),
    chooseButton,
    // The important line. Two of the engine's four guards are properties a
    // reader can check at a glance, so saying them here moves both from
    // after the wait to before the drop.
    el('span', { class: 'well-limits' }, 'Needs selectable text, not a scan. No password.'),
  );

  pane.append(
    el('h2', { class: 'slug' }, 'Fade in:'),
    el('p', { class: 'prose' },
      'Drop a script and it becomes a real e-book, built entirely on this ' +
      'computer. Nothing you drop here is ever uploaded.'),
    well,
  );
  pane.dataset.state = 'idle';
}

async function pickFileThenConvert() {
  if (busy) return;
  const path = await pickScreenplay();
  // desktop/README.md records that the webview does not always take keyboard
  // focus back when the native dialog closes. Asking for it costs nothing
  // and is the difference between a usable keyboard and a dead one.
  if (chooseButton?.isConnected) chooseButton.focus();
  if (path === null) return;
  await convertPath(path);
}

export async function convertPath(path, { force = false } = {}) {
  if (busy) return;
  busy = true;
  drawProgress(path);
  let answer;
  try {
    answer = await runEngine(argv.convert(path, { force }));
  } catch (err) {
    // Rust could not start the engine, or the engine printed something that
    // is not its contract. Its sentence is still the most useful one there
    // is, so it is shown the same way the engine's own would be.
    drawFailure({ code: 'internal', message: err.message }, path);
    return;
  } finally {
    busy = false;
    const stop = await unlistenProgress;
    if (typeof stop === 'function') stop();
    unlistenProgress = null;
  }
  if (answer.ok) drawResult(path, answer);
  else drawFailure(answer.error, path);
}

function drawProgress(path) {
  clear(pane);
  pane.dataset.state = 'working';
  paintFill(PROGRESS_START.percent);
  const fill = el('div', { class: 'fill' });
  const readOut = el('span', { class: 'read-out', role: 'status', 'aria-live': 'polite' },
    PROGRESS_START.label);
  let at = PROGRESS_START;

  unlistenProgress = onProgress((line) => {
    const moved = nextProgress(at, line);
    if (moved === at) return;
    at = moved;
    paintFill(at.percent);
    text(readOut, at.label);
  });

  pane.append(
    el('h2', { class: 'slug' }, 'Int. conversion bay - continuous'),
    el('p', { class: 'work-line' },
      `The pages of ${fileName(path)} reflow themselves, one scene at a time.`),
    el('div', { class: 'meter' },
      el('div', { class: 'track' }, fill),
      readOut),
    el('p', { class: 'sign-off' }, 'Please stand by:'),
  );
}

function drawResult(path, answer) {
  clear(pane);
  pane.dataset.state = 'done';
  ctx.state.script = scriptFrom(path, answer);
  const script = ctx.state.script;

  pane.append(
    el('h2', { class: 'slug' }, 'Int. your library - night'),
    el('div', { class: 'announce' },
      el('p', { class: 'book-title' }, script.title),
      script.author ? el('p', { class: 'book-by' }, `(by ${script.author})`) : null,
      el('p', { class: 'book-count' }, countLine(answer)),
      ...script.warnings.map((w) => el('p', { class: 'caption' }, `(${w})`)),
    ),
    el('div', { class: 'send' },
      el('button', { type: 'button', class: 'btn btn-brad', onclick: () => ctx.goTo('send') },
        'Send to a reader'),
      el('div', { class: 'asides' },
        el('button', { type: 'button', class: 'btn-quiet', onclick: () => ctx.goTo('read') },
          'Read it'),
        el('button', { type: 'button', class: 'btn-quiet', onclick: () => ctx.goTo('tune') },
          'Tune it'),
        el('button', { type: 'button', class: 'btn-quiet', onclick: choose },
          'Convert another'),
      ),
    ),
    el('p', { class: 'path-note' }, script.epubPath),
  );

  ctx.scriptChanged();
}

function drawFailure(error, path) {
  clear(pane);
  pane.dataset.state = 'failed';
  const refusal = failureFor(error);

  const ways = el('div', { class: 'ways' });
  if (refusal.canForce) {
    ways.append(el('button', {
      type: 'button', class: 'btn btn-brad',
      onclick: () => convertPath(path, { force: true }),
    }, 'Convert anyway'));
  }
  ways.append(el('button', { type: 'button', class: 'btn btn-outline', onclick: drawWell },
    'Back to one'));

  pane.append(
    el('p', { class: 'smash' }, 'Smash cut to:'),
    el('h2', { class: 'fault' }, refusal.heading),
    // The engine's own sentence, verbatim. Not reworded, not re-classified:
    // it already says what happened and what to do.
    el('p', { class: 'fault-body' }, refusal.message),
    ways,
    el('p', { class: 'caption' }, refusal.code),
  );
  ctx.state.script = null;
  ctx.scriptChanged();
}
