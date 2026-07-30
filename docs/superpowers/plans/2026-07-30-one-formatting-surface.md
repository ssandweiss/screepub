# One Formatting Surface Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the reader rail the single formatting surface, cut Settings down to General + Devices, and clean two stale strings off the title page.

**Architecture:** Delete `FormattingSettings` and `LayoutPreview` rather than grow the fixed-width Settings window to fit them. The four options the rail is missing already exist in `FormatSettings` and already flow through `ScriptSettings` to the engine, so this is a pure view-layer move: no new options, no engine change, no CSS change, no conversion-output change. One piece of real logic gets added to ScreepubKit (`DevicePreset.matching`) so the Devices tab can name the current default honestly, and that piece is test-driven.

**Tech Stack:** Swift 6 / SwiftUI, SwiftPM (no Xcode project). Tests are the `kit-check` executable, because CommandLineTools ships neither XCTest nor swift-testing.

**Spec:** `docs/superpowers/specs/2026-07-30-ui-margins-and-settings-design.md`

---

## Context you need before starting

**Run everything from the repo root.** This is a git worktree; do not `cd` to the
original checkout.

**Three verification commands, and what each one actually covers:**

| Command | Covers |
|---|---|
| `(cd app && swift build)` | Compiles **all** targets including `ScreepubApp`. This is the only thing that catches view compile errors. |
| `(cd app && swift run -c release kit-check)` | ScreepubKit behavior only. The `kit-check` target does **not** depend on `ScreepubApp`, so it will happily pass while the app is broken. |
| `bun test` and `bunx tsc --noEmit` | The TypeScript engine. Untouched by this work; run them to confirm exactly that. |

**No fixture sweep and no epubcheck for this plan.** Those are required after
stage-1 or CSS changes (see CLAUDE.md). Nothing here changes conversion output.

**The `binding(_:)` helper is not optional.** `ReaderRail` reaches into
`model.settings` through `binding(\.keyPath)` (`ReaderRail.swift:93`), which
triggers the debounced re-render on every change. Every control you add must use
it. A raw `$model.settings.foo` compiles and then silently never re-renders.

---

## File Structure

| File | Change | Responsibility after |
|---|---|---|
| `app/Sources/ScreepubKit/DevicePreset.swift` | Modify | Preset definitions **plus** identity-by-equality lookup |
| `app/Sources/KitCheck/main.swift` | Modify | Adds three checks for the above |
| `app/Sources/ScreepubApp/ContentView.swift` | Modify | Title page loses two strings |
| `app/Sources/ScreepubApp/ScreepubApp.swift` | Modify | `SettingsView` = General + Devices; `FormattingSettings` deleted |
| `app/Sources/ScreepubApp/LayoutPreview.swift` | **Delete** | (gone with its only caller) |
| `app/Sources/ScreepubApp/ReaderRail.swift` | Modify | The one formatting surface, 15 controls in 4 groups |

---

## Task 1: Title page copy

**Files:**
- Modify: `app/Sources/ScreepubApp/ContentView.swift` (tagline at `:279-282`, fountain line at `:314-321`)

- [ ] **Step 1: Remove the tagline**

In `ContentView.swift`, inside `private var titlePage: some View`, delete these
four lines that sit directly after the `SCREEPUB` `Text` and its rule overlay:

```swift
            Text("screenplay · to · kindle")
                .font(Theme.courier(12))
                .foregroundStyle(Theme.inkFaint)
                .padding(.top, 14)
```

Leave the `Spacer(minLength: 30)` that follows it in place for now.

- [ ] **Step 2: Remove the fountain advertisement and collapse its HStack**

Find this block near the end of `titlePage`:

```swift
            HStack(alignment: .bottom) {
                Text("also accepts\n.fountain files")
                    .font(Theme.courier(10))
                    .foregroundStyle(Theme.inkFaint)
                    .lineSpacing(2)
                Spacer()
                deviceStamps
            }
```

Replace the whole block with:

```swift
            deviceStamps
                .frame(maxWidth: .infinity, alignment: .trailing)
```

`deviceStamps` is already a trailing-aligned `VStack`; the `HStack` with its
`Spacer()` existed only to push it away from the fountain text. The
`.frame(maxWidth:alignment:)` preserves the corner placement now that the
`Spacer()` is gone.

- [ ] **Step 3: Verify it compiles**

Run: `(cd app && swift build)`
Expected: `Build complete!`, no warnings about unused views.

- [ ] **Step 4: Confirm .fountain input still works**

