// Tune: this script's own formatting. Eighteen knobs, saved beside the
// script, and re-rendered into Read as they move.
//
// The window decides nothing about what a knob MEANS: the engine owns the
// merge, the clamp and the storage (src/options.ts, src/settings/sidecar.ts).
// What this file decides is which control shows what, which knob is
// irrelevant right now, what one moved knob becomes on the way to the
// engine, and what the surface is allowed to claim about a save.
//
// The file is in two halves, the way convert.js and read.js are. Everything
// above the line is a pure function with no DOM in it, exercised directly by
// tests/desktop-ui.test.ts. Below the line is drawing, which holds no rule of
// its own and rides on the live run.
import { runEngine, argv } from './app.js';
import { el, clear, text } from './dom.js';
import { render as renderReader, splitPreview, dressFrame } from './read.js';

// ---------------------------------------------------------------- decisions

/** Why a knob can be on this surface and still not change the page behind
 *  it. Measured, not assumed — every one of the eighteen was flipped against
 *  a cached .fountain and the re-rendered document compared byte for byte:
 *
 *  'live'      the preview changes the moment this moves.
 *  'book'      the BOOK changes and the preview cannot show it. The preview
 *              is the script itself; a generated title page is not in it.
 *  'reconvert' decided while the PDF is read, written into the script
 *              Screepub keeps, and therefore not recoverable from it. These
 *              are the four knobs src/fountain/serialize.ts consumes.
 *
 *  The temptation with the last group is to hide them. That trades one
 *  silence for another: the setting is still saved, still applies to the next
 *  conversion, and a reader who cannot find it cannot set it. Saying so is
 *  the honest move. */
export const EFFECTS = ['live', 'book', 'reconvert'];

/** The eighteen, grouped by what a reader is trying to change rather than by
 *  where the engine consumes them — with the one exception above, where
 *  where-it-is-consumed IS what a reader needs to know. `help` explains WHY,
 *  carried over from the Mac app's rail (app/Sources/ScreepubApp/
 *  ReaderRail.swift) rather than reinvented, because that is where the
 *  explaining already happened. */
