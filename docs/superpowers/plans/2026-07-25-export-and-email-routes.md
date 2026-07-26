# Export & Email Routes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the silently-failing "EMAIL TO KINDLE…" compose handoff with export affordances — a purpose-labeled Save a Copy panel, drag-out, and a contextual three-button result view — so users on any mail client can get the file and send it themselves.

**Architecture:** Two new pure-logic types in ScreepubKit (`Export` for formats/freshness, `ResultActions` for which button is primary) are kit-checked; a new `ExportPanel.swift` in ScreepubApp owns the AppKit save panel so `ContentView` doesn't grow; both windows then rewire to the same shared decisions.

**Tech Stack:** Swift 6 / SwiftUI / AppKit (`NSSavePanel`, `NSPopUpButton`, `NSPasteboard`, `NSItemProvider`), SwiftPM, `kit-check` executable (CommandLineTools ships no XCTest).

**Spec:** `docs/superpowers/specs/2026-07-25-export-and-email-routes-design.md`

**Testing reality:** ScreepubKit logic is TDD'd through `kit-check`. SwiftUI views are **not** unit-testable in this project — for UI tasks the verification step is a real build plus a stated manual check. That is a limitation to state honestly, not to paper over with a fake assertion.

---

## File Structure

- **Create** `app/Sources/ScreepubKit/Export.swift` — what a converted script can be exported as, whether a Kindle artifact is stale, and producing a fresh one. Pure logic + two thin side-effecting calls.
- **Create** `app/Sources/ScreepubKit/ResultActions.swift` — resolves which action owns the single brass/primary slot. Tiny and separate so both windows and the test share one answer.
- **Create** `app/Sources/ScreepubApp/ExportPanel.swift` — `NSSavePanel` presentation with the format accessory view. Kept out of `ContentView.swift` (already ~520 lines).
- **Modify** `app/Sources/ScreepubKit/SendToKindle.swift` — add `defaultMailClientIsAppleMail`.
- **Modify** `app/Sources/ScreepubApp/ContentView.swift:300-345` — contextual hierarchy, drag-out, guidance line, `MORE WAYS…` menu.
- **Modify** `app/Sources/ScreepubApp/ReaderRail.swift:93-106` — same treatment.
- **Modify** `app/Sources/KitCheck/main.swift` — append checks (idiom: `check(condition, label)`, `tempDir(name)`).

---

## Task 1: `ExportFormat` and availability

**Files:**
- Create: `app/Sources/ScreepubKit/Export.swift`
- Test: `app/Sources/KitCheck/main.swift` (append)

- [ ] **Step 1: Write the failing checks**

Append to `app/Sources/KitCheck/main.swift`:

```swift
// — export formats —
let exDir = tempDir("export")
let exEpub = exDir.appendingPathComponent("Script.epub")
try! Data("epub".utf8).write(to: exEpub)

check(ExportFormat.epub.fileExtension(calibreAvailable: false) == "epub",
      "epub format uses .epub")
check(ExportFormat.kindle.fileExtension(calibreAvailable: true) == "azw3",
      "kindle format is azw3 when Calibre is available")
check(ExportFormat.kindle.fileExtension(calibreAvailable: false) == "mobi",
      "kindle format falls back to mobi without Calibre")
check(ExportFormat.epub.label(calibreAvailable: false).contains("email"),
      "epub label states its purpose")
check(ExportFormat.kindle.label(calibreAvailable: true).contains("sideload"),
      "kindle label states its purpose")

check(Export.available(for: exEpub, calibreAvailable: true) == [.epub, .kindle],
      "with Calibre both formats offered")
check(Export.available(for: exEpub, calibreAvailable: false) == [.epub],
      "without Calibre and without a .mobi, only epub offered")
let exMobi = exDir.appendingPathComponent("Script.mobi")
try! Data("mobi".utf8).write(to: exMobi)
check(Export.available(for: exEpub, calibreAvailable: false) == [.epub, .kindle],
      "an existing .mobi makes the kindle format available")
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd app && swift run -c release kit-check`
Expected: compile error — `cannot find 'ExportFormat' in scope`.

- [ ] **Step 3: Write the implementation**

Create `app/Sources/ScreepubKit/Export.swift`:

