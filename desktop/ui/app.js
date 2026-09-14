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

/** Every argv this window ever builds. One place, so a flag cannot be spelled
 *  two ways, and so a reviewer can read the whole contract at once. */
export const argv = {
  version: () => ['--version', '--json'],

  /** The first conversion. --progress makes the engine narrate to stderr,
   *  which the shell forwards as `engine-line`; --preview-inline puts the
   *  reader's document in the answer, because the window cannot read files. */
  convert: (path, { force = false, optionsJson = null } = {}) =>
    [path, '--json', '--progress', '--preview-inline',
      force ? '--force' : null,
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
 *  A truncated 400 KB answer is still 400 KB of JSON, and the fault body is
 *  a 52-character column: the first few lines say what went wrong, and the
 *  rest only buries the two buttons under it. */
const RAW_SHOWN = 300;

/** The engine's stdout, as text.
 *
 *  Rust hands it over as BYTES, not as a string, and that is load-bearing
 *  rather than a style choice. Tauri routes an IPC answer one of two ways
 *  (`tauri-2.11.5/src/ipc/protocol.rs:373-407`): a raw body goes down the
 *  channel, a JSON body only when it starts with `{` or `[`. A Rust String
 *  arrives as `"…"`, so it took the other route — injected into WebKitGTK as
 *  a JS string literal — and above roughly 400 KB that arrives TRUNCATED,
 *  nondeterministically. A 120-page script with --preview-inline is already
 *  220-320 KB, so this was not a theoretical ceiling.
 *
 *  Both shapes are accepted because Tauri's own routing is per platform:
 *  Linux and Windows deliver the raw body as an ArrayBuffer down the
 *  channel, while macOS and iOS still eval it, where a Vec<u8> serialises as
 *  an array of numbers. The string branch is what a test double hands over,
 *  and what the old transport produced. */
function decodeAnswer(answer) {
  if (typeof answer === 'string') return answer;
  if (answer instanceof ArrayBuffer) return new TextDecoder().decode(answer);
  if (ArrayBuffer.isView(answer)) return new TextDecoder().decode(answer);
  if (Array.isArray(answer)) return new TextDecoder().decode(Uint8Array.from(answer));
  return String(answer ?? '');
}

/** Run the engine and parse its one line of stdout.
 *  Throws an Error whose message is fit to show a person. */
export async function runEngine(args) {
  let stdout;
  try {
    stdout = decodeAnswer(await tauri().core.invoke('run_engine', { args }));
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

/** Ask the OS for a screenplay. Null when the reader cancelled. */
export async function pickScreenplay() {
  const path = await tauri().core.invoke('pick_file');
  return path ?? null;
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
