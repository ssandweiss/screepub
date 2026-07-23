# Script Preview Reader Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A separate reader window showing the actual converted script (real EPUB markup in a WKWebView) with a live per-script formatting rail.

**Architecture:** The engine grows a single-file preview-HTML output reusing the EPUB builders. The app stores per-script `FormatSettings` sidecars beside the `.fountain`, and a new reader window re-runs the engine from the cached `.fountain` (debounced) on every knob change, reloading the web view. Spec: `docs/superpowers/specs/2026-07-22-script-preview-reader-design.md`.

**Tech Stack:** Bun/TypeScript engine (bun:test), SwiftUI + WebKit app (kit-check), existing sidecar CLI contract.

---

### Task 1: Engine — `tokensToPreviewHtml`

**Files:**
- Modify: `src/epub/html.ts` (add function at end)
- Test: `tests/epub.test.ts` (append)

- [ ] **Step 1: Write the failing test**

Append to `tests/epub.test.ts` (it already imports from `../src/epub/html`; extend that import with `tokensToPreviewHtml`, and import `DEFAULT_FORMAT_OPTIONS` from `../src/options` if not present):

```ts
describe('tokensToPreviewHtml', () => {
  const tokens = new Fountain().parse(
    'INT. KITCHEN - DAY\n\nA kettle screams.\n\nCLEO\nTurn it off.\n',
    true,
  ).tokens;

  test('emits one self-contained document with inline css', () => {
    const html = tokensToPreviewHtml(tokens, { dialogueSideMarginPct: 25 });
    expect(html).toContain('class="dialogue-block"');
    expect(html).toContain('<style>');
    expect(html).toContain('margin-left: 25%');
    expect(html).not.toContain('<link');
  });

  test('defaults options when none given', () => {
    const html = tokensToPreviewHtml(tokens);
    expect(html).toContain('margin-left: 20%');
  });
});
```

