import Foundation
import KFXKit

/// EPUB → AZW3 via Calibre's ebook-convert. Kindles do NOT index sideloaded
/// EPUBs — a USB copy must be AZW3 (Calibre's "Send to Device" does exactly
/// this conversion first; Send-to-Kindle email/web converts server-side).
public enum EbookConvert {
    public enum ConvertError: Error, LocalizedError {
        case calibreMissing
        case failed(String)

        public var errorDescription: String? {
            switch self {
            case .calibreMissing:
                return "Calibre's ebook-convert was not found."
            case .failed(let detail):
                return "ebook-convert failed: \(detail)"
            }
        }
    }

    /// Delegates to KFXKit's single Calibre-location scanner so this and
    /// KFXToolchain.status() can never disagree about Calibre's presence.
    nonisolated public static func toolURL() -> URL? {
        KFXToolchain.calibreTool("ebook-convert")
    }

    nonisolated public static var isAvailable: Bool { toolURL() != nil }

    /// Calibre would otherwise undo two Screepub decisions during EPUB→AZW3:
    /// it inserts page-break-before on every h2 (scene-per-page again), and
    /// its remove-fake-margins heuristic sees side margins on most blocks —
    /// which is what a screenplay's dialogue column looks like — and deletes
    /// them as "publisher page margins", regardless of unit (% or em), so
    /// dialogue collapses to full width on device. (--extra-css is no rescue:
    /// on multi-file EPUBs Calibre attaches it only to its generated inline
    /// ToC, never to the script body.)

    /// Convert an EPUB to AZW3 next to it (~1s; no caching — a stale cache
    /// would outlive conversion-recipe changes). Blocking — call from a
    /// background task.
    @discardableResult
    nonisolated public static func toAzw3(_ epub: URL) throws -> URL {
        guard let tool = toolURL() else { throw ConvertError.calibreMissing }
        let azw3 = epub.deletingPathExtension().appendingPathExtension("azw3")
        do {
            _ = try KFXToolchain.run(tool: tool, arguments: [
                epub.path, azw3.path,
                "--page-breaks-before=/",
                "--chapter-mark=none",
                "--disable-remove-fake-margins",
            ])
        } catch let error as ToolRunError {
            throw ConvertError.failed(error.detail)
        }
        guard FileManager.default.fileExists(atPath: azw3.path) else {
            throw ConvertError.failed("ebook-convert exited cleanly but produced no .azw3")
        }
        return azw3
    }

    /// Convert an EPUB to KEPUB next to it (Calibre 7.1+ emits KEPUB with
    /// sentence-level koboSpan markup when the output extension is .kepub).
    /// The Kobo renderer selects on the double extension, so the result is
    /// renamed to `<name>.kepub.epub`. Blocking — call from a background
    /// task.
    @discardableResult
    nonisolated public static func toKepub(_ epub: URL) throws -> URL {
        guard let tool = toolURL() else { throw ConvertError.calibreMissing }
        let base = epub.deletingPathExtension()
        let raw = base.appendingPathExtension("kepub")
        let kepub = URL(fileURLWithPath: base.path + ".kepub.epub")
        do {
            _ = try KFXToolchain.run(tool: tool, arguments: [epub.path, raw.path])
        } catch let error as ToolRunError {
            throw ConvertError.failed(error.detail)
        }
        guard FileManager.default.fileExists(atPath: raw.path) else {
            throw ConvertError.failed("ebook-convert exited cleanly but produced no .kepub")
        }
        if FileManager.default.fileExists(atPath: kepub.path) {
            try FileManager.default.removeItem(at: kepub)
        }
        try FileManager.default.moveItem(at: raw, to: kepub)
        return kepub
    }
}
