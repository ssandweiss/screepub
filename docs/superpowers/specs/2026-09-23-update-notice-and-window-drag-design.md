# Update notice, automatic restart, and a window you can move

Date: 2026-09-23. Scope: the Tauri window (`desktop/`) only. The engine, the
Swift app and the release pipeline are untouched.

## Why

Two things went wrong on the owner's own Mac on 2026-09-23.

1. **0.7.2 installed itself and nobody could tell.** The launch check had found
   0.7.2 and marked it with the brass dot before the version stamp, which went
   unseen. The owner opened the release notes, pressed Check for updates, then
   Install. The updater swapped `/Applications/Screepub Desktop.app` for 0.7.2
   (bundle on disk read 0.7.2, notarized, replaced one minute after launch, no
   0.7.2 DMG in Downloads), but the process kept running 0.7.1 because the
   plugin does not relaunch on macOS. The only sign of success was one caption
   line in the notes sheet saying "Quit and reopen". The stamp still said 0.7.1,
   so it read as a failed update.
2. **The window cannot be dragged.** `titleBarStyle: "Overlay"` with
   `hiddenTitle` puts the web page under the title bar, and the page marks no
   drag region, so there is nothing to grab.

A third problem sits under the first: the window's once-a-day check is opt-in,
and **nothing ever asks**. The only switch is inside the release notes, so most
people will never turn it on and never hear about an update.

## Decisions the owner made (2026-09-23)

| Question | Answer |
| --- | --- |
| Default for the automatic check | Off until asked; ask once on first launch |
| Where the new-version notice goes | A label beside the version stamp, replacing the brass dot |
| Where the one-time question goes | The Convert page, under the drop area |
| After an update installs | Restart automatically, but wait while any engine work is running |
| New Rust dependency | Approved: `tauri-plugin-process` |
| New permissions | Approved: `process:allow-restart`, `core:window:allow-start-dragging` |

## Part 1: the one-time question

- **Where:** one line under the drop area on the Convert surface:
  "Check for new versions once a day?" with two buttons, "Turn on" and
  "No thanks".
- **When it shows:** the updater is usable in this build and platform
  (`updaterReady() && updatesPossible(platform)`, the same gate the launch
  check uses) AND the reader has never answered (`readState().asked` is
  false). Anyone who already flipped the switch in 0.7.1 or 0.7.2 has
  `asked` set by `rememberAnswer` and never sees it.
- **Nothing is sent before an answer.** The launch check already skips when
  `optedIn` is false, so the question adds no request.
- **Answering** calls the existing `rememberAnswer(storage, bool)` and removes
  the line for good. "Turn on" then runs the launch check at once (the answer
  is the consent, `lastChecked` is empty, so `shouldCheck` passes), so a
  reader who opts in on a day a release exists hears about it that session.
- **The switch in the release notes stays** as the place to change the answer
  later. Its label keeps saying the check is off by default, which stays true.

## Part 2: the notice beside the version

- The brass dot (`.rev-new::before` in `style.css`, `frame.updateWaiting`) is
  removed. In its place, a separate button beside the stamp: **"Update to
  0.7.3"**, set in the stamp's own type (structure face, fine size, letter
  spaced, upper case) in the brass accent. The stamp itself is unchanged and
  still opens the release notes, which already show what the server said
  about the new version.
- **Remembered across launches.** Today a found update lives in memory only
  (`setPending`), so quitting and reopening on the same day, when the
  once-a-day throttle skips the check, loses it. A found offer now also
  stores its version (`updateFound` in localStorage). At launch, if the
  stored version is still newer than this build (`pickUpdate`), the label is
  drawn without a request. The stored version is cleared once this build is
  at or past it, or when a check answers "current".
- **Clicking the label** needs a live `Update` object from the plugin, which
  cannot be stored. If this session's check produced one, it is used. If the
  label came from memory, the click runs a fresh check first; the click is the
  consent for that request, exactly as the manual button is today. If that
  check answers "current" (a release was pulled), the label goes away.
- **What the label says, in order:**
  1. "Update to 0.7.3"
  2. "Downloading 0.7.3… 40%" (from the plugin's `Started` content length and
     `Progress` chunk lengths; without a length, just "Downloading 0.7.3…")
  3. "Installing…"
  4. "Restarting after this finishes…" while engine work is running (Part 3)
  5. "Restarting…", then the app restarts
  - On failure: "Update failed. Try again", clickable, and the full message
    goes to the release notes' status line, where the manual button already
    reports errors.
- **The release notes' Install button ends the same way.** One shared install
  function drives both the label and the notes sheet, so they cannot drift.

## Part 3: restarting

- **Dependency:** `tauri-plugin-process = "2.3.1"` (latest 2.x on 2026-09-23;
  source read from the local cargo registry), registered in `main.rs` as
  `.plugin(tauri_plugin_process::init())`.