This is a copy removal only. Verify by reading, not by running: confirm
`ContentView.swift` still contains this line (it should be untouched at `:362`):

```swift
        panel.allowedContentTypes = [.pdf, UTType(filenameExtension: "fountain") ?? .plainText, .plainText]
```

If that line changed, revert your edit and redo it. Drag-and-drop handling is
separate and also untouched.

- [ ] **Step 5: Look at it**

Run: `app/build-app.sh` then open `app/dist/Screepub.app`.

Check the idle title page: no tagline under the SCREEPUB rule, no fountain text
in the bottom-left, device stamps still in the bottom-right corner with their
alternating rotation.

Judgment call: the logotype block just lost about 30pt of height. The three
`Spacer`s in `titlePage` (`minLength: 60`, `30`, `40`) redistribute free space,
so at a comfortable window size this will look fine and **you should change
nothing**. Only if the logotype reads as crowding the drop well at the window's
`minHeight: 560`, change `Spacer(minLength: 30)` to `Spacer(minLength: 52)` and
look again.

- [ ] **Step 6: Commit**

```bash
git add app/Sources/ScreepubApp/ContentView.swift
git commit -m "Title page drops the tagline and the fountain footnote

screenplay · to · kindle stopped being true when Kobo, tolino, reMarkable
and Apple Books shipped, and no replacement phrase earns the space. The
.fountain line advertised something that needs no advertising: the type
stays in the open panel's allowedContentTypes and drag-and-drop is
untouched. The corner now belongs entirely to the device stamps.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 2: `DevicePreset.matching`, test-driven

The Devices tab needs to answer "which preset is my default on?". Presets write
settings and store no identity, so equality against each preset is the only
honest answer. This lives in ScreepubKit so `kit-check` can test it.

**Files:**
- Modify: `app/Sources/ScreepubKit/DevicePreset.swift`
- Test: `app/Sources/KitCheck/main.swift` (the `// — device presets —` section, currently around `:308-313`)

- [ ] **Step 1: Write the failing checks**

In `app/Sources/KitCheck/main.swift`, find this existing block:

```swift
// — device presets —
check(DevicePreset.kindleEink.settings == FormatSettings.defaults, "Kindle e-ink preset equals the baseline defaults")
let phone = DevicePreset.phone.settings
check(phone.dualDialogue == "sequential", "phone preset uses sequential dual dialogue")
check(phone.dialogueSideMarginPct < FormatSettings.defaults.dialogueSideMarginPct, "phone preset widens the dialogue column")
check(DevicePreset.allCases.count == 2, "two device presets ship")
```

Append these three checks directly after `check(DevicePreset.allCases.count == 2, ...)`:

```swift
check(DevicePreset.matching(FormatSettings.defaults) == .kindleEink,
      "baseline defaults are recognised as the Kindle e-ink preset")
check(DevicePreset.matching(DevicePreset.phone.settings) == .phone,
      "phone preset settings are recognised as the phone preset")
var tuned = FormatSettings.defaults
tuned.dialogueSideMarginPct = 7
check(DevicePreset.matching(tuned) == nil,
      "settings tuned away from every preset match none")
```

- [ ] **Step 2: Run to verify it fails**

Run: `(cd app && swift run -c release kit-check)`
Expected: a compile error, not a test failure:
`error: type 'DevicePreset' has no member 'matching'`

That is the correct failure. The check cannot run until the method exists.

- [ ] **Step 3: Write the minimal implementation**

In `app/Sources/ScreepubKit/DevicePreset.swift`, add this method inside the
`DevicePreset` enum, directly after the `settings` computed property's closing
brace:

```swift
    /// The preset whose settings exactly match `settings`, or nil when they
    /// have been tuned away from every preset. Applying a preset overwrites
    /// FormatSettings and stores no identity, so equality is the only honest
    /// answer to "which preset am I on?" — a remembered name would keep
    /// claiming "Kindle e-ink" after the first knob moved.
    public static func matching(_ settings: FormatSettings) -> DevicePreset? {
        allCases.first { $0.settings == settings }
    }
```

- [ ] **Step 4: Run to verify it passes**

Run: `(cd app && swift run -c release kit-check)`
Expected: all three new lines print with an `ok` prefix, and the run exits 0:

```
  ok  baseline defaults are recognised as the Kindle e-ink preset
  ok  phone preset settings are recognised as the phone preset
  ok  settings tuned away from every preset match none
```

- [ ] **Step 5: Commit**

