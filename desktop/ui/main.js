// Boots the window: the frame, the five surfaces, the keyboard, and the one
// line that proves the engine is there.
import { runEngine, argv } from './app.js';
import { mountFrame } from './frame.js';
import { el, text } from './dom.js';
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

// A printer's mark at the foot of the paper, not a status bar: it belongs to
// the page, so it is legible on it. The desk outside the sheet is dark in
// both modes and has no ink that reads against it.
const stamp = el('p', { class: 'engine-stamp' }, 'looking for the engine…');
frame.sheet.append(stamp);

const surfaces = { convert, read, tune, send, notes };

/** The surfaces that have nothing to show until a script is open. */
const NEEDS_SCRIPT = ['read', 'tune', 'send'];

const context = {
  state,
  goTo: (id) => frame.setSurface(id),
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
  for (const [name, pane] of Object.entries(panes)) {
    const on = name === id;
    pane.hidden = !on;
    if (on) surfaces[name].show?.();
    else surfaces[name].hide?.();
  }
});

// Ctrl/Cmd-O opens a script from anywhere. Rust registers no menu, so the
// window owns its own shortcuts; convert.js prints the platform's spelling.
addEventListener('keydown', (event) => {
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'o') {
    event.preventDefault();
    frame.setSurface('convert');
    convert.choose();
  }
});

// No script yet, so Read, Tune and Send start out of reach. Going through
// scriptChanged rather than three enable() calls keeps one rule for which
// surfaces a script unlocks.
context.scriptChanged();
frame.setSurface('convert');

runEngine(argv.version()).then(
  (answer) => text(stamp, `engine ${answer.version}`),
  (err) => { text(stamp, err.message); stamp.classList.add('bad'); },
);
