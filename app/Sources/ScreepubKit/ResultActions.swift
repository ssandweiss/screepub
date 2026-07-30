import Foundation

/// Somewhere a converted script can go.
public enum Destination: Equatable, Sendable {
    /// A mounted volume — Kindle, Kobo, tolino.
    case device(ConnectedDevice)
    /// Docked reMarkable, which is uploaded to rather than copied onto.
    case remarkable
    /// Adds to the Books library; iCloud carries it to iPhone and iPad.
    case appleBooks
    /// Amazon's Send to Kindle app when installed, else its web uploader.
    case sendToKindle
    /// Pre-addressed compose in Apple Mail.
    case emailToKindle
    case saveCopy

    /// Stable key for remembering the user's last choice.
    ///
    /// Keyed on the device *kind*, never its name or volume path: a Kindle
    /// is the same destination whether it mounts as "Kindle" or gets a
    /// different label, and a remembered path would go stale the moment it
    /// was unplugged.
    public var storageKey: String {
        switch self {
        case .device(let d):  return "device:\(d.kind.rawValue)"
        case .remarkable:     return "remarkable"
        case .appleBooks:     return "appleBooks"
        case .sendToKindle:   return "sendToKindle"
        case .emailToKindle:  return "emailToKindle"
        case .saveCopy:       return "saveCopy"
        }
    }
}

/// One route, as the user should read it: named by where the script ends up,
/// with the mechanism demoted to the detail line. "Kindle" is a destination;
/// "AZW3 over USB" is an implementation detail that belongs underneath it.
public struct RouteOption: Equatable, Sendable, Identifiable {
    public let destination: Destination
    public let title: String
    public let detail: String
    /// What the action button reads while this route is chosen. The verb
    /// carries the mechanism — Copy is USB-offline, Add is local, Upload/
    /// Send/Email name exactly what fires — so the click is never a surprise.
    public let button: String
    /// Whether the route can fire right now. Physical destinations stay
    /// listed while disconnected (the menu is a catalog, not a status
    /// display); this flag is what waits for the hardware, and `detail`
    /// carries the plug-it-in instruction while it does.
    public let available: Bool

    /// Row identity for pickers and ForEach — NOT the remembered-choice key
    /// (that stays `destination.storageKey`, by kind). A connected device
    /// appends its volume path so two same-kind devices are two rows: keyed
    /// by kind alone, the second Kindle's row would collide with the first
    /// and a send aimed at it would land on the first one's volume.
    /// Placeholders (no volume) fall back to the storage key, which stays
    /// unique because placeholders exclude connected kinds and the
    /// remarkable/email rows are available-XOR-placeholder.
    public var id: String {
        if case .device(let d) = destination, let volume = d.volume {
            return "\(destination.storageKey)#\(volume.path)"
        }
        return destination.storageKey
    }

    public init(destination: Destination, title: String, detail: String, button: String,
                available: Bool = true) {
        self.destination = destination
        self.title = title
        self.detail = detail
        self.button = button
        self.available = available
    }
}

