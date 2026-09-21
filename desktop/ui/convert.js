// Convert: the drop well, the bar, the result, and the refusal.
// Four states, from brand/components/drop-well.html, progress.html,
// result-card.html and failure-notice.html.
//
// The file is in two halves. Everything this surface DECIDES — what a code
// means, what the bar reads, what the result says, what a drop is — is a
// pure exported function above the line, tested directly by
// tests/desktop-ui.test.ts. Below the line is drawing: it holds no rule of
// its own, so a live run is enough to check it.
import { runEngine, pickScreenplay, onProgress, argv, FORCE_FLAG } from './app.js';
import { el, clear, text } from './dom.js';

// ---------------------------------------------------------------- decisions

/** The heading names the CAUSE, not the failure. "Scanned pdf, no text"
 *  tells you what to do next; a generic apology does not. Every code
 *  src/cli-errors.ts can return on the conversion path has an entry, so a
 *  real failure never renders with a blank heading. */
export const HEADINGS = {
  'scanned': 'Scanned PDF, no text',
  'not-screenplay': 'Not a screenplay',
  'password': 'Locked PDF',
  'unreadable': 'Unreadable file',
  'unsupported-type': 'Wrong kind of file',
  'bad-options': 'Bad settings',
  'usage': 'Bad settings',
  'library': 'No way into the library',
  'internal': 'The engine did not answer',
};

/** The window's own name. On the idle screen this is the ONLY place the app
 *  says what it is: the macOS title bar is gone, and the paragraph that used
 *  to carry the name went with it. */
export const WORDMARK = 'Screepub';

/** The drop well's words, exported the way send.js and tune.js export theirs,
 *  so a test can read the copy without mounting a surface.
 *
 *  `limits` used to name TWO of the engine's four guards, a scan and a
 *  password-locked file, on the argument that both are properties a reader
 *  can check at a glance, which moved both from after the wait to before the
 *  drop. The password half was cut deliberately (2026-09-20). It is a real
 *  trade, not a tidy-up: a locked PDF is now met AFTER the conversion wait
 *  rather than before it. What makes it survivable is that the refusal still
 *  names the cause — HEADINGS above maps `password` to "Locked PDF" and
 *  prints the engine's own sentence under it. */
export const WELL = {
  call: 'Drop a screenplay PDF',
  or: 'or',
  limits: 'Needs selectable text, not a scan.',
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

/** The engine writes one refusal for both of its faces, and for the CLI it
 *  is right: "Pass --force to convert it anyway" is the next thing to type.
 *  In a window there is nothing to type it into, and the sentence lands
 *  directly above a Convert anyway button that already does it — the
 *  interface talking past itself, and the one place the two faces disagree.
 *
 *  The rule is not "reword the engine". It is narrower and it only ever
 *  fires where the window has made the sentence redundant: when the window
 *  has drawn the override, the sentence that names the flag comes out, and
 *  nothing else does. The diagnosis — the part only the engine knows — is
 *  untouched, and a refusal the window offers no button for keeps every word.
 *
 *  Nothing is ever dropped to nothing: a message that is ONLY the remedy is
 *  left whole, because a blank fault body says less than a sentence a
 *  window user cannot act on. */
export function withoutCliRemedy(message, flag) {
  const whole = String(message ?? '').trim();
  const needle = String(flag ?? '');
  if (needle === '' || !whole.includes(needle)) return whole;
  const sentences = whole.match(/[^.!?]+[.!?]*\s*/g) ?? [];
  const kept = sentences.filter((s) => !s.includes(needle)).join('').trim();
  return kept === '' ? whole : kept;
}

/** What a failing answer means for the reader. The message is the engine's
 *  own: it says what happened, and this window is not better placed to say
 *  it. The only edit is withoutCliRemedy's, and only where this window has
 *  put a button in the sentence's place. */
export function failureFor(input) {
  // The contract says an object with both fields; a failure whose error is
  // missing or malformed still has to render something a person can act on.
  const error = input === null || input === undefined ? {} : input;
  const raw = typeof error.code === 'string' ? error.code.trim() : '';
  const code = raw === '' ? 'internal' : raw;
  const message = typeof error.message === 'string' ? error.message.trim() : '';
  // Not `code in HEADINGS`: an unknown code is a file the window knows
  // nothing about, and guessing that it can be overridden is a lie.
  const canForce = code === OVERRIDABLE;
  const said = message === '' ? NO_MESSAGE : message;
  return {
    code,
    heading: HEADINGS[code] ?? HEADINGS.internal,
    message: canForce ? withoutCliRemedy(said, FORCE_FLAG) : said,
    canForce,
  };
}

/** What the refusal says about the book that was already open. A file the
 *  engine would not read produced nothing to replace it with, so it replaces
 *  nothing: Read, Tune and Send keep the script they had. Saying so is the
 *  other half — a reader who has just been refused should not have to guess
 *  whether the work they were tuning survived. */
export function stillOpenNote(script) {
  const title = typeof script?.title === 'string' ? script.title.trim() : '';
  if (title === '') return null;
  return `${title} is still open — this changed nothing about it.`;
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
  // The surface's first stop for a keyboard. It used to name the well's
  // button, which is only on screen in one of this surface's four states;
  // the plan in focus.js picks the first control there actually is.
  ctx.restoreFocus();
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
    el('span', { class: 'well-call' }, WELL.call),
    el('span', { class: 'well-or' }, WELL.or),
    chooseButton,
    el('span', { class: 'well-limits' }, WELL.limits),
  );

  // The wordmark stands where the paragraph did. An h1 because on this screen
  // it IS the page's title: nothing above it names the app any more.
  pane.append(
    el('h1', { class: 'wordmark' }, WORDMARK),
    well,
  );
  pane.dataset.state = 'idle';
  // The code belongs to the refusal that set it, not to the pane. Left in
  // place it would ride along on the next success — a `data-state="done"`
  // carrying `data-error-code="not-screenplay"` is exactly the wrong thing to
  // find in a bug report pasted out of the DOM.
  delete pane.dataset.errorCode;
}

