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
import { render as renderReader } from './read.js';

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
      { key: 'scenePageBreaks', label: 'Start each scene on a new page', kind: 'toggle' },
      { key: 'keepSceneHeadingWithScene', label: 'Keep headings with their scene', kind: 'toggle' },
      {
        key: 'keepSpeechesWhole', label: 'Keep each speech on one page', kind: 'toggle',
        help: 'Avoids mid-speech page turns; long speeches may leave white space at page '
          + 'bottoms. Speeches taller than a full page still break.',
      },
      {
        key: 'printSplitMinimums', label: 'Print-style split minimums', kind: 'toggle',
        help: 'Never leaves a single line of a speech or paragraph alone at a page edge. '
          + 'Off packs pages tighter. Applies on new-format Kindle (KFX) and Kobo/tolino.',
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
        key: 'cueAlignment', label: 'Character cues', kind: 'choice',
        choices: [['centered', 'Centered'], ['indented', 'Indented']],
        help: 'Centered reads naturally at any screen width. Indented reproduces the '
          + 'fixed offsets of a printed script.',
      },
      {
        key: 'cueIndentPct', label: 'Cue indent',
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
        key: 'justifyText', label: 'Justify body text', kind: 'toggle',
        help: 'Screenplays are traditionally ragged-right. Justifying opens stretchy word '
          + 'gaps in a narrow column.',
      },
      {
        key: 'preserveFontShifts', label: "Keep the PDF's font shifts", kind: 'toggle',
        help: 'Renders inserts, chyrons and on-screen text in the face and size the script '
          + 'drew them in. Off sets every block in the body typeface.',
      },
    ],
  },
  {
    id: 'front',
    title: 'What the book carries',
    knobs: [
      {
        key: 'includeTitlePage', label: 'Title page', kind: 'toggle', effect: 'book',
        help: 'The preview is the script itself, so a title page shows up in the book '
          + 'rather than here.',
      },
      { key: 'showSceneNumbers', label: 'Scene numbers', kind: 'toggle' },
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
        help: 'Joins the two halves of a speech the printed script broke with (MORE) and '
          + "(CONT'D). Off keeps the break where the PDF had it.",
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
      displayName: typeof preset?.displayName === 'string' ? preset.displayName : '',
      settings: settingsFrom(preset),
    }))
    .filter((preset) => preset.displayName !== '' && preset.settings !== null);
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
  slug: 'Int. the tuning bench - settings out of reach',
  line: 'Screepub could not read this script’s settings. The book itself is fine and can '
    + 'still be sent; converting the PDF again is the way to get the knobs back.',
  way: 'Convert it again',
};

export const LEDE = 'These settings belong to this script alone. They are saved beside it, '
  + 'and the book on disk is rebuilt to match, so what you send is what you see.';

export const PRESET_LABEL = 'Start from';

// ------------------------------------------------------------------ drawing

let ctx = null;
let pane = null;
let settings = null;
let presets = [];
let loaded = false;
let timer = null;
let running = Promise.resolve();
let pending = {};
let statusLine = null;
let controls = new Map();

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
  } catch (err) {
    settings = null;
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
    el('h2', { class: 'slug' }, 'Int. the tuning bench - day'),
    el('p', { class: 'prose' }, LEDE),
    drawPresets(),
    ...GROUPS.map(drawGroup),
    statusLine,
  );
  say(status ?? statusFor(isPending(pending) ? 'pending' : 'idle'));
}

function drawPresets() {
  if (presets.length === 0) return null;
  return el('div', { class: 'presets' },
    el('p', { class: 'state-label presets-label' }, PRESET_LABEL),
    ...presets.map((preset) => el('button', {
      type: 'button', class: 'btn btn-outline btn-small',
      onclick: () => applyAll(preset.settings),
    }, preset.displayName)));
}

function drawGroup(group) {
  return el('section', { class: 'knob-group' },
    el('h3', { class: 'subslug knob-group-title' }, group.title),
    group.note ? el('p', { class: 'caption knob-group-note' }, group.note) : null,
    ...group.knobs.map((knob) => drawKnob(knobFor(knob.key))));
}

