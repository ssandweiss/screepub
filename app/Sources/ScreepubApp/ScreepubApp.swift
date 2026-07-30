import SwiftUI
import ScreepubKit
import KFXKit

/// Open a pre-filled GitHub issue for feedback / bug reports, stamped with
/// the app and OS versions. `context` seeds the "what happened" block
/// (e.g. a conversion error) when reporting from a failure.
@MainActor func openFeedback(context: String? = nil) {
    let appVersion = UpdateController.currentVersion
    let osVersion = ProcessInfo.processInfo.operatingSystemVersionString
    NSWorkspace.shared.open(
        Feedback.newIssueURL(appVersion: appVersion, osVersion: osVersion, context: context))
}

/// Menu-driven check: user-initiated, so it runs regardless of the opt-in,
/// and unlike the silent launch check it reports every outcome — including
/// "you're current", which is the answer the user opened the menu for.
@MainActor func manualUpdateCheck() async {
    let current = UpdateController.currentVersion
    let alert = NSAlert()
    switch await UpdateController.shared.checkNow() {
    case .success(let update?):
        // An install may already be running from the footer popover; a
        // second Install button here would be silently swallowed by
        // install()'s busy guard — offer only what can actually happen.
        let installRunning = UpdateController.shared.busy
        alert.messageText = "Screepub \(update.version) is available"
        alert.informativeText = installRunning
            ? "You're running \(current). This update is already downloading — the app will relaunch when it finishes."
            : "You're running \(current). " + UpdateController.installConsentText
        if installRunning {
            alert.addButton(withTitle: "OK")
            alert.addButton(withTitle: "View Release")
        } else {
            alert.addButton(withTitle: "Install and Relaunch")
            alert.addButton(withTitle: "View Release")
            alert.addButton(withTitle: "Later")
        }
        switch alert.runModal() {
        case .alertFirstButtonReturn where !installRunning:
            await UpdateController.shared.install()
        case .alertSecondButtonReturn:
            NSWorkspace.shared.open(update.releaseNotesURL)
        default:
            break
        }
        return
    case .success(nil):
        alert.messageText = "You're up to date"
        alert.informativeText = "Screepub \(current) is the newest release."
    case .failure(UpdateCheckError.rateLimited):
        alert.messageText = "GitHub declined the request"
        alert.informativeText = "Unauthenticated checks are limited to 60 an hour per network. Try again in a little while."
    case .failure(let error):
        alert.messageText = "Couldn't check for updates"
        alert.informativeText = "The request didn't go through. Check your connection and try again. (\(error.localizedDescription))"
    }
    alert.runModal()
}

@main
struct ScreepubApp: App {
    init() {
        // A previous self-update may have parked the old bundle beside this
        // one; the running binary kept it alive until now. Deleting a full
        // parked bundle (~100MB, thousands of files) is not first-frame
        // work, and nothing downstream reads the result.
        let bundleURL = Bundle.main.bundleURL
        Task.detached(priority: .utility) {
            UpdateInstaller.cleanupLeftovers(near: bundleURL)
        }
    }

    var body: some Scene {
        WindowGroup {
            ContentView()
                .frame(minWidth: 460, minHeight: 560)
                .onAppear {
                    // Ensure the window fronts when launched from a bare
                    // bundle (no Xcode-generated activation plumbing).
                    NSApp.setActivationPolicy(.regular)
                    NSApp.activate(ignoringOtherApps: true)
                }
        }
        .windowResizability(.contentSize)
        .windowStyle(.hiddenTitleBar)
        .commands {
            CommandGroup(after: .appInfo) {
                Button("Check for Updates…") { Task { await manualUpdateCheck() } }
            }
            CommandGroup(replacing: .help) {
                Button("Send Feedback on GitHub…") { openFeedback() }
            }
        }

        WindowGroup("Script Preview", for: ScriptRef.self) { $ref in
            if let ref {
                ReaderView(ref: ref)
            }
        }
        .windowResizability(.contentMinSize)
        .defaultSize(width: 700, height: 800)

        Settings {
            SettingsView()
        }
    }
}

struct SettingsView: View {
    var body: some View {
        TabView {
            GeneralSettings()
                .tabItem { Label("General", systemImage: "gearshape") }
            DevicesSettings()
                .tabItem { Label("Devices", systemImage: "externaldrive") }
        }
        .frame(width: 520)
        .padding(.bottom, 8)
    }
}

struct GeneralSettings: View {
    @AppStorage(AppSettings.outputFolderKey) private var outputFolder = ""
    @AppStorage(AppSettings.updateOptInKey) private var updateOptIn = false