```swift
import Foundation

/// What a converted script can be saved as. Labeled by *purpose*, because
/// the file you email is not the file you sideload: Amazon stopped
/// accepting MOBI for Send to Kindle in 2022, while Kindles never index a
/// sideloaded EPUB.
public enum ExportFormat: String, CaseIterable, Sendable {
    case epub
    case kindle

    /// Kindle resolves the same way the USB route does — AZW3 via Calibre
    /// when installed, else the engine's own MOBI.
    public func fileExtension(calibreAvailable: Bool) -> String {
        switch self {
        case .epub:   return "epub"
        case .kindle: return calibreAvailable ? "azw3" : "mobi"
        }
    }

    public func label(calibreAvailable: Bool) -> String {
        switch self {
        case .epub:
            return "EPUB — for emailing to Kindle, and most e-readers"
        case .kindle:
            return "\(fileExtension(calibreAvailable: calibreAvailable).uppercased()) — for USB sideload to Kindle"
        }
    }
}

public enum Export {
    /// EPUB is always available (it is the conversion's primary output).
    /// The Kindle format needs either Calibre (converts from the current
    /// EPUB) or an already-built .mobi to refresh.
    nonisolated public static func available(for epub: URL,
                                             calibreAvailable: Bool) -> [ExportFormat] {
        var formats: [ExportFormat] = [.epub]
        let mobi = epub.deletingPathExtension().appendingPathExtension("mobi")
        if calibreAvailable || FileManager.default.fileExists(atPath: mobi.path) {
            formats.append(.kindle)
        }
        return formats
    }
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd app && swift run -c release kit-check`
Expected: eight new `ok` lines, exit 0.

- [ ] **Step 5: Commit**

```bash
git add app/Sources/ScreepubKit/Export.swift app/Sources/KitCheck/main.swift
git commit -m "kit: ExportFormat + availability, labeled by purpose"
```

---

## Task 2: Staleness rule

The reader window re-renders write only the EPUB (`includeMobi: false`), so a `.mobi` in the library can be **older than the current EPUB**. Exporting it unchecked hands the user a stale book — the exact silent wrongness this feature exists to remove.

**Files:**
- Modify: `app/Sources/ScreepubKit/Export.swift`
- Test: `app/Sources/KitCheck/main.swift` (append)

- [ ] **Step 1: Write the failing checks**

```swift
// — kindle artifact staleness —
let stDir = tempDir("stale")
let stEpub = stDir.appendingPathComponent("S.epub")
let stMobi = stDir.appendingPathComponent("S.mobi")
try! Data("e".utf8).write(to: stEpub)
check(Export.needsRegeneration(stMobi, freshRelativeTo: stEpub),
      "missing kindle artifact needs regeneration")

try! Data("m".utf8).write(to: stMobi)
try! FileManager.default.setAttributes(
    [.modificationDate: Date(timeIntervalSinceNow: -600)], ofItemAtPath: stMobi.path)
check(Export.needsRegeneration(stMobi, freshRelativeTo: stEpub),
      "kindle artifact older than the epub is stale")

try! FileManager.default.setAttributes(
    [.modificationDate: Date(timeIntervalSinceNow: 600)], ofItemAtPath: stMobi.path)
check(!Export.needsRegeneration(stMobi, freshRelativeTo: stEpub),
      "kindle artifact newer than the epub is fresh")
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd app && swift run -c release kit-check`
Expected: compile error — `type 'Export' has no member 'needsRegeneration'`.

- [ ] **Step 3: Write the implementation**

Add inside `public enum Export` in `app/Sources/ScreepubKit/Export.swift`:

```swift
    /// True when `artifact` is missing or older than the EPUB it derives
    /// from. Reader re-renders rewrite only the EPUB, so a previously
    /// built .mobi silently goes out of date.
    nonisolated public static func needsRegeneration(_ artifact: URL,
                                                     freshRelativeTo epub: URL) -> Bool {
        let fm = FileManager.default
        guard fm.fileExists(atPath: artifact.path) else { return true }
        let mtime: (URL) -> Date = { url in
            (try? fm.attributesOfItem(atPath: url.path)[.modificationDate] as? Date) ?? .distantPast
        }
        return mtime(artifact) < mtime(epub)
    }
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd app && swift run -c release kit-check`
Expected: three new `ok` lines, exit 0.

- [ ] **Step 5: Commit**

