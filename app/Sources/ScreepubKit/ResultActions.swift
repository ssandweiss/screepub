import Foundation

/// The action occupying the result view's single brass/primary slot.
public enum ResultAction: Equatable, Sendable {
    case transfer(ConnectedDevice)
    case saveCopy
}

/// Which action to emphasize after a conversion. Lives here rather than in
/// the views so the main window, the reader rail, and kit-check all share
/// one answer instead of separately re-deriving it.
public enum ResultActions {
    /// A mounted volume device is the best route when one is present.
    /// reMarkable is excluded: it uploads over its USB web interface rather
    /// than being copied to, and lives under "More ways…".
    nonisolated public static func primary(devices: [ConnectedDevice]) -> ResultAction {
        if let device = devices.first(where: { $0.kind != .remarkable }) {
            return .transfer(device)
        }
        return .saveCopy
    }
}
