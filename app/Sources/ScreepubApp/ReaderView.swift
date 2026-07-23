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
    private var generation = 0

    var fountainURL: URL { URL(fileURLWithPath: ref.fountainPath) }

    init(ref: ScriptRef) {
        self.ref = ref
        self.settings = ScriptSettings.load(
            forFountain: URL(fileURLWithPath: ref.fountainPath),
            fallback: AppSettings.formatSettings()
        )
    }

    /// Debounced: persist sidecar, re-run engine from the cached .fountain,
    /// refresh the web view. The library EPUB and MOBI are rewritten too —
    /// sends stay WYSIWYG with the preview.
    func settingsChanged() {
        renderTask?.cancel()
        renderTask = Task { [settings] in
            try? await Task.sleep(for: .milliseconds(300))
            guard !Task.isCancelled else { return }
            do {
                try ScriptSettings.save(settings, forFountain: self.fountainURL)
            } catch {
                self.errorLine = error.localizedDescription
                return
            }
            await self.render(with: settings)
        }
    }

    func renderNow() {
        renderTask?.cancel()
        renderTask = Task { await render(with: settings) }
    }

    private func render(with settings: FormatSettings) async {
        generation += 1
        let mine = generation
        rendering = true
        defer { rendering = false }
        let fountain = fountainURL
        let outputDir = fountain.deletingLastPathComponent()
        let previewFile = FileManager.default.temporaryDirectory
            .appendingPathComponent("screepub-preview-\(UUID().uuidString).html")
        let outcome: Result<String, Error> = await Task.detached {
            Result {
                let result = try Engine.convert(
                    input: fountain, force: false, outputDir: outputDir,
                    format: settings, includeMobi: true, previewHtml: previewFile)
                guard result.ok else {
                    throw EngineFailure.badOutput(result.error?.message ?? "engine error")
                }
                defer { try? FileManager.default.removeItem(at: previewFile) }
                return try String(contentsOf: previewFile, encoding: .utf8)
            }
        }.value
        guard mine == generation else { return }
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
            let script = "<script>window.scrollTo(0, \(scrollY)); addEventListener('load', () => requestAnimationFrame(() => window.scrollTo(0, \(scrollY))));</script>"
            view.loadHTMLString(
                html.replacingOccurrences(of: "</body>", with: script + "</body>"),
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
