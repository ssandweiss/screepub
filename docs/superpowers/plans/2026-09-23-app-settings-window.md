# The Gear, Window Half: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** From the window, a person can see and change where books land (with Reset), promote one script's settings to the starting point for new scripts, reset that starting point, and Show in Finder works wherever the library is.

**Architecture:** `app.js` gains `argv.appSettings`, `argv.reveal` and a `pickFolder` wrapper (it stays the only file that touches Tauri). The Convert page gets one line about the library; the per-script Settings page gets two buttons at its foot; the result screen's Show in Finder calls the engine. One new permission, `dialog:allow-open`, approved by the owner on 2026-09-23; the window's reveal permission is removed.

**Tech Stack:** plain ES modules in `desktop/ui/`, Tauri 2 capability JSON, bun:test.

**Spec:** [2026-09-23-app-settings-gear-design.md](../specs/2026-09-23-app-settings-gear-design.md) ("The window"). **Depends on** the engine half ([plan](2026-09-23-app-settings-engine.md)): `app-settings`, `reveal`, `appDefaults` in the `settings` answer.

> **As built (2026-09-24), two places this plan is now stale.** `reveal`
> does NOT count toward busy: it writes nothing, and on some Linux
> desktops `xdg-open` can keep running until the file manager itself
> closes, so waiting on it would block a restart on the reader's window
> manager. Show in Finder moved from Task CW2 into CW1, so removing the
> reveal permission and wiring the button to the engine landed in the
> same commit and the button was never left broken in between. Also true
> but not a correction: the library line lives in one slot `drawWell`
> builds empty, probed fresh on every `drawWell`. And the engine half
> grew one thing this plan does not mention: it saves a script's starting
> settings on its first library conversion, so a later change to the app
> defaults reaches only scripts converted afterwards, not ones already
> sitting in the library untuned.

---

## Ground rules for every task

- Your own worktree, branch `parity-c-gear`. Absolute paths.
- TDD with bun:test. `bunx tsc --noEmit` and the full `bun test` green before each commit.
- No em dash (U+2014) in any string you add.
- `desktop/ui/app.js` is the only file that touches `window.__TAURI__` or knows an engine flag.
- Existing window rules stay green (`tests/desktop-ui.test.ts`, `tests/desktop-shell.test.ts`); update a guard only when its premise legitimately changed, and say what it now guards.
- Coordination: piece B (branch `parity-b-routes`, in parallel, another session) rewrites `send.js`, adds `argv.routes`/`argv.route`/`saveDialog` to `app.js`, adds `dialog:allow-save` to the capability file and a test exception for it, and writes the ADR amendment about the engine opening files. Do not touch `send.js`. Keep your `app.js`, capability and `tests/desktop-shell.test.ts` edits small and local so the two merge by hand in minutes. `frame.js`, `main.js`, `update.js`, `notes-surface.js`, `style.css` belong to other work; `convert.js` already carries the update question under the drop area (read it and place your line after it without disturbing it).
- Commit trailer `Co-Authored-By: <your model name> <noreply@anthropic.com>`.

---

### Task CW1: Builders, the folder door, and the reveal door retired

