# Design: the desktop interface pass

Date: 2026-09-20 · Status: accepted (maintainer, in session); pieces 1 and 2
shipped 2026-09-21, 3 and 4 part-shipped — see "What has shipped" below
Program: [ADR 2026-09-12 — cross-platform rewrite](../../adr/2026-09-12-cross-platform-tauri.md)
Follows: [piece D — the Tauri interface](2026-09-13-tauri-ui-design.md)
Target version: 0.6.0

## Goal

Piece D built the interface. This pass is about how it *feels*, and it is the
first time the Tauri window has been looked at beside the frozen SwiftUI app
by the person who designed both.

The source is five batches of maintainer notes taken 2026-09-14 against two
builds running side by side, plus the decisions that came out of them. This
document records every decision with the reason, because several of the notes
turned out to be arguing with something deliberate, and a later reader needs
to know which.

## The constraint that shapes everything

Piece D's governing rule still holds: **the visual identity is decided and
this pass does not redecide it.** No new palette, no new typeface. What is
new here is that the window now has machine-enforced rules of its own, and
every change below has to pass them. From `tests/desktop-ui.test.ts`:

- No hex literal in any stylesheet but `style.css` and `tokens.css`.
- No `font-size` or `border-radius` in raw px, anywhere.
- No custom property declared by two of the window's stylesheets.
- Every stylesheet the page loads is bundled and local, and every bundled
  font face is declared.

And from the generator: **`desktop/ui/tokens.css` is generated** from
`brand/tokens.json` by `tools/build-desktop-tokens.ts`. A new token goes into
the brand, not into the window. Hand-editing it fails CI.

One rule that does *not* apply here, and is worth saying so nobody carries it
across by reflex: the CSS-2.1-vintage value-syntax ban in CLAUDE.md is about
**EPUB** CSS, because Adobe RMSDK can blank a book on a value function it
cannot parse. The desktop window runs in a modern webview. `min()`, `clamp()`
and `var()` are all already in use there and are fine.

## What was decided

### The window

1. **The macOS title bar goes.** The black Tauri bar reading "Screepub" is
   chrome the SwiftUI app never had. Replaced with an overlay title bar so
   the traffic lights float on the paper. This is `tauri.conf.json`, which is
   legitimately shell territory: a window is what Rust is for.
   **Cross-platform consequence:** this is a macOS-only win. Windows and
   Linux keep a normal title bar. The design must not depend on its absence.

2. **The paper runs to the window edge.** Already done: `desktop-paper-full-bleed`
   is cherry-picked onto this branch. The dark ground that swallowed the page
   on a wide display is gone.

3. **The 1000px page cap stays.** Considered dropping it once the title bar
   went, and built both. A screenplay's action column is a fixed measure near
   60 characters, and the Read surface exists to show a script *as a script*.
   Uncapped, the column runs near 95 characters at a 1600px window and past
   160 on a 2560px display, at which point the preview stops resembling the
   thing it previews. Wide windows get margin, not line length.

4. **The version stamp becomes `rev`, and becomes the way into Notes.**
   It currently reads `ENGINE 0.5.4`; the SwiftUI app read `rev. 0.5.4`. The
   stamp gains a control role: activating it opens the release notes.
   **Which number it names, and the thing not to break.** The stamp prints the
   *engine's* self-reported version today (0.5.4) while the desktop crate is
   0.6.0, so "rev 0.5.4" on a 0.6.0 build would be wrong in a place people
   quote into bug reports. It should name the **release**, since "rev" reads as
   this application's revision and the notes it opens are that release's notes.
   The value is already in the window and needs no new Rust, no new command and
   no new capability: `desktop/ui/notes.js` is generated from
   `docs/releases/<version>.md` and exports `RELEASE.version`. Taking the
   number from there makes the stamp and the notes it opens agree **by
   construction** rather than by coincidence.

   What must survive: that stamp is currently the app's only proof the sidecar
   works. It runs `--version` at boot, and on failure it turns red and prints
   the engine's own error with the button still usable. **Keep the call and
   keep the failure state.** Success shows `rev <RELEASE.version>`; failure
   still shows the engine's sentence in red. Losing that would remove the one
   signal that distinguishes a broken install from a quiet one.

5. **Notes leaves the tab bar.** It becomes what the SwiftUI app had, a sheet
   reached from the version. This is not a workaround: `notes-surface.js`
   already heads itself `Screepub <version>`, and the SwiftUI app showed it as
   `ReleaseNotesSheet`. Clicking a version to see what is in that version is
   the coherent arrangement; a permanent top-level tab was not.

