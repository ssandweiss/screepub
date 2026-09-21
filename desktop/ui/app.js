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
};

/** How much of an unparseable answer goes in the message a person reads.
 *  A truncated answer is still the whole of whatever did arrive, and the
 *  fault body is a 52-character column: the first few lines say what went
 *  wrong, and the rest only buries the two buttons under it. */
const RAW_SHOWN = 300;

/** Run the engine and parse its one line of stdout.
 *  Throws an Error whose message is fit to show a person.
 *
 *  The answer arrives as a string, however big it is. That was measured
 *  rather than assumed: returning it from Rust as BYTES instead — which
 *  takes a different route through Tauri's IPC — was tried and timed in the
 *  live window at 384 KB, 1.04 MB and 3.47 MB, and was SLOWER every time
 *  (median 430 vs 330 ms, 1006 vs 718 ms, 4803 vs 3864 ms), so the decode
 *  branch it needed was taken out again. See desktop/README.md. */
export async function runEngine(args) {
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

/** The progress lines, decoded. The payload is whatever the OS handed the
 *  Rust, so one event may carry several lines or a partial one; anything
 *  that is not a progress object is ignored rather than thrown, because a
 *  stray warning on stderr must not take a conversion down with it. */
/** Hand a URL to the OS. The window's first and only door onto anything
 *  outside itself (ADR 2026-09-21 — doors, not commands).
 *
 *  It is HERE because this file is the only one that touches Tauri, and
 *  opening a URL is a Tauri call. The URL itself is built by feedback.js,
 *  which is pure and knows nothing about any of this.
 *
 *  What may be opened is not decided here and must not be. The capability
 *  scopes the grant to this project's issue tracker, so a URL pointing
 *  anywhere else is refused by Tauri rather than quietly followed — which is
 *  the property that makes passing a built string to it safe at all.
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
