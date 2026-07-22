import SwiftUI
import UniformTypeIdentifiers

enum AppState {
    case idle
    case converting(String)
    case done(EngineResult)
    case failed(code: String, message: String, input: URL?)
}

struct ContentView: View {
    @State private var state: AppState = .idle
    @State private var dropTargeted = false

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
        .frame(width: 440, height: 480)
        .background(.background)
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
        VStack(spacing: 14) {
            Spacer(minLength: 0)
            Image(systemName: "checkmark.circle.fill")
                .font(.system(size: 44))
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
            Spacer(minLength: 8)
            if let path = result.epubPath {
                VStack(spacing: 10) {
                    Button {
                        sendToKindle(URL(fileURLWithPath: path))
                    } label: {
                        Label(SendToKindle.appIsInstalled ? "Send to Kindle" : "Send to Kindle (web)…",
                              systemImage: "paperplane.fill")
                            .frame(maxWidth: .infinity)
                    }
                    .controlSize(.large)
                    .buttonStyle(.borderedProminent)

                    HStack {
                        Button("Show in Finder") {
                            NSWorkspace.shared.activateFileViewerSelecting([URL(fileURLWithPath: path)])
                        }
                        Button("Convert Another") { state = .idle }
                    }
                }
            }
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
        state = .converting(url.lastPathComponent)
        Task {
            let outcome: Result<EngineResult, Error> = await Task.detached {
                Result { try Engine.convert(input: url, force: force) }
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

    private func sendToKindle(_ epub: URL) {
        SendToKindle.send(epub)
    }
}