6. **The settings gear returns, top right, opening in-window.** See Settings.

### Convert

7. **`Fade in:` goes, and so does the body paragraph.** "Drop a script and it
   becomes a real e-book, built entirely on this computer. Nothing you drop
   here is ever uploaded."
   **Flagged and accepted:** that second sentence is the only place the window
   states the privacy premise the whole project rests on. Removing it removes
   that claim from the interface. The maintainer chose to cut it anyway.

8. **The SCREEPUB wordmark goes into the whitespace**, as in the SwiftUI app.
   With the title bar gone this is also the only place the app names itself.

9. **Spacing opens up.** The current layout crowds everything to the top of
   the sheet. Target the SwiftUI app's vertical distribution.

10. **"Needs selectable text, not a scan" stays. "No password." goes.**
    Flagged before cutting, because it is load-bearing: `src/cli-errors.ts`
    has a real `password` code, and `convert.js` carries a comment saying the
    line is deliberate, since two of the engine's four guards are properties a
    reader can check at a glance, which moves both from *after* the wait to
    *before* the drop. Cutting it moves that discovery back after the wait.
    Accepted, with the condition that a locked PDF still produces a clear
    refusal. **It already does** and needs no work: code `password` maps to a
    real heading and renders the engine's own sentence with its code beneath.
    Only the heading's wording changes, under decision 12.

11. **`Convert another` returns to the drop well.** Today it calls the file
    picker directly, so the window jumps straight to a native dialog with no
    way back to the empty state.

### Cross-cutting

12. **The fake sluglines go, everywhere.** This was raised as two strings and
    is in fact a system. Verified inventory: **19 of them across four files** —
    `convert.js` 12 (nine refusal headings plus `Fade in:`, `Int. conversion
    bay - continuous`, `Int. your library - night`), `send.js` 4, `tune.js` 2,
    `read.js` 1. The heading in `notes-surface.js` is not one of these: it
    prints a real title, `Screepub <version>`, and stays.
    The replacement headings must keep the property the removed ones had, which
    `convert.js` records explicitly: **the heading names the CAUSE, not the
    failure.** "Scanned PDF, no text" tells a reader what to do next; a generic
    apology does not.

13. **No Cancel during conversion.** Piece F's parity list named it, and the
    maintainer overruled that here. `desktop/README.md` records the absence as
    deliberate: killing a running sidecar needs a kill handle the window can
    reach, which means a third Rust command. The shell stays at two,
    `run_engine` and `pick_file`, and "Rust is a window, not a brain" holds.

14. **Read, Tune and Send are hidden until a script exists, then revealed.**
    They are already *disabled* (`frame.enable()` plus `.tab:disabled`), which
    is why they read as greyed rather than absent. The ask is to go further and
    hide them, then animate them in on a successful conversion.
    **Consequence to absorb:** hiding changes the tab bar's width, so the
    reveal has to accommodate reflow rather than fight it. Must honour
    `prefers-reduced-motion`, which the window already respects and
    `main.js` already reads into `state.reducedMotion`.

### Read

15. **Keep it.** The maintainer's assessment: a solid improvement on the
    SwiftUI reader, elegant, and better than what came before.

