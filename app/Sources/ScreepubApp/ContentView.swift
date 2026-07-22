import SwiftUI
import Combine
import UniformTypeIdentifiers
import ScreepubKit

enum AppState {
    case idle
    case converting(String)
    case done(EngineResult)
    case failed(code: String, message: String, input: URL?)
}

struct ContentView: View {
    @State private var state: AppState = .idle
    @State private var dropTargeted = false
    @State private var kindleVolumes: [URL] = KindleDevice.mounted()
    @State private var transferNote: String?
    @AppStorage("kindleEmail") private var kindleEmail = ""
    @Environment(\.openSettings) private var openSettings

    private let volumeEvents = NSWorkspace.shared.notificationCenter
        .publisher(for: NSWorkspace.didMountNotification)
        .merge(with: NSWorkspace.shared.notificationCenter
            .publisher(for: NSWorkspace.didUnmountNotification))

    var body: some View {
        VStack(spacing: 0) {
            switch state {
            case .idle:
                dropZone
            case .converting(let name):
                progressView(name)
            case .done(let result):
                resultView(result)
            case .failed(let code, let message, let input):
                failureView(code: code, message: message, input: input)
            }
        }
        .padding(28)
        .frame(width: 440, height: 520)
        .background(.background)
        .onReceive(volumeEvents) { _ in
            kindleVolumes = KindleDevice.mounted()
        }
    }

    // MARK: - Idle / drop zone

