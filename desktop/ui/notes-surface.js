// Notes: what changed in the version you are running.
//
// The notes are compiled into desktop/ui/notes.js at build time by
// tools/build-desktop-notes.ts, so this works offline and needs no markdown
// library. Everything here is built with el(); nothing is ever markup.
import { RELEASE } from './notes.js';
import { el, text } from './dom.js';
import { updateCheck } from './app.js';
import { readState, rememberAnswer, runCheck, updateLabel } from './update.js';
import { flow } from './update-flow.js';

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
 *  Absent entirely unless updates can happen in this build and on this
 *  platform (update-flow.js, usable). A control whose only outcome is an
 *  error is worse than no control.
 *
 *  It follows the same flow as the label beside the stamp, so the two never
 *  describe the same update differently, and a launch check that answers
 *  after this sheet was built still reaches it. */
function updateBlock() {
  if (!flow.usable()) {
    // The fallback that shipped before any of this: say where releases live
    // rather than leave someone guessing.
    return el('p', { class: 'caption' },
      'Screepub does not update itself here. New releases are at '
      + 'github.com/ssandweiss/screepub/releases.');
  }

  const say = el('p', { class: 'caption update-status', role: 'status' }, '');
  const state = readState(localStorage);

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
  button.addEventListener('click', async () => {
    button.disabled = true;
    text(say, 'Looking…');
    // manual: pressing the button IS the consent for this one request, so it
    // runs whatever the switch says.
    const result = await runCheck({
      manual: true, storage: localStorage, now: Date.now(), check: updateCheck,
    });
    button.disabled = false;
    if (result.outcome === 'error') { text(say, result.message); return; }
    if (result.outcome !== 'offer') {
      text(say, `Screepub ${RELEASE.version} is the newest there is.`);
      return;
    }
    // The flow's own phase redraws everything below, including `say`, so
    // there is nothing left for this handler to set.
    flow.offerFound(result);
  });

  // One body and one Install button, built up front and hidden until an
  // offer, so a version that repeats (the remembered stub, then the live
  // check confirming it) redraws these rather than appending a second body
  // and a second Install button beside the first.
  const body = el('p', { class: 'prose update-body', hidden: true }, '');
  const install = el('button', { type: 'button', class: 'btn btn-brad btn-small', hidden: true }, '');
  install.addEventListener('click', () => {
    install.disabled = true;
    flow.start();
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
    body,
    install,
  );

  flow.subscribe((phase) => {
    if (phase === null) {
      body.hidden = true;
      install.hidden = true;
      return;
    }
    if (phase.kind === 'offer') {
      text(say, `Screepub ${phase.version} is available.`);
      text(body, phase.body ?? '');
      body.hidden = !phase.body;
      text(install, `Install ${phase.version}`);
      install.hidden = false;
      install.disabled = false;
      return;
    }
    // Every later moment is the label's words, except a failure, which gets
    // the full reason here: this is where someone looks for it.
    text(say, phase.kind === 'failed' ? phase.message : updateLabel(phase));
    install.disabled = phase.kind !== 'failed';
  });
  return block;
}