16. **The scene index moves left, as a drawer that parks in the binding
    margin.** Three approaches were built against the real UI and compared.
    The constraint is arithmetic: the binding margin is 17.6% of the sheet and
    the brads sit at 5.9% with a ~34px face, leaving about 96px clear, while
    the rail needs 150 to 218px. It cannot sit beside the fasteners.
    - *Swapping the grid columns* works but charges the script: the open list
      leaves it about 460px, wrapping near 48 characters.
    - *A plain overlay anchored to the content edge* was built and rejected on
      sight: it lies on the script and hides the scene headings, which are the
      one thing the index exists to reach.
    - **Chosen:** the panel parks one width further left, in the margin. The
      script keeps the full measure open or shut and is never covered. The
      brads tuck behind the panel while it is open.
    Two implementation facts that are not optional. The panel must be **capped
    to the margin width** (17.6/70.6 = 24.9% of the content box, itself capped
    at the rail's 218px) or it hangs off the window. And `.scene-rail` must
    stay **positioned**, because `read.js` keeps the marked scene in view by
    its button's `offsetTop` and an unpositioned rail would hand it an offset
    measured from the page.
    Hiding must use opacity, not translation alone: the margin grows with the
    window, so on a wide display a panel moved by its own width is still
    sitting on the paper in plain sight.

17. **Page markers default to on. Scene numbers do not.** The maintainer's
    reasoning: scene numbers are an intentional property of a draft, present
    or absent by the writer's choice, so the app should not add them. Page
    numbers are navigation.
    **This is not a UI change.** `showPageMarkers` is `false` in
    `format-defaults.json`, and that file is pinned by `options.test.ts` and by
    the Swift `kit-check`. Flipping it is a lockstep edit across
    `format-defaults.json` and `app/Sources/ScreepubKit/FormatSettings.swift`.
    That Swift file lives inside the frozen `app/`, whose
    `README-FROZEN.md` says no new Swift is written there;
    `tests/frozen-app.test.ts` guards the file *list*, not contents, so editing
    it will not trip the guard. **If `kit-check` forces that edit, say so out
    loud in the commit rather than making it quietly.**

### Settings (was Tune)

18. **Tune becomes Settings, and a gear returns top right.** These are one
    decision because there are genuinely two scopes and one surface cannot
    honestly be both:
    - **Per script**, saved in a sidecar beside the script: the eighteen knobs.
      This stays in the tab bar, renamed Settings.
    - **App-wide**, which the SwiftUI gear held and Tauri dropped entirely: the
      same eighteen as defaults for new scripts, plus the **output folder**.
      The folder is a real regression. The library is engine-owned and today
      overridable only through `$SCREEPUB_LIBRARY`, so no one can change where
      their books land without an environment variable.
    - **Plus an update section.** Piece D shipped no updater by design, and
      `notes-surface.js` still says so. That decision has since been reversed:
      the maintainer chose a full ported self-update. The gear needs room for
      it. Leave the room now rather than retrofitting.

19. **Tab order is unchanged:** Convert, Read, Settings, Send. It reads left to
    right as the actual sequence. Moving Send earlier would put the destination
    before the thing being sent.

20. **The eighteen get rewritten, outcome first.** The current copy explains
    mechanism to a screenwriter in a compressed register, using KFX, tolino,
    chyrons, ragged-right and `(CONT'D)` as though they were common words, and
    several labels name implementations rather than outcomes ("Print-style
    split minimums", "Keep the PDF's font shifts"). The brief: lead with what
    the reader will see in their book, one plain sentence, no jargon that is
    not glossed. The maintainer approves the list before it ships.
    Worth knowing when rewriting: this copy was *carried over* from the SwiftUI
    reader rail rather than written fresh, so the abstraction is inherited.

21. **Compact the list, and give it a side-by-side preview.** The surface reads
    as one long menacing column. The machinery to fix it already exists and was
    measured rather than guessed: every knob is classified `live` (the preview
    changes as it moves), `book` (the book changes and a preview cannot show
    it), or `reconvert` (decided when the PDF was read). "Settings that alter
    how the script looks" is therefore already a computed set. Put the `live`
    knobs beside a live preview, and put `book` and `reconvert` behind a
    disclosure, because a knob that cannot move the preview does not deserve
    equal billing next to one that can. `tune.js` already imports the reader's
    renderer and calls it, so the preview relationship exists; it is on the
    wrong surface.

22. **Fix "Start from".** It reads as arbitrary because it is three faults at
    once. It offers exactly two presets, and one of them, "Kindle e-ink (6\")",
    is *identical to the defaults*, so on a fresh script it visibly does
    nothing. The label never says it **overwrites every setting below it**,
    which the SwiftUI version stated out loud. And the engine exposes
    `matchingPreset()` to answer "which preset am I on", which the window never
    calls, so it cannot show you where you stand.

### Send

23. **The standing "what Screepub can reach" table comes off the default
    view.** It is kept and reachable, not deleted: it carries honest
    information about unproven routes. It simply should not be the first thing
    the surface says.

24. **The surface moves toward the SwiftUI original**, which did this better.

25. **The route list is mostly a back-end gap, not a UI gap.** Verified: five
    of nine routes have no code in any language. The Rust shell exposes only
    `run_engine` and `pick_file`, and `capabilities/default.json` grants no
    plugin permission at all, saying so explicitly, so the window today
    physically cannot open a URL, reveal a file, or hand a file to another app.
    The ADR deferred the OS-launch shims to piece C, "where Tauri's own plugins
    may answer them outright," and they were never built.

    | Route | SwiftUI | New stack | Gap |
    |---|---|---|---|
    | Plugged-in reader, USB | yes | yes | none |
    | reMarkable, docked | yes | yes (`src/device/remarkable.ts`) | none |
    | Preview script | yes | yes, the Read surface | naming and route |
    | Save a copy | yes | engine has `src/export/` | needs a **save** dialog |
    | Apple Books | yes | nothing | engine code + OS shim, macOS only |
    | Send to Kindle app/web | yes | nothing | engine code + OS shim |
    | Send to Kindle email | yes | nothing | needs Apple Mail, macOS only |
    | Show in Finder | yes | nothing | reveal shim |
    | Ranking, remembered choice | `ResultActions.swift` | **not ported** | all of it |

    The last row is the real loss and the easiest to rebuild wrongly. The
    SwiftUI version did not merely list routes. It ranked them, and **what you
    chose last time beat any heuristic**, on the recorded grounds that "the
    guess only has to be wrong once to be annoying." It also kept unavailable
    routes visible as dimmed rows carrying their own fix ("plug in over USB to
    send"), because hiding a row hides the capability. Rebuilt from a
    screenshot, all of that vanishes silently.

    **New constraint the SwiftUI list never faced:** Apple Books, the Send to
    Kindle app and Apple Mail are macOS only, and this app is now three
    platforms. The list needs a second kind of dimmed row, because "not
    available on Windows" is a different state from "plug it in."

## What this pass does not do

- **Cancel during conversion.** Overruled; see decision 13.
- **A new palette or typeface.** Piece D's rule still holds.
- **Reopen the page cap.** Decided in 3, with both options built.
- **Write the engine side of Send.** Owned here as design, not as engine work;
  see the decomposition.

## Decomposition

Too large for one plan. Four pieces, in dependency order. Pieces 1 and 2 are
pure front end and unblocked today. Piece 4 cannot finish without engine work
that does not exist yet.

| | Piece | Covers | Depends on | State (2026-09-21) |
|---|---|---|---|---|
| **1** | The frame and the empty state | 1, 4, 5, 7, 8, 9, 10, 12, 14 | nothing | **shipped** |
| **2** | Read | 16, 17 | nothing (17 touches the engine's defaults, not its code) | **shipped** |
| **3** | Settings | 18, 20, 21, 22 | an engine surface for app-wide settings and the output folder | 20, 21, 22 shipped; 18's rename shipped, **its gear is blocked** |
| **4** | Send and the result screen | 11, 23, 24, 25 | `ResultActions` ported, the OS-launch shims, a save dialog | 11 and 23 shipped; **24 and 25 blocked** |

Each piece gets its own implementation plan. This document is the shared
record of *why*; the plans are the *how*.

## What has shipped, and what changed on the way

Recorded here because the decisions above are dated 2026-09-20 and the code
moved past several of them the next day. A design document that still
describes shipped work in the future tense is the thing CLAUDE.md's own
working style warns about.

**Shipped** (fifteen commits on `worktree-desktop-ui-pass`, rebased onto
v0.6.0): all of piece 1 and piece 2, plus decisions 11, 20, 21, 22, 23 and
the rename half of 18.

**Three decisions changed after they were written.**

- **13, Cancel, hardened from "deferred" to "decided."** Gate 2 in the
  retire-SwiftUI spec had listed Cancel among six features settled on
  2026-09-14. The maintainer overruled it explicitly on 2026-09-21, after
  being shown `desktop/README.md`'s own note that a kill handle means a third
  Rust command. The shell stays at two. That makes "Rust is a window, not a
  brain" literally true, which is now load-bearing for the doors-not-commands
  ADR as well.
- **4, the rev stamp, was proven right by accident.** The decision to take
  the version from the generated notes module rather than from the engine was
  argued on the grounds that the two numbers differ during the transition.
  Three days later `package.json` went to 0.6.0 and the notes were
  regenerated; the stamp followed to `rev 0.6.0` with no edit, and would
  still have been reading 0.5.4 under the alternative.
- **17 narrowed to page markers only.** The maintainer's reasoning, worth
  keeping because it generalises: a scene number is an intentional property
  of a draft and the app must not invent one; a page number is navigation and
  the PDF already had it.

**One defect this pass introduced and fixed.** The release-notes `<dialog>`
was given a `display` on its bare class, which does not style a closed dialog
— it un-hides it, because any class selector outranks the browser's own
`dialog:not([open])` rule. The notes sat at the foot of every surface for six
commits, invisible in a short window. There is now a test for the shape of
that mistake, not just the instance.

**Shipped after the merge (2026-09-21), from the parity audit rather than
from the five note batches.** Report a Bug, which closed the hole where a
refused file was a dead end, and Show in Finder. Both are *doors* under
ADR 2026-09-21: two scoped opener grants, no new Rust command, the shell
still registering exactly `run_engine` and `pick_file`.

The tripwire asserting the capability was exactly `['core:default']` fired on
the first of those and did its job: it stopped the grant long enough for the
decision to be made in an ADR rather than in a diff. Its replacement is
narrower where it counts — every plugin grant must be scoped, `shell:execute`
is refused by name, and the opener's allow-lists may not widen past the issue
tracker and `$DOCUMENT/Screepub/**`.

**A coupling that outlives this document.** Reveal is scoped to
`$DOCUMENT/Screepub/**`, so a library moved with `$SCREEPUB_LIBRARY` is
outside it and reveal fails there, deliberately. When decision 18's app-wide
store lands and the output folder becomes settable, **the scope has to move
with the setting**. The engine session has this in the store's spec; it is
recorded here too because the two halves live in different documents.

**Two contracts agreed with the engine session, to build against.**
- Save a copy: `screepub export <epub> --for <fmt> --out <path>`. The engine
  writes the artifact to the chosen absolute path, creating parents, and the
  `--json` answer's `path` is that path. The window raises the save dialog
  and hands over a destination; it never writes a file. Anything else would
  need a filesystem write grant, which is not a door.
- The send routes: the `{id, title, detail, button, available}` list plus a
  perform-route call, ranking and remembered choice on the engine side.

**Two things the blocked pieces learned.** Decision 25's route contract was
adopted by the engine session as written, so the shape it specifies (a route
list of `{id, title, detail, button, available}` plus a perform-route call,
with ranking and remembered choice on the engine side) is now the agreed
boundary rather than this document's proposal. And the parity audit found
four gaps this spec did not name: feedback/report-a-bug, reveal-in-Finder,
the gear being three separate things, and `installKfxPlugin` being fully
implemented in the engine with no caller anywhere — a capability that exists
and cannot be reached.

## Testing

The window's rules are already enforced and every piece must keep them green:
`tests/desktop-ui.test.ts` (hex, px, duplicate tokens, bundled assets),
`tests/desktop-shell.test.ts` (the seven colours pinned to `brand/tokens.json`,
and every `invoke()` and flag literal in `app.js`), `tests/desktop-tokens.test.ts`
(the generator), and `tests/desktop-notes.test.ts`.

Three pieces need tests that do not exist yet:

- **The slugline cut** wants a test that no fake slugline comes back. The
  inventory is mechanical: no string literal in `desktop/ui` matching
  `/^Int\. .* - /` or `Fade in:`. Cheap, and it makes decision 12 permanent.
- **The refusal headings** already have full coverage of the nine codes, and
  the existing assertion that every code `src/cli-errors.ts` can return on the
  conversion path has an entry must keep passing with the new wording.
- **The page-marker default** is covered by the existing pins the moment
  `format-defaults.json` changes; the work is making all pinned copies agree,
  not writing a new test.

## Acceptance criteria

1. No fake slugline remains anywhere in `desktop/ui`, and a test fails if one
   returns. Refusal headings still name the cause.
2. Read, Settings and Send are absent from the bar until a script converts,
   then appear, and the appearance is suppressed under
   `prefers-reduced-motion`.
3. The version stamp reads `rev <RELEASE.version>`, is operable by keyboard and
   pointer, and opens the release notes. Notes is no longer a tab. A failed
   engine still turns the stamp red and prints the engine's own sentence.
4. A locked PDF still produces a named refusal with the engine's own sentence,
   with the drop-well warning gone.
5. `Convert another` returns to the drop well without opening a dialog.
6. The scene index sits left, collapses, never covers the script, and never
   extends past the window at any width down to the 720px breakpoint.
7. The script's measure is unchanged by opening the index.
8. `showPageMarkers` is `true` in every pinned copy, and both suites pass.
9. `bunx tsc --noEmit` clean, full suite green, and the window still loads with
   no console error.

## Risks

- **Decision 7 removes the privacy claim from the interface.** It is the
  project's whole premise and the window will no longer state it. Flagged and
  accepted; worth revisiting if the wordmark leaves room.
- **Decision 17 may force an edit inside the frozen `app/`.** Permitted, since
  the guard covers the file list rather than contents, but it must be declared
  rather than slipped in.
- **Piece 4 is the largest and the least under our control.** Its route panel
  is designed here but cannot be finished until `ResultActions` is ported and
  the shell gains the ability to open a URL and reveal a file. Designing it
  before that exists risks a panel built for routes that arrive shaped
  differently.
- **The title bar change is macOS only.** Windows and Linux keep their bar, so
  the wordmark and top spacing must look deliberate with a title bar present.
  Nobody has a Windows machine to check this on, which the ADR already records
  as an accepted gap.
