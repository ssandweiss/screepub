import SwiftUI
import ScreepubKit
import KFXKit

/// The reader's side rail: this script's formatting knobs (persisted to its
/// sidecar, re-rendered live), promotion to app defaults, and send actions.
struct ReaderRail: View {
    @ObservedObject var model: ReaderModel

    var body: some View {
        Form {
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
            Section {
                if model.rendering { ProgressView().controlSize(.small) }
                if let err = model.errorLine {
                    Text(err).font(.caption).foregroundStyle(.red)
                }
                if let status = model.statusLine {
                    Text(status).font(.caption).foregroundStyle(.secondary)
                }
                Button("Save as app defaults") { AppSettings.setFormatSettings(model.settings) }
                Button("Show EPUB in Finder") {
                    NSWorkspace.shared.activateFileViewerSelecting(
                        [URL(fileURLWithPath: model.ref.epubPath)])
                }
            }
            Section("Send") {
                ForEach(model.devices) { device in
                    Button("Copy to \(device.name) — USB") { copy(to: device) }
                }
                Button("Save") { saveACopy() }
                if AppleBooks.isAvailable {
                    Button("Open in Apple Books") {
                        if AppleBooks.send(URL(fileURLWithPath: model.ref.epubPath)) {
                            model.errorLine = nil
                            model.statusLine = "added to Apple Books — syncs to iPhone and iPad via iCloud"
                        } else {
                            model.statusLine = nil
                            model.errorLine = "Apple Books isn't available on this Mac"
                        }
                    }
                }
                // Only Apple Mail actually attaches the file: with a
                // third-party default client macOS degrades the compose to a
                // mailto: URL, which carries no attachment (RFC 6068) and
                // still reports success. Offer the route only where it works.
                if SendToKindle.defaultMailClientIsAppleMail {
                    Button("Send to Kindle email…") { composeInAppleMail() }
                }
            }
            .disabled(model.rendering)
        }
        .formStyle(.grouped)
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

    /// Save this script somewhere of the user's choosing, in the format they
    /// pick — the route that works regardless of mail client or device.
    private func saveACopy() {
        let epub = URL(fileURLWithPath: model.ref.epubPath)
        // The reader's PER-SCRIPT sidecar settings, not AppSettings' globals.
        // This rail is where the user tunes THIS script, so a global here
        // would silently export formatting they never chose.
        SaveFlow.present(
            epub: epub,
            fountainPath: model.ref.fountainPath,
            settings: model.settings,
            status: { model.errorLine = nil; model.statusLine = $0 },
            failure: {
                // Drop "saving…" — the rail renders statusLine and errorLine
                // together, so leaving it would show the save as still in
                // progress AND failed.
                model.statusLine = nil
                model.errorLine = $0
            })
    }

    private func composeInAppleMail() {
        if SendToKindle.email(URL(fileURLWithPath: model.ref.epubPath),
                              title: model.ref.title) {
            model.errorLine = nil
            model.statusLine = SendToKindle.legacyStoredAddress.map {
                "compose opened, addressed to \($0)"
            } ?? "compose opened. Address it to your @kindle.com address"
        } else {
            model.statusLine = nil
            model.errorLine = "Mail couldn't open a compose window"
        }
    }

    /// USB copy: AZW3 via Calibre for Kindle, else a MOBI that
    /// `freshKindleArtifact` rebuilds from this script's own settings when the
    /// one on disk is stale or absent, plain EPUB for everything else.
    /// A physical Kindle is the one place a stale book is hardest to notice,
    /// so the freshness check is not optional here.
    private func copy(to device: ConnectedDevice) {
        let epub = URL(fileURLWithPath: model.ref.epubPath)
        // Read off the main actor's state before detaching, exactly as
        // saveACopy does: `model.settings` is this script's sidecar tuning,
        // and passing globals instead would rebuild the MOBI (and rewrite the
        // library EPUB with it) in formatting the user never chose.
        let fountainPath = model.ref.fountainPath
        let settings = model.settings
        let calibre = EbookConvert.isAvailable
        Task {
            let outcome: Result<Void, Error> = await Task.detached {
                Result {
                    if device.kind == .kindle {
                        // The ONE Kindle ladder — Export owns KFX → AZW3 →
                        // MOBI, staleness reuse, and stage narration.
                        // Throws rather than copying anything when no
                        // Kindle file can be produced.
                        let artifact = try Export.freshKindleArtifact(
                            for: epub,
                            fountainPath: fountainPath,
                            format: settings,
                            calibreAvailable: calibre,
                            kfxReady: KFXToolchain.status().ready,
                            onStage: { stage in
                                Task { @MainActor in model.statusLine = "Kindle: \(stage)" }
                            })
                        try DeviceTransfer.copy(artifact, to: device)
                    } else {
                        try DeviceTransfer.copy(epub, to: device)
                    }
                }
            }.value
            switch outcome {
            case .success:
                model.errorLine = nil
                model.statusLine = "copied to \(device.name) — eject before unplugging"
            case .failure(let error):
                // Drop the stage narration too — the rail renders statusLine
                // and errorLine together, so leaving it would show the copy
                // as still in progress AND failed.
                model.statusLine = nil
                model.errorLine = error.localizedDescription
            }
        }
    }
}
