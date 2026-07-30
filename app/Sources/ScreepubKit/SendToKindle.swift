import AppKit

/// Wireless Kindle delivery routes. USB copy lives in KindleDevice; this
/// covers email (user's @kindle.com address via a pre-addressed Mail
/// compose) and Amazon's Send to Kindle app / web uploader.
public enum SendToKindle {
    public static let webUploader = URL(string: "https://www.amazon.com/sendtokindle")!

    public static var appURL: URL? {
        NSWorkspace.shared.urlForApplication(withBundleIdentifier: "com.amazon.sendtokindle")
            ?? existing("/Applications/Send to Kindle.app")
    }

    public static var appIsInstalled: Bool { appURL != nil }

    /// Open a Mail compose with the EPUB attached, ready to be addressed to
    /// the user's @kindle.com address. The app doesn't store that address —
    /// the setup guide in the send block explains where Amazon keeps it.
    /// Returns false when no compose service is available (no mail account
    /// configured).
    @MainActor
    @discardableResult
    public static func email(_ epub: URL, title: String?) -> Bool {
        guard let service = NSSharingService(named: .composeEmail) else { return false }
        service.subject = title ?? epub.deletingPathExtension().lastPathComponent
        guard service.canPerform(withItems: [epub]) else { return false }
        service.perform(withItems: [epub])
        return true
    }

    /// Amazon's Personal Document Settings — where the @kindle.com address
    /// lives and where the sender allow-list is edited. One page for both
    /// steps of the email setup.
    public static let personalDocumentSettings =
        URL(string: "https://www.amazon.com/hz/mycd/myx#/home/settings/pdoc")!

    /// Native app when installed, else web uploader with the file revealed
    /// in Finder for drag-in.
    @MainActor
    public static func sendViaAmazon(_ epub: URL) {
        if let app = appURL {
            NSWorkspace.shared.open([epub], withApplicationAt: app,
                                    configuration: NSWorkspace.OpenConfiguration())
        } else {
            NSWorkspace.shared.activateFileViewerSelecting([epub])
            NSWorkspace.shared.open(webUploader)
        }
    }

    private static func existing(_ path: String) -> URL? {
        FileManager.default.fileExists(atPath: path) ? URL(fileURLWithPath: path) : nil
    }

    /// True when Apple Mail handles `mailto:`. The compose handoff attaches
    /// the file correctly there; with a third-party default client macOS
    /// degrades the request to a `mailto:` URL, which by RFC 6068 carries no
    /// attachment at all — recipient and subject survive, the file vanishes,
    /// and `canPerform` still reports true. So the compose route is offered
    /// only when this is true.
    @MainActor
    public static var defaultMailClientIsAppleMail: Bool {
        guard let mailto = URL(string: "mailto:test@example.com"),
              let app = NSWorkspace.shared.urlForApplication(toOpen: mailto),
              let bundle = Bundle(url: app) else { return false }
        return bundle.bundleIdentifier == "com.apple.mail"
    }
}
