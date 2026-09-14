# Screepub desktop shell

A Tauri window around the Screepub engine. **No logic lives in this
directory.** The shell spawns the engine binary, passes it the arguments the
frontend built, and renders the JSON object the engine printed. Parsing,
device knowledge and formatting rules are all in `src/` (TypeScript), where
the CLI and the app share one implementation and one test suite. See
[ADR 2026-09-12](../docs/adr/2026-09-12-cross-platform-tauri.md).

## Build and run

    bun tools/build-sidecar.ts --host    # ~30s: compiles the engine for THIS machine
    cd desktop/src-tauri && cargo run

`cargo run` is the whole dev loop. The frontend is three static files that
`tauri-build` embeds at compile time, so there is no dev server, no bundler
and no npm dependency. The Tauri CLI is not used here; bundling and
installers are piece E2.

The sidecar must exist before the app starts — on this toolchain it must
exist before `cargo build` even *compiles*, see below.

## How long the build takes (measured 2026-09-13)

Numbers from one machine — aarch64-unknown-linux-gnu, 10 cores, rustc
1.98.1 / cargo 1.98.1, bun 1.3.11 — with the crate sources already in
`~/.cargo` (nothing was downloaded). They are here so the next person knows
whether their wait is normal.

| step | time |
| --- | --- |
| `bun tools/build-sidecar.ts --host` (engine → 102 MB binary) | **0.11 s** real |
| `cargo build` from an empty `target/` — 288 crates | **36.6 s** (`Finished dev profile [unoptimized + debuginfo] target(s) in 36.64s`) |
| `cargo build` after only the sidecar changed | 4.5 s |
| `cargo build` after a touched `tauri.conf.json`/sidecar, relink only | 6.3 s |

A cold build of four minutes would be *abnormal* here; the crate graph is
288 crates and it parallelises well. The 2.5 GB `target/` and the 98 MB
`binaries/` are both gitignored.

## Running it: what a good run looks like (observed 2026-09-13)

`cargo run` opens the window; `engine 0.5.4` appears under the title as soon
as the shell has run `--version --json` through the sidecar. Choosing
`tests/fixtures/screenplay.pdf` renders, verbatim from the engine's JSON:

    The Last Video Store
    A. N. Placeholder
    5 pages · 5 scenes · 3 speaking characters

which is exactly what `bun src/cli.ts tests/fixtures/screenplay.pdf --json`
prints for `title`/`author`/`pages`/`scenes`/`characters`. Choosing
`tests/fixtures/prose.pdf` renders the engine's own refusal, word for word,
with its code beneath it — not a crash and not a reworded message:

    No scene headings and no dialogue found — this does not look like a
    screenplay. Pass --force to convert it anyway.
    not-screenplay

**The app writes its output into the library, never beside the input** (see
the library section below; that was not true before task 10b). Converting
`tests/fixtures/screenplay.pdf` therefore leaves `tests/fixtures/` untouched
and puts the book in `<Documents>/Screepub/screenplay/`. Set
`SCREEPUB_LIBRARY` before `cargo run` to send a session's output somewhere
else.

### What a missing engine looks like

Removing the engine from beside the app binary (`target/debug/screepub-engine`)
and starting the app shows, in the window, in red, with the button still
usable:

    could not start the Screepub engine (sidecar "screepub-engine"): No such
    file or directory (os error 2). Run `bun tools/build-sidecar.ts --host`
    to build it.

**Giving the engine the wrong name produces the same message**, which is the
point of wrapping it: renaming `target/debug/screepub-engine` to
`screepub-engin` and starting the app prints that same line — where Tauri on
its own would have surfaced only a bare `No such file or directory (os error
2)` naming nothing (see the transcript below).

Note which of the two wrapped messages appears: it is always the one on the
call that runs the engine, `.spawn()` since piece D and `.output()` before
it ("could not **start**"). `sidecar()` itself returns `Ok` even when no
such file exists, so the "could not **find**" message — the `map_err` on
`sidecar()` — did not fire in either experiment.

