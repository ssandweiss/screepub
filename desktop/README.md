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

A **universal macOS** build, which is a different thing and is what a release
should ship:

    rustup target add x86_64-apple-darwin        # once
    bun tools/build-sidecar.ts --universal       # both slices, then lipo
    cd desktop/src-tauri
    cargo tauri build --target universal-apple-darwin \
      --bundles app,dmg --config tauri.transition.conf.json

bun compiles one architecture at a time, so the universal sidecar is a lipo
of two real builds rather than a target bun knows about. `--universal` builds
both and fuses them, and it CHECKS the result is genuinely fat: lipo exits 0
when handed a single input, and a thin binary inside a universal bundle would
hand every Intel user an app that cannot open.

Why bother, when per-arch DMGs already work: the frozen Swift app's updater
takes the first `.dmg` asset on a release and has no architecture logic,
because it was written when there was exactly one universal DMG to take. See
[ADR 2026-09-14](../docs/adr/2026-09-14-swift-app-update-path.md). Measured
here 2026-09-14: 25s for the Rust half once both targets are warm, a 57 MB
DMG, shell and sidecar each `x86_64 arm64`.

`cargo run` is the whole dev loop. The frontend is three static files that
`tauri-build` embeds at compile time, so there is no dev server, no bundler
and no npm dependency. The Tauri CLI is not used by `cargo run` at all; the
installable bundles are built by `bun tools/build-app-bundle.ts`, which calls
`cargo tauri build` for you. See the bundling section below.

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
commands are unchanged and the non-comment Rust went from 59 to 74 lines
against a ceiling of 200.

