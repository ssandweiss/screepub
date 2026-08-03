import SwiftUI
import AppKit

/// "Classic script page" theme: paper + typewriter ink + one brass accent
/// (the app icon's amber). Dark mode is night pages — same ink logic on
/// deep charcoal paper.
enum Theme {
    private static func dynamic(light: NSColor, dark: NSColor) -> Color {
        Color(nsColor: NSColor(name: nil) { appearance in
            appearance.bestMatch(from: [.aqua, .darkAqua]) == .darkAqua ? dark : light
        })
    }

    static let paper = dynamic(
        light: NSColor(red: 0.969, green: 0.949, blue: 0.902, alpha: 1),
        dark: NSColor(red: 0.118, green: 0.110, blue: 0.098, alpha: 1)
    )
    static let ink = dynamic(
        light: NSColor(red: 0.114, green: 0.106, blue: 0.086, alpha: 1),
        dark: NSColor(red: 0.910, green: 0.886, blue: 0.827, alpha: 1)
    )
    /// Secondary TEXT. `inkFaint` composites to #7F7C74 on paper, which is
    /// 3.73:1 and fails AA for normal text; the web hit this first and split
    /// off its own muted weight, and this is that weight brought back. Use
    /// this for anything a reader has to read.
    static let inkMuted = dynamic(
        light: NSColor(red: 0.427, green: 0.412, blue: 0.376, alpha: 1),
        dark: NSColor(red: 0.561, green: 0.533, blue: 0.486, alpha: 1)
    )
    /// Hairlines, strokes and fills only. Kept because a 1.2pt rule or a
    /// progress track is decoration, where 3.73:1 is fine and a heavier ink
    /// would draw the eye to furniture instead of the page.
    static let inkFaint = dynamic(
        light: NSColor(red: 0.114, green: 0.106, blue: 0.086, alpha: 0.55),
        dark: NSColor(red: 0.910, green: 0.886, blue: 0.827, alpha: 0.55)
    )
    static let hole = dynamic(
        light: NSColor(red: 0.114, green: 0.106, blue: 0.086, alpha: 0.10),
        dark: NSColor(white: 0, alpha: 0.45)
    )
    static let brass = Color(red: 0.910, green: 0.639, blue: 0.239) // icon amber
    /// Label color for anything sitting ON brass. Fixed in both appearances,
    /// because brass is fixed: following `ink` into dark mode puts cream on
    /// amber at 1.67:1. Same value as light-mode ink, which measures 7.98:1.
    static let inkOnBrass = Color(red: 0.114, green: 0.106, blue: 0.086)
    static let alarm = dynamic(
        light: NSColor(red: 0.686, green: 0.196, blue: 0.125, alpha: 1),
        dark: NSColor(red: 0.918, green: 0.478, blue: 0.396, alpha: 1)
    )

    /// Courier Prime when installed, Courier New otherwise (always present).
    static let face: String =
        NSFont(name: "Courier Prime", size: 12) != nil ? "Courier Prime" : "Courier New"

    static func courier(_ size: CGFloat, _ weight: Font.Weight = .regular) -> Font {
        .custom(face, size: size).weight(weight)
    }
}

/// Slugline: bold caps, flush left.
struct Slugline: View {
    let text: String
    var body: some View {
        Text(text.uppercased())
            .font(Theme.courier(13, .bold))
            .foregroundStyle(Theme.ink)
            .kerning(0.5)
            .frame(maxWidth: .infinity, alignment: .leading)
    }
}

/// Right-flush transition ("CUT TO:").
struct Transition: View {
    let text: String
    var body: some View {
        Text(text.uppercased())
            .font(Theme.courier(13, .bold))
            .foregroundStyle(Theme.inkMuted)
            .kerning(0.5)
            .frame(maxWidth: .infinity, alignment: .trailing)
    }
}

/// Primary action: brass-filled, ink caps — the brad of the page.
/// Buttons hug their text (plus a typewriter margin) rather than spanning
/// the column: sized like typed words on a page, not toolbar slabs.
struct BradButtonStyle: ButtonStyle {
    @Environment(\.isEnabled) private var isEnabled

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(Theme.courier(12, .bold))
            .kerning(0.8)
            .foregroundStyle(Theme.inkOnBrass)
            .padding(.vertical, 6)
            .padding(.horizontal, 26)
            .frame(minWidth: 150)
            .background(
                RoundedRectangle(cornerRadius: 3)
                    .fill(Theme.brass.opacity(configuration.isPressed ? 0.75 : 1))
            )
            .scaleEffect(configuration.isPressed ? 0.985 : 1)
            .animation(.easeOut(duration: 0.1), value: configuration.isPressed)
            // Held, not hidden: dimmed while it waits for its hardware.
            .opacity(isEnabled ? 1 : 0.35)
            .animation(.easeOut(duration: 0.2), value: isEnabled)
    }
}

/// Secondary action: inked outline on paper.
struct OutlineButtonStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(Theme.courier(12, .bold))
            .kerning(0.8)
            .foregroundStyle(Theme.ink)
            .padding(.vertical, 6)
            .padding(.horizontal, 26)
            .frame(minWidth: 150)
            .background(
                RoundedRectangle(cornerRadius: 3)
                    .stroke(Theme.ink.opacity(configuration.isPressed ? 0.4 : 0.8), lineWidth: 1.2)
            )
            .contentShape(RoundedRectangle(cornerRadius: 3))
            .opacity(configuration.isPressed ? 0.7 : 1)
    }
}

/// Inline checkbox in the page's own hand: a penciled box that takes a
/// brass check, with margin-note text. Defaults suit a footnote; pass a
/// larger size and ink when the choice is the point of the page.
struct MarginToggleStyle: ToggleStyle {
    var size: CGFloat = 10
    var color: Color = Theme.inkMuted

    func makeBody(configuration: Configuration) -> some View {
        Button {
            configuration.isOn.toggle()
        } label: {
            HStack(spacing: 6) {
                RoundedRectangle(cornerRadius: 2)
                    .stroke(Theme.inkFaint, lineWidth: 1.2)
                    .frame(width: size + 1, height: size + 1)
                    .overlay {
                        if configuration.isOn {
                            Image(systemName: "checkmark")
                                .font(.system(size: size - 2, weight: .heavy))
                                .foregroundStyle(Theme.brass)
                        }
                    }
                configuration.label
                    .font(Theme.courier(size))
                    .foregroundStyle(color)
            }
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }
}

/// Tertiary: bare caps text, like margin notes.
struct MarginButtonStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(Theme.courier(11, .bold))
            .kerning(0.6)
            .foregroundStyle(configuration.isPressed ? Theme.ink : Theme.inkMuted)
            .contentShape(Rectangle())
    }
}