/// Where a converted script can go — every destination, best route first,
/// with hardware that isn't currently connected listed last and flagged
/// unavailable.
///
/// The view renders this list as the send picker and `preselected` as its
/// opening choice, so the ordering *is* the interface — which is why it
/// lives here, in one kit-checkable place, rather than being re-derived
/// as a pile of conditionals across two views.
///
/// Ordering rationale, strongest claim first:
///  1. A plugged-in device is unambiguous: the user physically connected it.
///  2. A docked reMarkable, same reasoning, but it never mounts so it can't
///     win on volume presence alone.
///  3. Apple Books — instant, local, no account, and it reaches an iPhone or
///     iPad by itself. A better default than any route that opens a browser.
///  4. Send to Kindle, which needs Amazon and a browser but produces the
///     best-looking Kindle output.
///  5. Email, which works but requires the approved-sender setup people
///     routinely forget.
///  6. Save, which always works and asks the user to do the rest.
public enum ResultActions {
    public static func routes(
        devices: [ConnectedDevice],
        remarkableDocked: Bool = false,
        booksAvailable: Bool = true,
        canEmailToKindle: Bool = false,
        sendToKindleApp: Bool = false,
        inputIsPDF: Bool = true
    ) -> [RouteOption] {
        var routes: [RouteOption] = []

        for device in devices where device.kind != .remarkable {
            routes.append(RouteOption(
                destination: .device(device),
                title: device.name,
                detail: "over USB, offline, nothing leaves your Mac",
                button: "Copy to \(device.name)"))
        }
        if remarkableDocked {
            // The slip names the actual payload: fountain input has no
            // original PDF, and the upload falls back to the EPUB.
            routes.append(RouteOption(
                destination: .remarkable,
                title: "reMarkable",
                detail: inputIsPDF
                    ? "the original PDF, over its USB connection"
                    : "the EPUB, over its USB connection",
                button: "Upload to reMarkable"))
        }
        if booksAvailable {
            routes.append(RouteOption(
                destination: .appleBooks,
                title: "Apple Books",
                detail: "syncs to your iPhone and iPad",
                button: "Add to Apple Books"))
        }
        // Same executor either way (sendViaAmazon), but the label follows
        // what will actually open: the native app when installed, the web
        // uploader otherwise. "The click is never a surprise" includes this.
        let sendToKindleName = sendToKindleApp ? "Send to Kindle app" : "Send to Kindle web"
        routes.append(RouteOption(
            destination: .sendToKindle,
            title: sendToKindleName,
            detail: "via Amazon, the best-looking Kindle result",
            button: sendToKindleName))
        if canEmailToKindle {
            routes.append(RouteOption(
                destination: .emailToKindle,
                title: "Send to Kindle email",
                detail: "a Mail message with the book attached",
                button: "Send to Kindle email"))
        }
        routes.append(RouteOption(
            destination: .saveCopy,
            title: "Save a copy…",
            detail: "choose a folder",
            button: "Save a Copy…"))

        // Anything the user could fix at the desk stays listed — absent
        // hardware or a non-Apple-Mail default is a state, not a missing
        // feature, and hiding the row hides the capability. Placeholders
        // sink below every sendable route, carry the fix as their detail,
        // and become the real row (same storage key) the moment the state
        // changes. Only truly structural absence — no Books.app — is hidden.
        let connectedKinds = Set(devices.map(\.kind))
        // Every volume-mounted kind, so a future DeviceKind case gets its
        // placeholder without anyone remembering this list exists.
        for kind in DeviceKind.allCases where kind != .remarkable && !connectedKinds.contains(kind) {
            routes.append(RouteOption(
                destination: .device(ConnectedDevice(kind: kind, name: kind.displayName, volume: nil)),
                title: kind.displayName,
                detail: "plug in over USB to send",
                button: "Copy to \(kind.displayName)",
                available: false))
        }
        if !remarkableDocked {
            routes.append(RouteOption(
                destination: .remarkable,
                title: "reMarkable",
                detail: "dock over USB to send",
                button: "Upload to reMarkable",
                available: false))
        }
        if !canEmailToKindle {
            routes.append(RouteOption(
                destination: .emailToKindle,
                title: "Send to Kindle email",
                detail: "needs Apple Mail as the default mail app, the one client the attachment survives",
                button: "Send to Kindle email",
                available: false))
        }
        return routes
    }

    /// The route to pre-select. Always present — Save is the floor.
    ///
    /// What the user chose last time wins, whenever that route is still
    /// listed. A remembered choice beats any ordering heuristic: someone
    /// who always sends to Apple Books shouldn't have the list guess at
    /// them every time because a Kindle happens to be plugged in, and the
    /// guess only has to be wrong once to be annoying. The ordering above
    /// is the fallback for a first run, not a policy about what people
    /// ought to want.
    ///
    /// A remembered device that is merely unplugged stays chosen: the slip
    /// keeps the user's intent, the detail line says to plug it in, and the
    /// view holds SEND until detection makes it real. A first run, by
    /// contrast, never guesses at hardware that isn't there.
    public static func preselected(
        in routes: [RouteOption],
        lastChosen: String?
    ) -> RouteOption {
        if let key = lastChosen,
           let remembered = routes.first(where: { $0.destination.storageKey == key }) {
            return remembered
        }
        return routes.first(where: \.available) ?? routes[0]
    }

}
