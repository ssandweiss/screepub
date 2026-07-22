import SwiftUI

@main
struct ScreepubApp: App {
    var body: some Scene {
        WindowGroup {
            ContentView()
                .frame(minWidth: 440, minHeight: 480)
                .onAppear {
                    // Ensure the window fronts when launched from a bare
                    // bundle (no Xcode-generated activation plumbing).
                    NSApp.setActivationPolicy(.regular)
                    NSApp.activate(ignoringOtherApps: true)
                }
        }
        .windowResizability(.contentSize)
    }
}
