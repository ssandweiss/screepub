import SwiftUI
import ScreepubKit

/// Live miniature of the EPUB layout, driven by the same @AppStorage keys
/// as the Formatting controls — it mirrors the engine's CSS math
/// (src/epub/css.ts): % side margins on the dialogue column, % indents (or
/// centering) within it, em vertical rhythm. Sample text is ORIGINAL
/// classic-noir pastiche — real classic scripts are copyrighted and this
/// repo is headed public.
struct LayoutPreview: View {
    @AppStorage("fmtDialogueMargin") private var dialogueMargin = 20.0
    @AppStorage("fmtCueIndent") private var cueIndent = 33.0
    @AppStorage("fmtParenIndent") private var parenIndent = 17.0
    @AppStorage("fmtSpacing") private var spacing = 1.0
    @AppStorage("fmtFont") private var font = "courier"
    @AppStorage("fmtCueAlign") private var cueAlign = "centered"
    @AppStorage("fmtContd") private var contd = "auto"
    @AppStorage("fmtScenePageBreaks") private var scenePageBreaks = false
    @AppStorage("fmtSceneNumbers") private var sceneNumbers = false
    @AppStorage("fmtPageMarkers") private var pageMarkers = false

    private let base: CGFloat = 10.5 // preview "1em" in points

    private func bodyFont(_ size: CGFloat, bold: Bool = false) -> Font {
        switch font {
        case "serif": return .system(size: size, weight: bold ? .bold : .regular, design: .serif)
        case "sans": return .system(size: size, weight: bold ? .bold : .regular)
        default: return Theme.courier(size, bold ? .bold : .regular)
        }
    }

    private var gap: CGFloat { base * spacing }

    var body: some View {
        GeometryReader { geo in
            let W = geo.size.width - 24 // page padding
            let sideMargin = W * dialogueMargin / 100
            let blockW = W - sideMargin * 2

            ScrollView(.vertical) {
                VStack(alignment: .leading, spacing: 0) {
                    if pageMarkers {
                        Text("12.")
                            .font(bodyFont(base * 0.75))
                            .foregroundStyle(Theme.inkFaint)
                            .frame(maxWidth: .infinity, alignment: .trailing)
                            .padding(.bottom, gap)
                    }

                    heading("INT. MIDNIGHT OFFICE - NIGHT")
                    action("Rain hammers the window. A desk lamp burns low over a stack of unsolved rewrites.")

                    speech(cue: "DETECTIVE VERA",
                           paren: "(lighting a match)",
                           lines: ["Somebody re-paginated this town while we slept."],
                           blockW: blockW, sideMargin: sideMargin)

                    action("The match gutters out. She flips the script to its final page.")

                    if contd != "strip" {
                        speech(cue: "DETECTIVE VERA (CONT'D)",
                               paren: nil,
                               lines: ["And I intend to read every draft."],
                               blockW: blockW, sideMargin: sideMargin)
                    } else {
                        speech(cue: "DETECTIVE VERA",
                               paren: nil,
                               lines: ["And I intend to read every draft."],
                               blockW: blockW, sideMargin: sideMargin)
                    }

                    Text("CUT TO:")
                        .font(bodyFont(base, bold: true))
                        .foregroundStyle(Theme.ink)
                        .frame(maxWidth: .infinity, alignment: .trailing)
                        .padding(.top, gap)

                    if scenePageBreaks {
                        Rectangle()
                            .fill(Theme.inkFaint)
                            .frame(height: 0.8)
                            .padding(.vertical, gap)
                            .overlay(
                                Text("new page")
                                    .font(bodyFont(base * 0.7))
                                    .foregroundStyle(Theme.inkFaint)
                                    .padding(.horizontal, 4)
                                    .background(Theme.paper)
                            )
                    }

                    heading("EXT. PRINTING PRESS - DAWN")
                    action("The presses roll. Somewhere, a Kindle wakes.")
                }
                .padding(12)
            }
            .background(Theme.paper)
            .clipShape(RoundedRectangle(cornerRadius: 6))
            .overlay(
                RoundedRectangle(cornerRadius: 6)
                    .stroke(Theme.inkFaint.opacity(0.35), lineWidth: 1)
            )
        }
    }

    private func heading(_ text: String) -> some View {
        HStack(spacing: 4) {
            if sceneNumbers {
                Text("12").font(bodyFont(base)).foregroundStyle(Theme.inkFaint)
            }
            Text(text).font(bodyFont(base, bold: true)).foregroundStyle(Theme.ink)
        }
        .padding(.top, gap * 1.6)
        .padding(.bottom, gap)
    }

    private func action(_ text: String) -> some View {
        Text(text)
            .font(bodyFont(base))
            .foregroundStyle(Theme.ink)
            .lineSpacing(2)
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.vertical, gap / 2)
    }

    @ViewBuilder
    private func speech(cue: String, paren: String?, lines: [String], blockW: CGFloat, sideMargin: CGFloat) -> some View {
        VStack(alignment: .leading, spacing: 1) {
            if cueAlign == "centered" {
                Text(cue).font(bodyFont(base, bold: true)).foregroundStyle(Theme.ink)
                    .frame(width: blockW, alignment: .center)
                if let paren {
                    Text(paren).font(bodyFont(base)).foregroundStyle(Theme.inkFaint)
                        .frame(width: blockW, alignment: .center)
                }
            } else {
                Text(cue).font(bodyFont(base, bold: true)).foregroundStyle(Theme.ink)
                    .padding(.leading, blockW * cueIndent / 100)
                if let paren {
                    Text(paren).font(bodyFont(base)).foregroundStyle(Theme.inkFaint)
                        .padding(.leading, blockW * parenIndent / 100)
                }
            }
            ForEach(lines, id: \.self) { line in
                Text(line).font(bodyFont(base)).foregroundStyle(Theme.ink).lineSpacing(2)
                    .frame(width: blockW, alignment: .leading)
            }
        }
        .frame(width: blockW, alignment: .leading)
        .padding(.leading, sideMargin)
        .padding(.vertical, gap / 2)
    }
}