`mv desktop/src-tauri/binaries desktop/src-tauri/binaries.off` does **not**
reproduce this, because `binaries/` is consumed at build time: with it gone,
`cargo run` never gets as far as a window and fails with

    resource path `binaries/screepub-engine-aarch64-unknown-linux-gnu` doesn't exist

## Progress: why the shell spawns instead of waiting (piece D)

The engine writes one NDJSON line per whole percent to **stderr** when it is
given `--progress`; `--json`'s contract reserves stdout for exactly one
object, which is why progress cannot go there. Piece C discarded stderr, so
the window could only ever show a spinner.

`sidecar.rs` now spawns the engine and forwards every stderr line to the
window as a Tauri event named `engine-line`, payload = the line, verbatim,
newline included. It parses nothing: `desktop/ui/app.js` is where a line is
recognised as progress, and piece D's UI work is what will draw it.

This deliberately did **not** become a third Rust command. The two registered
commands are unchanged, the capability is still `core:default`, and the
non-comment Rust went from 59 to 74 lines against a ceiling of 200.

**There is no Cancel.** `brand/components/progress.html` draws one, and the
SwiftUI app has one, but killing a running sidecar needs a kill handle the
window can reach — a third command. Piece D does not add it. If Cancel is
wanted, it is a deliberate decision to make with the ADR's rule in view, not
a thing to slip in.

### Observed live, 2026-09-13

`cargo run` with a temporary `event.listen('engine-line', …)` appended to
`desktop/ui/app.js` (reverted afterwards; Task 7 adds the real one):

  * converting a copy of `tests/fixtures/screenplay.pdf` with
    `[path, '--json', '--progress']` delivered **six** events before the
    promise resolved — `{"progress":{"stage":"parse","percent":17}}` through
    `…{"stage":"render","percent":100}` — the same six lines
    `bun src/cli.ts … --progress` writes to stderr;
  * each payload arrived **with its trailing newline**: the shell plugin's
    reader keeps the delimiter, so `sidecar.rs` concatenates the pieces of a
    stream without adding anything and gets back exactly what was written;
  * `run_engine` still resolved with the whole answer — 451 characters,
    `JSON.parse`d to `ok: true`;
  * a deliberately multi-line stdout (`['--help']`, 36 lines, 1833
    characters trimmed) came back whole and unmangled, which is the case
    `.output()` used to get for free and spawning could have broken;
  * `listen()` itself needed **no new permission**: the capability is still
    `['core:default']`, which already carries the event API.

## Why a big answer used to arrive cut in half (piece D, measured 2026-09-13)

Driving `run_engine` from the live window against generated scripts, an
answer above roughly 400 KB came back TRUNCATED, nondeterministically: the
same 384 KB input succeeded twice and failed twice in one session. With
`--preview-inline` costing 1.85-2.6 KB per page, a 120-page script is
220-320 KB, so this was not a theoretical ceiling.

**It was not the IPC, and it was not this shell.** The received lengths were
all exact multiples of 64 KiB — a pipe buffer — and `bun src/cli.ts … |
cat`, with no Tauri anywhere, reproduced it at the same boundaries, while the
identical run redirected to a FILE was always whole. The engine's
`console.log` to a pipe is buffered, and the process was exiting without
waiting for the tail. `src/cli.ts` now writes that one answer through
`sayLine`, which waits for `drain`; `tests/cli.test.ts` has the regression
test.

That test had to be rebuilt once, and the reason is worth carrying: its first
version used a deliberately SLOW reader, on the theory that a full pipe makes
the loss more likely. The opposite is true — backpressure keeps the child
alive until it has flushed, which hides the very defect being tested. Measured
per attempt with the defect restored, 20 attempts each: reading at full speed
lost 30%, pausing 5 ms between reads 10%, pausing 50 ms 0%, and waiting 400 ms
before reading (what the first version did) 5%. It passed against a live
defect 5 runs in 16. The test now runs its eight attempts **in parallel**, so
they contend for the machine: with the defect restored that caught it in 20
standalone runs out of 20, worst round still losing 3 of its 8 attempts, and
with the fix in place 20 runs of 8 — 160 attempts — lost nothing. It also got
faster, about half a second for all eight.