export const GROUPS = [
  {
    id: 'page',
    title: 'The page',
    knobs: [
      {
        key: 'elementSpacingEm', label: 'Space between elements',
        kind: 'range', min: 0.4, max: 2, step: 0.1, unit: ' em',
      },
      {
        key: 'scenePageBreaks', label: 'Start each scene on a new page', kind: 'toggle',
        help: 'Makes every scene easy to find, and makes the book considerably longer.',
      },
      {
        key: 'keepSceneHeadingWithScene',
        label: 'Never end a page on a scene heading', kind: 'toggle',
        help: 'A heading alone at the foot of a page announces a scene and then makes you '
          + 'turn over to find it.',
      },
      {
        key: 'keepSpeechesWhole', label: 'Keep each speech on one page', kind: 'toggle',
        help: 'Stops a page turn landing in the middle of what someone is saying. The cost '
          + 'is a gap at the bottom of some pages. A speech longer than a whole page still '
          + 'has to break somewhere.',
      },
      {
        key: 'printSplitMinimums', label: 'Avoid stranded lines', kind: 'toggle',
        help: 'Stops a single line of a speech or a paragraph being left behind at the top '
          + 'or bottom of a page. Turning it off fits a little more onto each page. Not '
          + 'every e-reader obeys this one.',
      },
    ],
  },
  {
    id: 'dialogue',
    title: 'Dialogue',
    knobs: [
      {
        key: 'dialogueSideMarginPct', label: 'Dialogue margins',
        kind: 'range', min: 0, max: 30, step: 1, unit: '%',
      },
      {
        // A plural noun phrase, not a question. idleReason() composes this
        // label into "Only when <label> are indented.", so a label that reads
        // well alone but not in a sentence breaks the explanation beside two
        // OTHER knobs. "Where character names sit" did exactly that.
        key: 'cueAlignment', label: 'Character names', kind: 'choice',
        choices: [['centered', 'Centered'], ['indented', 'Indented']],
        help: 'Centred looks right at any screen size. Indented copies where they sit on a '
          + 'printed page, which only lines up at one width.',
      },
      {
        key: 'cueIndentPct', label: 'Character name indent',
        kind: 'range', min: 0, max: 60, step: 1, unit: '%',
        needs: { cueAlignment: 'indented' },
      },
      {
        key: 'parentheticalIndentPct', label: 'Parenthetical indent',
        kind: 'range', min: 0, max: 40, step: 1, unit: '%',
        needs: { cueAlignment: 'indented' },
      },
    ],
  },
  {
    id: 'text',
    title: 'The text',
    knobs: [
      {
        key: 'fontFamily', label: 'Typeface', kind: 'choice',
        choices: [['courier', 'Courier'], ['serif', 'Serif'], ['sans', 'Sans']],
      },
      {
        key: 'justifyText', label: 'Straighten the right edge', kind: 'toggle',
        help: 'Screenplays normally leave the right edge uneven. Straightening it opens up '
          + 'wide gaps between words in a column this narrow.',
      },
      {
        key: 'preserveFontShifts', label: "Keep the script's own type changes", kind: 'toggle',
        help: 'Some scripts set titles, inserts and on-screen text in a different typeface '
          + 'or size. This keeps them the way the script drew them; turning it off puts '
          + 'every line in one typeface.',
      },
    ],
  },
  {
    id: 'front',
    title: 'What the book carries',
    knobs: [
      {
        key: 'includeTitlePage', label: 'Title page', kind: 'toggle', effect: 'book',
        help: 'It appears in the finished book, not in the preview here, because the '
          + 'preview is the script itself.',
      },
      {
        key: 'showSceneNumbers', label: 'Scene numbers', kind: 'toggle',
        help: 'Only shows numbers the script already carried. Screepub never invents them: '
          + 'a numbered draft is a decision someone made, not a formatting choice.',
      },
    ],
  },
  {
    // The four knobs src/fountain/serialize.ts consumes. They are decided
    // while the PDF is read and written into the script Screepub keeps, so
    // nothing downstream of that can put them back — which is why moving one
    // here cannot move the preview. Measured: re-rendering with each of the
    // four flipped produced a byte-identical document.
    id: 'pdf',
    title: 'Read from the PDF',
    effect: 'reconvert',
    note: 'These four are decided while the PDF is being read. Everything else re-renders '
      + 'from the script Screepub already read, so changing one here saves it for the next '
      + 'time you convert this PDF — it will not change what you see now.',
    knobs: [
      {
        key: 'rejoinSplitDialogue', label: 'Rejoin speeches split across pages', kind: 'toggle',
        help: 'A printed script breaks a long speech across two pages and marks it (MORE) '
          + "and (CONT'D). This stitches the halves back into one speech. Turning it off "
          + 'keeps the break exactly where the PDF had it.',
      },
      {
        key: 'contdMode', label: "(CONT'D) after a cue", kind: 'choice',
        choices: [['auto', 'Automatic'], ['strip', 'Remove all'], ['keep', 'Keep as written']],
      },
      {
        key: 'showPageMarkers', label: "The PDF's page numbers", kind: 'toggle',
        help: 'Marks where each page of the printed script ended, so a note about page 42 '
          + 'can still be found.',
      },
      {
        key: 'dualDialogue', label: 'People talking at once', kind: 'choice',
        choices: [['sideBySide', 'Side by side'], ['sequential', 'One after the other']],
        help: 'Side by side needs two columns, which is a sliver on a phone. One after the '
          + 'other reads anywhere.',
      },
    ],
  },
];

/** Every knob, flattened, in the order it is drawn. */
export const KNOBS = GROUPS.flatMap((group) =>
  group.knobs.map((knob) => ({ ...knob, effect: knob.effect ?? group.effect ?? 'live' })));