(`Fountain` is already imported in that test file via the engine's test helpers — if not, `import { Fountain } from 'fountain-js';`.)

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/epub.test.ts 2>&1 | tail -5`
Expected: FAIL — `tokensToPreviewHtml` is not exported.

- [ ] **Step 3: Implement**

Append to `src/epub/html.ts`:

```ts
/**
 * The whole script as ONE self-contained HTML document — the same section
 * markup as the EPUB body, with the stylesheet inlined instead of linked.
 * This is the app's reader-preview surface: what you proof is what ships.
 */
export function tokensToPreviewHtml(
  tokens: Token[],
  format: Partial<FormatOptions> = {},
): string {
  const resolved: FormatOptions = { ...DEFAULT_FORMAT_OPTIONS, ...format };
  const body = tokensToBody(tokens, {
    maxFileBytes: Number.MAX_SAFE_INTEGER,
    format: resolved,
  });
  const doc = body.files[0]?.xhtml ?? xhtmlDoc('Script', '');
  return doc.replace(
    /<link rel="stylesheet"[^>]*\/>/,
    `<style>\n${screenplayCss(resolved)}</style>`,
  );
}
```

Add `screenplayCss` to the existing import from `./css` at the top of `html.ts` (it currently imports from `../options` and `./css` — extend whichever import lists `SCREENPLAY_CSS`/`FormatOptions`; `DEFAULT_FORMAT_OPTIONS` comes from `../options`).

- [ ] **Step 4: Run tests**

Run: `bun test tests/epub.test.ts 2>&1 | tail -3` then `bunx tsc --noEmit`
Expected: all pass, typecheck clean.

- [ ] **Step 5: Commit**

```bash
git add src/epub/html.ts tests/epub.test.ts
git commit -m "Engine: tokensToPreviewHtml — single-file inline-css preview document"
```

### Task 2: Engine — plumb previewHtml through convert + CLI flag

**Files:**
- Modify: `src/convert.ts` (ConvertResult + the shared build site at ~line 71)
- Modify: `src/cli.ts` (parseArgs options block ~line 60, output writing ~line 125, usage text, cleanup list ~line 177)
- Test: `tests/convert.test.ts` if present, else `tests/epub.test.ts` (append)

- [ ] **Step 1: Write the failing test**

```ts
describe('convertFountain previewHtml', () => {
  test('returns the preview document', async () => {
    const src = 'Title: T\n\nINT. LAB - DAY\n\nBeakers bubble.\n\nELI\nEureka.\n';
    const result = await convertFountain(src, {});
    expect(result.previewHtml).toContain('class="dialogue-block"');
    expect(result.previewHtml).toContain('<style>');
  });
});
```

(Import `convertFountain` from `../src/convert`. Match the file's existing call signature for `convertFountain` — check its `ConvertOptions` second parameter; `{}` uses defaults.)

- [ ] **Step 2: Run to verify failure** — `bun test 2>&1 | tail -4`; expect `previewHtml` undefined/type error.

- [ ] **Step 3: Implement**

In `src/convert.ts`: add `previewHtml: string;` to `ConvertResult` (line ~49, beside `epub`). At the shared build site (~line 71) add:

```ts
  const previewHtml = tokensToPreviewHtml(tokens, format);
```

and include `previewHtml` in the returned object(s) that carry `epub`. Extend the import from `./epub/html` with `tokensToPreviewHtml`. If pdf and fountain paths build separately, add it at both return sites.

In `src/cli.ts`:
- parseArgs options: `'preview-html': { type: 'string' },`
- USAGE text: `  --preview-html <file>  also write the script as one self-contained HTML file`
- after the mobi write block (~line 130):

```ts
  let previewPath: string | undefined;
  if (values['preview-html']) {
    previewPath = values['preview-html'];
    await writeFile(previewPath, result.previewHtml, 'utf8');
  }
```

- add `previewPath` to the `--json` payload (key `previewHtmlPath`) beside `epubPath`, and to the cleanup list at ~line 177.

- [ ] **Step 4: Run** — `bun test 2>&1 | tail -3`, `bunx tsc --noEmit`, and a smoke run:

```bash
bun src/cli.ts "$SCRATCHPAD/dualkeeps.fountain" -o /tmp/x.epub --preview-html /tmp/x.html && grep -c dialogue-block /tmp/x.html
```

Expected: pass, typecheck clean, grep count > 0.

- [ ] **Step 5: Commit**

```bash
git add src/convert.ts src/cli.ts tests/
git commit -m "Engine: --preview-html flag + previewHtml in convert results"
```

### Task 3: Kit — per-script settings sidecar

**Files:**
- Create: `app/Sources/ScreepubKit/ScriptSettings.swift`
- Test: `app/Sources/KitCheck/main.swift` (append before the final summary print)

- [ ] **Step 1: Write the failing checks**

```swift
// — per-script settings sidecar —
let lib = tempDir("library")
let fountain = lib.appendingPathComponent("Test Script.fountain")
try! Data("Title: T".utf8).write(to: fountain)
check(ScriptSettings.sidecarURL(forFountain: fountain).lastPathComponent == "Test Script.screepub.json",
      "sidecar path derives from fountain stem")
var fs = FormatSettings.defaults
fs.dialogueSideMarginPct = 27
try! ScriptSettings.save(fs, forFountain: fountain)
let loaded = ScriptSettings.load(forFountain: fountain, fallback: FormatSettings.defaults)
check(loaded.dialogueSideMarginPct == 27, "sidecar round-trips settings")
let missing = lib.appendingPathComponent("Other.fountain")
check(ScriptSettings.load(forFountain: missing, fallback: FormatSettings.defaults).dialogueSideMarginPct
        == FormatSettings.defaults.dialogueSideMarginPct,
      "absent sidecar falls back to defaults")
```

(If `FormatSettings` properties are `let`, build the modified value via its memberwise initializer instead of `var` mutation — mirror how `AppSettings.formatSettings()` constructs one.)

- [ ] **Step 2: Run to verify failure** — `cd app && swift build`; expect compile error (no `ScriptSettings`).

- [ ] **Step 3: Implement `ScriptSettings.swift`**

```swift
import Foundation

/// Per-script formatting overrides, stored beside the script's .fountain
/// in the library: `<Stem>.screepub.json`. Absent sidecar = global defaults.
public enum ScriptSettings {
    nonisolated public static func sidecarURL(forFountain fountain: URL) -> URL {
        fountain.deletingPathExtension().appendingPathExtension("screepub.json")
    }

    nonisolated public static func load(forFountain fountain: URL, fallback: FormatSettings) -> FormatSettings {
        let url = sidecarURL(forFountain: fountain)
        guard let data = try? Data(contentsOf: url),
              let settings = try? JSONDecoder().decode(FormatSettings.self, from: data) else {
            return fallback
        }
        return settings
    }

    nonisolated public static func save(_ settings: FormatSettings, forFountain fountain: URL) throws {
        try JSONEncoder().encode(settings).write(to: sidecarURL(forFountain: fountain))
    }
}
```

- [ ] **Step 4: Run** — `swift run -c release kit-check 2>&1 | tail -6`; expect the three new checks ok, all passed.

- [ ] **Step 5: Commit**

```bash
git add app/Sources/ScreepubKit/ScriptSettings.swift app/Sources/KitCheck/main.swift
git commit -m "Kit: per-script FormatSettings sidecar (<Stem>.screepub.json)"
```

### Task 4: Kit — Engine.convert render options

**Files:**
- Modify: `app/Sources/ScreepubKit/Engine.swift:51-70`

- [ ] **Step 1: Extend the signature** (default values keep every existing caller compiling):

```swift
    nonisolated public static func convert(
        input: URL,
        force: Bool,
        outputDir: URL,
        format: FormatSettings = .defaults,
        includeMobi: Bool = true,
        previewHtml: URL? = nil
    ) throws -> EngineResult {
```

and replace the fixed args line with:

```swift
        var args = [input.path, "-o", output.path, "--json", "--options", optionsFile.path]
        if includeMobi { args.append("--mobi") }
        if let previewHtml { args.append(contentsOf: ["--preview-html", previewHtml.path]) }
        if force { args.append("--force") }
```

- [ ] **Step 2: Build + existing checks** — `swift build && swift run -c release kit-check 2>&1 | tail -2`; expect all passed.

- [ ] **Step 3: Commit**

```bash
git add app/Sources/ScreepubKit/Engine.swift
git commit -m "Kit: Engine.convert learns includeMobi/previewHtml render options"
```

### Task 5: App — reader window (view, web view, plumbing)

**Files:**
- Create: `app/Sources/ScreepubApp/ReaderView.swift`
- Modify: `app/Sources/ScreepubApp/ScreepubApp.swift` (add WindowGroup)
- Modify: `app/Sources/ScreepubApp/ContentView.swift` (READ SCRIPT button)

- [ ] **Step 1: Create `ReaderView.swift`** — model + web view + shell (rail arrives in Task 6):

```swift
import SwiftUI
import WebKit
import ScreepubKit

/// Identity passed to the reader window.
struct ScriptRef: Codable, Hashable {
    let title: String
    let fountainPath: String
    let epubPath: String
}

/// Drives the reader: owns the per-script settings, re-renders on change.
@MainActor
final class ReaderModel: ObservableObject {
    let ref: ScriptRef
    @Published var settings: FormatSettings
    @Published var html: String = ""
    @Published var errorLine: String?
    @Published var rendering = false
    private var renderTask: Task<Void, Never>?

    var fountainURL: URL { URL(fileURLWithPath: ref.fountainPath) }

    init(ref: ScriptRef) {
        self.ref = ref
        self.settings = ScriptSettings.load(
            forFountain: URL(fileURLWithPath: ref.fountainPath),
            fallback: AppSettings.formatSettings()
        )
    }

    /// Debounced: persist sidecar, re-run engine from the cached .fountain,
    /// refresh the web view. The library EPUB is rewritten too — sends stay
    /// WYSIWYG with the preview.
    func settingsChanged() {
        try? ScriptSettings.save(settings, forFountain: fountainURL)
        renderTask?.cancel()
        renderTask = Task { [settings] in
            try? await Task.sleep(for: .milliseconds(300))
            guard !Task.isCancelled else { return }
            await self.render(with: settings)
        }
    }

    func renderNow() {
        Task { await render(with: settings) }
    }

    private func render(with settings: FormatSettings) async {
        rendering = true
        defer { rendering = false }
        let fountain = fountainURL
        let outputDir = fountain.deletingLastPathComponent()
        let previewFile = FileManager.default.temporaryDirectory
            .appendingPathComponent("screepub-preview-\(UUID().uuidString).html")
        let outcome: Result<String, Error> = await Task.detached {
            Result {
                _ = try Engine.convert(
                    input: fountain, force: false, outputDir: outputDir,
                    format: settings, includeMobi: false, previewHtml: previewFile)
                defer { try? FileManager.default.removeItem(at: previewFile) }
                return try String(contentsOf: previewFile, encoding: .utf8)
            }
        }.value
        switch outcome {
        case .success(let doc): html = doc; errorLine = nil
        case .failure(let error): errorLine = error.localizedDescription
        }
    }
}

/// WKWebView that reloads on html change, preserving scroll position.
struct ScriptWebView: NSViewRepresentable {
    let html: String

    func makeNSView(context: Context) -> WKWebView {
        let view = WKWebView()
        view.setValue(false, forKey: "drawsBackground")
        return view
    }

    func updateNSView(_ view: WKWebView, context: Context) {
        guard html != context.coordinator.lastHtml else { return }
        context.coordinator.lastHtml = html
        view.evaluateJavaScript("window.scrollY") { y, _ in
            let scrollY = (y as? Double) ?? 0
            view.loadHTMLString(
                html + "<script>window.scrollTo(0, \(scrollY));</script>",
                baseURL: nil)
        }
    }

    func makeCoordinator() -> Coordinator { Coordinator() }
    final class Coordinator { var lastHtml = "" }
}

struct ReaderView: View {
    @StateObject private var model: ReaderModel

    init(ref: ScriptRef) {
        _model = StateObject(wrappedValue: ReaderModel(ref: ref))
    }

    var body: some View {
        HSplitView {
            ScriptWebView(html: model.html)
                .frame(minWidth: 380)
                .background(Color.white)
            // Task 6 replaces this placeholder with the formatting rail.
            Text("")
                .frame(width: 0)
        }
        .frame(minWidth: 600, minHeight: 500)
        .navigationTitle(model.ref.title)
        .task { model.renderNow() }
    }
}
```

- [ ] **Step 2: Window plumbing in `ScreepubApp.swift`** — after the main WindowGroup:

```swift
        WindowGroup("Script Preview", for: ScriptRef.self) { $ref in
            if let ref {
                ReaderView(ref: ref)
            }
        }
        .windowResizability(.contentMinSize)
```

- [ ] **Step 3: READ button in `ContentView.swift`** — add `@Environment(\.openWindow) private var openWindow` beside the other environment values; in `transferButtons` (top of the VStack, before the device ForEach):

```swift
            if let fountainPath = result.fountainPath {
                Button("READ SCRIPT") {
                    openWindow(value: ScriptRef(
                        title: result.title ?? "Script",
                        fountainPath: fountainPath,
                        epubPath: epub.path))
                }
                .buttonStyle(BradButtonStyle())
            }
```

- [ ] **Step 4: Build + manual check** — `swift build`, then `./app/build-app.sh`, open the app, convert a script, hit READ SCRIPT: window opens showing the script (no rail yet).

- [ ] **Step 5: Commit**

```bash
git add app/Sources/ScreepubApp/ReaderView.swift app/Sources/ScreepubApp/ScreepubApp.swift app/Sources/ScreepubApp/ContentView.swift
git commit -m "App: reader window renders the real converted script"
```

### Task 6: App — formatting rail + save-as-defaults + footer sends

**Files:**
- Modify: `app/Sources/ScreepubApp/ReaderView.swift`

- [ ] **Step 1: Add the rail.** Replace the placeholder in `ReaderView.body` with:

```swift
            ReaderRail(model: model)
                .frame(minWidth: 210, maxWidth: 240)
```

and append to the file:

```swift
struct ReaderRail: View {
    @ObservedObject var model: ReaderModel

    var body: some View {
        Form {
            Section("This script") {
                slider("Dialogue margins", value: binding(\.dialogueSideMarginPct), range: 0...30)
                Picker("Cues", selection: binding(\.cueAlignment)) {
                    Text("Centered").tag("centered")
                    Text("Indented").tag("indented")
                }
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
                Toggle("Scene page breaks", isOn: binding(\.scenePageBreaks))
                Toggle("Scene numbers", isOn: binding(\.showSceneNumbers))
                Toggle("Page markers", isOn: binding(\.showPageMarkers))
            }
            Section {
                if model.rendering { ProgressView().controlSize(.small) }
                if let err = model.errorLine {
                    Text(err).font(.caption).foregroundStyle(.red)
                }
                Button("Save as app defaults") { saveAsDefaults() }
                Button("Show EPUB in Finder") {
                    NSWorkspace.shared.activateFileViewerSelecting(
                        [URL(fileURLWithPath: model.ref.epubPath)])
                }
            }
            Section("Send") {
                ForEach(DeviceDetect.mounted()) { device in
                    Button("Copy to \(device.name) — USB") { copy(to: device) }
                }
                Button("Email to Kindle") {
                    let address = UserDefaults.standard.string(forKey: "kindleEmail") ?? ""
                    if !address.isEmpty {
                        _ = SendToKindle.email(
                            URL(fileURLWithPath: model.ref.epubPath),
                            to: address, title: model.ref.title)
                    } else {
                        model.errorLine = "set your @kindle.com address in Settings first"
                    }
                }
            }
        }
        .formStyle(.grouped)
    }

    /// USB copy mirroring ContentView's route: AZW3 via Calibre for Kindle
    /// (preview renders skip MOBI, so Calibre-less Kindle sends point at the
    /// main window), plain EPUB elsewhere.
    private func copy(to device: ConnectedDevice) {
        let epub = URL(fileURLWithPath: model.ref.epubPath)
        Task {
            let outcome: Result<Void, Error> = await Task.detached {
                Result {
                    if device.kind == .kindle {
                        guard EbookConvert.isAvailable else {
                            throw EbookConvert.ConvertError.calibreMissing
                        }
                        let azw3 = try EbookConvert.toAzw3(epub)
                        try DeviceTransfer.copy(azw3, to: device)
                    } else {
                        try DeviceTransfer.copy(epub, to: device)
                    }
                }
            }.value
            if case .failure(let error) = outcome {
                model.errorLine = error.localizedDescription
            } else {
                model.errorLine = nil
            }
        }
    }

    /// Binding into the model's FormatSettings that triggers the debounced
    /// re-render on every change.
    private func binding<T>(_ keyPath: WritableKeyPath<FormatSettings, T>) -> Binding<T> {
        Binding(
            get: { model.settings[keyPath: keyPath] },
            set: { model.settings[keyPath: keyPath] = $0; model.settingsChanged() }
        )
    }

    private func slider(_ label: String, value: Binding<Double>, range: ClosedRange<Double>, step: Double = 1) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            HStack {
                Text(label)
                Spacer()
                Text("\(value.wrappedValue, specifier: step < 1 ? "%.1f" : "%.0f")")
                    .foregroundStyle(.secondary).monospacedDigit()
            }
            Slider(value: value, in: range, step: step)
        }
    }

    /// Copy this script's values into the global @AppStorage keys that
    /// Settings → Formatting and future conversions read.
    private func saveAsDefaults() {
        let s = model.settings
        let d = UserDefaults.standard
        d.set(s.scenePageBreaks, forKey: "fmtScenePageBreaks")
        d.set(s.dialogueSideMarginPct, forKey: "fmtDialogueMargin")
        d.set(s.cueIndentPct, forKey: "fmtCueIndent")
        d.set(s.parentheticalIndentPct, forKey: "fmtParenIndent")
        d.set(s.elementSpacingEm, forKey: "fmtSpacing")
        d.set(s.keepSceneHeadingWithScene, forKey: "fmtKeepHeading")
        d.set(s.fontFamily, forKey: "fmtFont")
        d.set(s.rejoinSplitDialogue, forKey: "fmtRejoin")
        d.set(s.contdMode, forKey: "fmtContd")
        d.set(s.cueAlignment, forKey: "fmtCueAlign")
        d.set(s.includeTitlePage, forKey: "fmtTitlePage")
        d.set(s.showSceneNumbers, forKey: "fmtSceneNumbers")
        d.set(s.showPageMarkers, forKey: "fmtPageMarkers")
        d.set(s.dualDialogue, forKey: "fmtDual")
    }
}
```

(If `FormatSettings` fields are `let`, change them to `var` in `FormatSettings.swift` — it is a plain Codable value type, so this is safe.)

- [ ] **Step 2: Build + manual verify** — `swift build`; rebuild bundle, open a script, drag the margin slider: page reflows in ~a second; sidecar JSON appears in the library; "Save as app defaults" then Settings → Formatting shows the new values.

- [ ] **Step 3: Run kit-check + full engine suite** — both green.

- [ ] **Step 4: Commit**

```bash
git add app/Sources/ScreepubApp/ReaderView.swift app/Sources/ScreepubKit/FormatSettings.swift
git commit -m "App: live formatting rail with per-script sidecar + save-as-defaults"
```

### Task 7: Docs, rebuild, ship

**Files:**
- Modify: `docs/formatting-options-log.md` (Mac app notes), `README.md`, `CLAUDE.md` (commands note only if CLI usage line changes)

- [ ] **Step 1: Registry note** — append to "Mac app notes":

```markdown
- **Script preview reader (2026-07-22):** READ SCRIPT opens a window
  rendering the engine's real preview HTML (`--preview-html`; same
  markup as the EPUB, CSS inlined). The rail edits a per-script
  sidecar (`<Stem>.screepub.json`, ScriptSettings.swift) with
  debounced re-render from the cached .fountain; "Save as app
  defaults" promotes sidecar values to the global keys. The library
  EPUB is rewritten on every re-render so sends match the preview.
```

- [ ] **Step 2: README** — add a bullet under the app features: reader window + live per-script formatting.

- [ ] **Step 3: Full verification** — `bun test`, `bunx tsc --noEmit`, `cd app && swift run -c release kit-check`, `./app/build-app.sh`, `epubcheck` one regenerated EPUB.

- [ ] **Step 4: Commit + push**

```bash
git add -A && git commit -m "Script preview reader: docs + bundle rebuild" && git push
```