```bash
git add app/Sources/ScreepubKit/DevicePreset.swift app/Sources/KitCheck/main.swift
git commit -m "DevicePreset can name itself from settings alone

Settings carry no preset identity, so the only honest way to report which
preset a default is on is to compare against each preset's settings. A
remembered name would keep claiming Kindle e-ink after the first knob
moved. Returns nil for customised, which the Devices tab renders as such.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 3: Settings becomes General + Devices

**Files:**
- Modify: `app/Sources/ScreepubApp/ScreepubApp.swift` (`SettingsView` at `:110-121`, `GeneralSettings` at `:123-180`, `FormattingSettings` at `:260-379`)

- [ ] **Step 1: Rewrite `SettingsView`**

Replace the whole `SettingsView` struct with:

```swift
struct SettingsView: View {
    var body: some View {
        TabView {
            GeneralSettings()
                .tabItem { Label("General", systemImage: "gearshape") }
            DevicesSettings()
                .tabItem { Label("Devices", systemImage: "externaldrive") }
        }
        .frame(width: 520)
        .padding(.bottom, 8)
    }
}
```

- [ ] **Step 2: Trim `GeneralSettings` down to Library and Updates**

In `GeneralSettings`, delete the `KfxQualitySection()` call and the entire
`Section("Other devices")` block, including the comment above it. The `Form`
body should end after the `Section("Updates")` block, leaving:

```swift
    var body: some View {
        Form {
            Section("Library") {
                LabeledContent("Output folder") {
                    HStack {
                        Text(displayedFolder)
                            .lineLimit(1)
                            .truncationMode(.middle)
                            .foregroundStyle(.secondary)
                        Button("Choose…") { choose() }
                        if !outputFolder.isEmpty {
                            Button("Reset") { outputFolder = "" }
                        }
                    }
                }
                Text("Converted EPUB, MOBI, and Fountain files are saved here.")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
            Section("Updates") {
                Toggle("Check for updates at launch", isOn: $updateOptIn)
                Text("At most one anonymous request a day to GitHub's public API: app name and version, nothing else. Off by default. Screepub → Check for Updates… always works regardless.")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
        }
        .formStyle(.grouped)
    }
```

Leave `displayedFolder` and `choose()` alone.

- [ ] **Step 3: Add `DevicesSettings`**

Insert this new struct immediately after `GeneralSettings`'s closing brace, before
`KfxQualitySection`:

```swift
/// Machine-level concerns: what this Mac talks to, and the coarse formatting
/// default new conversions start from. Per-script tuning lives in the reader
/// window's rail, beside a live render of the actual output.
struct DevicesSettings: View {
    @State private var currentDefault: DevicePreset?

    var body: some View {
        Form {
            Section("Default formatting") {
                LabeledContent("Current default") {
                    Text(currentDefault?.displayName ?? "Customized")
                        .foregroundStyle(.secondary)
                }
                Menu("Load device preset") {
                    ForEach(DevicePreset.allCases) { preset in
                        Button(preset.displayName) {
                            AppSettings.setFormatSettings(preset.settings)
                        }
                    }
                }
                HStack {
                    Spacer()
                    Button("Reset to Defaults") { AppSettings.resetFormatting() }
                }
                Text("The starting point for new conversions. Fine-tune a single script in its preview window, then use Save as app defaults there to promote it here.")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
            KfxQualitySection()
            // The Kindle email address is Amazon's to know, not ours to
            // store — the send block's setup guide points at the page where
            // it lives. The Kobo KEPUB choice lives on the result page's send
            // block, shown only while a Kobo is the chosen destination.
            Section("Other devices") {
                Text("tolino: books are copied into the Books folder. reMarkable: enable Settings → Storage → USB web interface on the tablet, then dock it over USB.")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
        }
        .formStyle(.grouped)
        .onAppear { refreshCurrentDefault() }
        // AppSettings reads UserDefaults directly rather than through
        // @AppStorage, so nothing here republishes on its own. This also
        // catches the reader rail's Save as app defaults landing while this
        // window is open.
        .onReceive(NotificationCenter.default.publisher(for: UserDefaults.didChangeNotification)) { _ in
            refreshCurrentDefault()
        }
    }

    private func refreshCurrentDefault() {
        currentDefault = DevicePreset.matching(AppSettings.formatSettings())
    }
}
```

- [ ] **Step 4: Delete `FormattingSettings` entirely**

Delete the whole `struct FormattingSettings: View { ... }` block, from its
leading comment (`// Initial values come from FormatSettings.defaults …`)
through its closing brace, including the nested `formColumn` property and the
`slider(_:value:range:unit:step:)` helper. That is roughly `:260-379` in the
current file, and it should be the last struct in the file.

- [ ] **Step 5: Verify it compiles and check for orphans**

Run: `(cd app && swift build)`
Expected: `Build complete!`

Then confirm the only remaining reference to `LayoutPreview` is its own
definition:

Run: `grep -rn "LayoutPreview" app/Sources/`
Expected: exactly one hit, `app/Sources/ScreepubApp/LayoutPreview.swift:10`.

If `ScreepubApp.swift` still appears in that output, Step 4 was incomplete.

- [ ] **Step 6: Verify `resetFormatting()` still has a caller**

Run: `grep -rn "resetFormatting" app/Sources/`
Expected: two hits, the definition in `AppSettings.swift:78` and the new button
in `ScreepubApp.swift`. If only the definition appears, the Reset button did not
make it into `DevicesSettings` and you have just orphaned the method.

- [ ] **Step 7: Commit**

```bash
git add app/Sources/ScreepubApp/ScreepubApp.swift
git commit -m "Settings becomes General + Devices; Formatting tab deleted

The Formatting tab was not a duplicate of the reader rail so much as a
better-equipped one with a worse preview: 15 knobs beside a hand-drawn
schematic, against the rail's 11 beside the real engine output. The window
that could show you the change was the one that could not make four of
them. Deleting it fixes the split, and the cramped fixed-width window
resolves by removing what did not fit rather than by fighting the Settings
scene's sizing.

Devices takes the preset menu, the reset button (whose only caller was the
deleted tab), the KFX toolchain rows, and the tolino/reMarkable notes. It
names the current default by equality against each preset, so it reports
Customized the moment a knob moves rather than lying about a remembered
name.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 4: Delete `LayoutPreview.swift`

Its only caller went with `FormattingSettings` in Task 3. A second preview of
lower fidelity than the reader's is worse than one preview.

**Files:**
- Delete: `app/Sources/ScreepubApp/LayoutPreview.swift`

- [ ] **Step 1: Confirm it is unreferenced**

Run: `grep -rn "LayoutPreview" app/Sources/`
Expected: exactly one hit, the definition at `app/Sources/ScreepubApp/LayoutPreview.swift:10`.

Do not proceed if there is a second hit. Go back and finish Task 3 Step 4.

- [ ] **Step 2: Delete the file**

```bash
git rm app/Sources/ScreepubApp/LayoutPreview.swift
```

- [ ] **Step 3: Verify the build still succeeds**

Run: `(cd app && swift build)`
Expected: `Build complete!`

- [ ] **Step 4: Commit**

```bash
git commit -m "Delete LayoutPreview, which lost its only caller

The schematic existed to give the Settings Formatting tab something to
show. The reader window renders the real engine output instead, so keeping
a lower-fidelity second opinion around would only invite the two to
disagree.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 5: Reader rail becomes the one formatting surface

Add the four options the rail never had, and group the resulting 15 so the rail
stays scannable.

**Files:**
- Modify: `app/Sources/ScreepubApp/ReaderRail.swift` (the `Section("This script")` block at `:12-47`, and the frame at `ReaderView.swift:146`)

- [ ] **Step 1: Replace the single "This script" section with five grouped sections**

In `ReaderRail.swift`, replace this entire block:

```swift
            Section("This script") {
                Menu("Load device preset") {
                    ForEach(DevicePreset.allCases) { preset in
                        Button(preset.displayName) {
                            model.settings = preset.settings
                            model.settingsChanged()
                        }
                    }
                }
                Text("Overwrites this script's settings below.")
                    .font(.caption)
                    .foregroundStyle(.secondary)
                slider("Dialogue margins", value: binding(\.dialogueSideMarginPct), range: 0...30)
                Picker("Cues", selection: binding(\.cueAlignment)) {
                    Text("Centered").tag("centered")
                    Text("Indented").tag("indented")
                }
                slider("Cue indent", value: binding(\.cueIndentPct), range: 0...60)
                    .disabled(model.settings.cueAlignment == "centered")
                slider("Paren indent", value: binding(\.parentheticalIndentPct), range: 0...40)
                    .disabled(model.settings.cueAlignment == "centered")
                slider("Spacing (em)", value: binding(\.elementSpacingEm), range: 0.4...1.6, step: 0.1)
                Picker("Typeface", selection: binding(\.fontFamily)) {
                    Text("Courier").tag("courier")
                    Text("Serif").tag("serif")
                    Text("Sans").tag("sans")
                }
                Picker("Dual dialogue", selection: binding(\.dualDialogue)) {
                    Text("Side by side").tag("sideBySide")
                    Text("Sequential").tag("sequential")
                }
                Toggle("Justify body text", isOn: binding(\.justifyText))
                Toggle("Scene page breaks", isOn: binding(\.scenePageBreaks))
                Toggle("Scene numbers", isOn: binding(\.showSceneNumbers))
                Toggle("Page markers", isOn: binding(\.showPageMarkers))
            }
```

with this:

```swift
            Section("This script") {
                Menu("Load device preset") {
                    ForEach(DevicePreset.allCases) { preset in
                        Button(preset.displayName) {
                            model.settings = preset.settings
                            model.settingsChanged()
                        }
                    }
                }
                Text("Overwrites this script's settings below.")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
            Section("Page") {
                slider("Spacing (em)", value: binding(\.elementSpacingEm), range: 0.4...1.6, step: 0.1)
                Toggle("Scene page breaks", isOn: binding(\.scenePageBreaks))
                Toggle("Keep headings with scene", isOn: binding(\.keepSceneHeadingWithScene))
            }
            Section("Dialogue") {
                slider("Dialogue margins", value: binding(\.dialogueSideMarginPct), range: 0...30)
                Picker("Cues", selection: binding(\.cueAlignment)) {
                    Text("Centered").tag("centered")
                    Text("Indented").tag("indented")
                }
                slider("Cue indent", value: binding(\.cueIndentPct), range: 0...60)
                    .disabled(model.settings.cueAlignment == "centered")
                slider("Paren indent", value: binding(\.parentheticalIndentPct), range: 0...40)
                    .disabled(model.settings.cueAlignment == "centered")
                Picker("Dual dialogue", selection: binding(\.dualDialogue)) {
                    Text("Side by side").tag("sideBySide")
                    Text("Sequential").tag("sequential")
                }
            }
            Section("Text") {
                Picker("Typeface", selection: binding(\.fontFamily)) {
                    Text("Courier").tag("courier")
                    Text("Serif").tag("serif")
                    Text("Sans").tag("sans")
                }
                Toggle("Justify body text", isOn: binding(\.justifyText))
            }
            Section("Content") {
                Toggle("Title page", isOn: binding(\.includeTitlePage))
                Toggle("Scene numbers", isOn: binding(\.showSceneNumbers))
                Toggle("Page markers", isOn: binding(\.showPageMarkers))
                Toggle("Rejoin split dialogue", isOn: binding(\.rejoinSplitDialogue))
                Picker("(CONT'D)", selection: binding(\.contdMode)) {
                    Text("Automatic").tag("auto")
                    Text("Remove all").tag("strip")
                    Text("Keep as written").tag("keep")
                }
            }
```

The four newly-added controls are `keepSceneHeadingWithScene`,
`includeTitlePage`, `rejoinSplitDialogue`, and `contdMode`. Every one goes
through `binding(_:)` so it inherits the debounced re-render. Leave the status
section, the `Save as app defaults` / `Show EPUB in Finder` section, and the
`Section("Send")` block below exactly as they are.

- [ ] **Step 2: Widen the rail**

In `app/Sources/ScreepubApp/ReaderView.swift`, find this line inside the
`HSplitView` (currently `:146`):

```swift
                .frame(minWidth: 210, maxWidth: 240)
```

Change it to:

```swift
                .frame(minWidth: 240, maxWidth: 300)
```

The rail is in an `HSplitView`, so the user can still drag it wider.

- [ ] **Step 3: Verify it compiles**

Run: `(cd app && swift build)`
Expected: `Build complete!`

A compile error naming a key path here means the property name is wrong. The
authoritative list of the 15 property names is
`app/Sources/ScreepubKit/FormatSettings.swift:13-27`.

- [ ] **Step 4: Verify every option is now reachable**

Run this to count the key paths wired into the rail:

```bash
grep -cF 'binding(\.' app/Sources/ScreepubApp/ReaderRail.swift
```

Expected: `15`, one per option in `FormatSettings`. Each occurrence sits on its
own line, and `-F` matches the literal string so neither the `private func
binding<T>` definition nor the `Binding(` constructor inside it is counted. The
two `.disabled(model.settings.cueAlignment == "centered")` lines read the model
directly rather than through `binding`, so they correctly do not count.

If the number is lower, list the 15 property names from
`app/Sources/ScreepubKit/FormatSettings.swift:13-27` and find which one has no
control.

- [ ] **Step 5: Exercise it in the real app**

Run: `app/build-app.sh` then open `app/dist/Screepub.app`.

Convert a script from `tests/fixtures/`, open its preview window, then verify:

1. Five sections appear: This script, Page, Dialogue, Text, Content.
2. Toggling **Title page** removes and restores the generated title page in the
   live render.
3. Switching **(CONT'D)** to "Remove all" strips `(CONT'D)` from character cues.
4. Toggling **Keep headings with scene** and **Rejoin split dialogue** each
   trigger a visible re-render (the spinner appears; output may change subtly).
5. The rail scrolls cleanly when the window is dragged down to its
   `minHeight: 500`.

If any control does not trigger a re-render, it is not going through
`binding(_:)`.

- [ ] **Step 6: Commit**

```bash
git add app/Sources/ScreepubApp/ReaderRail.swift app/Sources/ScreepubApp/ReaderView.swift
git commit -m "Reader rail gains the four options it never had

keepSceneHeadingWithScene, includeTitlePage, rejoinSplitDialogue and
contdMode were reachable only from the Settings tab that had no live
preview, so changing them meant leaving the window that could show you the
result. All four already existed in FormatSettings and already flowed
through ScriptSettings to the engine; only the controls were missing.

Grouping the resulting 15 into Page / Dialogue / Text / Content keeps the
rail scannable, and the extra width pays for the longer labels.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 6: Full verification sweep

Nothing here should have moved the engine. This task proves it.

**Files:** none modified.

- [ ] **Step 1: Confirm the engine is untouched**

Run: `git diff main --stat -- src/ tests/ format-defaults.json`
Expected: empty output. Any file listed here means something went wrong; this
plan is view-layer only.

- [ ] **Step 2: Run the engine suite**

Run: `bun test`
Expected: all pass. Integration tests need `fixtures/`; if that directory is
absent those specific tests skip, which is fine.

- [ ] **Step 3: Typecheck the engine**

Run: `bunx tsc --noEmit`
Expected: no output, exit 0.

- [ ] **Step 4: Run the Swift behavior checks**

Run: `(cd app && swift run -c release kit-check)`
Expected: exit 0, every line prefixed `ok`, including the three added in Task 2.

- [ ] **Step 5: Rebuild the shipping bundle**

Run: `app/build-app.sh`
Expected: `app/dist/Screepub.app` produced without error. The bundle embeds the
engine sidecar, so this is required after any app change per CLAUDE.md.

- [ ] **Step 6: Final walkthrough**

Open `app/dist/Screepub.app` and confirm, in one pass:

1. **Title page:** no tagline, no fountain line, device stamps in the corner.
2. **Settings:** two tabs only. Window comfortable at 520pt with no clipping.
3. **Settings → Devices:** "Current default" reads `Kindle e-ink (6")` on a
   fresh profile. Apply the Phone preset; it should read
   `Phone / narrow screen`. Open a script, change one knob in the rail, hit
   **Save as app defaults**, and confirm Devices now reads `Customized`
   **while the Settings window stays open** (this is what the
   `UserDefaults.didChangeNotification` subscription buys). Hit **Reset to
   Defaults**; it should return to `Kindle e-ink (6")`.
4. **Reader:** five sections, all 15 controls, all live.

- [ ] **Step 7: Commit any fixes**

If the walkthrough turned up adjustments, commit them:

```bash
git add -A
git commit -m "Adjustments from the post-restructure walkthrough

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

If nothing needed fixing, skip this step. Do not create an empty commit.

---

## Done when

- `(cd app && swift build)` and `(cd app && swift run -c release kit-check)` both green.
- `bun test` and `bunx tsc --noEmit` both green and demonstrably untouched.
- `git diff main --stat -- src/ tests/ format-defaults.json` is empty.
- `grep -rn "LayoutPreview\|FormattingSettings" app/Sources/` returns nothing.
- The walkthrough in Task 6 Step 6 passes.

## Explicitly out of scope

Page margins, `sceneHeadingSpaceRatio`, and `keepCueWithDialogue`. Deferred
pending the beta tester's Kindle model number; see Appendix A of the spec for the
diagnosis and the Calibre `--margin-*` lead to check first. Do not add options to
`FormatOptions` in this plan.