Measured after the fix, through the live window, four attempts each:
212 KB, 384 KB, 487 KB, 694 KB and **3.47 MB** all arrived whole and parsed,
20 of 20. Re-measured on the `String` build that actually ships (below), six
attempts each at 384 KB, 1.04 MB and 3.47 MB: whole and parsed, 18 of 18.

### Bytes or a String? Measured, then reverted

`run_engine` briefly returned the stdout as **bytes**
(`tauri::ipc::Response`), with `app.js` decoding them, on the argument that a
`String` return makes Tauri escape the whole answer into a quoted JSON string
which the window then parses back out. Plausible, and wrong. Timed in the
live window, `--preview-inline`, six runs each, median of `invoke`:

| answer | bytes | String |
| --- | --- | --- |
| 384 KB | 430 ms / 417 ms (two sessions) | **330 ms** |
| 1.04 MB | 1006 ms / 1025 ms | **718 ms** |
| 3.47 MB | 4803 ms / 4795 ms | **3864 ms** |

Spreads were comparable (bytes max−min 120-250 ms, String ~130 ms), and the
client-side decode-and-parse was single-digit milliseconds either way. The
String is faster at every size, by about 20%, so the bytes return and the
decode branch that went with it were both taken out. **A `String` is what
ships.**

Two cautions for anyone re-running that measurement. Tauri picks the IPC
route per page load and can fall back permanently (below), so check which
route a run actually used before comparing two of them: both bytes runs above
landed on the `eval` route, its worst case, and the route could not be forced.
And `cargo run` after a change to `desktop/ui/` alone may serve the
**previously embedded** frontend: put a build stamp in the page and read it
back, or the numbers are quietly from the old code.

  * A dead end worth recording: Tauri only sends a JSON IPC body down the
    channel when it starts with `{` or `[`
    (`tauri-2.11.5/src/ipc/protocol.rs:373-407`), and otherwise injects it
    into the webview with `eval`. That looked like the cause. It was not:
    with the engine truncating, the webview's IPC `fetch` failed once and
    Tauri then fell back to `postMessage` + `eval` **permanently** for that
    page (`customProtocolIpcFailed` in `scripts/ipc-protocol.js`), which is
    what made the second symptom appear. With the engine fixed, the custom
    protocol holds and every answer arrives as an ArrayBuffer. The CSP was
    briefly widened to `connect-src 'self' ipc: http://ipc.localhost` while
    chasing this; it made no difference and was reverted — `default-src
    'self'` is what ships.

## How Tauri finds the engine (observed 2026-09-13, on aarch64-unknown-linux-gnu)

This section is a transcript, not a summary. Tauri 2.11.5 /
tauri-build 2.4.x / tauri-plugin-shell 2.3.6, rustc 1.98.1, Linux.

**The requirement is enforced at BUILD time, by the build script, and the
error names the exact file it wanted.** With `"externalBin":
["binaries/screepub-engine"]` in `tauri.conf.json` and an unsuffixed stub
at `desktop/src-tauri/binaries/screepub-engine`, `cargo build` failed:

    error: failed to run custom build command for `screepub-desktop v0.6.0 (.../desktop/src-tauri)`

    Caused by:
      process didn't exit successfully: `.../target/debug/build/screepub-desktop-c47a0d512ab3847e/build-script-build` (exit status: 1)
      --- stdout
      ...
      cargo:rustc-env=TAURI_ENV_TARGET_TRIPLE=aarch64-unknown-linux-gnu
      resource path `binaries/screepub-engine-aarch64-unknown-linux-gnu` doesn't exist

So: the config value is a **prefix**, and the file on disk must carry
`-` + the triple `rustc -vV` reports as `host:` — here
`screepub-engine-aarch64-unknown-linux-gnu` — and it must sit at a path
resolved **relative to the directory containing `tauri.conf.json`**
(`desktop/src-tauri/binaries/`). Renaming the stub to that exact name made
the build pass with no further complaint.