    var body: some View {
        Form {
            Section("Library") {
                LabeledContent("Output folder") {
                    HStack {
                        Text(displayedFolder)
                            .lineLimit(1)
                            .truncationMode(.middle)
                            .foregroundStyle(.secondary)
                        Button("Choose…") { choose() }
                        if !outputFolder.isEmpty {
                            Button("Reset") { outputFolder = "" }
                        }
                    }
                }
                Text("Converted EPUB, MOBI, and Fountain files are saved here.")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
            Section("Updates") {
                Toggle("Check for updates at launch", isOn: $updateOptIn)
                Text("At most one anonymous request a day to GitHub's public API: app name and version, nothing else. Off by default. Screepub → Check for Updates… always works regardless.")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
        }
        .formStyle(.grouped)
    }

    private var displayedFolder: String {
        (AppSettings.outputFolder.path as NSString).abbreviatingWithTildeInPath
    }

    private func choose() {
        let panel = NSOpenPanel()
        panel.canChooseFiles = false
        panel.canChooseDirectories = true
        panel.canCreateDirectories = true
        panel.directoryURL = AppSettings.outputFolder
        if panel.runModal() == .OK, let url = panel.url {
            outputFolder = url.path
        }
    }
}

/// Machine-level concerns: what this Mac talks to, and the coarse formatting
/// default new conversions start from. Per-script tuning lives in the reader
/// window's rail, beside a live render of the actual output.
struct DevicesSettings: View {
    @State private var currentDefault: DevicePreset?

    var body: some View {
        Form {
            Section("Default formatting") {
                LabeledContent("Current default") {
                    Text(currentDefault?.displayName ?? "Customized")
                        .foregroundStyle(.secondary)
                }
                Menu("Load device preset") {
                    ForEach(DevicePreset.allCases) { preset in
                        Button(preset.displayName) {
                            AppSettings.setFormatSettings(preset.settings)
                        }
                    }
                }
                HStack {
                    Spacer()
                    Button("Reset to Defaults") { AppSettings.resetFormatting() }
                }
                Text("The starting point for new conversions. Fine-tune a single script in its preview window, then use Save as app defaults there to promote it here.")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
            KfxQualitySection()
            // The Kindle email address is Amazon's to know, not ours to
            // store — the send block's setup guide points at the page where
            // it lives. The Kobo KEPUB choice lives on the result page's send
            // block, shown only while a Kobo is the chosen destination.
            Section("Other devices") {
                Text("tolino: books are copied into the Books folder. reMarkable: enable Settings → Storage → USB web interface on the tablet, then dock it over USB.")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
        }
        .formStyle(.grouped)
        .onAppear { refreshCurrentDefault() }
        // AppSettings reads UserDefaults directly rather than through
        // @AppStorage, so nothing here republishes on its own. This also
        // catches the reader rail's Save as app defaults landing while this
        // window is open.
        .onReceive(NotificationCenter.default.publisher(for: UserDefaults.didChangeNotification)) { _ in
            refreshCurrentDefault()
        }
    }

    private func refreshCurrentDefault() {
        currentDefault = DevicePreset.matching(AppSettings.formatSettings())
    }
}

/// The KFX setup story, told honestly: two things only the user can
/// install (Calibre and Kindle Previewer — we may not redistribute either),
/// one thing Screepub installs for them (the KFX plugin, one click). Until
/// all three are green, USB transfers quietly fall back to AZW3 or MOBI.
struct KfxQualitySection: View {
    @State private var status: KFXToolchain.Status?
    @State private var working = false
    @State private var note: String?

    var body: some View {
        Section("Best Kindle quality (KFX)") {
            if let status {
                row("Calibre", ok: status.calibre,
                    fix: Link("Get Calibre", destination: KFXToolchain.calibreDownloadURL))
                row("Kindle Previewer", ok: status.previewer,
                    fix: Link("Get Kindle Previewer", destination: KFXToolchain.previewerDownloadURL))
                row("KFX plugin", ok: status.pluginInstalled, fix: pluginFix(status))
                if let note {
                    Text(note).font(.caption).foregroundStyle(.secondary)
                }
                Text(status.ready
                     ? "Ready. USB transfers to a Kindle use KFX — the same modern rendering as books Amazon delivers, working fully offline."
                     : "USB transfers fall back to \(EbookConvert.isAvailable ? "AZW3" : "MOBI") until all three are installed. Screepub installs the plugin for you; Calibre and Kindle Previewer are free and installed once.")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            } else {
                Text("Checking what's installed…")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
        }
        .task { await refresh() }
    }

    @ViewBuilder
    private func pluginFix(_ status: KFXToolchain.Status) -> some View {
        if !status.calibre {
            Text("needs Calibre first").font(.caption).foregroundStyle(.secondary)
        } else if working {
            ProgressView().controlSize(.small)
        } else {
            Button("Install plugin") {
                working = true
                note = nil
                Task.detached {
                    do {
                        try KFXToolchain.installPlugin()
                        await MainActor.run { note = "Plugin installed." }
                    } catch {
                        await MainActor.run { note = error.localizedDescription }
                    }
                    await refresh()
                    await MainActor.run { working = false }
                }
            }
        }
    }

    @ViewBuilder
    private func row(_ name: String, ok: Bool, fix: some View) -> some View {
        LabeledContent(name) {
            if ok {
                Label("Installed", systemImage: "checkmark.circle.fill")
                    .labelStyle(.titleAndIcon)
                    .foregroundStyle(.green)
            } else {
                fix
            }
        }
    }

    private func refresh() async {
        // The Settings pane exists to answer "did my install take?" —
        // bypass the cache and probe for real.
        status = await Task.detached { KFXToolchain.status(maxAge: 0) }.value
    }
}