    private var dropZone: some View {
        VStack(spacing: 18) {
            Spacer()
            Image(systemName: "book.pages")
                .font(.system(size: 56, weight: .light))
                .foregroundStyle(dropTargeted ? Color.accentColor : .secondary)
            Text("Drop a screenplay PDF")
                .font(.title2.weight(.medium))
            Text("Converts to a reflowable EPUB that reads properly on Kindle — sluglines, cues, and dialogue intact.")
                .font(.callout)
                .foregroundStyle(.secondary)
                .multilineTextAlignment(.center)
            Button("Choose PDF…") { choose() }
                .keyboardShortcut("o")
            Spacer()
            if let kindle = kindleVolumes.first {
                Label("\(KindleDevice.name(of: kindle)) connected", systemImage: "cable.connector")
                    .font(.caption)
                    .foregroundStyle(.green)
            }
            Text("Also accepts .fountain files")
                .font(.caption)
                .foregroundStyle(.tertiary)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(
            RoundedRectangle(cornerRadius: 16)
                .strokeBorder(
                    dropTargeted ? Color.accentColor : Color.secondary.opacity(0.35),
                    style: StrokeStyle(lineWidth: 2, dash: [8, 6])
                )
        )
        .onDrop(of: [.fileURL], isTargeted: $dropTargeted) { providers in
            guard let provider = providers.first else { return false }
            _ = provider.loadObject(ofClass: URL.self) { url, _ in
                if let url {
                    Task { @MainActor in convert(url, force: false) }
                }
            }
            return true
        }
    }

    private func choose() {
        let panel = NSOpenPanel()
        panel.allowedContentTypes = [.pdf, UTType(filenameExtension: "fountain") ?? .plainText, .plainText]
        panel.allowsMultipleSelection = false
        if panel.runModal() == .OK, let url = panel.url {
            convert(url, force: false)
        }
    }

    // MARK: - Converting

    private func progressView(_ name: String) -> some View {
        VStack(spacing: 16) {
            Spacer()
            ProgressView()
                .controlSize(.large)
            Text("Converting \(name)…")
                .font(.headline)
            Spacer()
        }
    }

    // MARK: - Done

    private func resultView(_ result: EngineResult) -> some View {
        VStack(spacing: 12) {
            Spacer(minLength: 0)
            Image(systemName: "checkmark.circle.fill")
                .font(.system(size: 40))
                .foregroundStyle(.green)
            Text(result.title ?? "Converted")
                .font(.title2.weight(.semibold))
                .multilineTextAlignment(.center)
            if let author = result.author {
                Text("by \(author)")
                    .foregroundStyle(.secondary)
            }
            if let pages = result.pages, let scenes = result.scenes, let chars = result.characters {
                Text("\(pages) pages · \(scenes) scenes · \(chars) speaking characters")
                    .font(.callout)
                    .foregroundStyle(.secondary)
            }
            if let warnings = result.warnings, !warnings.isEmpty {
                ForEach(warnings, id: \.self) { w in
                    Label(w, systemImage: "exclamationmark.triangle")
                        .font(.caption)
                        .foregroundStyle(.orange)
                }
            }
            Spacer(minLength: 6)
            if let path = result.epubPath {
                transferButtons(result: result, epub: URL(fileURLWithPath: path), title: result.title)
            }
            if let note = transferNote {
                Text(note)
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .multilineTextAlignment(.center)
            }
        }
    }

    @ViewBuilder
    private func transferButtons(result: EngineResult, epub: URL, title: String?) -> some View {
        VStack(spacing: 10) {
            if let kindle = kindleVolumes.first {
                Button {
                    copyToDevice(result: result, epub: epub, volume: kindle)
                } label: {
                    Label("Copy to \(KindleDevice.name(of: kindle)) (USB)", systemImage: "cable.connector")
                        .frame(maxWidth: .infinity)
                }
                .controlSize(.large)
                .buttonStyle(.borderedProminent)
            }

            let emailButton = Button {
                emailToKindle(epub, title: title)
            } label: {
                Label("Email to Kindle…", systemImage: "envelope")
                    .frame(maxWidth: .infinity)
            }
            .controlSize(.large)
            if kindleVolumes.isEmpty {
                emailButton.buttonStyle(.borderedProminent)
            } else {
                emailButton.buttonStyle(.bordered)
            }

            HStack {
                Button(SendToKindle.appIsInstalled ? "Send to Kindle app" : "Send to Kindle (web)") {
                    SendToKindle.sendViaAmazon(epub)
                }
                Button("Show in Finder") {
                    NSWorkspace.shared.activateFileViewerSelecting([epub])
                }
                Button("Convert Another") {
                    transferNote = nil
                    state = .idle
                }
            }
            .controlSize(.small)
        }
    }

    // MARK: - Failed

    private func failureView(code: String, message: String, input: URL?) -> some View {
        VStack(spacing: 14) {
            Spacer()
            Image(systemName: "xmark.octagon.fill")
                .font(.system(size: 44))
                .foregroundStyle(.red)
            Text(friendlyTitle(for: code))
                .font(.title3.weight(.semibold))
            Text(message)
                .font(.callout)
                .foregroundStyle(.secondary)
                .multilineTextAlignment(.center)
            Spacer()
            HStack {
                if code == "not-screenplay", let input {
                    Button("Convert Anyway") { convert(input, force: true) }
                }
                Button("Back") { state = .idle }
                    .keyboardShortcut(.cancelAction)
            }
        }
    }

    private func friendlyTitle(for code: String) -> String {
        switch code {
        case "scanned": return "This PDF has no text layer"
        case "not-screenplay": return "This doesn't look like a screenplay"
        case "password": return "Password-protected PDF"
        case "engine-missing": return "Converter engine not found"
        default: return "Conversion failed"
        }
    }

    // MARK: - Actions

    private func convert(_ url: URL, force: Bool) {
        transferNote = nil
        state = .converting(url.lastPathComponent)
        Task {
            let outputDir = AppSettings.outputFolder
            let format = AppSettings.formatSettings()
            let outcome: Result<EngineResult, Error> = await Task.detached {
                Result { try Engine.convert(input: url, force: force, outputDir: outputDir, format: format) }
            }.value

            switch outcome {
            case .success(let result) where result.ok:
                state = .done(result)
            case .success(let result):
                state = .failed(
                    code: result.error?.code ?? "internal",
                    message: result.error?.message ?? "Unknown engine error.",
                    input: url
                )
            case .failure(EngineFailure.notFound):
                state = .failed(
                    code: "engine-missing",
                    message: "screepub-engine is missing from the app bundle. Rebuild with app/build-app.sh.",
                    input: nil
                )
            case .failure(let error):
                state = .failed(code: "internal", message: String(describing: error), input: url)
            }
        }
    }

    private func copyToDevice(result: EngineResult, epub: URL, volume: URL) {
        // Kindles never index sideloaded EPUBs, so USB copies a native
        // format: Calibre's AZW3 when available (keeps the full EPUB
        // styling), else the engine's own MOBI (dependency-free).
        let deviceName = KindleDevice.name(of: volume)
        let mobiPath = result.mobiPath

        if EbookConvert.isAvailable {
            transferNote = "Converting to AZW3 for Kindle…"
        } else if mobiPath == nil {
            transferNote = "No Kindle-native file available — use Email to Kindle instead."
            return
        } else {
            transferNote = "Copying MOBI to \(deviceName)…"
        }

        Task {
            let outcome: Result<String, Error> = await Task.detached {
                Result {
                    if EbookConvert.isAvailable {
                        let azw3 = try EbookConvert.toAzw3(epub)
                        try KindleDevice.copy(azw3, to: volume)
                        return "AZW3"
                    }
                    try KindleDevice.copy(URL(fileURLWithPath: mobiPath!), to: volume)
                    return "MOBI"
                }
            }.value
            switch outcome {
            case .success(let format):
                transferNote = "Copied to \(deviceName) as \(format) — eject before unplugging."
            case .failure(let error):
                transferNote = "Transfer failed: \(error.localizedDescription)"
            }
        }
    }

    private func emailToKindle(_ epub: URL, title: String?) {
        let address = kindleEmail.trimmingCharacters(in: .whitespaces)
        guard !address.isEmpty else {
            transferNote = "Set your @kindle.com address first (Screepub → Settings…)."
            openSettings()
            return
        }
        if SendToKindle.email(epub, to: address, title: title) {
            transferNote = "Mail compose opened — hit Send and it lands on every Kindle on your account."
        } else {
            transferNote = "No mail account available — configure Mail.app, or use the web uploader below."
        }
    }
}