**A second build-time failure is unrelated to the sidecar but happens in the
same breath**, so it is recorded here. Without `desktop/src-tauri/icons/icon.png`
the `generate_context!` macro panics at compile time:

    error: proc macro panicked
      --> src/main.rs:40:14
       |
    40 |         .run(tauri::generate_context!())
       |              ^^^^^^^^^^^^^^^^^^^^^^^^^^
       |
       = help: message: failed to open icon .../desktop/src-tauri/icons/icon.png: No such file or directory (os error 2)

Fixed by `rsvg-convert -w 512 -h 512 assets/icon.svg -o
desktop/src-tauri/icons/icon.png` plus `"icon": ["icons/icon.png"]` in the
`bundle` object. A plain `cargo build` needs an icon; this is not only a
bundling concern.

**After a successful build the file appears beside the app binary, with the
triple STRIPPED OFF:**

    $ ls -l target/debug/ | grep -i screepub-engine
    -rwxr-xr-x 1 sandywho sandywho        52 Sep 13 15:44 screepub-engine

**The running app looks next to its own executable and asks for the stripped
name.** The probe (`desktop/src-tauri/src/main.rs` as it stood in Task 1)
printed:

    PROBE exe = .../desktop/src-tauri/target/debug/screepub-desktop
    PROBE looking beside the app, in .../desktop/src-tauri/target/debug
    PROBE   found: screepub-engine
    PROBE sidecar("screepub-engine") ran; stdout = {"ok":true,"version":"stub-probe"}

Two names, therefore, and they are different: **on disk in `binaries/` it is
suffixed; in `sidecar("…")` it is not.** Passing the suffixed name to
`sidecar()` fails — observed directly:

    // sidecar("screepub-engine-aarch64-unknown-linux-gnu")
    PROBE sidecar resolved but failed to run: No such file or directory (os error 2)

Deleting `target/debug/screepub-engine` while `binaries/` still held the
suffixed original gave the same failure, which confirms the *running* app
reads the copy beside the executable and never looks in `binaries/`:

    PROBE looking beside the app, in .../desktop/src-tauri/target/debug
    PROBE sidecar resolved but failed to run: No such file or directory (os error 2)

### The failure text to search for

**`sidecar()` does not fail on a wrong name.** With the name deliberately
misspelled as `screepub-engin`, `handle.shell().sidecar(...)` still returned
`Ok` — it only builds a command — and the failure surfaced later, from
`.output()`, as an OS error that names nothing at all:

    PROBE sidecar resolved but failed to run: No such file or directory (os error 2)

That is the entire message: no filename, no path, no mention of "sidecar".
It is identical to the message you get when the sidecar was simply never
built. Any Rust that spawns the sidecar must therefore add its own context
(the name it asked for, and "run `bun tools/build-sidecar.ts --host`") before
this string reaches the window, or the only clue a maintainer gets is
`os error 2`.

## How a dropped file arrives (task 8, 2026-09-13)

**Paths arrive on `tauri://drag-drop`, and nowhere else.** With
`dragDropEnabled` at its default, Tauri takes the OS drop before the webview
sees it: the HTML5 `drop` event never fires, and the payload is Tauri's own
`DragDropPayload` —

    tauri://drag-enter   { paths: [<absolute path>, …], position: { x, y } }
    tauri://drag-drop    { paths: [<absolute path>, …], position: { x, y } }
    tauri://drag-leave   (no payload at all)

which is why `desktop/ui/app.js`'s `onFileDrag` reads `event.payload.paths`
and hands the whole ARRAY to the surface: deciding which of several dropped
files to convert is the surface's job, not the boundary's.

**How this was verified, and what was not.** This machine has no pointer
injection available to an automated session (`/dev/uinput` is root-only,
there is no ydotool, and `wtype` is keyboard-only), so **no human hand
dragged a file onto this window.** What was checked instead:

  * the three listeners register under `core:default` and fire — Tauri
    2.11.5 puts no reserved-prefix guard on `emit`, so a temporary probe in
    the page emitted the exact payload the Rust emits, and the window
    highlighted the well, converted the file, and rendered the result;
  * the payload SHAPE is read off the Rust rather than guessed:
    `tauri-2.11.5/src/manager/window.rs` builds `DragDropPayload { paths,
    position }` for enter and drop and sends `()` for leave;
  * on Linux the events come from `wry-0.55.1/src/webkitgtk/drag_drop.rs`,
    which raises `Enter` from GTK's `drag_data_received` (so the paths are
    already known when the well lights up) and emits `Leave` through an idle
    callback that a real drop cancels.