- **Permission:** `process:allow-restart` only. Not `process:default`, which
  also grants `allow-exit`; the window has no reason to quit itself.
- **JS:** with `withGlobalTauri` the plugin's `api-iife.js` defines
  `window.__TAURI__.process.relaunch()`, which invokes `plugin:process|restart`
  (read in the 2.3.1 source). `app.js` wraps it as `restartApp()` beside a
  `restartReady()` guard, the same shape as `updaterReady()`.
- **It restarts the NEW version.** Tauri 2.11.5's `process::restart` reads the
  bundle's `Contents/Info.plist` on macOS to find the binary, because an
  update may rename it (`restart_macos_app`, read in the source), then spawns
  it and exits.
- **Waiting for work.** `app.js` counts engine calls in flight: every
  `runEngine` call, which covers convert, send, export, device listing and
  settings writes. `whenIdle()` resolves when the count is zero, whether the
  calls resolved or rejected. The restart is `await whenIdle()` then
  `restartApp()`. A settings write counts on purpose: restarting halfway
  through saving a sidecar would be worse than a slow restart.
- **Fallback:** if `restartReady()` is false, the label ends on today's
  `installedLine`: "Update installed. Quit and reopen Screepub to use 0.7.3."
- **Comments to rewrite:** `update.js` and `notes-surface.js` both say a
  one-click restart is "another crate and another permission, so ask rather
  than pretend". The owner has now approved both; the comments must say so
  and date it, rather than be deleted.

## Part 4: dragging the window

- **Mechanism, read in Tauri 2.11.5's `src/window/scripts/drag.js`:**
  `data-tauri-drag-region="deep"` makes a whole subtree draggable, while
  anything clickable inside it (buttons, links, inputs, labels, `role="tab"`
  and the other interactive roles) keeps working as itself. Mousedown sends
  `plugin:window|start_dragging`. Double-click sends
  `plugin:window|internal_toggle_maximize`, on mouseup on macOS so that
  moving the mouse cancels it, like a native title bar.
- **Permission:** `core:window:allow-start-dragging`, which `core:default` does
  NOT include. `allow-internal-toggle-maximize` IS already in `core:default`
  (Tauri's own permission reference), so double-click zoom needs nothing new.
- **Where:** the band from the window's top edge down to the bottom of the
  tab row, full width. The empty space around the tabs drags; the tabs
  themselves stay clickable. The plan measures the real layout (`frame.js`
  builds `.page` > `.sheet` > `nav.tabs`) and puts the attribute on whichever
  element spans that band, adding a strip only if nothing does.
- **Other platforms:** `titleBarStyle` only changes macOS, so Windows and
  Linux keep their native title bars. The attribute is harmless there.

## Documentation

- `README.md`, the paragraph on where the cross-platform window touches the
  network: first launch asks once; the label; the automatic restart that
  waits for running work.
- `desktop/README.md`'s capability ledger gains both permissions and the new
  plugin.
- `tests/desktop-shell.test.ts` pins the capability list and the crate list.
  It will fail, which is the tripwire working: change it deliberately and say
  why in its comment.

## Testing

- **Pure logic, `bun test`, fake storage:** when the question shows; the
  remembered offer (write on offer, read at launch, clear when this build
  catches up or a check answers current); the label's text for each state,
  as one function from state to words; progress arithmetic with and without
  a content length.
- **`app.js`:** the in-flight counter and `whenIdle()`, including a call that
  rejects and two overlapping calls.
- **Window tests with the fake DOM** (`tests/desktop-ui.test.ts`): the question
  appears and disappears; the label replaces the dot; clicking a remembered
  label runs a check first; restart waits while a fake engine call is open.
- **Shell tests:** the plugin is in `Cargo.toml` and registered in `main.rs`;
  capabilities hold `process:allow-restart` and
  `core:window:allow-start-dragging` and do NOT hold `process:allow-exit` or
  `process:default`; the drag attribute is on the header band and on no
  clickable element.
- **Pictures:** the capture tool's Tauri stand-in has no updater
  (`tools/capture/bridge.js`), so `updaterReady()` is false there and neither
  the question nor the label can appear in README or site pictures. A rerun
  of `bun tools/capture-screens.ts` must print `unchanged` for all nine.
- **On a real Mac:** the full proof needs two releases. The release that
  carries this work still installs over 0.7.2 the old way (0.7.2 has no
  restart), so the owner quits and reopens once more. The release after it
  is the first that should download, wait, and restart by itself, and that
  is the proof to record.

## Not in scope

- Windows and Linux updates: the manifest still lists darwin only.
- A settings gear to hold the update switch: that is parity piece C, in
  another session.
- Any change to what the daily check sends or how often: still one request a
  day, and only after a yes.
