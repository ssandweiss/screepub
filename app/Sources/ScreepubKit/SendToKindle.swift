import AppKit

/// Wireless Kindle delivery routes. USB copy lives in KindleDevice; this
/// covers email (user's @kindle.com address via a pre-addressed Mail
/// compose) and Amazon's Send to Kindle app / web uploader.
public enum SendToKindle {
    public static let webUploader = URL(string: "https://www.amazon.com/sendtokindle")!

    public static var appURL: URL? {
        NSWorkspace.shared.urlForApplication(withBundleIdentifier: "com.amazon.sendtokindle")
            ?? existingApp(atPath: "/Applications/Send to Kindle.app")
    }

    /// Feeds the route catalog's label: `sendViaAmazon` opens the native
    /// app when installed, and the button must say which one fires.
    public static var appIsInstalled: Bool { appURL != nil }

    /// The @kindle.com address a pre-0.4 Screepub stored. The app no
    /// longer ASKS for it (the setup guide explains where Amazon keeps
    /// it), but an address the user already gave us keeps working —
    /// removing the Settings field must not demote existing users from
    /// zero-typing to lookup-and-type on every send.
    public static var legacyStoredAddress: String? {
        let stored = UserDefaults.standard.string(forKey: "kindleEmail")?
            .trimmingCharacters(in: .whitespaces) ?? ""
        return stored.isEmpty ? nil : stored
    }

    /// Open a Mail compose with the EPUB attached — pre-addressed when a
    /// previously stored @kindle.com address exists, otherwise ready to be
    /// addressed by hand. Returns false when no compose service is
    /// available (no mail account configured).
    @MainActor
    @discardableResult
    public static func email(_ epub: URL, title: String?) -> Bool {
        guard let service = NSSharingService(named: .composeEmail) else { return false }
        if let address = legacyStoredAddress {
            service.recipients = [address]
        }
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
