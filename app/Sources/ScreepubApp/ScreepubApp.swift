import SwiftUI
import ScreepubKit

@main
struct ScreepubApp: App {
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
            FormattingSettings()
                .tabItem { Label("Formatting", systemImage: "text.alignleft") }
        }
        .frame(width: 720)
        .padding(.bottom, 8)
    }
}

struct GeneralSettings: View {
    @AppStorage("kindleEmail") private var kindleEmail = ""
    @AppStorage(AppSettings.outputFolderKey) private var outputFolder = ""

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
            Section("Kindle") {
                TextField("Send-to-Kindle email", text: $kindleEmail, prompt: Text("yourname_123@kindle.com"))
                    .textContentType(.emailAddress)
                    .autocorrectionDisabled()
                Text("Find it under Amazon → Manage Your Content and Devices → Devices. Your own email address must be on Amazon's approved sender list.")
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

struct FormattingSettings: View {
    @AppStorage("fmtScenePageBreaks") private var scenePageBreaks = false
    @AppStorage("fmtDialogueMargin") private var dialogueMargin = 20.0
    @AppStorage("fmtCueIndent") private var cueIndent = 33.0
    @AppStorage("fmtParenIndent") private var parenIndent = 17.0
    @AppStorage("fmtSpacing") private var spacing = 1.0
    @AppStorage("fmtKeepHeading") private var keepHeading = true
    @AppStorage("fmtFont") private var font = "courier"
    @AppStorage("fmtRejoin") private var rejoin = true
    @AppStorage("fmtContd") private var contd = "auto"
    @AppStorage("fmtCueAlign") private var cueAlign = "centered"
    @AppStorage("fmtTitlePage") private var titlePage = true
    @AppStorage("fmtSceneNumbers") private var sceneNumbers = false
    @AppStorage("fmtPageMarkers") private var pageMarkers = false

    var body: some View {
        HStack(alignment: .top, spacing: 0) {
            formColumn
            VStack(alignment: .leading, spacing: 6) {
                Text("PREVIEW")
                    .font(Theme.courier(10, .bold))
                    .kerning(1.2)
                    .foregroundStyle(Theme.inkFaint)
                LayoutPreview()
            }
            .padding(.vertical, 18)
            .padding(.trailing, 18)
            .frame(width: 264)
        }
    }

    private var formColumn: some View {
        Form {
            Section("Layout") {
                slider("Dialogue column margins", value: $dialogueMargin, range: 0...30, unit: "%")
                Picker("Cue & parenthetical alignment", selection: $cueAlign) {
                    Text("Centered in column").tag("centered")
                    Text("Print-style indent").tag("indented")
                }
                slider("Character cue indent", value: $cueIndent, range: 0...60, unit: "% of column")
                    .disabled(cueAlign == "centered")
                slider("Parenthetical indent", value: $parenIndent, range: 0...40, unit: "% of column")
                    .disabled(cueAlign == "centered")
                slider("Space between elements", value: $spacing, range: 0.4...1.6, unit: "em", step: 0.1)
                Picker("Typeface", selection: $font) {
                    Text("Courier (screenplay)").tag("courier")
                    Text("Serif (reader default)").tag("serif")
                    Text("Sans-serif").tag("sans")
                }
            }
            Section("Pages") {
                Toggle("Start each scene on a new page", isOn: $scenePageBreaks)
                Toggle("Keep scene headings with their scene", isOn: $keepHeading)
            }
            Section("Content") {
                Toggle("Generate a title page", isOn: $titlePage)
                Toggle("Show shooting-script scene numbers", isOn: $sceneNumbers)
                Toggle("Show original page numbers", isOn: $pageMarkers)
                Toggle("Rejoin dialogue split by page breaks", isOn: $rejoin)
                Picker("(CONT'D) on character cues", selection: $contd) {
                    Text("Automatic (standard rule)").tag("auto")
                    Text("Remove all").tag("strip")
                    Text("Keep as written").tag("keep")
                }
            }
            Section {
                HStack {
                    Spacer()
                    Button("Reset to Defaults") { AppSettings.resetFormatting() }
                }
                Text("Changes apply to the next conversion.")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
        }
        .formStyle(.grouped)
    }

    private func slider(
        _ label: String,
        value: Binding<Double>,
        range: ClosedRange<Double>,
        unit: String,
        step: Double = 1
    ) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            HStack {
                Text(label)
                Spacer()
                Text("\(value.wrappedValue, specifier: step < 1 ? "%.1f" : "%.0f") \(unit)")
                    .foregroundStyle(.secondary)
                    .monospacedDigit()
            }
            Slider(value: value, in: range, step: step)
        }
    }
}
