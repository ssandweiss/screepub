// Boots the window: the frame, the five surfaces, the keyboard, and the one
// line that proves the engine is there.
import { runEngine, argv, onFileDrag, onDialogClosed } from './app.js';
import { shouldAsk, updateLabel } from './update.js';
import { flow } from './update-flow.js';
import { mountFrame } from './frame.js';
import { stopAfterDialog } from './focus.js';
import { el } from './dom.js';
import * as convert from './convert.js';
import * as read from './read.js';
import * as tune from './tune.js';
import * as send from './send.js';
import * as notes from './notes-surface.js';

/** Everything the surfaces share. One object, passed in, never read as a
 *  global from another module. */
export const state = {
  script: null,
  devices: [],
  reducedMotion: matchMedia('(prefers-reduced-motion: reduce)').matches,
};

const root = document.getElementById('app');
const frame = mountFrame(root);

// Notes is not in the bar. It is what changed in the version you are running,
// so it is reached from the stamp that names that version, and it arrives as
// a sheet over the page rather than a place you navigate to and have to come
// back from.
//
// A real <dialog> rather than a hand-rolled panel: it brings Esc, the focus
// trap, the inert background and the restored focus with it, all of which
// this window would otherwise have to write and keep right.
const notesSheet = el('dialog', { class: 'sheet-over', 'aria-label': 'Release notes' });
const notesBody = el('div', { class: 'sheet-body' });
notes.mount(notesBody);
notesSheet.append(
  el('button', {
    type: 'button',
    class: 'btn-quiet sheet-close',
    onclick: () => notesSheet.close(),
  }, 'Close'),
  notesBody,
);
root.append(notesSheet);
frame.onRev(() => notesSheet.showModal());

const surfaces = { convert, read, tune, send };

/** The surfaces that have nothing to show until a script is open. */
const NEEDS_SCRIPT = ['read', 'tune', 'send'];

// Which surface is on screen. Kept here rather than asked of the frame,
// because it is what decides where the keyboard goes back to.
let showing = 'convert';

/** Put the keyboard somewhere it can carry on from, for whatever surface is
 *  actually on screen. The rule is focus.js's; this is the whole of the
 *  binding — query the plan's selectors in order, take the first node that
 *  can really take the focus, focus it.
 *
 *  Called after every native dialog (app.js says when, for every dialog it
 *  ever opens, not just this one path) and by any surface that has just
 *  redrawn the element the keyboard was standing on. */
function restoreFocus() {
  const stop = stopAfterDialog(showing, (selector) => document.querySelectorAll(selector));
  stop?.focus();
  return stop;
}

onDialogClosed(restoreFocus);

const context = {
  state,
  goTo: (id) => frame.setSurface(id),
  restoreFocus,
  /** The one-time update question under the drop well. The rule is
   *  update.js's; the answer goes to the flow. */
  updates: {
    shouldAsk: () => shouldAsk(flow.usable(), localStorage),
    answer: (on) => flow.answer(on),
  },
  /** Called whenever the script on screen changes, so the other surfaces
   *  stop showing a book that is no longer open. */
  scriptChanged() {
    const open = state.script !== null;
    for (const id of NEEDS_SCRIPT) frame.enable(id, open);
    for (const surface of Object.values(surfaces)) surface.scriptChanged?.();
  },
};

const panes = {};
for (const [id, surface] of Object.entries(surfaces)) {
  const pane = el('section', {
    class: 'surface',
    id: `surface-${id}`,
    role: 'tabpanel',
    'aria-labelledby': `tab-${id}`,
    tabindex: '0',
    hidden: true,
  });
  frame.sheet.append(pane);
  panes[id] = pane;
  surface.mount(pane, context);
}

frame.onSurface((id) => {
  showing = id;
  for (const [name, pane] of Object.entries(panes)) {
    const on = name === id;
    pane.hidden = !on;
    if (on) surfaces[name].show?.();
    else surfaces[name].hide?.();
  }
});

// A file dragged onto the window lands on Convert, whatever was on screen.
// Tauri takes the drop before the webview sees it, so this is the only way
// the paths reach the page at all.
onFileDrag({
  over: (on) => convert.dragOver(on),
  drop: (paths) => convert.dropPaths(paths),
});

// Ctrl/Cmd-O opens a script from anywhere. Rust registers no menu, so the
// window owns its own shortcuts; convert.js prints the platform's spelling.
//
// It does NOT move to Convert first. Converting a file does (convert.js owns
// that, for the shortcut and for a drop alike), but ASKING for one should
// not: someone who hits the shortcut on Tune and then changes their mind
// used to be left on a surface they had not asked for, with the work they
// were doing off screen. Cancelling now leaves them exactly where they were
// — which is also what makes the focus rule above general rather than a
// dressed-up special case for Convert.
addEventListener('keydown', (event) => {
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'o') {
    event.preventDefault();
    convert.choose();
  }
});

// No script yet, so Read, Tune and Send start out of reach. Going through
// scriptChanged rather than three enable() calls keeps one rule for which
// surfaces a script unlocks.
context.scriptChanged();
frame.setSurface('convert');

// The stamp already names the build, so a working engine needs no
// announcement. A broken one does: this is still the only check that the
// sidecar can be started at all, and without it the first sign of trouble
// would be a conversion that never begins.
runEngine(argv.version()).then(
  () => {},
  (err) => frame.engineFailed(err.message),
);

// Updates. update-flow.js owns the one run and the moment it is in; the frame
// only shows the words and reports a click, and notes-surface.js listens to
// the same flow, so the label and the release notes never disagree.
//
// flow.boot() is the once-a-day check the README promises: it redraws what an
// earlier check found, then asks the server only if the reader said yes to
// the question on the Convert page, and at most once a day (update.js).
flow.subscribe((phase) => frame.setUpdateLabel(updateLabel(phase)));
frame.onUpdateClick(() => flow.start());
flow.boot();
