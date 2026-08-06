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
        // CRLF is NOT one separator to components(separatedBy: .newlines) —
        // it splits \r and \n independently, so every real CRLF line break
        // yields a phantom empty string that the blank-line rule below
        // reads as a block break mid-sentence. Normalize once, up front,
        // rather than guard every call site downstream.
        let normalized = markdown.replacingOccurrences(of: "\r\n", with: "\n")

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
            // Reset before the emptiness guard below: an early return here
            // must not leave a stale pending/pendingIsBullet for the NEXT
            // flush() call to inherit.
            pending = []
            pendingIsBullet = false
            guard !text.isEmpty else { return }

            if wasBullet {
                let (lead, body) = splitLead(text)
                // Re-check AFTER splitLead/unemphasize strip markdown: a
                // markdown-only line like "**" or "****" is non-empty going
                // in but empty coming out, and must emit no block either way.
                guard !(lead ?? "").isEmpty || !body.isEmpty else { return }
                blocks.append(.bullet(lead: lead, body: body))
            } else if let inner = wholeItalic(text) {
                guard !inner.isEmpty else { return }
                blocks.append(.aside(inner))
            } else {
                let paragraph = unemphasize(text)
                guard !paragraph.isEmpty else { return }
                blocks.append(.paragraph(paragraph))
            }
        }

        for raw in normalized.components(separatedBy: .newlines) {
            let line = stripHTMLComments(raw).trimmingCharacters(in: .whitespaces)

            // release.yml appends a machine-generated trailer to the
            // committed notes before publishing them as the GitHub release
            // body: "\n\n---\n\n", then an install paragraph and a fenced
            // SHA-256 block (see the "Publish GitHub Release" step in
            // .github/workflows/release.yml). That trailer is process
            // furniture, not authored prose — the same class of thing as
            // the `# ` title or an `<!-- ... -->` marker below — so a line
            // that is exactly `---` ends the document here: flush whatever
            // is pending and stop, dropping everything after it.
            if line == "---" { flush(); break }

            // A bare bullet marker with nothing after it ("- ", which trims
            // to "-") is content-free: treat it like a blank line rather
            // than let it fall through to a stray "-" paragraph.
            if line.isEmpty || line == "-" { flush(); continue }
            if line.hasPrefix("## ") {
                flush()
                blocks.append(.section(unemphasize(String(line.dropFirst(3)))))
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
        // An empty extracted lead ("****") is the same as no lead at all —
        // never return a non-nil-but-empty lead for a view to branch on.
        return (lead.isEmpty ? nil : lead, unemphasize(rest))
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

    /// Removes `<!-- ... -->` spans, such as the template's
    /// `<!-- caveat: registry-17 -->` markers. GitHub hides these because it
    /// renders markdown to HTML, where a comment is invisible; our sheet
    /// renders these blocks as plain SwiftUI Text, not HTML, so a marker
    /// left in would show up to the reader as literal `<!-- ... -->`. A
    /// marker is punctuation for the release process, not prose the reader
    /// is meant to see, so dropping it is the same call as dropping the `#`
    /// title, not a violation of "no text lost".
    ///
    /// Single-line only, applied per physical line before it is classified:
    /// the documented convention always places a marker at the end of one
    /// line, so this covers the real case without contorting the parser for
    /// a comment spanning multiple lines.
    private static func stripHTMLComments(_ line: String) -> String {
        guard line.contains("<!--") else { return line }
        var result = ""
        var remainder = Substring(line)
        while let open = remainder.range(of: "<!--") {
            result += remainder[remainder.startIndex..<open.lowerBound]
            if let close = remainder.range(of: "-->", range: open.upperBound..<remainder.endIndex) {
                remainder = remainder[close.upperBound...]
            } else {
                // Unterminated on this line: drop the rest rather than leak
                // a dangling "<!--".
                remainder = remainder[remainder.endIndex...]
            }
        }
        result += remainder
        return result
    }
}
