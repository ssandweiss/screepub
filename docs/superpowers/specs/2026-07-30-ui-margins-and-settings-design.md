# Title-page copy, Settings restructure, and one formatting surface

Date: 2026-07-30
Branch: `worktree-ui-margins-and-settings`
Status: approved for implementation (margin feature deferred, see Appendix A)

## Problem

Three complaints, which turned out to share one cause.

1. The title page tagline reads `screenplay · to · kindle`. Kindle is no longer
   the only destination: Kobo, tolino, reMarkable, and Apple Books all ship.
2. `also accepts .fountain files` occupies the bottom-left of the title page to
   advertise something that does not need advertising.
3. Settings has a Formatting tab that duplicates the reader rail, in a window
   that cannot be resized and is too small for what it holds.

Investigating (3) found the real defect. Settings and the reader rail are not
equal duplicates:

| | knobs | preview |
|---|---|---|
| Settings, Formatting tab | all 15 | `LayoutPreview`, a hand-drawn schematic |
| Reader rail | 11 | real engine output, live, debounced re-render |

The window with the *real* preview cannot reach `keepSceneHeadingWithScene`,
`includeTitlePage`, `rejoinSplitDialogue`, or `contdMode`. Anyone tuning a
script hits that wall, switches to the window with the *fake* preview to change
the option, then switches back to see what it did. That is the bug. The
duplication and the cramped window are symptoms of it.

## Approach

Delete the Formatting tab rather than grow the window to fit it. Formatting is
a see-it activity and belongs beside the live render. Settings keeps app-level
and machine-level concerns. The cramped-window complaint resolves by removing
the content that did not fit, instead of fighting SwiftUI's `Settings` scene
sizing convention.

Rejected alternatives:

- **Keep a thin Formatting tab.** Retains two surfaces and the question of
  which one is authoritative. The preset picker already covers the case it
  would serve.
- **Make the Settings window resizable, change nothing else.** Possible on
  macOS 13+ via `.windowResizability`, but a resizable preferences window
  fights platform convention, and it makes room for content that should not be
  there.

### The one cost, and its fix

With no script open there is no reader window, so a new user has nowhere to set
defaults. Device presets cover this: presets are the coarse choice and belong
in Settings; fine-tuning is a per-script activity and belongs beside a live
render. The rail's existing **Save as app defaults** closes the loop back.

## Scope

### 1. Title page copy (`ContentView.swift`)

- Remove the tagline `Text("screenplay · to · kindle")` and its `.padding(.top, 14)`
  (currently `:279`).
- Remove `Text("also accepts\n.fountain files")` (currently `:315`).
- The enclosing `HStack` then holds only `Spacer()` and `deviceStamps`. Collapse
  it to `deviceStamps` aligned trailing.
- `.fountain` stays in `panel.allowedContentTypes` (`:362`) and drag-and-drop is
  untouched. Only the advertisement goes.
- Removing the tagline changes vertical balance under the logotype. Adjust the
  following `Spacer(minLength: 30)` by eye against a real build, not by guess.

### 2. Settings becomes General + Devices (`ScreepubApp.swift`)

`SettingsView`:

- Tabs become **General** and **Devices** (`systemImage: "externaldrive"`).
- Drop `.frame(width: 720)` to roughly `520`. Confirm against a build; 720 was
  sized for the two-column form-plus-preview layout that is going away.

`GeneralSettings` keeps **Library** (output folder) and **Updates**, and loses
`KfxQualitySection()` and the "Other devices" section to the new tab.

New `DevicesSettings`:

- **Default formatting** section: the `DevicePreset` apply-menu moved verbatim
  from `FormattingSettings` (it already calls `AppSettings.setFormatSettings`).
  Add a status line naming the current default. `FormatSettings` is `Equatable`,
  so compare `AppSettings.formatSettings()` against each `preset.settings` and
  show either the matching preset's `displayName` or "Customized". Presets write
  settings and store no identity, so a stateful `Picker` would misreport a
  fine-tuned default; an apply-menu plus a computed status line is honest.
- Move the **Reset to Defaults** button here. `AppSettings.resetFormatting()`
  currently has exactly one caller, the button inside the tab being deleted, and
  would otherwise become dead code.
- `KfxQualitySection()`, unchanged, moved.
- The "Other devices" tolino/reMarkable note, unchanged, moved.

Delete `FormattingSettings` entirely.

### 3. Delete `LayoutPreview.swift`

Verified single caller at `ScreepubApp.swift:289`, inside `FormattingSettings`.
Delete the file (210 lines) with its caller. Keeping a second preview of lower
fidelity than the reader's is worse than having one.

### 4. Reader rail becomes the one formatting surface (`ReaderRail.swift`)

Add the four missing options, all already present in `FormatSettings` and
already flowing through `ScriptSettings` and the engine. No new options, no
engine change, no CSS change.

- `keepSceneHeadingWithScene` (Toggle)
- `includeTitlePage` (Toggle)
- `rejoinSplitDialogue` (Toggle)
- `contdMode` (Picker: Automatic / Remove all / Keep as written)

