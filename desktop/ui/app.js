// The window's whole share of the work: build an argv, hand it to Rust,
// parse what comes back.
//
// This is the ONLY file that touches Tauri, and the only file that knows an
// engine flag. The Rust does not know these flags and must not learn them:
// --json is this file's responsibility, and so is deciding what the answer
// means. See ADR 2026-09-12: Rust is a window, not a brain.
// tests/desktop-shell.test.ts and tests/desktop-ui.test.ts read this file
// by name; keep every invoke() and every flag literal here.

// Resolved at call time, not at import time. `window.__TAURI__` only exists
// inside the shell, and reaching for it while the module loads would make
// this file impossible to import anywhere else — including from the test
// that runs every argv builder below and checks what it produced.
const tauri = () => window.__TAURI__;

/** The flag the window's own override button stands for. It is spelled here
 *  with every other flag, and exported because the refusal the engine writes
 *  names it in prose: the surface that has already drawn the button needs to
 *  recognise the sentence telling a reader to type it. */
export const FORCE_FLAG = '--force';

/** Every argv this window ever builds. One place, so a flag cannot be spelled
 *  two ways, and so a reviewer can read the whole contract at once. */
export const argv = {
  version: () => ['--version', '--json'],

  /** The first conversion. --progress makes the engine narrate to stderr,
   *  which the shell forwards as `engine-line`; --preview-inline puts the
   *  reader's document in the answer, because the window cannot read files;
   *  --library keeps the .epub, the .fountain and the sidecar out of whatever
   *  folder the reader happened to drag the PDF from. Where the library IS
   *  belongs to the engine (src/library.ts) — this window never names a path,
   *  and reads the ones it gets back off the answer. */
  convert: (path, { force = false, optionsJson = null } = {}) =>
    [path, '--json', '--progress', '--preview-inline', '--library',
      force ? FORCE_FLAG : null,
      optionsJson ? '--options-json' : null, optionsJson].filter((a) => a !== null),

  /** A re-render from the cached .fountain, writing the library EPUB back in
   *  place so what gets sent stays what was previewed. */
  reconvert: (fountain, epubPath, optionsJson) =>
    [fountain, '--json', '--preview-inline', '-o', epubPath,
      '--options-json', optionsJson],

  devices: () => ['devices', '--json'],

  send: (file, deviceId = null) =>
    ['send', file, '--json', deviceId ? '--device' : null, deviceId]
      .filter((a) => a !== null),

  settings: (fountain, set = null) =>
    ['settings', fountain, '--json', set ? '--set' : null, set].filter((a) => a !== null),

  export: (epub, { forFormat, fountain = null, optionsJson = null }) =>
    ['export', epub, '--json', '--for', forFormat,
      fountain ? '--fountain' : null, fountain,
      optionsJson ? '--options-json' : null, optionsJson].filter((a) => a !== null),

  /** Can this computer make KFX for a Kindle? Installs nothing. */
  kfxStatus: () => ['kfx-status', '--json'],

  /** Install the KFX plugin into Calibre. Fetches it from Calibre's plugin
   *  index and writes into the user's Calibre, so it is only ever built in
   *  answer to a press of the button that says so (kfx.js). */
  kfxInstall: () => ['kfx-install', '--json'],
};

/** How much of an unparseable answer goes in the message a person reads.
 *  A truncated answer is still the whole of whatever did arrive, and the
 *  fault body is a 52-character column: the first few lines say what went
 *  wrong, and the rest only buries the two buttons under it. */
const RAW_SHOWN = 300;

// How many COUNTED engine calls are running right now (see countsTowardBusy
// for the one exception). An update's restart waits for the engine to have
// been quiet a while (update.js, installAndRestart), because every counted
// call is somebody's work: a conversion, a copy to a Kindle, a settings file
// half written. Counted HERE because this is the one door every call goes
// through.
let inFlight = 0;
let idleWaiters = [];

