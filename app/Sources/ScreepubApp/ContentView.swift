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
        ZStack {
            Theme.paper.ignoresSafeArea()
            punchHoles
            pageFurniture

            Group {
                switch state {
                case .idle:
                    titlePage
                case .converting(let name):
                    convertingPage(name)
                case .done(let result):
                    resultPage(result)
                case .failed(let code, let message, let input):
                    failurePage(code: code, message: message, input: input)
                }
            }
            .padding(.horizontal, 52)
            .padding(.top, 44)
            .padding(.bottom, 24)
        }
        .frame(width: 460, height: 560)
        .onReceive(volumeEvents) { _ in
            kindleVolumes = KindleDevice.mounted()
        }
        .onDrop(of: [.fileURL], isTargeted: $dropTargeted) { providers in
            guard let provider = providers.first else { return false }
            _ = provider.loadObject(ofClass: URL.self) { url, _ in
                if let url {
                    Task { @MainActor in convert(url, force: false) }
                }
            }
            return true
        }
        .overlay(
            Rectangle()
                .strokeBorder(Theme.brass, style: StrokeStyle(lineWidth: 3, dash: [10, 7]))
                .padding(6)
                .opacity(dropTargeted ? 1 : 0)
                .animation(.easeOut(duration: 0.15), value: dropTargeted)
                .allowsHitTesting(false)
        )
    }

    // MARK: - Page furniture

    private var punchHoles: some View {
        VStack {
            ForEach(0..<3, id: \.self) { _ in
                Circle()
                    .fill(Theme.hole)
                    .frame(width: 13, height: 13)
                Spacer()
            }
        }
        .padding(.vertical, 64)
        .padding(.leading, 18)
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private var pageFurniture: some View {
        VStack {
            HStack(alignment: .firstTextBaseline, spacing: 14) {
                Spacer()
                Text(pageNumber)
                    .font(Theme.courier(12))
                    .foregroundStyle(Theme.inkFaint)
                SettingsLink {
                    Image(systemName: "gearshape.fill")
                        .font(.system(size: 13))
                        .foregroundStyle(Theme.inkFaint)
                }
                .buttonStyle(.plain)
                .help("Settings (⌘,)")
            }
            .padding(.horizontal, 22)
            .padding(.top, 26)
            Spacer()
        }
    }

    private var pageNumber: String {
        switch state {
        case .idle: return ""
        case .converting: return "…"
        case .done(let r): return r.pages.map { "\($0)." } ?? "1."
        case .failed: return "1."
        }
    }

    // MARK: - Idle: the title page

    private var titlePage: some View {
        VStack(spacing: 0) {
            Spacer(minLength: 60)
            Text("SCREEPUB")
                .font(Theme.courier(26, .bold))
                .kerning(4)
                .foregroundStyle(Theme.ink)
                .overlay(
                    Rectangle().fill(Theme.ink).frame(height: 1.4).offset(y: 4),
                    alignment: .bottom
                )
            Text("screenplay · to · kindle")
                .font(Theme.courier(12))
                .foregroundStyle(Theme.inkFaint)
                .padding(.top, 14)

            Spacer(minLength: 36)

            VStack(spacing: 10) {
                Text("written by")
                    .font(Theme.courier(12))
                    .foregroundStyle(Theme.inkFaint)
                Text("dropping a screenplay PDF here")
                    .font(Theme.courier(14))
                    .foregroundStyle(Theme.ink)
                Button("CHOOSE PDF…") { choose() }
                    .buttonStyle(MarginButtonStyle())
                    .keyboardShortcut("o")
                    .padding(.top, 6)
            }

            Spacer(minLength: 60)

            HStack(alignment: .bottom) {
                Text("also accepts\n.fountain files")
                    .font(Theme.courier(10))
                    .foregroundStyle(Theme.inkFaint)
                    .lineSpacing(2)
                Spacer()
                if let kindle = kindleVolumes.first {
                    Text("\(KindleDevice.name(of: kindle).uppercased()) CONNECTED")
                        .font(Theme.courier(10, .bold))
                        .kerning(1)
                        .foregroundStyle(Theme.brass)
                        .padding(.vertical, 5)
                        .padding(.horizontal, 8)
                        .overlay(Rectangle().stroke(Theme.brass, lineWidth: 1.2))
                        .rotationEffect(.degrees(-3))
                }
            }
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

    private func convertingPage(_ name: String) -> some View {
        VStack(alignment: .leading, spacing: 22) {
            Slugline(text: "INT. CONVERSION BAY - CONTINUOUS")
            Text("The pages of \(name) reflow themselves, one scene at a time.")
                .font(Theme.courier(13))
                .foregroundStyle(Theme.ink)
                .lineSpacing(4)
            ProgressView()
                .controlSize(.small)
                .tint(Theme.brass)
                .frame(maxWidth: .infinity, alignment: .center)
                .padding(.top, 12)
            Spacer()
            Transition(text: "PLEASE STAND BY:")
        }
    }

    // MARK: - Done: the script announces itself

    private func resultPage(_ result: EngineResult) -> some View {
        VStack(spacing: 0) {
            Slugline(text: "INT. YOUR LIBRARY - NIGHT")
                .padding(.bottom, 18)

            // The converted script gets a speech: cue, parenthetical, dialogue.
            VStack(spacing: 5) {
                Text((result.title ?? "Untitled").uppercased())
                    .font(Theme.courier(15, .bold))
                    .kerning(1)
                    .foregroundStyle(Theme.ink)
                    .multilineTextAlignment(.center)
                if let author = result.author {
                    Text("(by \(author))")
                        .font(Theme.courier(12))
                        .foregroundStyle(Theme.inkFaint)
                }
                if let pages = result.pages, let scenes = result.scenes, let chars = result.characters {
                    Text("\(pages) pages. \(scenes) scenes.\n\(chars) speaking characters.")
                        .font(Theme.courier(13))
                        .foregroundStyle(Theme.ink)
                        .multilineTextAlignment(.center)
                        .lineSpacing(3)
                        .padding(.top, 3)
                }
                ForEach(result.warnings ?? [], id: \.self) { w in
                    Text("(\(w))")
                        .font(Theme.courier(11))
                        .foregroundStyle(Theme.brass)
                        .multilineTextAlignment(.center)
                }
            }
            .padding(.horizontal, 24)

            Spacer(minLength: 16)

            if let path = result.epubPath {
                transferButtons(result: result, epub: URL(fileURLWithPath: path), title: result.title)
            }

            if let note = transferNote {
                Text("(\(note))")
                    .font(Theme.courier(11))
                    .foregroundStyle(Theme.inkFaint)
                    .multilineTextAlignment(.center)
                    .lineSpacing(2)
                    .padding(.top, 10)
            }
        }
    }

    @ViewBuilder
    private func transferButtons(result: EngineResult, epub: URL, title: String?) -> some View {
        VStack(spacing: 9) {
            if let kindle = kindleVolumes.first {
                Button("COPY TO \(KindleDevice.name(of: kindle).uppercased()) — USB") {
                    copyToDevice(result: result, epub: epub, volume: kindle)
                }
                .buttonStyle(BradButtonStyle())
            }

            Button("EMAIL TO KINDLE…") {
                emailToKindle(epub, title: title)
            }
            .buttonStyle(kindleVolumes.isEmpty ? AnyButtonStyle(BradButtonStyle()) : AnyButtonStyle(OutlineButtonStyle()))

            Button(SendToKindle.appIsInstalled ? "SEND TO KINDLE APP" : "SEND TO KINDLE — WEB") {
                SendToKindle.sendViaAmazon(epub)
            }
            .buttonStyle(OutlineButtonStyle())

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
        }
    }

    // MARK: - Failure

    private func failurePage(code: String, message: String, input: URL?) -> some View {
        VStack(alignment: .leading, spacing: 20) {
            Transition(text: "SMASH CUT TO:")
            Slugline(text: "INT. \(friendlyTitle(for: code)) - DAY")
                .foregroundStyle(Theme.alarm)
            Text(message)
                .font(Theme.courier(13))
                .foregroundStyle(Theme.ink)
                .lineSpacing(4)
            Spacer()
            VStack(spacing: 9) {
                if code == "not-screenplay", let input {
                    Button("CONVERT ANYWAY") { convert(input, force: true) }
                        .buttonStyle(BradButtonStyle())
                }
                Button("BACK TO ONE") { state = .idle }
                    .buttonStyle(OutlineButtonStyle())
                    .keyboardShortcut(.cancelAction)
            }
        }
    }

    private func friendlyTitle(for code: String) -> String {
        switch code {
        case "scanned": return "SCANNED PDF, NO TEXT"
        case "not-screenplay": return "NOT A SCREENPLAY"
        case "password": return "LOCKED PDF"
        case "engine-missing": return "MISSING ENGINE"
        default: return "CONVERSION TROUBLE"
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
        let deviceName = KindleDevice.name(of: volume)
        let mobiPath = result.mobiPath

        if EbookConvert.isAvailable {
            transferNote = "converting to AZW3 for Kindle…"
        } else if mobiPath == nil {
            transferNote = "no Kindle-native file available — use Email to Kindle instead"
            return
        } else {
            transferNote = "copying MOBI to \(deviceName)…"
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
                transferNote = "copied to \(deviceName) as \(format) — eject before unplugging"
            case .failure(let error):
                transferNote = "transfer failed: \(error.localizedDescription)"
            }
        }
    }

    private func emailToKindle(_ epub: URL, title: String?) {
        let address = kindleEmail.trimmingCharacters(in: .whitespaces)
        guard !address.isEmpty else {
            transferNote = "set your @kindle.com address first — Screepub → Settings"
            openSettings()
            return
        }
        if SendToKindle.email(epub, to: address, title: title) {
            transferNote = "Mail compose opened — hit Send and it lands on every Kindle on your account"
        } else {
            transferNote = "no mail account available — configure Mail.app, or use the web uploader"
        }
    }
}

/// Type-erased ButtonStyle so the email button can flip between primary
/// and secondary depending on whether USB is available.
struct AnyButtonStyle: ButtonStyle {
    private let make: (Configuration) -> AnyView
    init<S: ButtonStyle>(_ style: S) {
        make = { AnyView(style.makeBody(configuration: $0)) }
    }
    func makeBody(configuration: Configuration) -> some View {
        make(configuration)
    }
}
