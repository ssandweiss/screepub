// Notes: what changed in the version you are running.
//
// The notes are compiled into desktop/ui/notes.js at build time by
// tools/build-desktop-notes.ts, so this works offline and needs no markdown
// library. Everything here is built with el(); nothing is ever markup.
import { RELEASE } from './notes.js';
import { el, text } from './dom.js';
import { updaterReady, updateCheck, updateInstall } from './app.js';
import {
  updatesPossible, readState, rememberAnswer, runCheck, installedLine, pendingUpdate,
} from './update.js';

/** What the surface decides: which sections have anything to show. The
 *  generator now throws rather than shipping a heading with zero bullets
 *  (build-desktop-notes.ts), so this should never actually drop one — it
 *  stays as the surface's own guarantee that a heading is never printed
 *  with nothing beneath it, and it is what a test calls directly rather
 *  than a DOM emulator. */
export function visibleSections(sections) {
  return sections.filter((section) => section.items.length > 0);
}

/** A plain Good to know caveat has no bold claim to lead with — its lead
 *  is '' — so it prints as plain prose instead of an empty <strong> and a
 *  stray leading space. */
function noteItem(item) {
  return item.lead
    ? el('p', { class: 'note-item' },
        el('strong', { class: 'note-lead' }, item.lead), ` ${item.body}`)
    : el('p', { class: 'note-item' }, item.body);
}

// The sheet is built ONCE, at boot, and the launch check resolves after
// that. So a pending offer cannot be read during mount — it is not there
// yet. This is the seam that lets the answer arrive late, and it exists
// because the first version read pendingUpdate() at build time and silently
// showed nothing: the dot appeared on the stamp and the sheet it pointed at
// had no news in it.
let statusEl = null;
let checkButton = null;

/** A launch check found something, after this surface was already drawn. */
export function updateFound(result) {
  if (statusEl === null || checkButton === null) return;
  offer(statusEl, checkButton, result);
}

export function mount(pane) {
  pane.append(
    el('h2', { class: 'slug' }, `Screepub ${RELEASE.version}`),
    el('p', { class: 'prose' }, RELEASE.headline),
    ...visibleSections(RELEASE.sections).map((section) =>
      el('section', { class: 'notes-section' },
        el('h3', { class: 'state-label' }, section.title),
        ...section.items.map(noteItem),
      ),
    ),
    updateBlock(),
  );
}

/** Whether there is a newer Screepub, asked where the current version is
 *  already named. This sheet answers "which version am I on and what changed
 *  in it", so "is there a newer one?" belongs in the same breath. It is also
 *  the only home available: the settings gear that will eventually hold the
 *  preference does not exist yet, and waiting for it would hold the updater
 *  behind engine work it does not need.
 *
 *  Absent entirely unless the plugin is linked AND the platform is one the
 *  published manifest covers. A control whose only outcome is an error is
 *  worse than no control, and this sheet is read by people who have just
 *  been told what version they are running — the worst possible audience for
 *  a button that says "could not check". */
function updateBlock() {
  const platform = navigator.userAgentData?.platform ?? navigator.platform;
  if (!updaterReady() || !updatesPossible(platform)) {
    // The fallback that shipped before any of this: say where releases live
    // rather than leave someone guessing.
    return el('p', { class: 'caption' },
      'Screepub does not update itself here. New releases are at '
      + 'github.com/ssandweiss/screepub/releases.');
  }

  const say = el('p', { class: 'caption update-status', role: 'status' }, '');
  const state = readState(localStorage);
  statusEl = say;
  // Held from the launch check, if it found something. Shown without asking
  // the server again: the answer is already in hand, and a second request
  // the moment somebody opens the notes would break the once-a-day promise
  // that made the first one acceptable.
  const waiting = pendingUpdate();

  const auto = el('input', {
    type: 'checkbox',
    id: 'update-auto',
    checked: state.optedIn ? '' : null,
    onchange: (event) => {
      rememberAnswer(localStorage, event.target.checked);
      text(say, event.target.checked
        ? 'Screepub will look once a day, and only for this file.'
        : 'Screepub will not look on its own.');
    },
  });

  const button = el('button', { type: 'button', class: 'btn btn-outline btn-small' },
    'Check for updates');
  checkButton = button;
  button.addEventListener('click', async () => {
    button.disabled = true;
    text(say, 'Looking…');
    // manual: pressing the button IS the consent for this one request, so it
    // runs whatever the toggle says.
    const result = await runCheck({
      manual: true, storage: localStorage, now: Date.now(), check: updateCheck,
    });
    button.disabled = false;
    if (result.outcome === 'error') { text(say, result.message); return; }
    if (result.outcome !== 'offer') {
      text(say, `Screepub ${RELEASE.version} is the newest there is.`);
      return;
    }
    offer(say, button, result);
  });

  const block = el('section', { class: 'notes-section update-block' },
    el('h3', { class: 'state-label' }, 'Updates'),
    el('p', { class: 'auto-check' },
      auto,
      el('label', { for: 'update-auto' },
        'Look for a new version once a day. Off by default; nothing is sent '
        + 'but the request itself.')),
    el('div', { class: 'read-ways' }, button),
    say,
  );
  // The launch check already found one. Present it straight away rather than
  // making somebody press a button to be told what the app has known since
  // startup.
  if (waiting) offer(say, button, waiting);
  return block;
}

/** There is a newer one. Name it, show what the server said about it, and
 *  make installing a second deliberate act rather than a consequence of
 *  having pressed Check. */
function offer(say, button, result) {
  text(say, `Screepub ${result.version} is available.`);
  const install = el('button', { type: 'button', class: 'btn btn-brad btn-small' },
    `Install ${result.version}`);
  install.addEventListener('click', async () => {
    install.disabled = true;
    button.disabled = true;
    text(say, 'Downloading…');
    try {
      await updateInstall(result.update, (event) => {
        if (event?.event === 'Started') text(say, 'Downloading…');
        if (event?.event === 'Finished') text(say, 'Installing…');
      });
      // The plugin swaps the bundle and stops. It does not relaunch on
      // macOS, and a one-click restart is another crate and another
      // permission, so this asks rather than pretends.
      text(say, installedLine(result.version));
    } catch (err) {
      text(say, String(err?.message ?? err));
      install.disabled = false;
      button.disabled = false;
    }
  });
  say.after(el('p', { class: 'prose update-body' }, result.body || ''), install);
}
