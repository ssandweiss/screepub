# Parity audit: what the Swift app does that the Tauri app does not

Date: 2026-09-21 · Audited from the CODE, not from the specs
Sources: this session and the interface-pass session, independently, then
reconciled. Where we disagreed or one of us could not verify something,
it says so.

## Why this exists

Gate 2 of [the retirement spec](superpowers/specs/2026-09-14-retire-swiftui-design.md)
settled six features on 2026-09-14: five marked `port`, one named as gone.
**Settled is not the same as executed, and several documents have since
been written as though it were.** A week later, all five are at zero lines
in the Tauri app.

This file is the difference between a decision and a fact. It is meant to
be deleted when it is empty.

## Method, so the numbers can be rechecked

Counts are `grep -rniE` over `app/Sources/`, over `desktop/ui/` plus
`desktop/src-tauri/src/`, and over `src/`. Every apparent counter-example
was opened and read: `src/` mentions Apple Books five times and
Send-to-Kindle eight, and all thirteen are prose in CSS comments about
renderer behaviour. The `cancel` hits in the Tauri UI are all about
dismissing dialogs. The three test files matching these terms
(`epub.test.ts`, `options.test.ts`, `app-references.test.ts`) match prose.
**No test covers any unported feature.**

The kit-check figure is a direct recount from
`app/Sources/KitCheck/main.swift`, not a quotation of the spec.

## The route catalog, which is the cleanest measure

`ResultActions.swift` enumerates exactly six ways a finished book leaves
the Swift app. That enumeration is exhaustive by construction, which makes
it better evidence than any grep.

| Swift route | Tauri | |
| --- | --- | --- |
| `device` (Kindle, Kobo, tolino over USB) | **yes** | ported by piece A |
| `remarkable` | **yes** | ported by piece A |
| `appleBooks` | **yes** | done 2026-09-23 (piece B) |
| `sendToKindle` (Amazon web) | **yes** | done 2026-09-23 (piece B) |
| `emailToKindle` | **yes** | done 2026-09-23 (piece B) |
| `saveCopy` | **yes** | done 2026-09-23 (piece B) |

Six of six. The ranking and the remembered choice are done too:
`screepub routes` ranks every route and marks the one to preselect,
`screepub route <key>` performs a non-device route and remembers it, and
`desktop/ui/send.js` polls `routes` and draws the list in that order, with
the remembered route's button in brass.

## Everything missing, including four gate 2 does not name

| | Swift refs | Tauri UI | Status |
| --- | --- | --- | --- |
| Self-update (check, compare, decode, errors, install) | 109 | 0 | `port`, not started |
| Apple Books | 30 | 0 | **done 2026-09-23** (piece B) |
| Send-to-Kindle web | 59 | 0 | **done 2026-09-23** (piece B) |
| Email to Kindle | 38 | 0 | **done 2026-09-23** (piece B) |
| Save a copy | 15 | 0 | **done 2026-09-23** (piece B) |
| Cancel during conversion | 54 | 0 | **OUT, decided twice** |
| **Feedback / Report a Bug** | 17 | 0 | **in nobody's list** |
| **Show in Finder (two places)** | 2 | 0 | **done 2026-09-23** (piece C: the result screen) |
| **KFX plugin install** | button | 0 | **done 2026-09-23** (piece D: `kfx-status`, `kfx-install`, Send page) |
| **The gear (three things)** | 3 | 0 | **done 2026-09-23** (piece C: output folder, app defaults, Show in Finder) |
| First-run welcome screen | 1 | 0 | lower confidence |
| "Open Amazon's settings page" | 1 | 0 | **done 2026-09-23** (piece B: `route kindle-email-setup`) |

### The four gate 2 does not name

Found by the interface-pass session sweeping the Swift app's BUTTONS
rather than its modules, which is why a module-shaped audit missed them.
All four verified here independently.

**Feedback, and the failure screen matters most.**
`ScreepubApp.swift:114` has "Send Feedback on GitHub…" and
`ContentView.swift:704` has "REPORT A BUG" on the failure screen, which
carries the error's code and message into the report. That second one is
the only path by which a refusal reaches a bug report. The ADR named
Feedback among the deferred OS-launch shims and gate 2's six do not
include it, so it currently belongs to no list at all.

**Show in Finder, twice.** `ReaderRail.swift:101` "Show EPUB in Finder"
and `ContentView.swift:670` "SHOW IN FINDER". Revealing a file is not part
of save-a-copy and is not among the six.

**The KFX plugin installer is written and unreachable.**
`src/export/kfx.ts` exports `installKfxPlugin`, and it has ZERO callers
outside its own file and its tests. The CLI reads `kfxStatus` to decide
what it can build and never offers to install. Swift had an "Install
plugin" button. So this is not a port: the engine capability already
exists and nothing can reach it. **"Implemented" and "reachable" have come
apart, and this row exists to keep that visible** — it is the cheapest
item here and it is invisible to any audit that greps for absence.

