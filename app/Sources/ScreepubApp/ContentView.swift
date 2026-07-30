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
    @AppStorage("koboKepub") private var koboKepub = false
    @State private var showEmailGuide = false
    /// First-launch gate: false shows the welcome page in place of the
    /// title page. Converting a script also counts as being welcomed.
    @AppStorage("welcomed") private var welcomed = false
    /// Consent for the launch-time update check. Off until the user says
    /// otherwise — the welcome page asks once, Settings can change it.
    @AppStorage("updateOptIn") private var updateOptIn = false
    @AppStorage("updateLastChecked") private var updateLastChecked = 0.0
    @State private var availableUpdate: AvailableUpdate?
    /// Last destination the user actually sent to. Empty on first run, when
    /// the ordering in ResultActions.routes supplies the opening guess.
    @AppStorage("lastDestination") private var lastDestination = ""
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
                    if welcomed { titlePage } else { welcomePage }
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
        .task { await maybeCheckForUpdates() }
        .onChange(of: updateOptIn) { _, on in
            // Opting in IS the request to check — do the first one right
            // away rather than making the user relaunch to see it work.
            if on { Task { await maybeCheckForUpdates() } }
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
            // Footer margins: a newer revision announces itself bottom-left,
            // and the draft-revision mark prints bottom-right — dev builds
            // stamp git-describe there, so two running builds are tellable
            // apart at a glance.
            HStack(alignment: .firstTextBaseline) {
                if let update = availableUpdate {
                    Button {
                        NSWorkspace.shared.open(update.releaseNotesURL)
                    } label: {
                        Text("rev. \(update.version) available")
                            .font(Theme.courier(9, .bold))
                            .kerning(0.4)
                            .foregroundStyle(Theme.brass)
                            .underline()
                    }
                    .buttonStyle(.plain)
                    .help("Opens the release notes and download on GitHub")
                }
                Spacer()
                Text("rev. \(appVersion)")
                    .font(Theme.courier(9))
                    .kerning(0.4)
                    .foregroundStyle(Theme.inkFaint)
                    .textSelection(.enabled)
            }
            .padding(.horizontal, 22)
            .padding(.bottom, 8)
        }
    }

    /// Launch-time check, gated twice: the opt-in, then the daily throttle.
    /// Failures are silent — a background courtesy must never nag; the
    /// manual menu check is the place errors get reported.
    private func maybeCheckForUpdates() async {
        let last = updateLastChecked > 0 ? Date(timeIntervalSince1970: updateLastChecked) : nil
        guard UpdateCheck.shouldCheck(optedIn: updateOptIn, lastChecked: last, now: Date()) else { return }
        updateLastChecked = Date().timeIntervalSince1970
        availableUpdate = try? await UpdateCheck.latest(currentVersion: appVersion)
    }

    private var pageNumber: String {
        switch state {
        case .idle: return ""
        case .converting: return "…"
        case .done(let r): return r.pages.map { "\($0)." } ?? "1."
        case .failed: return "1."
        }
    }

    // MARK: - First launch: the cold open

    /// Shown once, in place of the title page: a personal note and the one
    /// consent decision the app ever asks for. The story starts when the
    /// user clicks FADE IN.
    private var welcomePage: some View {
        VStack(alignment: .leading, spacing: 0) {
            Slugline(text: "INT. SCREEPUB - FIRST LAUNCH")
            Text("Welcome. I built Screepub because reading screenplays on an e-reader shouldn't be harder than reading anything else. Drop a script PDF on this page and it becomes a real e-book, built entirely on this Mac. Scripts are confidential; nothing you drop here is ever uploaded.")
                .font(Theme.courier(13))
                .foregroundStyle(Theme.ink)
                .lineSpacing(4)
                .padding(.top, 18)
            Text("Glad to share it with you.")
                .font(Theme.courier(13))
                .foregroundStyle(Theme.ink)
                .padding(.top, 14)
            Text("SAM")
                .font(Theme.courier(13, .bold))
                .kerning(1)
                .foregroundStyle(Theme.ink)
                .frame(maxWidth: .infinity, alignment: .trailing)
                .padding(.top, 10)

            Spacer(minLength: 24)

            VStack(alignment: .leading, spacing: 7) {
                Toggle("tell me when an update is available", isOn: $updateOptIn)
                    .toggleStyle(MarginToggleStyle(size: 12, color: Theme.ink))
                Text("(one anonymous request to GitHub, at most daily: app name and version, nothing else. Stays off unless you check this; change your mind anytime in Settings.)")
                    .font(Theme.courier(10))
                    .foregroundStyle(Theme.inkFaint)
                    .lineSpacing(2)
                    .fixedSize(horizontal: false, vertical: true)
            }

            Button("FADE IN") { welcomed = true }
                .buttonStyle(BradButtonStyle())
                .frame(maxWidth: .infinity)
                .padding(.top, 22)
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

    private var appVersion: String {
        Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? "unbundled"
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
        let epub = result.epubPath.map { URL(fileURLWithPath: $0) }
        return VStack(spacing: 0) {
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
            // The title block IS the file: drag it straight into a compose
            // window (Superhuman, webmail, Messages). Dragging is the one
            // route that carries the attachment whatever the default mail
            // client happens to be.
            .onDrag {
                guard let epub, let provider = NSItemProvider(contentsOf: epub) else {
                    return NSItemProvider()
                }
                return provider
            }
            .help("Drag this into a mail compose window — or any app — to attach the file")

            Spacer(minLength: 16)

            if let epub {
                transferButtons(result: result, epub: epub, title: result.title)
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

    /// Perform a route chosen from the send menu. One switch so the menu and
    /// its default action can't drift apart.
    private func run(route: RouteOption, result: EngineResult, epub: URL, title: String?) {
        switch route.destination {
        case .device(let device):
            copyToDevice(result: result, epub: epub, device: device)
        case .remarkable:
            sendToRemarkable(epub: epub)
        case .appleBooks:
            AppleBooks.send(epub)
            transferNote = "added to Apple Books. It syncs to your iPhone and iPad if Books iCloud is on"
        case .sendToKindle:
            SendToKindle.sendViaAmazon(epub)
        case .emailToKindle:
            emailToKindle(epub, title: title)
        case .saveCopy:
            saveACopy(result: result, epub: epub)
        }
    }

    @ViewBuilder
    private func transferButtons(result: EngineResult, epub: URL, title: String?) -> some View {
        VStack(spacing: 9) {
            // result.fountainPath (--json's fountainPath) is only set for PDF
            // input — the engine doesn't re-emit a .fountain for .fountain
            // input, so fall back to the input file itself in that case.
            if let fountainPath = result.fountainPath
                ?? (lastInput?.pathExtension.lowercased() == "fountain" ? lastInput?.path : nil) {
                // Outlined, not brass: SEND is the page's one primary action,
                // and preview shouldn't compete with it.
                Button("PREVIEW SCRIPT") {
                    openWindow(value: ScriptRef(
                        title: result.title ?? "Script",
                        fountainPath: fountainPath,
                        epubPath: epub.path))
                }
                .buttonStyle(OutlineButtonStyle())
            }
            // One decision — where is this going? — instead of a stack of
            // peers. The best route is the button; everything else is one
            // click away in its menu, named by destination with the
            // mechanism demoted to the detail line.
            let routes = ResultActions.routes(
                devices: devices,
                remarkableDocked: remarkableUp,
                booksAvailable: AppleBooks.isAvailable,
                canEmailToKindle: SendToKindle.defaultMailClientIsAppleMail)

            let chosen = ResultActions.preselected(in: routes, lastChosen: lastDestination.isEmpty ? nil : lastDestination)

            // The destination is picked, not guessed at. Every route is one
            // click away in the popup and the current one is readable
            // without opening anything, so a wrong pre-selection costs a
            // click rather than an unwanted send. Styled as the routing
            // slip it is: the destination typed onto a fill-in-the-blank
            // rule, its mechanism as the parenthetical underneath.
            VStack(spacing: 5) {
                Menu {
                    Picker("Send to", selection: Binding(
                        get: { chosen.destination.storageKey },
                        set: { lastDestination = $0 }
                    )) {
                        ForEach(routes.filter(\.available)) { route in
                            Text(route.title).tag(route.destination.storageKey)
                        }
                        // Disconnected hardware is still a destination —
                        // choosing it states intent, and SEND waits for
                        // the device to show up.
                        if routes.contains(where: { !$0.available }) {
                            Section("Not connected") {
                                ForEach(routes.filter { !$0.available }) { route in
                                    Text(route.title).tag(route.destination.storageKey)
                                }
                            }
                        }
                    }
                    .pickerStyle(.inline)
                    .labelsHidden()
                } label: {
                    HStack(alignment: .firstTextBaseline, spacing: 8) {
                        Text("SEND TO:")
                            .font(Theme.courier(12, .bold))
                            .kerning(0.8)
                            .foregroundStyle(Theme.inkFaint)
                        HStack(spacing: 6) {
                            Text(chosen.title.uppercased())
                                .font(Theme.courier(13, .bold))
                                .kerning(1)
                                .foregroundStyle(Theme.ink)
                            Image(systemName: "chevron.down")
                                .font(.system(size: 8, weight: .bold))
                                .foregroundStyle(Theme.brass)
                        }
                        .overlay(
                            Rectangle().fill(Theme.brass).frame(height: 1.2).offset(y: 4),
                            alignment: .bottom
                        )
                    }
                    .contentShape(Rectangle())
                }
                .menuStyle(.button)
                .buttonStyle(.plain)
                .menuIndicator(.hidden)
                .fixedSize()
                .help("Every place this script can go")

                // While the chosen hardware is unplugged the detail line IS
                // the instruction, so it steps forward in brass.
                Text("(\(chosen.detail))")
                    .font(Theme.courier(10))
                    .foregroundStyle(chosen.available ? Theme.inkFaint : Theme.brass)
                    .frame(maxWidth: .infinity, alignment: .center)

                // Kobo's format choice lives here, at the moment it applies,
                // not in Settings. Only shown when Calibre can actually
                // produce a KEPUB — otherwise plain EPUB is the only truth.
                if case .device(let d) = chosen.destination, d.kind == .kobo,
                   EbookConvert.isAvailable {
                    Toggle("as KEPUB, for page numbers & reading stats", isOn: $koboKepub)
                        .toggleStyle(MarginToggleStyle())
                        .padding(.top, 2)
                        .help("KEPUB unlocks Kobo's page-turn counts and reading stats, but its renderer has justification quirks around dashes and ellipses, which are common in dialogue. Off sends a plain EPUB (recommended).")
                }

                // The email route needs two one-time steps on Amazon's side
                // that the app can't do for the user — the guide names them
                // and links straight to the page where both happen.
                if chosen.destination == .emailToKindle {
                    Button {
                        showEmailGuide.toggle()
                    } label: {
                        Text("first time? the two-step Amazon setup")
                            .font(Theme.courier(10))
                            .foregroundStyle(Theme.inkFaint)
                            .underline()
                    }
                    .buttonStyle(.plain)
                    .padding(.top, 2)
                    .popover(isPresented: $showEmailGuide, arrowEdge: .bottom) {
                        EmailSetupGuide()
                    }
                }
            }
            .padding(.top, 4)

            // The button reads the route's own verb, so what happens on
            // click is written on the thing that does it. It holds, dimmed,
            // while the chosen hardware is unplugged — the volume events and
            // reMarkable probe light it up the moment the device appears.
            Button(chosen.button.uppercased()) {
                lastDestination = chosen.destination.storageKey
                run(route: chosen, result: result, epub: epub, title: title)
            }
            .buttonStyle(BradButtonStyle())
            .disabled(!chosen.available)

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
        // Dropping a script straight onto the welcome page is as welcomed
        // as anyone needs to be — don't replay the cold open afterwards.
        welcomed = true
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
            transferNote = "no Kindle-native file available. Use Send to Kindle email instead"
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

    /// Save the script somewhere of the user's choosing, in the format they
    /// pick — the route that works regardless of mail client, device, or
    /// Amazon account state.
    private func saveACopy(result: EngineResult, epub: URL) {
        let stem = epub.deletingPathExtension().lastPathComponent
        // Everything the save depends on is captured HERE, not inside the
        // completion: `panel.begin` is modeless, so CONVERT ANOTHER can move
        // `lastInput` to a different script while the sheet is still open.
        let fountainPath = result.fountainPath
            ?? (lastInput?.pathExtension.lowercased() == "fountain" ? lastInput?.path : nil)
        // The export must reproduce the settings the library EPUB was built
        // from — the same per-script sidecar, globals only as fallback, that
        // convert() resolves. It isn't just the exported file at stake: the
        // Kindle branch can re-run the engine, which rewrites <stem>.epub in
        // place, so exporting under any other settings would silently desync
        // the library EPUB from its own <Stem>.screepub.json.
        let settings = fountainPath.map {
            ScriptSettings.load(forFountain: URL(fileURLWithPath: $0),
                                fallback: AppSettings.formatSettings())
        } ?? AppSettings.formatSettings()
        let calibre = EbookConvert.isAvailable
        ExportPanel.present(epub: epub, stem: stem) { destination, format in
            transferNote = "saving…"
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

    private func emailToKindle(_ epub: URL, title: String?) {
        if SendToKindle.email(epub, title: title) {
            transferNote = "compose opened. Address it to your @kindle.com address, from a sender Amazon has approved"
        } else {
            transferNote = "no mail account available. Configure Mail.app, or use Send to Kindle web"
        }
    }
}

/// The two Amazon-side steps the app can't perform, plus what happens next —
/// a page insert anchored to the email route.
private struct EmailSetupGuide: View {
    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("SEND TO KINDLE EMAIL: ONE-TIME SETUP")
                .font(Theme.courier(12, .bold))
                .kerning(0.8)
                .foregroundStyle(Theme.ink)

            step("1. FIND YOUR KINDLE'S ADDRESS",
                 "Amazon → Manage Your Content & Devices → Preferences → Personal Document Settings. It ends in @kindle.com.")
            step("2. APPROVE YOUR OWN ADDRESS",
                 "Same page, \u{201C}Approved Personal Document E-mail List\u{201D}: add the address you send from. Amazon silently discards mail from anyone else. No bounce, no error.")
            step("3. SEND",
                 "The compose window opens with the script attached. Address it to your @kindle.com address.")

            Divider()

            step("ANOTHER MAIL APP?",
                 "Only Apple Mail attaches the file from here. With Superhuman, Outlook, or webmail, drag the script's title block into your compose window instead; the file rides along.")

            Button("OPEN AMAZON'S SETTINGS PAGE") {
                NSWorkspace.shared.open(SendToKindle.personalDocumentSettings)
            }
            .buttonStyle(OutlineButtonStyle())
            .frame(maxWidth: .infinity)
        }
        .padding(18)
        .frame(width: 340)
        .background(Theme.paper)
    }

    private func step(_ title: String, _ body: String) -> some View {
        VStack(alignment: .leading, spacing: 3) {
            Text(title)
                .font(Theme.courier(11, .bold))
                .foregroundStyle(Theme.ink)
            Text(body)
                .font(Theme.courier(11))
                .foregroundStyle(Theme.inkFaint)
                .lineSpacing(3)
                .fixedSize(horizontal: false, vertical: true)
        }
    }
}