The one thing still unconfirmed is GTK's own delivery of a drag from a file
manager. If a real drop ever turns out not to arrive, the fallback is the
one the task brief names: `"dragDropEnabled": false` and the button alone.

## The progress percent is ALREADY the whole job (task 8, 2026-09-13)

`src/convert.ts` applies `PARSE_SHARE = 0.85` itself, so the engine's line is
the overall fraction, not the stage's own: a 3,601-page script emits `parse`
6…85 and then `render` 85, `render` 100. A window that weighted those numbers
a second time sat at **72%** for the whole tail of the parse and then jumped
to the end — seen on screen before it was fixed. `desktop/ui/convert.js`
takes the number as given and only picks the wording from the stage.

The bar's width is written through a constructed stylesheet
(`new CSSStyleSheet()` + `replaceSync` + `adoptedStyleSheets`), because
`default-src 'self'` refuses an inline style; observed painting correctly at
83% and 85% in a live run.

### A very large `--preview-inline` answer does not survive the pipe

Converting a synthetic **3,601-page** script (stdout 6.0 MB, most of it
`previewHtml`) failed in the window with `the engine did not answer in JSON:`
followed by a valid-looking prefix of that object — i.e. what reached
`JSON.parse` was not the whole 6 MB. The same argv run straight from a shell
prints a complete, parseable object. Nothing in `sidecar.rs` truncates
(it concatenates every `CommandEvent::Stdout` chunk), so the loss is further
down — the shell plugin's line reader or the IPC response itself. Real
scripts are nowhere near this size (a 120-page script's preview is a few
hundred KB) and every fixture converts fine, so this is recorded rather than
fixed. The failure was at least legible: the window showed the engine's raw
output under `INT. THE ENGINE DID NOT ANSWER - DAY`.

## The library, and what the first conversion does NOT apply (task 10b, 2026-09-14)

`argv.convert` passes `--library`, so the `.epub`, the `.fountain` and the
settings sidecar land in `<Documents>/Screepub/<stem>/` and never beside the
user's PDF. The window names no path: `src/library.ts` resolves the library
and the window reads `epubPath`/`fountainPath` back off the answer.
`SCREEPUB_LIBRARY` overrides the location (it is also the tests' only seam —
no test may write into a real home).

**This was once a defect and is now fixed, in the engine rather than here.**
The first conversion still sends no `--options-json` — it has no settings to
send — but `src/cli.ts` now reads the script's own `.screepub.json` before it
renders and says so on stderr, so a tuned script comes back tuned on the very
first conversion. Confirmed in the running window on 2026-09-14: page markers
switched on in Tune, then the same PDF dropped again, and the new `.fountain`
carried `= pg N`. The window passes no flag for this and needs none.

## The interface (piece D)

`desktop/ui/` is the app. No build step, no bundler, no npm: `index.html`
loads three stylesheets and one ES module, and `tauri-build` embeds the
directory at compile time.

| file | what it owns |
| --- | --- |
| `app.js` | **the only file that talks to Rust**, and the only one that knows an engine flag. Every argv the window builds is in `argv`. |
| `main.js` | boot, the shared `state`, the surface routing, the Ctrl/Cmd-O shortcut. |
| `frame.js` | the sheet, the punched holes, the brads, the tablist. |
| `dom.js` | `el` / `clear` / `text`. Nothing else, and no innerHTML. |
| `convert.js` `read.js` `tune.js` `send.js` `notes-surface.js` | one surface each. |
| `tokens.css` | **generated** from `brand/tokens.json` by `tools/build-desktop-tokens.ts`. |
| `notes.js` | **generated** from `docs/releases/<version>.md` by `tools/build-desktop-notes.ts`. |
| `style.css` | the seven core colours (pinned by `tests/desktop-shell.test.ts`), the fonts, the frame. |