```bash
git add app/Sources/ScreepubKit/Export.swift app/Sources/KitCheck/main.swift
git commit -m "kit: staleness rule so exports never ship an out-of-date book"
```

---

## Task 3: Produce a fresh Kindle artifact

**Files:**
- Modify: `app/Sources/ScreepubKit/Export.swift`

No kit-check here: both branches shell out (Calibre / the engine), so this is an integration path verified manually in Task 8. The *decision* it rests on is already tested in Task 2.

- [ ] **Step 1: Add the error type and producer**

Add to `app/Sources/ScreepubKit/Export.swift`, inside `public enum Export`:

```swift
    public enum ExportError: Error, LocalizedError {
        case cannotRegenerate
        public var errorDescription: String? {
            "Can't rebuild the Kindle file — the script's .fountain is missing."
        }
    }

    /// A Kindle-format file guaranteed current with `epub`.
    /// Calibre converts straight from the present EPUB, so that branch is
    /// fresh by construction; the MOBI branch re-runs the engine only when
    /// Task 2's rule says the file is stale.
    ///
    /// Blocking (spawns Calibre or the engine) — call off the main thread.
    /// `format` must be the script's real settings, not `.defaults`, or the
    /// export silently loses the user's tuned formatting.
    nonisolated public static func freshKindleArtifact(
        for epub: URL,
        fountainPath: String?,
        format: FormatSettings,
        calibreAvailable: Bool
    ) throws -> URL {
        if calibreAvailable {
            return try EbookConvert.toAzw3(epub)
        }
        let mobi = epub.deletingPathExtension().appendingPathExtension("mobi")
        guard needsRegeneration(mobi, freshRelativeTo: epub) else { return mobi }
        guard let fountainPath else { throw ExportError.cannotRegenerate }
        _ = try Engine.convert(
            input: URL(fileURLWithPath: fountainPath),
            force: false,
            outputDir: epub.deletingLastPathComponent(),
            format: format,
            includeMobi: true
        )
        return mobi
    }

    /// Copy a produced artifact to the user's chosen destination,
    /// replacing whatever is there.
    nonisolated public static func copy(_ source: URL, to destination: URL) throws {
        let fm = FileManager.default
        if fm.fileExists(atPath: destination.path) {
            try fm.removeItem(at: destination)
        }
        try fm.copyItem(at: source, to: destination)
    }
```

- [ ] **Step 2: Verify it compiles**

Run: `cd app && swift build -c release`
Expected: `Build complete!` with no errors.

- [ ] **Step 3: Commit**

```bash
git add app/Sources/ScreepubKit/Export.swift
git commit -m "kit: produce a Kindle artifact that is current with the EPUB"
```

---

## Task 4: Primary-slot resolution

**Files:**
- Create: `app/Sources/ScreepubKit/ResultActions.swift`
- Test: `app/Sources/KitCheck/main.swift` (append)

- [ ] **Step 1: Write the failing checks**

```swift
// — which action owns the primary slot —
let kindleDev = ConnectedDevice(kind: .kindle, name: "Kindle", volume: URL(fileURLWithPath: "/Volumes/Kindle"))
let rmDev = ConnectedDevice(kind: .remarkable, name: "reMarkable", volume: nil)
check(ResultActions.primary(devices: []) == .saveCopy,
      "no devices -> Save a Copy is promoted to primary")
check(ResultActions.primary(devices: [kindleDev]) == .transfer(kindleDev),
      "a mounted Kindle takes the primary slot")
check(ResultActions.primary(devices: [rmDev]) == .saveCopy,
      "reMarkable alone does not take primary (it lives under More ways)")
check(ResultActions.primary(devices: [rmDev, kindleDev]) == .transfer(kindleDev),
      "a volume device wins over a docked reMarkable")
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd app && swift run -c release kit-check`
Expected: compile error — `cannot find 'ResultActions' in scope`.

- [ ] **Step 3: Write the implementation**

Create `app/Sources/ScreepubKit/ResultActions.swift`:

```swift
import Foundation

/// The action occupying the result view's single brass/primary slot.
public enum ResultAction: Equatable, Sendable {
    case transfer(ConnectedDevice)
    case saveCopy
}

/// Which action to emphasize after a conversion. Lives here rather than in
/// the views so the main window, the reader rail, and kit-check all share
/// one answer instead of separately re-deriving it.
public enum ResultActions {
    /// A mounted volume device is the best route when one is present.
    /// reMarkable is excluded: it uploads over its USB web interface rather
    /// than being copied to, and lives under "More ways…".
    nonisolated public static func primary(devices: [ConnectedDevice]) -> ResultAction {
        if let device = devices.first(where: { $0.kind != .remarkable }) {
            return .transfer(device)
        }
        return .saveCopy
    }
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd app && swift run -c release kit-check`
Expected: four new `ok` lines, exit 0.

- [ ] **Step 5: Commit**

```bash
git add app/Sources/ScreepubKit/ResultActions.swift app/Sources/KitCheck/main.swift
git commit -m "kit: contextual primary-action resolution shared by both windows"
```

---

## Task 5: Detect Apple Mail as the default client

**Files:**
- Modify: `app/Sources/ScreepubKit/SendToKindle.swift`
- Test: `app/Sources/KitCheck/main.swift` (append)

The *value* depends on the machine running the check, so asserting it would make the suite machine-dependent. Assert only that it resolves without crashing, and that both possible values are booleans — a smoke check, deliberately.

- [ ] **Step 1: Write the failing check**

```swift
// — default mail client detection (value is machine-dependent) —
let isAppleMail = SendToKindle.defaultMailClientIsAppleMail
check(isAppleMail == true || isAppleMail == false,
      "default-mail-client detection resolves without crashing")
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd app && swift run -c release kit-check`
Expected: compile error — `type 'SendToKindle' has no member 'defaultMailClientIsAppleMail'`.

- [ ] **Step 3: Write the implementation**

Add inside `public enum SendToKindle` in `app/Sources/ScreepubKit/SendToKindle.swift`:

```swift
    /// True when Apple Mail handles `mailto:`. The compose handoff attaches
    /// the file correctly there; with a third-party default client macOS
    /// degrades the request to a `mailto:` URL, which by RFC 6068 carries no
    /// attachment at all — recipient and subject survive, the file vanishes,
    /// and `canPerform` still reports true. So the compose route is offered
    /// only when this is true.
    @MainActor
    public static var defaultMailClientIsAppleMail: Bool {
        guard let mailto = URL(string: "mailto:test@example.com"),
              let app = NSWorkspace.shared.urlForApplication(toOpen: mailto),
              let bundle = Bundle(url: app) else { return false }
        return bundle.bundleIdentifier == "com.apple.mail"
    }
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd app && swift run -c release kit-check`
Expected: one new `ok` line, exit 0.

- [ ] **Step 5: Commit**

```bash
git add app/Sources/ScreepubKit/SendToKindle.swift app/Sources/KitCheck/main.swift
git commit -m "kit: detect Apple Mail as the mailto: handler"
```

---

## Task 6: The save panel

**Files:**
- Create: `app/Sources/ScreepubApp/ExportPanel.swift`

- [ ] **Step 1: Write the panel**

Create `app/Sources/ScreepubApp/ExportPanel.swift`:

```swift
import AppKit
import ScreepubKit

/// Owns the format pop-up in the save panel's accessory view and keeps the
/// panel's filename extension in step with the selection.
@MainActor
final class ExportAccessory: NSObject {
    private let panel: NSSavePanel
    private let stem: String
    private let calibre: Bool
    let formats: [ExportFormat]
    let view = NSView(frame: NSRect(x: 0, y: 0, width: 460, height: 52))
    private let popup = NSPopUpButton(frame: NSRect(x: 76, y: 12, width: 372, height: 25))

    init(panel: NSSavePanel, stem: String, formats: [ExportFormat], calibre: Bool) {
        self.panel = panel
        self.stem = stem
        self.formats = formats
        self.calibre = calibre
        super.init()

        let label = NSTextField(labelWithString: "Format:")
        label.frame = NSRect(x: 8, y: 16, width: 62, height: 18)
        label.alignment = .right
        view.addSubview(label)

        for format in formats {
            popup.addItem(withTitle: format.label(calibreAvailable: calibre))
        }
        popup.target = self
        popup.action = #selector(formatChanged)
        view.addSubview(popup)
        applyExtension()
    }

    var selected: ExportFormat { formats[max(0, popup.indexOfSelectedItem)] }

    @objc private func formatChanged() { applyExtension() }

    private func applyExtension() {
        panel.nameFieldStringValue =
            stem + "." + selected.fileExtension(calibreAvailable: calibre)
    }
}

enum ExportPanel {
    /// Save panel defaulting to the Desktop, with the purpose-labeled format
    /// selector. `completion` runs only when the user confirms.
    @MainActor
    static func present(epub: URL,
                        stem: String,
                        completion: @escaping (URL, ExportFormat) -> Void) {
        let calibre = EbookConvert.isAvailable
        let formats = Export.available(for: epub, calibreAvailable: calibre)
        let panel = NSSavePanel()
        panel.directoryURL = FileManager.default
            .urls(for: .desktopDirectory, in: .userDomainMask).first
        panel.canCreateDirectories = true
        panel.title = "Save a Copy"

        let accessory = ExportAccessory(panel: panel, stem: stem,
                                        formats: formats, calibre: calibre)
        panel.accessoryView = accessory.view

        panel.begin { response in
            guard response == .OK, let url = panel.url else { return }
            completion(url, accessory.selected)
        }
    }
}
```