// Idle means no counted engine call has been RUNNING for this long, not
// merely that the count last touched zero. A reviewer reproduced the bug a
// single macrotask left open: send.js's sendTo() runs settings (via its own
// ensureSettings()), export and send as an AWAITED CHAIN, and tune.js's
// flush() runs a save then a rebuild the same way; the next call in either
// chain starts again within microtasks of the one before it finishing, so
// the count touches zero BETWEEN two calls that belong to the same job, not
// just after the job ends. 500 ms covers that gap.
//
// It does NOT cover every knob move. tune.js debounces a change behind its
// own 300 ms settle timer (SETTLE_MS; schedule()) before the change ever
// reaches the engine as a save. That debounce is
// covered only for a knob moved DURING a save, or within the 200 ms after
// one ends: only then has the 300 ms timer fired, and the engine call it
// produces started, by the time this quiet period would otherwise expire. A
// knob moved after a LONGER quiet has no engine call running yet when the
// debounce starts, so a restart already waiting on whenIdle() can fire and
// drop the change before tune.js ever asks the engine to save it. That gap
// is not closed here.
export const ENGINE_QUIET_MS = 500;

// performance.now() when a counted call last finished. -Infinity so a
// whenIdle() asked before anything has ever run resolves at once, the same
// as one asked long after everything has. performance.now() rather than
// Date.now(): it is monotonic, so a clock sync, DST, or the system clock
// changing cannot make this go negative or huge and either hold a restart
// off forever or release it early.
let lastEnded = -Infinity;
let settleTimer = null;

/** Whether a call is worth counting toward "the engine is busy".
 *
 *  `devices` is not: send.js polls it every 2 s while the Send tab is open,
 *  and each poll takes about 1.5 s on its own (the reMarkable probe
 *  timeout). It is never mid-job — killing a listing loses nothing — so
 *  counting it would flash "Restarting after this finishes…" on a tab that
 *  is just sitting there polling, and WITH a quiet period, could hold a
 *  restart off indefinitely for as long as that tab stayed open.
 *
 *  `kfx-status` is not either, for the same reason: kfx.js's probe() runs
 *  it when the Send tab opens and again every time the window gets focus
 *  back, read-only and never mid-job. `kfx-install` is the one that
 *  actually writes (into Calibre) and stays counted. */
function countsTowardBusy(args) {
  return args[0] !== argv.devices()[0] && args[0] !== argv.kfxStatus()[0];
}

/** Release every whenIdle() waiter if the engine has been quiet for
 *  ENGINE_QUIET_MS; otherwise arrange to try again once it has been. Called
 *  both when a counted call finishes and when whenIdle() adds a waiter, so a
 *  caller arriving after the quiet period already elapsed does not sit
 *  waiting for a moment that already passed. */
function settle() {
  if (inFlight !== 0 || idleWaiters.length === 0) return;
  const remaining = ENGINE_QUIET_MS - (performance.now() - lastEnded);
  if (settleTimer) {
    clearTimeout(settleTimer);
    settleTimer = null;
  }
  if (remaining > 0) {
    settleTimer = setTimeout(settle, remaining);
    return;
  }
  const waiters = idleWaiters;
  idleWaiters = [];
  for (const resolve of waiters) resolve();
}

/** Run the engine and parse its one line of stdout, counted while it runs
 *  (see countsTowardBusy for the one call this skips). See runEngineOnce for
 *  what the answer means. */
export async function runEngine(args) {
  const counted = countsTowardBusy(args);
  if (counted) inFlight += 1;
  try {
    return await runEngineOnce(args);
  } finally {
    if (counted) {
      inFlight -= 1;
      lastEnded = performance.now();
      settle();
    }
  }
}

/** True while any COUNTED engine call is running. Unlike whenIdle, this asks
 *  nothing about the quiet period: it is the instantaneous fact, not the
 *  promise a restart waits on. Its only reader is update.js's 'waiting'
 *  label (wired through update-flow.js's `busy: engineBusy`); no surface
 *  reads it to disable a button. */