async function pickFileThenConvert() {
  if (busy) return;
  // Two things this no longer does. It does not guard against a second
  // picker — app.js does, at the one place that can, so the shortcut and the
  // button cannot disagree about it. And it does not put the keyboard back
  // itself: it used to re-focus the well's button, which exists on ONE of
  // this surface's four states, so cancelling a dialog over a result or a
  // refusal left the page with no focused element at all. main.js restores
  // the focus for whatever surface is showing, for every dialog. See focus.js.
  const path = await pickScreenplay();
  if (path === null) return;
  await convertPath(path);
}

export async function convertPath(path, { force = false } = {}) {
  if (busy) return;
  busy = true;
  // A conversion is this surface's business, wherever it was started from: a
  // drop on the Read surface and Ctrl-O on Tune both end up here. One rule,
  // one place — and it fires on a file, never on the ASK for one.
  ctx.goTo('convert');
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
    el('h2', { class: 'slug' }, 'Converting'),
    el('p', { class: 'work-line' },
      `The pages of ${fileName(path)} reflow themselves, one scene at a time.`),
    el('div', { class: 'meter' },
      el('div', { class: 'track' }, fill),
      readOut),
    el('p', { class: 'sign-off' }, 'Please stand by:'),
  );
  // The redraw threw away whatever had the focus. This surface has no
  // control while it works, so the plan lands on the pane itself and Tab
  // still moves from there.
  ctx.restoreFocus();
}

function drawResult(path, answer) {
  clear(pane);
  pane.dataset.state = 'done';
  delete pane.dataset.errorCode;
  ctx.state.script = scriptFrom(path, answer);
  const script = ctx.state.script;

  pane.append(
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
  ctx.restoreFocus();
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
  ways.append(el('button', {
    type: 'button',
    class: 'btn btn-outline',
    onclick: () => { drawWell(); ctx.restoreFocus(); },
  }, 'Back to one'));

  // The script that was already open stays open: see stillOpenNote. The
  // refusal is news about the file that was just refused, not about the book
  // in the library, and clearing the open script here used to take Read,
  // Tune and Send away from a book that was still perfectly good.
  const kept = stillOpenNote(ctx.state.script);

  pane.append(
    el('p', { class: 'smash' }, 'Smash cut to:'),
    el('h2', { class: 'fault' }, refusal.heading),
    // The engine's own sentence. The only thing the window takes out of it is
    // an instruction to type the flag the window has already drawn a button
    // for; see withoutCliRemedy.
    el('p', { class: 'fault-body' }, refusal.message),
    ways,
    kept === null ? null : el('p', { class: 'kept-note' }, kept),
    // The code is a support handle, not a sentence: it is what someone quotes
    // in a bug report, and printing it as body text under the buttons read as
    // leftover debug output. Labelled and set in the code face, it is
    // findable without pretending to be something a reader was told.
    el('p', { class: 'code-note' },
      el('span', { class: 'code-note-label' }, 'Error code'),
      el('code', { class: 'code code-chip' }, refusal.code)),
  );
  // Also on the pane, for a bug report pasted out of the DOM and for anyone
  // reading the window with a tool rather than eyes.
  pane.dataset.errorCode = refusal.code;
  ctx.restoreFocus();
}