**Closed 2026-09-23 (piece D).** `screepub kfx-status` and
`screepub kfx-install` reach it from the CLI, and the Send page draws the
same three-step checklist with Get and Install buttons. See
[the spec](superpowers/specs/2026-09-23-kfx-install-surface-design.md).

**The gear is three things.** `ScreepubApp.swift:157` "Output folder" with
a picker and a Reset, `ReaderRail.swift:100` "Save as app defaults" which
promotes one script's settings to app-wide, and `ScreepubApp.swift:221`
"Reset to Defaults". Tauri has none, and has no app-wide settings scope at
all. Today the library location is engine-owned and overridable only by
`$SCREEPUB_LIBRARY`, so **nobody can change where their books land without
setting an environment variable.**

**Closed 2026-09-23 (piece C).** The Convert page has a library line under
the drop area with Change… and Reset; the per-script Settings page's foot
has "Use these for new scripts" and, when the app defaults differ from
Screepub's own, "Reset new scripts to Screepub's defaults"; and Show in
Finder goes through the engine's `reveal`, so it works wherever the
library is. See
[the spec](superpowers/specs/2026-09-23-app-settings-gear-design.md).

## Two structural facts that shape any port

**The shell registers exactly two commands** (`run_engine`, `pick_file`)
and `desktop/src-tauri/capabilities/default.json` grants only
`core:default`. So the window today *physically cannot* open a URL or
reveal a file, even if the UI were written. Every OS-launch shim is
blocked on a capability decision, not just on code.

**`pick_file` is an OPEN dialog.** Save-a-copy needs a SAVE dialog, which
does not exist.

**A cross-platform state the Swift app never had to express.** Apple
Books, the Send to Kindle app and Apple Mail are macOS-only, and this is
three platforms now. "Not available on Windows" is a different row from
"plug it in to send", and the route list needs both. Raised by the
interface-pass session; it is a real gap in the Swift design being carried
forward unexamined.

## Cancel is decided, in the other direction

Gate 2 listed Cancel as gone pending the release notes. The interface-pass
session reports putting it back to the owner on 2026-09-21, after gate 2,
quoting `desktop/README.md`'s own note that the absence is deliberate and
that a kill handle means a third Rust command. **The answer was a flat
no.** So this item is not open, and the shell staying at two commands is
now load-bearing for a second reason: it is the only thing keeping "Rust
is a window, not a brain" literally true.

Recorded here as reported by that session rather than witnessed in this
one.

## The coverage number, recounted

`kit-check` has **264** check sites, unchanged since 2026-09-14. Counting
the ranges `docs/retired-coverage.md` names:

```
   5  feedback-url                45  send-menu
  17  updater-version-compare     26  self-update-installer
   5  mail-and-books              10  engine-cancellation (part)
  17  update-selection            14  update-decoding
  21  release-notes-parsing       11  update-error-descriptions
 ---
 171 of 264 = 65%
```

One nuance the headline figure hides: **21 of those 171 are
`release-notes-parsing`, where the FEATURE is replaced in kind** by
`tools/build-desktop-notes.ts` and `desktop/ui/notes.js`, and only the
Swift assertions are lost. So the genuinely unreplaced behaviour is **150
checks**, and the other 21 are a different kind of debt.

## What this blocks, and what it does not

**F3 is blocked, hard.** `app/` is the only implementation of six
user-facing features and the only coverage for 150 checks of behaviour.
Deleting it is not subtracting duplicated code.

**The updater deserves its own piece.** 85 of the 171 are the updater, and
`docs/retired-coverage.md` already says it "should be scoped as its own
piece rather than folded into F". This audit agrees.

**v0.6.1 is NOT blocked, but it owes disclosure.** It takes the bundle
identifier, so an existing Swift user upgrades themselves into the Tauri
app and loses, in one step: Apple Books, Send-to-Kindle, email-to-Kindle,
save-a-copy, Show in Finder, the feedback link, the output-folder setting
and Cancel. Gate 2's rule is that each is "ported, or listed in
`docs/releases/<version>.md` as a thing that went away". **Only Cancel is
currently written down.** That is the concrete, dated obligation this
audit creates.

## Open

- Whether v0.6.1 should ship at all before some of these land, or ship
  with a full disclosure list. That is the owner's call and this file does
  not make it.
- The engine-side surface the route panel needs. The interface-pass
  session's decision 25 asks for a route list (`id`, `title`, `detail`,
  `button`, `available`) plus a "perform route X" call, with the ranking
  and the remembered choice on the ENGINE side, because they are decisions
  and decisions do not belong in drawing code. Nobody owns building it.