export function engineBusy() {
  return inFlight > 0;
}

/** Resolves once the engine has been quiet for ENGINE_QUIET_MS: at once if
 *  it already has been (including if nothing has run yet). Always goes
 *  through settle(), the one place a waiter is ever released, so a caller
 *  can never observe "idle" a macrotask before the quiet period is actually
 *  up. */
export function whenIdle() {
  return new Promise((resolve) => {
    idleWaiters.push(resolve);
    settle();
  });
}

/** Run the engine and parse its one line of stdout.
 *  Throws an Error whose message is fit to show a person.
 *
 *  The answer arrives as a string, however big it is. That was measured
 *  rather than assumed: returning it from Rust as BYTES instead — which
 *  takes a different route through Tauri's IPC — was tried and timed in the
 *  live window at 384 KB, 1.04 MB and 3.47 MB, and was SLOWER every time
 *  (median 430 vs 330 ms, 1006 vs 718 ms, 4803 vs 3864 ms), so the decode
 *  branch it needed was taken out again. See desktop/README.md. */
async function runEngineOnce(args) {
  let stdout;
  try {
    stdout = await tauri().core.invoke('run_engine', { args });
  } catch (message) {
    // Rust rejected: it could not find or start the binary at all.
    throw new Error(String(message));
  }
  try {
    return JSON.parse(stdout);
  } catch {
    // The engine printed something that is not its contract. Show it raw
    // rather than swallowing it — this is how a dropped --json presents —
    // but only as much of it as a person can actually read.
    const shown = stdout.length > RAW_SHOWN ? `${stdout.slice(0, RAW_SHOWN)}…` : stdout;
    throw new Error(`the engine did not answer in JSON:\n${shown}`);
  }
}

// One outstanding file dialog, ever. Ctrl-O twice used to open two native
// pickers — both modal, both waiting on the same window — because the only
// guard the window had was `busy`, and `busy` is a running CONVERSION.
let dialogOpen = false;
const dialogClosed = [];

/** Called after every dialog this file opens closes, however it closed.
 *  main.js puts the keyboard back with it; see focus.js for why that is not
 *  the dialog-opening surface's business. */
export function onDialogClosed(handler) {
  dialogClosed.push(handler);
}

/** True while a native dialog is on screen. */
export function isDialogOpen() {
  return dialogOpen;
}

/** Ask the OS for a screenplay. Null when the reader cancelled — and null,
 *  without opening anything, when a picker is already up. */
export async function pickScreenplay() {
  if (dialogOpen) return null;
  dialogOpen = true;
  try {
    const path = await tauri().core.invoke('pick_file');
    return path ?? null;
  } finally {
    dialogOpen = false;
    for (const handler of dialogClosed) handler();
  }
}

/** Every diagnostic line the engine writes, verbatim, as it writes it.
 *  Resolves to the function that stops listening. */
export function onEngineLine(handler) {
  return tauri().event.listen('engine-line', (event) => handler(String(event.payload)));
}

/** OS drag-and-drop. Tauri intercepts it before the webview sees it, so the
 *  HTML5 drop event never fires and the PATHS — which is all the engine can
 *  use — arrive here instead. The payload is Tauri's DragDropPayload:
 *  `{ paths: [...], position: { x, y } }` on enter and drop, and nothing at
 *  all on leave. Which of the paths to convert is not decided here; this file
 *  is the boundary, not the surface. */
export function onFileDrag({ over, drop }) {
  tauri().event.listen('tauri://drag-enter', () => over(true));
  tauri().event.listen('tauri://drag-leave', () => over(false));
  tauri().event.listen('tauri://drag-drop', (event) => {
    over(false);
    drop(event.payload?.paths ?? []);
  });
}

