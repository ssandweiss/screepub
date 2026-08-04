import Foundation

/// One piece of a release note. The set is deliberately small: it covers
/// exactly what docs/release-notes-template.md produces.
public enum NoteBlock: Equatable, Sendable {
    case section(String)
    case bullet(lead: String?, body: String)
    case paragraph(String)
    case aside(String)
}

/// Turns a published release body into blocks the app can set in its own
/// type. Not a general markdown parser and not trying to be: the notes have
/// a fixed shape that CI enforces.
///
/// The invariant that matters: a line matching no rule becomes a paragraph
/// verbatim. Unknown syntax may render plainly, but it never disappears.
public enum ReleaseNotes {
    public static func parse(_ markdown: String) -> [NoteBlock] {
        var blocks: [NoteBlock] = []
        var pending: [String] = []
        var pendingIsBullet = false

        func flush() {
            guard !pending.isEmpty else { return }
            // Notes are hard-wrapped at 72 columns in the repo; joining lets
            // them reflow at whatever width the sheet is.
            let text = pending.joined(separator: " ")
                .trimmingCharacters(in: .whitespaces)
            let wasBullet = pendingIsBullet
            pending = []
            pendingIsBullet = false
            guard !text.isEmpty else { return }

            if wasBullet {
                let (lead, body) = splitLead(text)
                blocks.append(.bullet(lead: lead, body: body))
            } else if let inner = wholeItalic(text) {
                blocks.append(.aside(inner))
            } else {
                blocks.append(.paragraph(unemphasize(text)))
            }
        }

        for raw in markdown.components(separatedBy: .newlines) {
            let line = raw.trimmingCharacters(in: .whitespaces)

            if line.isEmpty { flush(); continue }
            if line.hasPrefix("## ") {
                flush()
                blocks.append(.section(String(line.dropFirst(3))))
                continue
            }
            // The sheet prints the version itself, so the title would double.
            if line.hasPrefix("# ") { flush(); continue }
            if line.hasPrefix("- ") {
                flush()
                pendingIsBullet = true
                pending.append(String(line.dropFirst(2)))
                continue
            }
            pending.append(line)
        }
        flush()
        return blocks
    }

    /// "**Lead.** rest" -> ("Lead.", "rest"). Anything else has no lead.
    private static func splitLead(_ text: String) -> (String?, String) {
        guard text.hasPrefix("**") else { return (nil, unemphasize(text)) }
        let afterOpen = text.index(text.startIndex, offsetBy: 2)
        guard let close = text.range(of: "**", range: afterOpen..<text.endIndex) else {
            return (nil, unemphasize(text))
        }
        let lead = String(text[afterOpen..<close.lowerBound])
        let rest = String(text[close.upperBound...])
            .trimmingCharacters(in: .whitespaces)
        return (lead, unemphasize(rest))
    }

    /// A paragraph that is italic end to end, which is how the notes carry
    /// their closing footnote.
    private static func wholeItalic(_ text: String) -> String? {
        guard text.count > 2,
              text.hasPrefix("*"), text.hasSuffix("*"),
              !text.hasPrefix("**") else { return nil }
        let inner = String(text.dropFirst().dropLast())
        guard !inner.contains("*") else { return nil }
        return inner
    }

    /// The sheet styles a bullet's lead itself, so inline bold is flattened
    /// rather than half-rendered. A stray asterisk reads worse than none.
    private static func unemphasize(_ text: String) -> String {
        text.replacingOccurrences(of: "**", with: "")
    }
}
