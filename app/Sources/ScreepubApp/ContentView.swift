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
    @State private var devices: [ConnectedDevice] = DeviceDetect.mounted()
    @State private var remarkableUp = false
    @State private var lastInput: URL?
    @State private var transferNote: String?
    @AppStorage("kindleEmail") private var kindleEmail = ""
    @AppStorage("koboKepub") private var koboKepub = false
    @Environment(\.openSettings) private var openSettings
    @Environment(\.openWindow) private var openWindow

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
            devices = DeviceDetect.mounted()
        }
        .task {
            // reMarkable never mounts — poll its USB web interface instead.
            while !Task.isCancelled {
                remarkableUp = await RemarkableDevice.probe()
                try? await Task.sleep(for: .seconds(6))
            }
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

            Spacer(minLength: 30)

            // The drop well — an unmistakable target on the page.
            VStack(spacing: 9) {
                Image(systemName: "arrow.down.doc")
                    .font(.system(size: 26, weight: .light))
                    .foregroundStyle(dropTargeted ? Theme.brass : Theme.inkFaint)
                Text("DROP A SCREENPLAY PDF")
                    .font(Theme.courier(13, .bold))
                    .kerning(1.2)
                    .foregroundStyle(Theme.ink)
                Text("or")
                    .font(Theme.courier(10))
                    .foregroundStyle(Theme.inkFaint)
                Button("CHOOSE PDF…  ⌘O") { choose() }
                    .buttonStyle(OutlineButtonStyle())
                    .keyboardShortcut("o")
                    .frame(width: 190)
            }
            .padding(.vertical, 24)
            .frame(maxWidth: .infinity)
            .background(
                RoundedRectangle(cornerRadius: 5)
                    .strokeBorder(
                        dropTargeted ? Theme.brass : Theme.inkFaint,
                        style: StrokeStyle(lineWidth: 1.5, dash: [7, 5])
                    )
            )

            Spacer(minLength: 40)

            HStack(alignment: .bottom) {
                Text("also accepts\n.fountain files")
                    .font(Theme.courier(10))
                    .foregroundStyle(Theme.inkFaint)
                    .lineSpacing(2)
                Spacer()
                deviceStamps
            }
        }
    }

    /// One rubber-stamp badge per connected device, stacked like a
    /// producer's approval stamps in the page corner.
    private var deviceStamps: some View {
        VStack(alignment: .trailing, spacing: 7) {
            ForEach(Array(stampLabels.enumerated()), id: \.element) { i, label in
                Text(label)
                    .font(Theme.courier(10, .bold))
                    .kerning(1)
                    .foregroundStyle(Theme.brass)
                    .padding(.vertical, 5)
                    .padding(.horizontal, 8)
                    .overlay(Rectangle().stroke(Theme.brass, lineWidth: 1.2))
                    .rotationEffect(.degrees(i.isMultiple(of: 2) ? -3 : 2))
                    .transition(.opacity.combined(with: .scale(scale: 1.4)))
            }
        }
        .animation(.spring(duration: 0.35), value: stampLabels)
    }

    private var stampLabels: [String] {
        var labels = devices.map { "\($0.name.uppercased()) CONNECTED" }
        if remarkableUp { labels.append("REMARKABLE DOCKED") }
        return labels
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

    private var anyDeviceReachable: Bool { !devices.isEmpty || remarkableUp }

    @ViewBuilder
    private func transferButtons(result: EngineResult, epub: URL, title: String?) -> some View {
        VStack(spacing: 9) {
            // result.fountainPath (--json's fountainPath) is only set for PDF
            // input — the engine doesn't re-emit a .fountain for .fountain
            // input, so fall back to the input file itself in that case.
            if let fountainPath = result.fountainPath
                ?? (lastInput?.pathExtension.lowercased() == "fountain" ? lastInput?.path : nil) {
                Button("READ SCRIPT") {
                    openWindow(value: ScriptRef(
                        title: result.title ?? "Script",
                        fountainPath: fountainPath,
                        epubPath: epub.path))
                }
                .buttonStyle(BradButtonStyle())
            }
            ForEach(devices) { device in
                Button("COPY TO \(device.name.uppercased()) — USB") {
                    copyToDevice(result: result, epub: epub, device: device)
                }
                .buttonStyle(BradButtonStyle())
            }
            if remarkableUp {
                Button("SEND TO REMARKABLE — USB") {
                    sendToRemarkable(epub: epub)
                }
                .buttonStyle(BradButtonStyle())
            }

            Button("EMAIL TO KINDLE…") {
                emailToKindle(epub, title: title)
            }
            .buttonStyle(anyDeviceReachable ? AnyButtonStyle(OutlineButtonStyle()) : AnyButtonStyle(BradButtonStyle()))

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
                Button("REPORT A BUG") {
                    openFeedback(context: "\(code): \(message)")
                }
                .buttonStyle(MarginButtonStyle())
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
        lastInput = url
        state = .converting(url.lastPathComponent)
        Task {
            let outputDir = AppSettings.outputFolder
            let stem = url.deletingPathExtension().lastPathComponent
            // For .fountain input the engine reads/re-caches the input itself
            // (no separate .fountain is emitted into outputDir), so the
            // sidecar lives beside the input, not beside a prospective copy.
            let prospectiveFountain = url.pathExtension.lowercased() == "fountain"
                ? url
                : outputDir.appendingPathComponent(stem).appendingPathExtension("fountain")
            let format = ScriptSettings.load(forFountain: prospectiveFountain, fallback: AppSettings.formatSettings())
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

    private func copyToDevice(result: EngineResult, epub: URL, device: ConnectedDevice) {
        let mobiPath = result.mobiPath
        let wantKepub = koboKepub

        switch device.kind {
        case .kindle where EbookConvert.isAvailable:
            transferNote = "converting to AZW3 for Kindle…"
        case .kindle where mobiPath == nil:
            transferNote = "no Kindle-native file available — use Email to Kindle instead"
            return
        case .kindle:
            transferNote = "copying MOBI to \(device.name)…"
        case .kobo where wantKepub && EbookConvert.isAvailable:
            transferNote = "converting to KEPUB for Kobo…"
        default:
            transferNote = "copying EPUB to \(device.name)…"
        }

        Task {
            let outcome: Result<String, Error> = await Task.detached {
                Result {
                    switch device.kind {
                    case .kindle:
                        if EbookConvert.isAvailable {
                            let azw3 = try EbookConvert.toAzw3(epub)
                            try DeviceTransfer.copy(azw3, to: device)
                            return "AZW3"
                        }
                        try DeviceTransfer.copy(URL(fileURLWithPath: mobiPath!), to: device)
                        return "MOBI"
                    case .kobo where wantKepub && EbookConvert.isAvailable:
                        let kepub = try EbookConvert.toKepub(epub)
                        try DeviceTransfer.copy(kepub, to: device)
                        return "KEPUB"
                    default:
                        try DeviceTransfer.copy(epub, to: device)
                        return "EPUB"
                    }
                }
            }.value
            switch outcome {
            case .success(let format):
                transferNote = "copied to \(device.name) as \(format) — eject before unplugging"
            case .failure(let error):
                transferNote = "transfer failed: \(error.localizedDescription)"
            }
        }
    }

    /// reMarkable is a big-screen PDF annotation device — send the original
    /// screenplay PDF when we have one (native pagination + pen notes);
    /// fall back to the EPUB for Fountain input.
    private func sendToRemarkable(epub: URL) {
        let file = lastInput?.pathExtension.lowercased() == "pdf" ? lastInput! : epub
        transferNote = "sending \(file.lastPathComponent) to reMarkable…"
        Task {
            do {
                try await RemarkableDevice.upload(file)
                transferNote = "sent to reMarkable — it appears in My files"
            } catch {
                transferNote = "reMarkable upload failed: \(error.localizedDescription)"
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