Regroup the resulting 15 format controls (11 today plus these 4), replacing the
single "This script" section:

| Section | Controls |
|---|---|
| Page | element spacing, scene page breaks, keep scene headings |
| Dialogue | column margins, cue alignment, cue indent, paren indent, dual dialogue |
| Text | typeface, justify |
| Content | title page, scene numbers, page markers, rejoin split dialogue, (CONT'D) |

The preset menu, render status, **Save as app defaults**, **Show EPUB in
Finder**, and the **Send** section keep their current order and behavior.

Widen the rail from `.frame(minWidth: 210, maxWidth: 240)` to roughly
`minWidth: 240, maxWidth: 300`. It is in an `HSplitView`, so the user can still
drag it. Confirm the `Form` scrolls cleanly at the window's `minHeight: 500`
with all 15 controls plus the preset menu and Send section present.

Use the existing `binding(_:)` helper for every new control so each one gets the
debounced re-render for free. Do not bypass it.

## Out of scope

- Any change to `FormatOptions`, `format-defaults.json`, `FormatSettings.swift`,
  `ScriptSettings.swift`, `AppSettings.swift`, `css.ts`, or the engine.
- Page margins and the vertical-gap work. See Appendix A.

## Verification

Swift and app-layer only, so no fixture sweep and no epubcheck run: no
conversion output changes.

- `bunx tsc --noEmit` and `bun test` should be untouched by this work. Run them
  to confirm exactly that.
- `(cd app && swift run -c release kit-check)` must stay green. It pins
  `FormatSettings.defaults` against `format-defaults.json` and asserts
  `DevicePreset.allCases.count == 2`; neither changes here, so a failure means
  something was disturbed that should not have been.
- `app/build-app.sh`, then exercise by hand:
  - Title page: no tagline, no fountain line, device stamps still positioned and
    rotating correctly, vertical balance acceptable.
  - Settings: two tabs, window comfortable at the new width, preset apply-menu
    works, status line reports "Kindle e-ink (6\")" on a fresh profile and
    "Customized" after changing one knob, Reset to Defaults restores it.
  - Reader: all 15 controls present, each triggers a live re-render, the four
    newly-added ones visibly change output, rail scrolls at minimum window
    height.
- Confirm `.fountain` still opens via both **Choose PDF…** and drag-and-drop
  after the copy removal.

## Appendix A: deferred page-margin work, and what we learned

Paused 2026-07-30 pending the beta tester's Kindle model number. Recorded here
so the forensics are not lost.

**Original request.** A global top/bottom page-margin control, live in the
preview window, because a beta tester on an older Kindle reported very large top
and bottom margins.

**What the code actually does.** `css.ts:34` sets `html, body { margin: 0;
padding: 0 }`. Screepub ships *zero* page margin. Any margin the reader sees
comes from the device or the conversion toolchain, not from us.

**Two mechanisms found in our own output.**

1. `html.ts:118` and `:222` wrap heading-plus-first-block and cue-plus-first-line
   in `.keep-together`. A chunk that does not fit gets pushed whole to the next
   page, leaving a ragged bottom gap that differs page to page. `css.ts:11`
   already warns about exactly this.
2. `css.ts:55` gives `h2.scene-heading` a `gap * 1.6` top margin. The CSS spec
   says margins are truncated at a page boundary; older Kindle renderers keep
   them, so a heading landing at a page top carries 1.6 blank lines of dead air
   with it.

**A vertical page margin is not buildable in reflowable EPUB.** `body {
padding-top }` applies to the top of the body box, which is the start of a spine
file, not of every page. `html.ts` packs scenes into a handful of files, so it
would affect a few pages out of hundreds. `@page` margins are the correct
mechanism and Kindle's renderers largely ignore them. Horizontal is different:
`body { padding-left/right: X% }` applies to every line box and is genuinely
per-page.

**Why it paused.** The reporter later clarified that the excess is uniform on
*every* page, not only pages where a scene heading lands at the top. A uniform
symptom fits device firmware or the conversion toolchain far better than it fits
either mechanism above.

**Next suspect to rule out.** `KFXToolchain.swift:83`'s `calibreFormatGuards`
passes no `--margin-*` flags, so `ebook-convert` applies its own defaults on both
the AZW3 and KFX routes. That would be uniform on every page and Kindle-route
only, matching the clarified description. Check this before designing anything.

**The design that was drafted, if it is ever revived.** Three options, each
defaulting to today's exact output so the defaults-pinning in `options.test.ts`
and `kit-check` stays meaningful: `pageMarginSidePct` (0 to 12, default 0);
`sceneHeadingSpaceRatio` (0 to 2, default 1.6, a multiplier on
`elementSpacingEm` rather than an absolute em value, to preserve the invariant
that all vertical rhythm scales together); `keepCueWithDialogue` (bool, default
true, making registry §8b's always-on cue keep-together optional, with the
honest trade that off allows an orphaned cue at a page bottom, which print
convention forbids).

Note that `sceneHeadingSpaceRatio` cannot solve the problem outright: one number
governs the space both mid-page, where it is wanted, and at a page top, where it
is not, and CSS offers no way to distinguish them in reflowable text.