- [ ] **Step 2: Verify it compiles**

Run: `cd app && swift build -c release`
Expected: `Build complete!` with no errors.

- [ ] **Step 3: Commit**

```bash
git add app/Sources/ScreepubApp/ExportPanel.swift
git commit -m "app: save panel with purpose-labeled format selector"
```

---

## Task 7: Rewire the main result view

**Files:**
- Modify: `app/Sources/ScreepubApp/ContentView.swift:300-345` (the button stack) and its `emailToKindle` helper at `:493`

- [ ] **Step 1: Replace the button stack**

In `app/Sources/ScreepubApp/ContentView.swift`, replace the block that currently runs from `Button("EMAIL TO KINDLE…")` through the `HStack` holding `SHOW IN FINDER` / `CONVERT ANOTHER` with:

```swift
            // Exactly one brass primary, resolved from context in
            // ScreepubKit so this view and the reader rail agree.
            let primary = ResultActions.primary(devices: devices)

            if case .saveCopy = primary {
                Button("SAVE A COPY…") { saveACopy(result: result, epub: epub) }
                    .buttonStyle(BradButtonStyle())
            } else {
                Button("SAVE A COPY…") { saveACopy(result: result, epub: epub) }
                    .buttonStyle(OutlineButtonStyle())
            }

            Menu("MORE WAYS…") {
                Button(SendToKindle.appIsInstalled ? "Send to Kindle app" : "Send to Kindle — web") {
                    SendToKindle.sendViaAmazon(epub)
                }
                if SendToKindle.defaultMailClientIsAppleMail {
                    Button("Email to Kindle…") { emailToKindle(epub, title: title) }
                }
                if remarkableUp {
                    Button("Send to reMarkable — USB") { sendToRemarkable(epub: epub) }
                }
            }
            .menuStyle(.borderlessButton)
            .font(Theme.courier(11))
            .foregroundStyle(Theme.inkFaint)
            .frame(maxWidth: 160)

            if !kindleEmail.trimmingCharacters(in: .whitespaces).isEmpty {
                Button {
                    let address = kindleEmail.trimmingCharacters(in: .whitespaces)
                    NSPasteboard.general.clearContents()
                    NSPasteboard.general.setString(address, forType: .string)
                    transferNote = "copied \(address) — attach the saved EPUB in any mail app"
                } label: {
                    Text("Or email it to \(kindleEmail.trimmingCharacters(in: .whitespaces))")
                        .font(Theme.courier(10))
                        .foregroundStyle(Theme.inkFaint)
                        .underline()
                }
                .buttonStyle(.plain)
                .help("Copy your Kindle address. The address you send FROM must be on Amazon's Approved Personal Document E-mail List, or the message is discarded.")
            }

            HStack(spacing: 22) {
                Button("SHOW IN FINDER") {
                    NSWorkspace.shared.activateFileViewerSelecting([epub])
                }
                Button("CONVERT ANOTHER") {
                    transferNote = nil
                    state = .idle
                }
            }
            .buttonStyle(MarginButtonStyle())
            .padding(.top, 6)
```

Leave `READ SCRIPT` and the `ForEach(devices)` USB buttons above exactly as they are — the device transfer already renders with `BradButtonStyle()`, which is the primary treatment when a device is mounted.