- `argv.appSettings(set = null)` → `['app-settings', '--json', ...(set ? ['--set', set] : [])]`; `argv.reveal(path)` → `['reveal', path, '--json']`. Extend the argv pin tests.
- `countsTowardBusy`: `app-settings` without `--set` is read-only and does not count; with `--set` it counts. `reveal` counts. Say why in the comment beside the others.
- `export async function pickFolder({ defaultPath })`: `tauri().dialog.open({ directory: true, defaultPath })` → the path or null; it shares the one-dialog-at-a-time guard and `onDialogClosed` handlers with `pickScreenplay` (read it). The dialog plugin's JS global is `window.__TAURI__.dialog` (verified in tauri-plugin-dialog 2.7.3's api-iife.js: `open(options)` and `save(options)`).
- Remove `revealItem` from `app.js`; replace its only caller (the result screen in `convert.js`) with `runEngine(argv.reveal(path))` in Task CW2.
- Capability: add the bare string `"dialog:allow-open"`; remove the `opener:allow-reveal-item-in-dir` entry. In `tests/desktop-shell.test.ts`: add `dialog:allow-open` to the bare-grant exceptions with the reason (the user chooses a folder in a native dialog; the window only receives a path and hands it to the engine); REPLACE the "reveal is scoped to the library" test with one asserting there is no reveal grant at all (the engine reveals, per the owner's 2026-09-23 decision). Update the description: remove the reveal clause, add the folder-picker clause.
- `desktop/README.md`: a dated quoted note: the folder picker door added, the reveal door removed and why.

- [ ] Commit "Window: a folder picker door, and Show in Finder handed to the engine".

---

### Task CW2: The library line on the Convert page, and Show in Finder through the engine

Pure decisions above the line in `convert.js`, tested directly:
- `libraryFrom(answer)`: validates `app-settings --json` (`ok`, `library.path` string, `library.chosen` string or null, `library.platformDefault` string, `library.fromEnv` boolean) → a clean object or null.
- `libraryLine(library)`: `Books are saved in <path, with the user's home folder shown as ~>.`; when `fromEnv`: `Books are saved in <path>, set by SCREEPUB_LIBRARY.` (Derive the home prefix from nothing in the window: add `home` to the engine's `app-settings` answer if you need it, in the engine plan's Task 3, and test it there.)
- `libraryActions(library)`: `[]` when `fromEnv`; `['change']` when nothing chosen; `['change', 'reset']` when a folder was chosen.
- `movedLine`: `New books go here. Books already converted stay where they are.`

Drawing: under the drop area (after the update question), one caption line plus `Change…` and (when chosen) `Reset` as quiet buttons. Probed with `argv.appSettings()` when the Convert page is shown. `Change…` → `pickFolder({ defaultPath: library.path })` → on a path, `runEngine(argv.appSettings(JSON.stringify({ libraryPath: path })))`; the engine's refusal (`bad-settings`) shows its sentence; success redraws the line and shows `movedLine` once. `Reset` → `{ libraryPath: null }`.

Result screen: Show in Finder calls `runEngine(argv.reveal(script.epubPath))`; a refusal shows its sentence where the result's other messages go; success says nothing.

Tests: the decisions, and shape tests (the Convert page asks `argv.appSettings()` on show; Change goes through `pickFolder` before `argv.appSettings(` with a set; Show in Finder uses `argv.reveal` and `revealItem` is gone from every ui file).

- [ ] Commit "Convert page: where books land, and a way to change it".

---

### Task CW3: App defaults on the Settings page

Read `desktop/ui/tune.js` in full first (the per-script Settings page; it loads the `settings` answer, draws presets and knobs, and saves with `argv.settings(fountain, set)`).

Pure decisions above the line, tested directly:
- `appDefaultsFrom(answer)`: the `settings` answer's `appDefaults` (validated with tune.js's existing `settingsFrom`) or null.
- `defaultsCaption(appDefaults, shipped)`: `New scripts start from Screepub's own defaults.` when equal, else `New scripts start from your own defaults.`
- `canResetDefaults(appDefaults, shipped)`: true when they differ.

Drawing, at the foot of the Settings page: the caption, a `Use these for new scripts` button (sends `argv.appSettings(JSON.stringify({ formatDefaults: <this script's current settings> }))`, then says `New scripts will start from these settings.` and refreshes the caption), and, when `canResetDefaults`, `Reset new scripts to Screepub's defaults` (`{ formatDefaults: null }`). Neither changes THIS script's settings.

Tests: the decisions; shape tests that `Use these for new scripts` sends the page's CURRENT settings (not the defaults) and that neither button calls `argv.settings(` (they must not touch the script's sidecar).

- [ ] Commit "Settings page: use these for new scripts, and a way back to Screepub's own".

---

### Task CW4: Docs

- `docs/parity-audit.md`: the gear's three things done (date, piece C).
- `docs/superpowers/plans/2026-09-21-parity.md` piece C: a Done note.
- `README.md`: the library section mentions changing the folder from the app.
- Full suite, tsc, em-dash check.
- [ ] Commit "Docs: piece C is done".
