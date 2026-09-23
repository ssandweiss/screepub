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

/** The Updates block's rules, pulled out of the subscriber so every moment
 *  can be checked directly, without mounting a surface.
 *
 *  Pure: a function of the CURRENT phase (whatever update-flow.js just
 *  emitted) and of what the block has already drawn —
 *    state.drewOffer   has an offer ever been shown this session? A null
 *                       phase before the first offer is this block's own
 *                       IDLE state (nothing has been asked yet); a null
 *                       phase after one is a check that found nothing
 *                       newer, and those read very differently.
 *    state.version /
 *    state.body        the version and notes an offer or a download most
 *                       recently named. installing, waiting, restarting,
 *                       failed and installed carry no body of their own,
 *                       and blanking the notes the instant the download
 *                       starts would be its own small lie.
 *
 *  `say` is `undefined`, not a string, exactly where the caller should
 *  leave its own text alone. */
export function notesView(phase, state) {
  const drewOffer = Boolean(state?.drewOffer);
  if (phase === null || phase === undefined) {
    return {
      say: drewOffer ? `Screepub ${RELEASE.version} is the newest there is.` : undefined,
      body: { text: '', hidden: true },
      install: { text: '', hidden: true, disabled: true },
      checkDisabled: false,
    };
  }
  if (phase.kind === 'offer') {
    return {
      say: `Screepub ${phase.version} is available.`,
      body: { text: phase.body ?? '', hidden: !phase.body },
      // A retry leaving 'failed' re-emits its own 'offer' phase, marked
      // retrying, while installAndRestart's fresh check is still in
      // flight (update-flow.js). Nothing is confirmed yet, so Install
      // must not look ready to click again.
      install: { text: `Install ${phase.version}`, hidden: false, disabled: Boolean(phase.retrying) },
      checkDisabled: false,
    };
  }
  // Every other kind. `downloading` carries its own (possibly NEWER) body —
  // a retry's own fresh check can find a version with different release
  // notes than what was last offered — so it is used fresh; everything
  // else keeps naming whatever state last drew.
  const version = phase.version ?? state?.version ?? '';
  const body = phase.kind === 'downloading' ? (phase.body ?? '') : (state?.body ?? '');
  // Disabled while a run is busy doing something a manual "current" would
  // contradict, and once installed (the bundle is already swapped). NOT
  // while 'failed': a manual check is exactly how someone stuck on a
  // failure finds out whether a newer fix has since shipped.
  const checkDisabled = phase.kind === 'downloading' || phase.kind === 'installing'
    || phase.kind === 'waiting' || phase.kind === 'restarting' || phase.kind === 'installed';
  return {
    say: phase.kind === 'failed' ? phase.message : updateLabel(phase),
    body: { text: body, hidden: !body },
    install: { text: `Install ${version}`, hidden: false, disabled: phase.kind !== 'failed' },
    checkDisabled,
  };
}

// The one checkbox the "once a day" switch actually is, so show() (below)
// can resync it. Null wherever the block is absent (flow.usable() false).
let autoCheckbox = null;

/** Called just before the release notes sheet opens (main.js, frame.onRev),
 *  because the sheet is built ONCE at boot and readState(localStorage) was
 *  read once then too: a "Turn on" given later, under the drop well on the
 *  Convert page, answered shouldAsk() and reached the flow, but never
 *  reached this checkbox, which kept showing off until the window
 *  relaunched. */
export function show() {
  if (autoCheckbox === null) return;
  autoCheckbox.checked = readState(localStorage).optedIn;
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

  // Whatever notesView's checkDisabled last said, so the manual click
  // handler below can restore THAT rather than unconditionally re-enable a
  // button the flow (started from the label, say) still wants disabled.
  let checkDisabled = false;

  const auto = el('input', {
    type: 'checkbox',
    id: 'update-auto',
    checked: state.optedIn,
    onchange: (event) => {
      rememberAnswer(localStorage, event.target.checked);
      text(say, event.target.checked
        ? 'Screepub will look once a day, and only for this file.'
        : 'Screepub will not look on its own.');
    },
  });
  autoCheckbox = auto;

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
    // Not unconditionally false: a flow run started elsewhere (the label,
    // say) may have become busy WHILE this request was in flight, and this
    // restores to whatever it currently wants rather than fight it.
    button.disabled = checkDisabled;
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

  // What notesView needs to keep naming a version/body across moments that
  // carry none of their own (see the pure function's own doc comment).
  let drewOffer = false;
  let lastVersion = null;
  let lastBody = '';
  flow.subscribe((phase) => {
    const view = notesView(phase, { drewOffer, version: lastVersion, body: lastBody });
    if (view.say !== undefined) text(say, view.say);
    text(body, view.body.text);
    body.hidden = view.body.hidden;
    text(install, view.install.text);
    install.hidden = view.install.hidden;
    install.disabled = view.install.disabled;
    checkDisabled = view.checkDisabled;
    button.disabled = checkDisabled;
    if (phase !== null && phase !== undefined) {
      drewOffer = true;
      if (phase.version !== undefined) lastVersion = phase.version;
      if (phase.kind === 'offer' || phase.kind === 'downloading') lastBody = phase.body ?? '';
    }
  });
  return block;
}