Regenerate both generated files after touching `brand/tokens.json` or the
release notes; CI diffs them and fails if you didn't.

### Why the reader is an iframe with an adopted stylesheet

The window's CSP is `default-src 'self'`, which blocks **every** inline
style — including a `<style>` inside an `<iframe srcdoc>`, because srcdoc
frames inherit the parent's policy. Measured, not assumed: an engine preview
dropped into a srcdoc frame renders completely unstyled, with no error
anywhere.

CSSOM is not blocked. So `read.js` lifts the `<style>` out of the engine's
document and adopts its text as a constructed stylesheet instead — the same
bytes, nothing rewritten. Three details are load-bearing:

- The sheet must be constructed **in the frame's realm**
  (`new frame.contentWindow.CSSStyleSheet()`); one built in the parent is
  rejected on adoption.
- The frame is `sandbox="allow-same-origin"` with **no** `allow-scripts`, so
  the parent can keep the reader's scroll position and build the scene rail,
  while nothing inside the document can run.
- The engine's CSS asks for "Courier Prime" by name and nothing inside the
  frame says where that file is, so `read.js` supplies the `@font-face`
  rules. `about:srcdoc` resolves relative URLs against the parent, so
  `url(fonts/…)` reaches the bundled subsets under the strict CSP.

The asset protocol was tried and rejected: it renders, but the frame is
cross-origin, so the parent cannot script it and it cannot reach the bundled
fonts. It also needs a `protocol-asset` cargo feature and a path-scope grant.

### Fonts

Courier Prime and Literata are bundled as the same six WOFF2 subsets the
website self-hosts. **Do not use `document.fonts.check()` to verify one is
present** — it was measured returning `true` on a machine where `fc-list`
showed neither installed. `await document.fonts.load(...)` and then read the
`FontFace.status`.

### What piece D does not do

- **No Cancel during conversion** (see the progress section above).
- **No global "app defaults"** — settings are per script, in the sidecar
  `src/settings/sidecar.ts` owns. A cross-platform preference store would
  mean a new Tauri plugin and a new capability grant.
- **No auto-update.** Notes says so on the surface.

### Known, open, and found by running it (task 13, 2026-09-14)

Each of these was seen in the live window on Linux. None is fixed here.

- **The keyboard can be left with nowhere to stand after the native file
  dialog closes.** Ctrl-O then Escape, with a result on screen, sometimes
  leaves no focused element: Tab, Shift-Tab and the tablist's arrow keys all
  do nothing, and re-focusing the window does not help. `convert.js` already
  re-focuses `chooseButton` when the picker returns, but that button is only
  connected while the drop well is on screen, so the result and refusal
  surfaces have no such anchor. Intermittent, and the section above already
  records that the webview does not always take focus back.
- **Ctrl-O while a picker is already open opens a second picker.** `busy`
  only guards a running conversion, not an open dialog.
- **The reader iframe takes focus without showing it.** Tabbing into the
  reader leaves no visible focus ring for one stop; the tablist is still
  reachable by tabbing on round to the rail and the panel, but a keyboard
  user cannot see where they are for those presses.
- **The not-a-screenplay refusal tells a window user to type a CLI flag.**
  The engine's sentence ends "Pass `--force` to convert it anyway", and the
  window prints it verbatim directly above a **Convert anyway** button that
  does exactly that. `drawFailure`'s comment says the engine's sentence
  "already says what to do"; for `not-screenplay` in a window, it does not.
- **A refusal closes whatever script was open.** `drawFailure` sets
  `state.script = null`, so dropping a non-screenplay after converting a
  script takes Read, Tune and Send away from the script that is still
  perfectly good in the library. Defensible, but it is a decision, not an
  accident, and nothing on the surface says the earlier book is still there.
- **The raw error code is printed under the buttons** (`not-screenplay`,
  `scanned`). Deliberate — it is a support handle — but on the page it reads
  as leftover debug text.