export const OPTION_KEYS = KNOBS.map((knob) => knob.key);

export function knobFor(key) {
  return KNOBS.find((knob) => knob.key === key) ?? null;
}

/** Why this knob does nothing right now, or null when it does something.
 *  Not a reason to hide it: a control that vanishes takes its own
 *  explanation with it, and the reader is left wondering where the cue
 *  indent went. It is shown, disabled, and told why. */
export function idleReason(knob, settings) {
  const needs = knob?.needs;
  if (!needs || settings === null || settings === undefined) return null;
  for (const [key, want] of Object.entries(needs)) {
    if (settings[key] === want) continue;
    const other = knobFor(key);
    const label = other?.choices?.find(([value]) => value === want)?.[1] ?? String(want);
    return `Only when ${(other?.label ?? key).toLowerCase()} are ${label.toLowerCase()}.`;
  }
  return null;
}

/** Everything that belongs beside a control right now: why it is doing
 *  nothing, then what it is for — in that order, because the reason it is
 *  greyed out is the more urgent of the two.
 *
 *  Drawing a knob and re-stating one both go through this, because they were
 *  once two answers and the second was never asked. The sentence was written
 *  at draw time only, so switching cues to Indented left "Only when character
 *  cues are indented." standing beside a control that had just become live —
 *  and a surface opened WITH cues indented had no sentence to show at all
 *  when they were switched back, leaving a greyed-out slider with no
 *  explanation and nothing for aria-describedby to point at. */
export function notesFor(knob, settings) {
  return [idleReason(knob, settings), knob?.help]
    .filter((note) => typeof note === 'string' && note.trim() !== '');
}

/** Whether a knob can ever have something to say. Its sentence element is
 *  drawn whenever this is true — empty and hidden if there is nothing to say
 *  yet — so there is always something for notesFor() to rewrite. */
export function canExplain(knob) {
  return Boolean(knob?.needs) || typeof knob?.help === 'string';
}

/** What a control's read-out says. Tabular and unit-carrying: "20%" is an
 *  answer, "20" is a number. A value the engine never sends still has to
 *  render as something rather than as NaN. */
export function displayValue(knob, value) {
  // Number(null) is 0 and Number('') is 0: a missing value must read as
  // missing, not as a knob sitting at zero.
  if (value === null || value === undefined || value === '') return '—';
  const number = Number(value);
  if (!Number.isFinite(number)) return '—';
  const decimals = knob.step < 1 ? 1 : 0;
  return `${number.toFixed(decimals)}${knob.unit ?? ''}`;
}

/** One moved control, as a value the engine will accept — or null when it is
 *  not one, which is a change that must never be sent. A range arrives from
 *  the DOM as a STRING, and a string where the engine wants a number is
 *  discarded by the engine's own resolver in silence: the knob would appear
 *  to move and nothing would happen. The clamp is the same one src/options.ts
 *  applies, so the surface cannot offer a value the engine will throw away. */
export function coerceValue(knob, raw) {
  if (knob === null || knob === undefined) return null;
  if (knob.kind === 'toggle') return raw === true || raw === false ? raw : null;
  if (knob.kind === 'range') {
    const number = Number(raw);
    if (!Number.isFinite(number)) return null;
    return Math.min(knob.max, Math.max(knob.min, number));
  }
  const value = String(raw);
  return knob.choices.some(([choice]) => choice === value) ? value : null;
}

/** What is owed to the engine and has not been sent yet.
 *
 *  Every change accumulates here rather than replacing what is waiting. A
 *  reader who moves the margin and then the typeface inside one debounce
 *  window has changed two things; sending only the second SAVES only the
 *  second, and the engine — which overlays a partial on what is stored —
 *  would hand back settings with the first one missing and the surface would
 *  redraw it away. */
