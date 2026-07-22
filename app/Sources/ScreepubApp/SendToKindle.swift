import AppKit

/// Kindle delivery. Recent Kindles use MTP over USB (not mountable on
/// macOS), so Amazon's Send to Kindle is the dependable path: the native
/// app when installed, otherwise the web uploader with the EPUB revealed
/// in Finder for drag-in.
enum SendToKindle {
    static let webUploader = URL(string: "https://www.amazon.com/sendtokindle")!

    static var appURL: URL? {
        NSWorkspace.shared.urlForApplication(withBundleIdentifier: "com.amazon.sendtokindle")
            ?? existing("/Applications/Send to Kindle.app")
    }

    static var appIsInstalled: Bool { appURL != nil }

    static func send(_ epub: URL) {
        if let app = appURL {
            NSWorkspace.shared.open([epub], withApplicationAt: app, configuration: NSWorkspace.OpenConfiguration())
        } else {
            // Web flow: put the file in front of the user, then the uploader.
            NSWorkspace.shared.activateFileViewerSelecting([epub])
            NSWorkspace.shared.open(webUploader)
        }
    }

    private static func existing(_ path: String) -> URL? {
        FileManager.default.fileExists(atPath: path) ? URL(fileURLWithPath: path) : nil
    }
}
