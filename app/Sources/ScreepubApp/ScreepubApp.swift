import SwiftUI

@main
struct ScreepubApp: App {
    var body: some Scene {
        WindowGroup {
            ContentView()
                .frame(minWidth: 440, minHeight: 520)
                .onAppear {
                    // Ensure the window fronts when launched from a bare
                    // bundle (no Xcode-generated activation plumbing).
                    NSApp.setActivationPolicy(.regular)
                    NSApp.activate(ignoringOtherApps: true)
                }
        }
        .windowResizability(.contentSize)

        Settings {
            SettingsView()
        }
    }
}

struct SettingsView: View {
    @AppStorage("kindleEmail") private var kindleEmail = ""

    var body: some View {
        Form {
            Section {
                TextField("Send-to-Kindle email", text: $kindleEmail, prompt: Text("yourname_123@kindle.com"))
                    .textContentType(.emailAddress)
                    .autocorrectionDisabled()
            } footer: {
                Text("Find it under Amazon → Manage Your Content and Devices → Devices → your Kindle. Your own email address must be on Amazon's approved sender list for delivery to work.")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
        }
        .formStyle(.grouped)
        .frame(width: 420)
        .padding(.bottom, 8)
    }
}