export function mergePending(pending, key, value) {
  return { ...pending, [key]: value };
}

export function isPending(pending) {
  return Object.keys(pending ?? {}).length > 0;
}

/** What is owed after a save that did not happen. `pending` is cleared
 *  before the engine is asked — that is what makes a knob moved DURING a
 *  save land in the next one — so a failure has to put back what the
 *  attempt carried, or the screen would show values the engine never stored
 *  and nothing would be left to store them. Anything moved since the attempt
 *  started wins: it is the newer answer about that knob. */
export function restorePending(owed, pending) {
  return { ...owed, ...pending };
}

/** The engine's settings answer, or null if it is not one. Checked key by
 *  key against the eighteen and against each knob's own kind: a surface that
 *  trusted a malformed answer would draw an empty select or a slider at NaN
 *  and give a reader no idea why. Extra keys are carried through untouched —
 *  a future engine knob this window has never heard of must survive a round
 *  trip rather than being quietly dropped from the script's settings. */
export function settingsFrom(answer) {
  const settings = answer?.settings;
  if (typeof settings !== 'object' || settings === null || Array.isArray(settings)) return null;
  for (const knob of KNOBS) {
    const value = settings[knob.key];
    if (knob.kind === 'toggle' && typeof value !== 'boolean') return null;
    if (knob.kind === 'range' && !Number.isFinite(value)) return null;
    if (knob.kind === 'choice' && !knob.choices.some(([choice]) => choice === value)) return null;
  }
  return { ...settings };
}

/** The named starting points, from the engine's own list. A preset whose
 *  settings do not survive settingsFrom() is left out rather than offered as
 *  a button that would half-apply. */
export function presetsFrom(answer) {
  const presets = answer?.presets;
  if (!Array.isArray(presets)) return [];
  return presets
    .map((preset) => ({
      // Carried so the surface can mark the one the script is actually on.
      // Without it the two presets are just two buttons, and the one that
      // equals the defaults looks like a button that does nothing.
      id: typeof preset?.id === 'string' ? preset.id : '',
      displayName: typeof preset?.displayName === 'string' ? preset.displayName : '',
      settings: settingsFrom(preset),
    }))
    .filter((preset) => preset.displayName !== '' && preset.settings !== null);
}

/** Which preset this script's settings currently equal, or null when they
 *  have been tuned away from every one of them.
 *
 *  The engine answers this by comparing values, not by remembering a name it
 *  was handed — `src/settings/presets.ts` says why: applying a preset stores
 *  no identity, so equality is the only honest answer, and a remembered name
 *  would go on claiming "Kindle e-ink" after the first knob moved.
 *
 *  The window ignored this field entirely until 2026-09-21. That is what made
 *  the row read as arbitrary: one of the two presets is identical to the
 *  defaults, so on a fresh script it appears to do nothing, and without
 *  "you are here" there was no way to tell a no-op from a confirmation. */
export function currentPreset(answer) {
  const id = answer?.preset;
  return typeof id === 'string' && id !== '' ? id : null;
}

export function sameSettings(a, b) {
  if (a === null || b === null || a === undefined || b === undefined) return a === b;
  return OPTION_KEYS.every((key) => a[key] === b[key]);
}

/** What the surface is allowed to claim, and when. "Saved" is a claim about
 *  a file on disk, so it is never shown while a change is still owed: a
 *  reader who walks away on the word "saved" has to be right. */
export const STATUS = {
  idle: '',
  pending: 'Changed. Saving in a moment…',
  saving: 'Saving, and rebuilding the book to match…',
  saved: 'Saved. The book on disk matches what you see.',
};

export const NO_MESSAGE = 'The engine refused the change without saying why.';

export function statusFor(phase, message) {
  if (phase === 'failed') {
    const said = typeof message === 'string' ? message.trim() : '';
    return { line: said === '' ? NO_MESSAGE : said, bad: true };
  }
  return { line: STATUS[phase] ?? '', bad: false };
}

