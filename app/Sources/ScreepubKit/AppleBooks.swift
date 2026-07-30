import AppKit

/// Apple Books delivery — the route to an iPhone or iPad.
///
/// No conversion is involved: Books reads EPUB3 natively, which is what the
/// engine already emits. It is also the best-rendering target Screepub has.
/// Books draws with WebKit, so the `page-break-inside: avoid` rules on
/// dialogue blocks are honoured — the same rules a Kindle's sideload
/// renderer ignores, which is why a cue can strand at the foot of a page
/// there and does not here.
///
/// Adding a book to Books on this Mac is what carries it to iOS: with
/// iCloud syncing enabled for Books, the title appears on every signed-in
/// iPhone and iPad by itself. That is the whole of Screepub's iOS support —
/// no cable, no account of ours, and nothing uploaded anywhere except the
/// user's own iCloud library, at their instruction.
public enum AppleBooks {
    /// Books ships with macOS, but it can be removed, and on a managed Mac
    /// it may be absent — so this is an Optional rather than an assumption.
    public static var appURL: URL? {
        NSWorkspace.shared.urlForApplication(withBundleIdentifier: "com.apple.iBooksX")
            ?? existingApp(atPath: "/System/Applications/Books.app")
            ?? existingApp(atPath: "/Applications/Books.app")
    }

    public static var isAvailable: Bool { appURL != nil }

    /// Add the EPUB to the Books library. Returns false when Books isn't
    /// installed, so the caller can hide the affordance rather than offer a
    /// button that does nothing.
    @MainActor
    @discardableResult
    public static func send(_ epub: URL) -> Bool {
        guard let app = appURL else { return false }
        NSWorkspace.shared.open([epub], withApplicationAt: app,
                                configuration: NSWorkspace.OpenConfiguration())
        return true
    }

}