function drawKnob(knob) {
  const id = `knob-${knob.key}`;
  const idle = idleReason(knob, settings);
  const value = settings[knob.key];
  const notes = [idle, knob.help].filter((note) => note !== null && note !== undefined);
  const described = notes.length === 0 ? null : `${id}-why`;

  const row = el('div', {
    class: `knob knob-${knob.kind}${idle === null ? '' : ' knob-idle'}`,
  },
  el('label', { for: id, class: 'knob-label' }, knob.label));

  if (knob.kind === 'range') {
    const readOut = el('span', { class: 'knob-value' }, displayValue(knob, value));
    const slider = el('input', {
      type: 'range', id, class: 'knob-slider',
      min: knob.min, max: knob.max, step: knob.step, value: String(value),
      disabled: idle !== null,
      'aria-describedby': described,
      oninput: (event) => {
        text(readOut, displayValue(knob, event.target.value));
        change(knob, event.target.value);
      },
    });
    row.append(readOut, slider);
    controls.set(knob.key, { input: slider, readOut, knob });
  } else if (knob.kind === 'toggle') {
    const box = el('input', {
      type: 'checkbox', id, class: 'knob-box',
      disabled: idle !== null,
      'aria-describedby': described,
      onchange: (event) => change(knob, event.target.checked),
    });
    box.checked = value === true;
    row.append(box);
    controls.set(knob.key, { input: box, knob });
  } else {
    const select = el('select', {
      id, class: 'knob-select',
      disabled: idle !== null,
      'aria-describedby': described,
      onchange: (event) => change(knob, event.target.value),
    }, ...knob.choices.map(([choice, label]) => el('option', { value: choice }, label)));
    select.value = String(value);
    row.append(select);
    controls.set(knob.key, { input: select, knob });
  }

  if (described !== null) {
    row.append(el('p', { class: 'caption knob-why', id: described }, notes.join(' ')));
  }
  return row;
}

/** A preset overwrites every knob at once, so the whole surface is redrawn
 *  and the whole settings object is what gets owed to the engine. */
function applyAll(next) {
  const changed = {};
  for (const key of OPTION_KEYS) {
    if (settings[key] !== next[key]) changed[key] = next[key];
  }
  if (Object.keys(changed).length === 0) return;
  settings = { ...settings, ...changed };
  ctx.state.script.settings = settings;
  pending = { ...pending, ...changed };
  draw();
  schedule();
}

function change(knob, raw) {
  const value = coerceValue(knob, raw);
  if (value === null || settings[knob.key] === value) return;
  settings = { ...settings, [knob.key]: value };
  ctx.state.script.settings = settings;
  pending = mergePending(pending, knob.key, value);
  // Alignment decides whether two other knobs mean anything, and those two
  // have to say so themselves.
  if (knob.key === 'cueAlignment') refreshIdle();
  say(statusFor('pending'));
  schedule();
}

/** Re-state which knobs are doing nothing, without rebuilding the surface —
 *  a redraw under the reader's pointer would drop the control they are
 *  holding. */
function refreshIdle() {
  for (const { input, knob } of controls.values()) {
    if (!knob.needs) continue;
    const idle = idleReason(knob, settings);
    input.disabled = idle !== null;
    input.closest('.knob')?.classList.toggle('knob-idle', idle !== null);
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
  const owed = pending;
  pending = {};
  if (!isPending(owed) || !script?.fountainPath) return;
  say(statusFor('saving'));
  try {
    const saved = settingsFrom(await runEngine(
      argv.settings(script.fountainPath, JSON.stringify(owed))));
    if (saved === null) {
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
    if (answer.ok !== true) {
      say(statusFor('failed', answer.error?.message));
      return;
    }
    script.previewHtml = answer.previewHtml ?? script.previewHtml;
    renderReader(script.previewHtml);
    say(statusFor(isPending(pending) ? 'pending' : 'saved'));
  } catch (err) {
    say(statusFor('failed', err.message));
  }
}

function say(status) {
  if (statusLine === null) return;
  text(statusLine, status.line);
  statusLine.classList.toggle('bad', status.bad);
}