/** There is no notice for a surface with no script open: main.js disables
 *  this tab whenever none is, exactly as it does for Read, so a reader can
 *  never be standing here with nothing converted. The one state that IS
 *  reachable and is not the knobs is a script whose settings could not be
 *  read — a sidecar on a disk that went away. */
export const FAULT = {
  slug: 'Settings out of reach',
  line: 'Screepub could not read this script’s settings. The book itself is fine and can '
    + 'still be sent; converting the PDF again is the way to get the knobs back.',
  way: 'Convert it again',
};

export const LEDE = 'These settings belong to this script alone. They are kept with it in '
  + 'your library, never beside the PDF you dropped, and the book on disk is rebuilt to '
  + 'match, so what you send is what you see.';

/** "Start from" said nothing about what pressing one does. It does not nudge
 *  a setting or set a baseline to build on: it REPLACES all eighteen. The
 *  SwiftUI version said so on screen and this one did not. */
export const PRESET_LABEL = 'Load a preset';
export const PRESET_NOTE = 'Overwrites every setting below.';

// ------------------------------------------------------------------ drawing

let ctx = null;
let pane = null;
let settings = null;
let presets = [];
let onPreset = null;
let presetsBox = null;
let previewFrame = null;
let previewCss = '';
let loaded = false;
let timer = null;
let running = Promise.resolve();
let pending = {};
let statusLine = null;
let controls = new Map();
/** Which script these knobs belong to. A flush already chained onto
 *  `running` cannot be cancelled, so it checks this before it paints
 *  anything: converting a second PDF while a save is in flight must not put
 *  the first script's pages back into the reader. */
let era = 0;

/** Long enough that a dragged slider is one conversion rather than a
 *  hundred, short enough that a single click does not feel ignored. */
const SETTLE_MS = 300;

export function mount(node, context) {
  pane = node;
  ctx = context;
  draw();
}

/** The script on screen changed, or went away: these knobs belong to the
 *  other one. */
export function scriptChanged() {
  era += 1;
  loaded = false;
  settings = null;
  presets = [];
  pending = {};
  clearTimeout(timer);
  draw();
}

export async function show() {
  if (loaded || ctx.state.script === null) return;
  loaded = true;
  await load();
}

async function load() {
  const script = ctx.state.script;
  if (!script?.fountainPath) {
    draw(statusFor('failed', FAULT.line));
    return;
  }
  try {
    const answer = await runEngine(argv.settings(script.fountainPath));
    settings = settingsFrom(answer);
    presets = presetsFrom(answer);
    onPreset = currentPreset(answer);
  } catch (err) {
    settings = null;
    // Openable again: a sidecar that could not be read once — a disk that
    // was not there yet, an engine that did not start — must not strand
    // this surface on the fault screen for the life of the script.
    loaded = false;
    draw(statusFor('failed', err.message));
    return;
  }
  if (settings === null) {
    loaded = false;
    draw(statusFor('failed', NO_MESSAGE));
    return;
  }
  script.settings = settings;
  draw();
}

function draw(status) {
  clear(pane);
  controls = new Map();
  statusLine = null;
  if (ctx.state.script === null) return;

  if (settings === null) {
    pane.append(
      el('h2', { class: 'slug' }, FAULT.slug),
      el('p', { class: 'prose' }, FAULT.line),
      status?.bad ? el('p', { class: 'caption bad' }, status.line) : null,
      el('div', { class: 'read-ways' },
        el('button', {
          type: 'button', class: 'btn btn-outline', onclick: () => ctx.goTo('convert'),
        }, FAULT.way)),
    );
    return;
  }

  statusLine = el('p', { class: 'caption tune-status', role: 'status' }, '');
  pane.append(
    el('h2', { class: 'slug' }, 'This script’s settings'),
    el('p', { class: 'prose' }, LEDE),
    el('div', { class: 'tune-split' },
      el('div', { class: 'tune-knobs' },
        (presetsBox = drawPresets()),
        ...GROUPS.map(drawGroup),
        statusLine,
      ),
      drawPreview(),
    ),
  );
  say(status ?? statusFor(isPending(pending) ? 'pending' : 'idle'));
  renderPreview(ctx.state.script?.previewHtml);
}

