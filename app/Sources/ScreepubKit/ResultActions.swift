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

    public var id: String { title + detail }

    public init(destination: Destination, title: String, detail: String) {
        self.destination = destination
        self.title = title
        self.detail = detail
    }
}

/// Where a converted script can go, best route first.
///
/// The view renders `routes.first` as the single emphasized button and the
/// rest inside its menu, so this ordering *is* the interface — which is why
/// it lives here, in one kit-checkable place, rather than being re-derived
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
        canEmailToKindle: Bool = false
    ) -> [RouteOption] {
        var routes: [RouteOption] = []

        for device in devices where device.kind != .remarkable {
            routes.append(RouteOption(
                destination: .device(device),
                title: device.name,
                detail: "over USB — works offline, nothing leaves your Mac"))
        }
        if remarkableDocked {
            routes.append(RouteOption(
                destination: .remarkable,
                title: "reMarkable",
                detail: "the original PDF, over its USB connection"))
        }
        if booksAvailable {
            routes.append(RouteOption(
                destination: .appleBooks,
                title: "Apple Books",
                detail: "syncs to your iPhone and iPad"))
        }
        routes.append(RouteOption(
            destination: .sendToKindle,
            title: "Send to Kindle",
            detail: "via Amazon — the best-looking Kindle result"))
        if canEmailToKindle {
            routes.append(RouteOption(
                destination: .emailToKindle,
                title: "Email to Kindle",
                detail: "opens a message with the book attached"))
        }
        routes.append(RouteOption(
            destination: .saveCopy,
            title: "Save a copy…",
            detail: "choose a folder"))
        return routes
    }

    /// The route to pre-select. Always present — Save is the floor.
    ///
    /// What the user chose last time wins, whenever that route is still
    /// available. A remembered choice beats any ordering heuristic: someone
    /// who always sends to Apple Books shouldn't have the list guess at
    /// them every time because a Kindle happens to be plugged in, and the
    /// guess only has to be wrong once to be annoying. The ordering above
    /// is the fallback for a first run, not a policy about what people
    /// ought to want.
    public static func preselected(
        in routes: [RouteOption],
        lastChosen: String?
    ) -> RouteOption {
        if let key = lastChosen,
           let remembered = routes.first(where: { $0.destination.storageKey == key }) {
            return remembered
        }
        return routes[0]
    }

    public static func primary(
        devices: [ConnectedDevice],
        remarkableDocked: Bool = false,
        booksAvailable: Bool = true,
        canEmailToKindle: Bool = false
    ) -> RouteOption {
        routes(devices: devices,
               remarkableDocked: remarkableDocked,
               booksAvailable: booksAvailable,
               canEmailToKindle: canEmailToKindle)[0]
    }
}