> Written when the capability was exactly `core:default`. Since 2026-09-21 it
> also carries two **scoped** opener grants: `allow-open-url` for the
> project's issue tracker, so Report a Bug can open it, and
> `allow-reveal-item-in-dir` for `$DOCUMENT/Screepub/**`, so Show in Finder
> can point at a book. Both are doors, not commands: the count of registered
> commands is still two. See
> [ADR 2026-09-21](../docs/adr/2026-09-21-doors-not-commands.md).
>
> Later the same day it gained `updater:default`, the updater plugin's
> check/download/install set. That grant is bare because the plugin has no
> allow-list to write: its scope is the single endpoint in `tauri.conf.json`
> (this repository's `releases/latest/download/latest.json`), and
> `tests/desktop-shell.test.ts` pins that to one URL. Still two commands.

### The updater archive is a release artifact, not a build artifact

`tauri.updater.conf.json` is a second overlay beside the transition one,
and it holds exactly `bundle.createUpdaterArtifacts: true`. It is passed by
`tools/build-app-bundle.ts --updater`, which only `release.yml`'s macOS leg
uses. The flag is **not** in `tauri.conf.json` on purpose: tauri-cli signs
the updater archive itself whenever that flag is on and fails the whole
bundle with "A public key has been found, but no private key" when
`TAURI_SIGNING_PRIVATE_KEY` is unset. `desktop.yml` bundles on every push
with no secrets, and so does anyone running `cargo tauri build` at home, so
the flag has to be something only a release turns on. Read off
`tauri-cli/src/bundle.rs` (`sign_updaters`), 2026-09-21.

One more consequence of the plugin: `serde_json` is now in `Cargo.toml`.
Not because any Rust here parses anything, but because
`tauri::generate_context!` embeds the `plugins` block of `tauri.conf.json`
as `::serde_json::Value` literals and the build fails without the crate.
The rule moved from "not linked" to "linked for the generator, and no `.rs`
file may name it", and the test that used to assert the former now asserts
the latter, with the reason written next to the dependency line.

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
  * `listen()` itself needed **no new permission**: `core:default` already
    carries the event API. (The capability was exactly `['core:default']`
    when this was measured; it gained one scoped opener grant on 2026-09-21,
    which changes nothing about `listen()`.)

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

### A very large `--preview-inline` answer: fixed, see above

A synthetic **3,601-page** script (stdout 6.0 MB, most of it `previewHtml`)
once failed here with `the engine did not answer in JSON:` followed by a
valid-looking prefix of that object. That was the same defect measured and
fixed in "Why a big answer used to arrive cut in half" above: the engine's
own buffered `console.log` to a pipe, exiting without waiting for the tail,
from roughly 400 KB up — not 6 MB, and not the shell plugin or the IPC
response, both of which that section rules out by measurement. The fix is
`sayLine` in `src/cli.ts`; answers up to 3.47 MB now arrive whole through
the live window.

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
- **No auto-update.** Notes says so on the surface. *(True until
  2026-09-21. Both halves exist now: the transport half is the overlay
  section above and `docs/superpowers/plans/2026-09-21-updater-transport.md`,
  and the window half is `desktop/ui/update.js`, off by default with a
  switch beside the version number. The first release to carry them is what
  makes it live.)*

### Known, open, and found by running it — and fixed in 13b (task 13, 2026-09-14)

Each of these was seen in the live window on Linux by task 13 and is
left here as the record of what was wrong. **All six are fixed**; the
section after this one says how, and what is still open.


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

### The keyboard, and where the focus goes (task 13b, 2026-09-14)

Task 13's keyboard-only pass found six defects in this window; all six are
fixed here, and every one was reproduced and then re-checked in the live
window on this machine (Hyprland/Wayland, WebKitGTK, no pointer available).

**Placing the focus is a decision, and it lives in `desktop/ui/focus.js`.**
`convert.js` used to re-focus the drop well's button when a file dialog
closed — a button that exists in one of that surface's four states — so
cancelling a dialog over a result or a refusal left the page with **no
focused element at all**: nothing for Tab, Shift-Tab or the tablist's arrows
to move from. `focusPlan(surface)` now answers, for whatever surface is
showing, where the keyboard goes: the first control inside the showing pane,
then the pane itself (every pane carries `tabindex="0"`), then that surface's
tab, then the Convert tab, which exists in every state of the window.
`main.js` is the only place that queries it and the only place that calls
`focus()`. `app.js` calls it after **every** dialog it opens, through
`onDialogClosed`, and any surface may ask for it through
`context.restoreFocus()` after a redraw that threw the focused element away.

Measured after the fix, on all five surfaces: Convert lands on `Send to a
reader` / `Convert anyway`, Read on the reader's stage, Tune on its first
preset, and Send and Notes — which have no control at all — on the pane,
which rings and which Tab moves on from.

**One dialog at a time.** Ctrl-O twice used to open two native pickers. The
guard is in `app.js`, at the one place that opens one, because the shortcut
and the button must not be able to disagree about it; a second ask returns
`null`, exactly as a cancel does, and opens nothing.

**Ctrl-O no longer moves you to Convert.** Converting a file does (`convert.js`
owns that, for a drop and for the shortcut alike); asking for one does not, so
cancelling on Tune leaves you on Tune with your work on screen.

**A refusal keeps the script that was open.** `drawFailure` used to set
`state.script = null`, which took Read, Tune and Send away from a book still
sitting in the library. A file the engine would not read produces nothing to
replace the open script with, so it replaces nothing, and the refusal says so
by name.

**The window trims the CLI remedy it has already replaced with a button.**
The engine's refusal is still rendered verbatim, and that rule is right —
with one exception, in `withoutCliRemedy`: when the window has drawn the
override, the engine's sentence naming the flag comes out, and nothing else
does. `not-screenplay` therefore reads "No scene headings and no dialogue
found — this does not look like a screenplay." directly above **Convert
anyway**. Every other refusal keeps every word, including one that names the
flag where the window offers no button.

**The error code is a labelled handle, not prose.** It is still on the page —
`ERROR CODE  not-screenplay`, in the code face, in a chip — and it is also on
the pane as `data-error-code` for anyone pasting a bug report out of the DOM.

### The reader frame cannot show focus, so it is no longer the Tab stop

Measured with a probe on the live window, not assumed. Tabbing to the
`<iframe>` makes it the parent's `document.activeElement`, and then:

  * it does **not** match `:focus` or `:focus-visible`, so no rule fires;
  * `outline` and `box-shadow` were both tried on those selectors, and on the
    element directly: nothing is painted for a focused iframe;
  * **no focus, blur or focusin event fires at all** — not on the element and
    not on its `contentWindow` — so a class could not be hung on it from
    script either.

A frame that takes the keyboard and shows nothing is worse than one that does
not take it, so the frame is now `tabindex="-1"` and the Tab stop is the
`div.script-stage` around it, which is an ordinary element and rings like
one. The arrow keys used to scroll the frame for free, because WebKit routed
them into it; `read.js`'s `scrollStep` is that behaviour made explicit —
arrows a line, PageUp/PageDown/Space nine tenths of the frame, Home and End
the ends of the script — and the stage's keydown handler scrolls the
same-origin frame with it. `focus.js`'s `FOCUSABLE` deliberately does not
list `iframe`.

### Still open after task 13b

- **The rail's mark is a beat behind.** It marks the scene occupying the top
  of the viewport, so a new heading just below the top edge still points at
  the previous scene. Correct by `readerPlace`'s stated rule; cosmetic.
- **The library path on the result page breaks mid-word.**
- **A live theme switch is not picked up** — WebKitGTK only reads the new
  preference on restart.
- **Send and Notes have no focusable control of their own.** After a dialog
  the keyboard lands on the pane, which is right; one Tab from there leaves
  the page the way the end of any document does, and one more Tab comes back
  to the tablist.
- **Drag-and-drop is still unverified in a running window** (no way to
  synthesise a Wayland drag from outside).
- **A file dropped WHILE a conversion is running is discarded in silence.**
  `convertPath` opens with `if (busy) return;`, so the second drop leaves no
  mark at all — the progress bar for the first script just keeps going and
  nothing says the new file was ignored. Correct as a refusal (two
  conversions at once is the thing to prevent) and wrong as feedback; the
  smallest fix is a line on the progress surface naming the file that was
  not taken.

### Why the launcher entry says `Categories=Office;` and not `Office;Publishing;`

The design doc asked for both. `bundle.category` is a fixed enum, not a
free string, and `Productivity` maps to the literal `"Office;"`
(`tauri-bundler/src/bundle/category.rs`); no enum member produces
`Publishing;`. The only way to add it is a custom
`linux.deb.desktopTemplate`, which replaces the generated `.desktop` file
wholesale and so takes over `Exec=`, `Icon=`, `StartupWMClass=` and
`MimeType=` as well — four more things to keep correct by hand, on a
surface nobody here can test, to add one category string. Not worth it.
`Office;` is what ships and this paragraph is why.

## Bundling: what was built, and what was checked (observed 2026-09-14)

`cargo tauri build --bundles deb,rpm` from an empty
`target/release/bundle/`, on aarch64-unknown-linux-gnu with
`tauri-cli 2.11.4`, `rustc`/`cargo` 1.98.1 and bun 1.3.11:

| artifact | size | wall time |
| --- | --- | --- |
| `Screepub_0.6.0_arm64.deb` | 44,363,262 B | **3 m 29.8 s for the pair** |
| `Screepub-0.6.0-1.aarch64.rpm` | 44,358,894 B | (`cargo` itself: 15.06 s) |

**Three and a half minutes, not fifty seconds.** The Rust half is 15
seconds; the other three and a quarter minutes are the bundler compressing a
102 MB engine twice — once into `data.tar.gz`, once into the rpm payload.
Budget for that, and note that `--bundles deb` alone is roughly half of it.

Opened with `tools/bundle-archive.ts` — no `dpkg-deb`, no `rpm2cpio`, no
`rpm`, none of which is installed here — both hold `usr/bin/screepub-engine`
(102,153,058 B), `usr/lib/Screepub/LICENSE` (34,523 B),
`usr/lib/Screepub/THIRD-PARTY-NOTICES.md` (6,079 B) and a `.desktop` entry
carrying `Categories=Office;` and a human `Comment=` — and, since the
association was withdrawn later the same day, **no `MimeType=`**; the sizes
above are from the rebuilt pair. `findEntry` absorbs the rpm's `./` prefix;
no lookup needed a special case. `tools/smoke-bundle.ts` ran the engine
straight out of both and converted `tests/fixtures/screenplay.pdf`, and
rejected `--expect-version 9.9.9` on both, which is what makes the passing
run evidence.

**The application itself was run out of the `.deb`, not just the engine.**
The payload was unpacked to a scratch directory with
`tools/bundle-archive.ts` and `usr/bin/screepub-desktop` launched directly
under the live Hyprland/Wayland session. It mapped a window
(`class=screepub-desktop`, `title=Screepub`), rendered the CONVERT page, and
printed `ENGINE 0.5.4` in the corner — which means the shell found and
spawned `usr/bin/screepub-engine` from beside itself inside the unpacked
tree. `Ctrl+O` opened the portal file chooser. Nothing was installed and no
`sudo` was used.

**What this does NOT show.** No `.deb` or `.rpm` has been *installed* on any
machine; they have been opened and their contents executed in place. The
launcher entry has never been exercised by a desktop environment — the app
was started from a shell. No `.dmg` and no NSIS installer has ever been
produced by this project at all.

### What contradicted the plan

1. **Wall time was 4× the plan's figure** — 3 m 29.8 s for the pair against
   "about 50 seconds each". Corrected in the table above.
2. **The deb and the rpm carry exactly the same nine files.** The plan, and
   the doc comment on `verifyBundleFile`, both recorded that they do not:
   that the deb ships four icon sizes and the rpm only 512×512, and that
   their `screepub-desktop` binaries differ in size (14,434,192 vs
   15,482,648). In this build the rpm ships **all four** icon sizes and both
   `screepub-desktop` binaries are **14,434,192 B**, byte-for-byte the same
   size, as is every other entry. The earlier observation was of a stale
   pair built before the Task 2 config change; it is not a property of the
   bundlers. Only the entry *order* and the `./` prefix differ. The
   cross-kind file-list assertion the plan warned against is in fact safe
   today — but it is still not asserted, because nothing guarantees two
   different bundlers stay in step.
3. **The PDF file association was inert, and has been withdrawn.** The
   entry declared `MimeType=application/pdf`, but `Exec=screepub-desktop`
   carries no `%f`/`%U`, so a desktop environment passes no path — and
   `desktop/src-tauri/src/main.rs` never reads `argv` anyway. "Open with
   Screepub" from a file manager put the app in the handler list and then
   opened an **empty window**.

   `bundle.fileAssociations` is therefore gone from `tauri.conf.json`, and
   both `tests/desktop-shell.test.ts` and `tests/app-bundle-e2e.test.ts`
   now assert its **absence**. Appearing in a menu and then doing nothing is
   worse than not appearing: the user has already chosen Screepub by the
   time they learn it cannot help.

   Making it real needs two things that do not exist yet — `%f` in a custom
   `desktopTemplate` (a whole template file to maintain, declined earlier
   for the menu category) *and* argv handling in the shell. Restoring the
   key without both re-creates the empty window.
4. `cargo tauri build` rewrote `desktop/src-tauri/Cargo.toml` again, to
   exactly the Task 2 spelling: `tauri-build = { version = "2", features =
   [] }` and `tauri = { version = "2", features = [] }`. The two plugin
   dependencies (`tauri-plugin-shell`, `tauri-plugin-dialog`) are **not**
   touched. Restored with `git checkout`.
5. The gated suite has **seven** tests, not six-plus-one: with bundles on
   disk it is 7 pass, and with none it is 1 pass / 6 skip with the reason
   printed. The plan's "passes six tests" undercounts by one.

### The macOS name, and what has not been seen

`desktop/src-tauri/tauri.transition.conf.json` renames the macOS product to
`Screepub Desktop` so the Tauri app and the SwiftUI app can both be
installed. The overlay is passed only by release.yml's two macOS bundle legs,
which now pass it; **piece F deletes the file** and the name becomes
`Screepub.app`.

The overlay is exactly one key — `{"productName": "Screepub Desktop"}`,
nothing else. An earlier draft added a leading-underscore `"_why"` key to
carry this same note as JSON, on the assumption that Tauri ignores unknown
top-level keys in a `--config` overlay the way a `_` prefix is ignored
elsewhere in this codebase. **That assumption is wrong**, and it was wrong
in a way that would have broken the real build. Confirmed on this machine:

    $ cargo tauri build --config tauri.transition.conf.json --bundles deb
    Error `"tauri.conf.json"` error: Additional properties are not allowed ('_why' was unexpected)

`tauri-cli 2.11.4` — the exact version `desktop.yml` pins — ships a
`config.schema.json` with `"additionalProperties": false` at the top level,
and `--config` merges via RFC 7396 merge patch, which carries a brand-new
key straight into the object that gets schema-validated. There is no
exception for `_`-prefixed names, and no flag to relax it. Removing the key
and re-running the identical command bundled cleanly:

    $ cargo tauri build --config tauri.transition.conf.json --bundles deb
        Bundling Screepub Desktop_0.6.0_arm64.deb (…/target/release/bundle/deb/Screepub Desktop_0.6.0_arm64.deb)

So the self-documentation this note would have carried lives here instead —
this file is the one `tests/desktop-shell.test.ts` checks for the marker —
and the overlay itself stays the minimal, provably-working single key.

**Nobody has opened the result on macOS.** No `.app`, no `.dmg` and no NSIS
installer has been produced by this project on any machine at the time of
writing; the macOS and Windows halves are read off tauri-bundler's source
and ride on CI. What *was* checked on this Linux machine, against the real
`cargo tauri` binary CI uses: that the overlay parses, that `cargo tauri
build --config` accepts it and reaches `productName` (the throwaway `.deb`
above), and that a bare underscore-prefixed key — the design this file
almost shipped with — does not merely get ignored but hard-fails the build.
The identifier (`com.darkwell.screepub.desktop`, already distinct from the
Swift app's `com.darkwell.screepub`) and the window title (`app.windows[0].
title`, left untouched at `"Screepub"`) were not re-verified here beyond
what `tests/desktop-shell.test.ts` already pins, since neither one is
touched by this piece.

## What nobody has verified

The honest version of this app's status, kept here so that the next person
does not have to infer it from a green checkmark. Three lists, and an item
only moves up one when somebody does the thing.

**Verified on a real machine, by a person** (2026-09-14 on
aarch64-unknown-linux-gnu, Arch/Asahi, live Hyprland session; 2026-09-20 on
an Apple Silicon Mac):

- `Screepub_0.6.0_arm64.deb` and `Screepub-0.6.0-1.aarch64.rpm` build, and
  both contain the engine, `LICENSE`, `THIRD-PARTY-NOTICES.md`, four icon
  sizes and a `.desktop` entry with `Categories=Office;` and a human
  `Comment=`. Note the architecture: these are the bundles an ARM machine
  makes. The two Intel packages the release actually publishes have never
  been built here at all.
- The engine runs straight out of both, converts
  `tests/fixtures/screenplay.pdf`, and refuses `--expect-version 9.9.9`,
  which is what makes the passing run evidence rather than decoration.
- The window opens, converts a PDF and shows a result, from `cargo run`. See
  "Running it: what a good run looks like" above.
- The window also opened **out of an unpacked `.deb`**: mapped, CONVERT page
  rendered, `ENGINE 0.5.4` in the corner, which means the shell found and
  spawned the engine from inside the unpacked tree. That launch was of the
  pair built earlier the same day, before the PDF file association was
  withdrawn; the pair on disk now was rebuilt afterwards and differs only in
  that its `.desktop` entry no longer claims a `MimeType`.
- `cargo tauri build --config tauri.transition.conf.json` is accepted by
  `tauri-cli 2.11.4` and reaches `productName`, producing a throwaway
  `Screepub Desktop_0.6.0_arm64.deb`.
- **Gate 1b, 2026-09-20: the macOS app was installed and used.** A
  universal `.dmg` built here (`bun tools/build-sidecar.ts --universal`,
  then `--arch universal`) was mounted, dragged to `/Applications`,
  launched from there past Gatekeeper, and used to convert TWO real feature
  scripts. Evidence beyond "a window opened": the app's own `.fountain` for
  one of those scripts is byte-for-byte identical to a fresh
  `bun src/cli.ts` run over the same PDF, and its EPUB matches the CLI's on
  scene headings (162) and mini-slugs (19). Note the architecture here too:
  the DMG is universal and holds both slices, but the machine that ran it
  is Apple Silicon, so it is the ARM slice that executed. The Intel slice
  has been built and never run, by anyone.
- The DMG was built HERE, not downloaded from a release. `release.yml` has
  still never produced one; see the CI section below.

**Verified only by CI, and only as far as CI can reach.** `desktop.yml` ran
for the first time on 2026-09-14 (run 34876329117), and **all three legs
passed**: the shell compiled on ubuntu-latest, macos-15 and windows-latest,
a `.dmg` and an NSIS `.exe` were produced, and `smoke-bundle.ts` opened each
without installing it and ran the engine out of it —

```
smoke-bundle: dmg ok -- .../Screepub_0.6.0_aarch64.dmg
smoke-bundle: nsis ok -- ...\Screepub_0.6.0_x64-setup.exe
smoke-bundle: 1 bundle(s) report 0.5.4 and convert the fixture
```

`release.yml`'s bundle jobs have still never run — those need a tag. The
list below is what CI now checks on every push, and the ceiling of what it
could ever prove:

- That the shell compiles on macOS and Windows at all.
- That a `.dmg` and an NSIS installer can be produced.
- That the engine inside the Linux bundles, the arm64 `.dmg` and the Windows
  installer runs and converts the fixture. CI opens each bundle without
  installing it.

Until that first run, every macOS and Windows claim in this repository rests
on reading `tauri-bundler`'s source and on unit tests driven by fakes.

**Verified by nobody:**

- Installing the `.deb`, the `.rpm` or the `.exe`. None has been installed
  on a real machine. (The macOS `.dmg` moved off this list on 2026-09-20;
  see gate 1b above.)
- The window on Windows. No runner has a display, so the GUI half of the
  app has never been exercised there, and gate 1c is deferred indefinitely.
- Any NSIS installer, opened by a person. CI produces one and runs the
  engine out of it; nobody has run the installer itself.
- The Intel SLICE of the universal macOS `.dmg`. This used to be a whole
  separate download, cross-compiled and executed nowhere. It is now half of
  one artifact: CI opens the universal DMG and runs its ARM slice, and the
  x86-64 slice is built, verified as a container, signed and published
  without ever executing. The release job prints a `::notice::` naming the
  slice that ran, rather than exiting 0 quietly.
- Any bundle that came off `release.yml`. Everything installed or opened so
  far was built by hand or by `desktop.yml`; no tag has ever produced one,
  which is also why nothing in this repository has ever been SIGNED by the
  release path.
- Gatekeeper accepting a NOTARIZED bundle, and SmartScreen actually showing
  the screen `README.md` describes. The DMG gate 1b installed was signed
  locally, not notarized by the release path.
- The launcher entry, exercised by a desktop environment. The app has only
  ever been started from a shell or from `/Applications`.

No sentence in `README.md`, `site/index.html` or the release notes may move
an item up this list without someone doing the thing.