- [ ] **Step 2: Add the export handler**

Add alongside `emailToKindle` (near `ContentView.swift:493`):

```swift
    private func saveACopy(result: EngineResult, epub: URL) {
        let stem = epub.deletingPathExtension().lastPathComponent
        ExportPanel.present(epub: epub, stem: stem) { destination, format in
            transferNote = "saving…"
            let fountainPath = result.fountainPath
                ?? (lastInput?.pathExtension.lowercased() == "fountain" ? lastInput?.path : nil)
            let settings = AppSettings.formatSettings()
            Task.detached {
                do {
                    let source: URL
                    switch format {
                    case .epub:
                        source = epub
                    case .kindle:
                        source = try Export.freshKindleArtifact(
                            for: epub,
                            fountainPath: fountainPath,
                            format: settings,
                            calibreAvailable: EbookConvert.isAvailable)
                    }
                    try Export.copy(source, to: destination)
                    await MainActor.run {
                        transferNote = "saved to \(destination.deletingLastPathComponent().lastPathComponent)"
                    }
                } catch {
                    await MainActor.run {
                        transferNote = "save failed: \(error.localizedDescription)"
                    }
                }
            }
        }
    }
```

- [ ] **Step 3: Make the result card draggable**

Find the view showing the converted file's name in the result state and attach:

```swift
            .onDrag { NSItemProvider(contentsOf: epub) ?? NSItemProvider() }
```

- [ ] **Step 4: Verify it builds**

Run: `cd app && swift build -c release`
Expected: `Build complete!` with no errors.

- [ ] **Step 5: Manual check**

Run: `app/build-app.sh && open app/dist/Screepub.app`
Convert a PDF from `~/Downloads`, then confirm: with no device attached `SAVE A COPY…` renders brass; the panel opens on the Desktop with the format pop-up; saving writes a real file; the address line copies; `MORE WAYS…` lists Send to Kindle and (only on an Apple-Mail Mac) Email to Kindle.

- [ ] **Step 6: Commit**

```bash
git add app/Sources/ScreepubApp/ContentView.swift
git commit -m "app: contextual result view — save a copy, drag-out, inline address"
```

---

## Task 8: Rewire the reader rail

**Files:**
- Modify: `app/Sources/ScreepubApp/ReaderRail.swift:93-106`

- [ ] **Step 1: Replace `emailToKindle()`**

Replace the whole `emailToKindle()` function in `app/Sources/ScreepubApp/ReaderRail.swift` with:

```swift
    private func saveACopy() {
        let epub = URL(fileURLWithPath: model.ref.epubPath)
        let stem = epub.deletingPathExtension().lastPathComponent
        let fountainPath = model.ref.fountainPath
        // The reader's PER-SCRIPT sidecar settings, not AppSettings'
        // globals — the rail is where the user tunes this script, so a
        // global here would silently export the wrong formatting.
        let settings = model.settings
        ExportPanel.present(epub: epub, stem: stem) { destination, format in
            model.errorLine = nil
            model.statusLine = "saving…"
            Task.detached {
                do {
                    let source: URL
                    switch format {
                    case .epub:
                        source = epub
                    case .kindle:
                        source = try Export.freshKindleArtifact(
                            for: epub,
                            fountainPath: fountainPath,
                            format: settings,
                            calibreAvailable: EbookConvert.isAvailable)
                    }
                    try Export.copy(source, to: destination)
                    await MainActor.run {
                        model.statusLine = "saved to \(destination.deletingLastPathComponent().lastPathComponent)"
                    }
                } catch {
                    await MainActor.run {
                        model.errorLine = "save failed: \(error.localizedDescription)"
                    }
                }
            }
        }
    }

    private func composeInAppleMail() {
        let address = (UserDefaults.standard.string(forKey: "kindleEmail") ?? "")
            .trimmingCharacters(in: .whitespaces)
        guard !address.isEmpty else {
            model.statusLine = "set your @kindle.com address in Settings first"
            return
        }
        if SendToKindle.email(URL(fileURLWithPath: model.ref.epubPath),
                              to: address, title: model.ref.title) {
            model.errorLine = nil
            model.statusLine = "Mail compose opened"
        } else {
            model.errorLine = "Mail couldn't open a compose window"
        }
    }
```