/** The script, beside the knobs that change it.
 *
 *  Only the `live` knobs can move this — the effect classification above says
 *  which, and it was measured rather than guessed. The `book` and `reconvert`
 *  ones cannot, and they say so themselves rather than being hidden: a knob
 *  that silently does nothing here is worse than one that explains why.
 *
 *  A plain frame, not the reader. It carries no scene rail, keeps no reading
 *  place and takes no keyboard: this is a swatch, not somewhere you read. The
 *  one thing it shares with the reader is dressFrame(), because the CSP dance
 *  that gets the engine's stylesheet into the document is the piece that must
 *  never exist twice. */
function drawPreview() {
  previewFrame = el('iframe', {
    class: 'tune-preview-frame',
    title: 'Preview',
    // Same grant the reader's frame gets, and no more: same-origin so the
    // parent can adopt a stylesheet into it, nothing that lets the document
    // run anything.
    sandbox: 'allow-same-origin',
    // Not a Tab stop. There is nothing to do inside it.
    tabindex: '-1',
    'aria-hidden': 'true',
  });
  previewFrame.addEventListener('load', () => dressFrame(previewFrame, previewCss));
  return el('div', { class: 'tune-preview' },
    el('p', { class: 'state-label' }, 'Preview'),
    previewFrame);
}

/** Show a document in the preview. Safe to call before the frame exists and
 *  safe to call with nothing, which is what happens on the fault screen. */
function renderPreview(previewHtml) {
  if (previewFrame === null || previewHtml === undefined || previewHtml === null) return;
  const parts = splitPreview(previewHtml, new DOMParser());
  previewCss = parts.css;
  previewFrame.setAttribute('srcdoc', parts.html);
}

function drawPresets() {
  if (presets.length === 0) return null;
  return el('div', { class: 'presets' },
    el('p', { class: 'state-label presets-label' }, PRESET_LABEL),
    el('div', { class: 'preset-row' },
      ...presets.map((preset) => {
        // The one the script is already on is marked and inert. It is what
        // turns a button that appears to do nothing — the Kindle preset IS
        // the defaults — into a statement about where you are.
        const on = preset.id !== '' && preset.id === onPreset;
        return el('button', {
          type: 'button',
          class: `btn btn-outline btn-small${on ? ' preset-on' : ''}`,
          disabled: on,
          'aria-current': on ? 'true' : null,
          onclick: () => applyAll(preset.settings),
        }, preset.displayName);
      })),
    el('p', { class: 'caption presets-note' }, PRESET_NOTE));
}

/** Which groups arrive open. Only the first: five shut boxes is a surface
 *  with nothing on it, and eighteen open controls is the wall this replaced.
 *
 *  Exported so the rule is a fact rather than an inline literal, and so a
 *  later "remember what was open" can be added without hunting for where the
 *  decision was made. */
export function groupStartsOpen(index) {
  return index === 0;
}

function drawGroup(group, index) {
  // <details> rather than a toggle of our own: the open state, the keyboard
  // and the announcement all come from the platform. Folding, never
  // dropping — all five groups and all eighteen knobs are still here, because
  // a setting that cannot be found still applies to every conversion.
  return el('details', { class: 'knob-group', open: groupStartsOpen(index) ? '' : null },
    el('summary', { class: 'subslug knob-group-title' }, group.title),
    group.note ? el('p', { class: 'caption knob-group-note' }, group.note) : null,
    ...group.knobs.map((knob) => drawKnob(knobFor(knob.key))));
}

