import SwiftUI
import AppKit
import ScreepubKit

/// Every version since the installed one, with the decision it informs kept
/// on the same surface. A popover was too narrow for prose and a second
/// window would have carried the notes away from the install button.
struct ReleaseNotesSheet: View {
    let update: AvailableUpdate
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        VStack(spacing: 0) {
            ScrollView {
                VStack(alignment: .leading, spacing: 22) {
                    ForEach(Array(update.notes.enumerated()), id: \.offset) { index, note in
                        // A version boundary has to read as unmistakably
                        // stronger than a paragraph-to-section gap inside
                        // one version (10 spacing + 6 top padding = 16):
                        // the rule, plus this same 22pt spacing landing on
                        // both sides of it, is what makes "a new release
                        // starts here" obvious at a glance. Not before the
                        // first version, which has nothing above it to
                        // separate from.
                        if index > 0 {
                            Rectangle()
                                .fill(Theme.inkFaint)
                                .frame(height: 1)
                        }
                        VStack(alignment: .leading, spacing: 10) {
                            Slugline(text: "SCREEPUB \(note.version)")
                            let blocks = ReleaseNotes.parse(note.markdown)
                            if blocks.isEmpty {
                                Text("No notes were published for this version.")
                                    .font(Theme.courier(11))
                                    .foregroundStyle(Theme.inkMuted)
                            } else {
                                ForEach(Array(blocks.enumerated()), id: \.offset) { _, block in
                                    blockView(block)
                                }
                            }
                        }
                    }
                }
                .padding(.horizontal, 30)
                .padding(.vertical, 24)
                .frame(maxWidth: .infinity, alignment: .leading)
            }

            Rectangle()
                .fill(Theme.inkFaint.opacity(0.35))
                .frame(height: 1)

            VStack(spacing: 9) {
                Button("INSTALL AND RELAUNCH") {
                    dismiss()
                    Task { await UpdateController.shared.install() }
                }
                .buttonStyle(BradButtonStyle())
                Button("NOT NOW") { dismiss() }
                    .buttonStyle(OutlineButtonStyle())
                    .keyboardShortcut(.cancelAction)
                // The escape hatch: anything the parser renders badly is
                // still one click from the source.
                Button("READ ON GITHUB") {
                    NSWorkspace.shared.open(update.releaseNotesURL)
                }
                .buttonStyle(MarginButtonStyle())
            }
            .padding(.vertical, 16)
        }
        .frame(width: 460, height: 520)
        .background(Theme.paper)
    }

    @ViewBuilder
    private func blockView(_ block: NoteBlock) -> some View {
        switch block {
        case .section(let text):
            Text(text.uppercased())
                .font(Theme.courier(11, .bold))
                .kerning(0.7)
                .foregroundStyle(Theme.inkMuted)
                .padding(.top, 6)

        case .bullet(let lead, let body):
            HStack(alignment: .firstTextBaseline, spacing: 7) {
                Text("\u{2022}")
                    .font(Theme.courier(12))
                    .foregroundStyle(Theme.inkMuted)
                    // Decorative: the lead/body text already carries the
                    // full meaning, so VoiceOver should not also speak
                    // "bullet" before every single item.
                    .accessibilityHidden(true)
                Group {
                    if let lead {
                        Text(lead).font(Theme.courier(12, .bold))
                            + Text(" " + body).font(Theme.courier(12))
                    } else {
                        Text(body).font(Theme.courier(12))
                    }
                }
                .foregroundStyle(Theme.ink)
                .lineSpacing(3)
                .fixedSize(horizontal: false, vertical: true)
            }

        case .paragraph(let text):
            Text(text)
                .font(Theme.courier(12))
                .foregroundStyle(Theme.ink)
                .lineSpacing(3)
                .fixedSize(horizontal: false, vertical: true)

        case .aside(let text):
            Text(text)
                .font(Theme.courier(11))
                .italic()
                .foregroundStyle(Theme.inkMuted)
                .lineSpacing(3)
                .fixedSize(horizontal: false, vertical: true)
                // Matches .section's top padding: without it the closing
                // footnote sits the same 10pt under the last bullet as any
                // other block and reads as one more oddly-styled list
                // item, not the document closer it actually is.
                .padding(.top, 6)
        }
    }
}