/** Hand a URL to the OS. The window's first and only door onto anything
 *  outside itself (ADR 2026-09-21 — doors, not commands).
 *
 *  It is HERE because this file is the only one that touches Tauri, and
 *  opening a URL is a Tauri call. The URL itself is built by feedback.js,
 *  which is pure and knows nothing about any of this.
 *
 *  What may be opened is not decided here and must not be. The capability
 *  scopes the grant to this project's issue tracker and the three Calibre
 *  and Kindle Previewer download pages the KFX checklist links to, so a URL
 *  pointing anywhere else is refused by Tauri rather than quietly followed —
 *  which is the property that makes passing a built string to it safe at
 *  all.
 *
 *  Resolves either way. A bug report that will not open is a disappointment;
 *  it is not a reason to throw into a click handler on a screen that is
 *  already showing someone a failure. */
export async function openUrl(url) {
  try {
    await tauri().opener.openUrl(String(url));
    return true;
  } catch {
    return false;
  }
}

/** Show a file where it lives, selected, in the OS file manager.
 *
 *  Scoped to the library in capabilities/default.json, so a path outside it
 *  is refused by Tauri rather than revealed. That scope uses `$DOCUMENT`,
 *  which means a library MOVED with $SCREEPUB_LIBRARY is outside it and this
 *  returns false. Honest and narrow beats broad and convenient: the day the
 *  settings gear can set the folder, the scope follows it there.
 *
 *  Resolves either way, like openUrl. A reveal that will not open is a
 *  disappointment, not a reason to throw inside a click handler. */
export async function revealItem(path) {
  try {
    await tauri().opener.revealItemInDir(String(path));
    return true;
  } catch {
    return false;
  }
}

/** Whether the updater plugin is linked into THIS build.
 *
 *  It arrives on a separate branch, so a window built before that lands has
 *  no `updater` at all. Every update affordance is drawn behind this, which
 *  means the feature appears when the plugin does and never shows a control
 *  that can only throw. */
export function updaterReady() {
  return typeof tauri()?.updater?.check === 'function';
}

/** Ask the endpoint whether there is a newer release.
 *
 *  Deliberately NOT caught here. A rejection is the answer in the failure
 *  case and carries the only description of what went wrong — a 404 manifest
 *  reads differently from no network — so it goes up to update.js, which
 *  turns it into something a person can read. Swallowing it here is how a
 *  failed check becomes an indistinguishable "you are up to date". */
export async function updateCheck() {
  return tauri().updater.check();
}

/** Download and swap the bundle, reporting bytes as they arrive.
 *
 *  `close()` releases a resource held on the Rust side, so it runs whatever
 *  happened. The plugin does not relaunch on macOS; restartApp below does,
 *  once whenIdle above says the engine is quiet enough to leave. */
export async function updateInstall(update, onProgress) {
  try {
    await update.downloadAndInstall((event) => onProgress?.(event));
  } finally {
    await update.close?.();
  }
}

/** Whether tauri-plugin-process is linked into THIS build, the same test
 *  updaterReady makes for the updater. A build without it falls back to
 *  asking the reader to quit and reopen. */
export function restartReady() {
  return typeof tauri()?.process?.relaunch === 'function';
}

/** Restart into whatever bundle is on disk now. After an update, that is the
 *  new version: Tauri reads Contents/Info.plist to find the binary on macOS
 *  (tauri 2.11.5, src/process.rs). Only `restart` is granted to this window;
 *  the plugin's `exit` is not. */
export async function restartApp() {
  await tauri().process.relaunch();
}

/** The progress lines, decoded. The payload is whatever the OS handed the
 *  Rust, so one event may carry several lines or a partial one; anything
 *  that is not a progress object is ignored rather than thrown, because a
 *  stray warning on stderr must not take a conversion down with it. */
export function onProgress(handler) {
  return onEngineLine((payload) => {
    for (const line of payload.split('\n')) {
      const trimmed = line.trim();
      if (trimmed === '') continue;
      try {
        const parsed = JSON.parse(trimmed);
        if (parsed && parsed.progress) handler(parsed.progress);
      } catch {
        // Not JSON, not ours.
      }
    }
  });
}