function drawKnob(knob) {
  const id = `knob-${knob.key}`;
  const value = settings[knob.key];
  // Drawn whenever this knob could ever explain itself, even if it has
  // nothing to say yet: state() below is what fills it in, now and every
  // time the setting it depends on moves.
  const why = canExplain(knob)
    ? el('p', { class: 'caption knob-why', id: `${id}-why` })
    : null;

  const row = el('div', { class: `knob knob-${knob.kind}` },
    el('label', { for: id, class: 'knob-label' }, knob.label));
  let input;

  if (knob.kind === 'range') {
    const readOut = el('span', { class: 'knob-value' }, displayValue(knob, value));
    input = el('input', {
      type: 'range', id, class: 'knob-slider',
      min: knob.min, max: knob.max, step: knob.step, value: String(value),
      oninput: (event) => {
        text(readOut, displayValue(knob, event.target.value));
        change(knob, event.target.value);
      },
    });
    row.append(readOut, input);
    controls.set(knob.key, { input, readOut, why, knob });
  } else if (knob.kind === 'toggle') {
    input = el('input', {
      type: 'checkbox', id, class: 'knob-box',
      onchange: (event) => change(knob, event.target.checked),
    });
    input.checked = value === true;
    row.append(input);
    controls.set(knob.key, { input, why, knob });
  } else {
    input = el('select', {
      id, class: 'knob-select',
      onchange: (event) => change(knob, event.target.value),
    }, ...knob.choices.map(([choice, label]) => el('option', { value: choice }, label)));
    input.value = String(value);
    row.append(input);
    controls.set(knob.key, { input, why, knob });
  }

  if (why !== null) row.append(why);
  state(controls.get(knob.key), row);
  return row;
}

/** Put one control into the state the current settings ask for: live or
 *  idle, and the sentences that go with that. The ONE place that decides it,
 *  so a knob drawn idle and a knob that becomes idle cannot disagree. */
function state({ input, why, knob }, row = input.closest('.knob')) {
  const notes = notesFor(knob, settings);
  const idle = idleReason(knob, settings) !== null;
  input.disabled = idle;
  row?.classList.toggle('knob-idle', idle);
  if (why === null) return;
  text(why, notes.join(' '));
  // An empty <p> is not something to point a screen reader at.
  why.hidden = notes.length === 0;
  if (notes.length === 0) input.removeAttribute('aria-describedby');
  else input.setAttribute('aria-describedby', why.id);
}

/** A preset overwrites every knob at once, so the whole surface is redrawn
 *  and the whole settings object is what gets owed to the engine. */
function applyAll(next) {
  const changed = {};
  for (const key of OPTION_KEYS) {
    if (settings[key] !== next[key]) changed[key] = next[key];
  }
  if (Object.keys(changed).length === 0) return;
  // The script is now on whichever preset these settings are, by equality —
  // the same rule the engine uses. Matched on the values rather than on the
  // button that was pressed, so applying a preset that happens to equal
  // another one cannot leave the wrong one marked.
  onPreset = presets.find((p) => OPTION_KEYS.every((k) => p.settings[k] === next[k]))?.id ?? null;
  settings = { ...settings, ...changed };
  ctx.state.script.settings = settings;
  pending = { ...pending, ...changed };
  draw();
  schedule();
}

function change(knob, raw) {
  const value = coerceValue(knob, raw);
  if (value === null || settings[knob.key] === value) return;
  // One moved knob takes the script off whatever preset it was on. The mark
  // has to go with it or the surface keeps claiming a name that stopped
  // being true, which is the exact failure src/settings/presets.ts refuses
  // to commit by storing equality instead of an identity.
  const wasOn = onPreset;
  onPreset = null;
  if (wasOn !== null) refreshPresets();
  settings = { ...settings, [knob.key]: value };
  ctx.state.script.settings = settings;
  pending = mergePending(pending, knob.key, value);
  // Alignment decides whether two other knobs mean anything, and those two
  // have to say so themselves.
  if (knob.key === 'cueAlignment') refreshIdle();
  say(statusFor('pending'));
  schedule();
}

