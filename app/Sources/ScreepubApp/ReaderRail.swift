import SwiftUI
import ScreepubKit

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
                Button("Save a copy…") { saveACopy() }
                // Only Apple Mail actually attaches the file: with a
                // third-party default client macOS degrades the compose to a
                // mailto: URL, which carries no attachment (RFC 6068) and
                // still reports success. Offer the route only where it works.
                if SendToKindle.defaultMailClientIsAppleMail {
                    Button("Email to Kindle…") { composeInAppleMail() }
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
        let stem = epub.deletingPathExtension().lastPathComponent
        let fountainPath = model.ref.fountainPath
        // The reader's PER-SCRIPT sidecar settings, not AppSettings' globals.
        // This rail is where the user tunes THIS script, so a global here
        // would silently export formatting they never chose.
        let settings = model.settings
        let calibre = EbookConvert.isAvailable
        ExportPanel.present(epub: epub, stem: stem) { destination, format in
            model.errorLine = nil
            model.statusLine = "saving…"
            // freshKindleArtifact spawns Calibre or the engine — keep it off
            // the main actor or the whole UI stalls behind it.
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
                            calibreAvailable: calibre)
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

    /// USB copy mirroring ContentView's route: AZW3 via Calibre for Kindle,
    /// fresh MOBI fallback without it, plain EPUB elsewhere.
    private func copy(to device: ConnectedDevice) {
        let epub = URL(fileURLWithPath: model.ref.epubPath)
        let mobi = Export.mobiSibling(for: epub)
        Task {
            let outcome: Result<Void, Error> = await Task.detached {
                Result {
                    if device.kind == .kindle {
                        if EbookConvert.isAvailable {
                            let azw3 = try EbookConvert.toAzw3(epub)
                            try DeviceTransfer.copy(azw3, to: device)
                        } else if FileManager.default.fileExists(atPath: mobi.path) {
                            try DeviceTransfer.copy(mobi, to: device)
                        } else {
                            throw EbookConvert.ConvertError.calibreMissing
                        }
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
                model.errorLine = error.localizedDescription
            }
        }
    }
}
