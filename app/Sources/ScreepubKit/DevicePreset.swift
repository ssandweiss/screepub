import Foundation

/// Named bundles of FormatSettings tuned for a class of reading device.
/// Applying a preset replaces the whole FormatSettings — global (Settings)
/// or per-script (reader rail). Responsive reflow is impossible in a fixed
/// e-book (no JS, media queries stripped), so a preset chosen at conversion
/// time is the mechanism for device-appropriate geometry.
public enum DevicePreset: String, CaseIterable, Identifiable, Sendable {
    /// The recommended baseline: 6" e-ink Kindle. Identical to defaults.
    case kindleEink
    /// Narrow phone/tablet reading app: side-by-side dual dialogue is an
    /// unreadable sliver, so speeches go sequential, and the dialogue
    /// column widens (shallower side margins) to use the small screen.
    case phone

    public var id: String { rawValue }

    public var displayName: String {
        switch self {
        case .kindleEink: return "Kindle e-ink (6\")"
        case .phone: return "Phone / narrow screen"
        }
    }

    public var settings: FormatSettings {
        switch self {
        case .kindleEink:
            return .defaults
        case .phone:
            var s = FormatSettings.defaults
            s.dialogueSideMarginPct = 10
            s.dualDialogue = "sequential"
            return s
        }
    }

    /// The preset whose settings exactly match `settings`, or nil when they
    /// have been tuned away from every preset. Applying a preset overwrites
    /// FormatSettings and stores no identity, so equality is the only honest
    /// answer to "which preset am I on?" — a remembered name would keep
    /// claiming "Kindle e-ink" after the first knob moved.
    public static func matching(_ settings: FormatSettings) -> DevicePreset? {
        allCases.first { $0.settings == settings }
    }
}