/** Swap the preset row for a fresh one, so the "you are here" mark can move
 *  when a knob does. Only this row is rebuilt, for the same reason
 *  refreshIdle() exists: a full redraw under the reader's pointer would drop
 *  the control they are currently holding. */
function refreshPresets() {
  if (presetsBox === null) return;
  const next = drawPresets();
  if (next === null) return;
  presetsBox.replaceWith(next);
  presetsBox = next;
}

/** Re-state the knobs whose meaning depends on another setting, without
 *  rebuilding the surface — a redraw under the reader's pointer would drop
 *  the control they are holding. Same state() the draw uses, so the sentence
 *  beside a control is corrected rather than left standing. */
function refreshIdle() {
  for (const control of controls.values()) {
    if (!control.knob.needs) continue;
    state(control);
  }
}

function schedule() {
  clearTimeout(timer);
  timer = setTimeout(() => {
    // Serialised behind whatever is already in flight: two conversions
    // writing the same EPUB is a race, and a slow early one finishing last
    // would leave the file disagreeing with the screen.
    running = running.catch(() => {}).then(flush);
  }, SETTLE_MS);
}

async function flush() {
  const script = ctx.state.script;
  const mine = era;
  const owed = pending;
  pending = {};
  if (!isPending(owed) || !script?.fountainPath) return;

  /** A change that was not stored is still owed. Clearing `pending` before
   *  the engine is asked is what makes a knob moved DURING the save land in
   *  the next one; but if the save itself fails, dropping what it carried
   *  would leave the screen showing values the engine never wrote. */
  const giveBack = () => { pending = restorePending(owed, pending); };
  /** Another script was opened while this was in flight. The engine has
   *  already been asked and there is no taking that back, but painting its
   *  answer would put the previous script's pages into the reader. */
  const stale = () => era !== mine;

  say(statusFor('saving'));
  try {
    const saved = settingsFrom(await runEngine(
      argv.settings(script.fountainPath, JSON.stringify(owed))));
    if (stale()) return;
    if (saved === null) {
      giveBack();
      say(statusFor('failed', NO_MESSAGE));
      return;
    }
    script.settings = saved;
    // The engine is the authority on what was stored. It agrees with the
    // screen whenever the clamps agree, which is why this redraw is silent
    // almost always — and why, when it does not, the screen is the thing
    // that is wrong and gets redrawn rather than the file. A knob moved
    // while this was in flight is not yet in `saved`, so the screen keeps
    // what it has and the next flush reconciles.
    if (!isPending(pending) && !sameSettings(saved, settings)) {
      settings = saved;
      draw();
    }
    if (script.epubPath === null) {
      say(statusFor('saved'));
      return;
    }
    const answer = await runEngine(
      argv.reconvert(script.fountainPath, script.epubPath, JSON.stringify(script.settings)));
    if (stale()) return;
    if (answer.ok !== true) {
      // The settings ARE stored; it is the book that did not get rebuilt,
      // and the surface may not claim otherwise. Owing them again is what
      // makes the next change try the rebuild again.
      giveBack();
      say(statusFor('failed', answer.error?.message));
      return;
    }
    script.previewHtml = answer.previewHtml ?? script.previewHtml;
    // Both frames, because the reader is a surface the reader may come back
    // to and this one is on screen right now. They render the same document;
    // neither is a copy of the other's rendering.
    renderReader(script.previewHtml);
    renderPreview(script.previewHtml);
    say(statusFor(isPending(pending) ? 'pending' : 'saved'));
  } catch (err) {
    if (stale()) return;
    giveBack();
    say(statusFor('failed', err.message));
  }
}

function say(status) {
  if (statusLine === null) return;
  text(statusLine, status.line);
  statusLine.classList.toggle('bad', status.bad);
}