- [ ] **Step 2: Update the rail's buttons**

Wherever the rail currently calls `emailToKindle()`, replace that button with:

```swift
                Button("SAVE A COPY…") { saveACopy() }
                if SendToKindle.defaultMailClientIsAppleMail {
                    Button("EMAIL TO KINDLE…") { composeInAppleMail() }
                }
```

- [ ] **Step 3: Verify it builds**

Run: `cd app && swift build -c release`
Expected: `Build complete!` with no errors.

- [ ] **Step 4: Manual check**

Run: `app/build-app.sh && open app/dist/Screepub.app`, convert a script, click `READ SCRIPT`, and confirm the rail's `SAVE A COPY…` opens the same panel and writes a file.

- [ ] **Step 5: Commit**

```bash
git add app/Sources/ScreepubApp/ReaderRail.swift
git commit -m "app: reader rail gets the same export treatment"
```

---

## Task 9: Full verification

**Files:** none

- [ ] **Step 1: Whole suite**

```bash
cd app && swift build -c release && swift run -c release kit-check
```
Expected: `Build complete!`, every check `ok`, exit 0.

- [ ] **Step 2: Engine regression net**

```bash
bun test && bunx tsc --noEmit
```
Expected: 216 pass / 0 fail, `tsc` silent. (No `src/` changes — a failure here means something unrelated broke.)

- [ ] **Step 3: The stale-MOBI check that motivated Task 2**

With Calibre *not* on PATH: convert a script, open `READ SCRIPT`, change a formatting knob (which rewrites only the EPUB), close the reader, then `SAVE A COPY…` → Kindle format. Confirm the saved `.mobi` reflects the change rather than the pre-edit render.

- [ ] **Step 4: Rebuild the app bundle**

```bash
app/build-app.sh
```
Expected: `built: …/app/dist/Screepub.app` — the bundle embeds the sidecar, so it must be rebuilt after any change.

- [ ] **Step 5: Commit any fixes**

```bash
git add -A && git commit -m "fix: issues found in full verification"
```

---

## Self-Review

- **Spec coverage:** §1 `ExportFormat` → T1; staleness → T2; fresh artifact + copy → T3; §2 export panel → T6; §3 drag-out → T7 step 3; §4 hierarchy/primary slot → T4 + T7; §5 guidance line with inline copyable address → T7; §6 conditional compose → T5 + T7 + T8; call sites → T7 (ContentView) + T8 (ReaderRail); testing → T1/T2/T4/T5 kit-checks + T9. All covered.
- **Placeholders:** none — every code step carries complete code; the two untestable-by-unit paths (T3, T6) say so and name the manual check that covers them.
- **Type consistency:** `ExportFormat.epub` / `.kindle` and `fileExtension(calibreAvailable:)` / `label(calibreAvailable:)` are used identically in T1, T6, T7, T8. `Export.available(for:calibreAvailable:)`, `Export.needsRegeneration(_:freshRelativeTo:)`, `Export.freshKindleArtifact(for:fountainPath:format:calibreAvailable:)`, and `Export.copy(_:to:)` match between T1–T3 and their callers in T7/T8. `ResultAction.transfer(_:)` / `.saveCopy` and `ResultActions.primary(devices:)` match between T4 and T7. `SendToKindle.defaultMailClientIsAppleMail` matches between T5, T7, T8.
- **Known integration risk:** `ExportPanel.present` uses `panel.begin`, so the accessory object must stay alive until the completion handler runs — it does, because the handler captures `accessory`. If a future edit stops capturing it, the format selection will read as `nil` and crash on `formats[...]`; the manual check in T7 step 5 is what catches that.
- **API verification (done against the tree, not assumed):** `AppSettings.formatSettings()` (AppSettings.swift:22), `ScriptRef.{title,fountainPath,epubPath}` (ReaderView.swift:8-12, `fountainPath` non-optional), `EngineResult.fountainPath: String?` (Engine.swift:20), `ContentView.lastInput` (:18), and `ReaderModel.settings: FormatSettings` (ReaderView.swift:18) all exist as used. The settings distinction matters: **ContentView uses `AppSettings.formatSettings()` (global), the rail uses `model.settings` (per-script sidecar)** — swapping them exports a book with the wrong formatting and nothing would fail loudly.
