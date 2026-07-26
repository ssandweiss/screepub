import Foundation

/// What a converted script can be saved as. Labeled by *purpose*, because
/// the file you email is not the file you sideload: Amazon stopped
/// accepting MOBI for Send to Kindle in 2022, while Kindles never index a
/// sideloaded EPUB.
public enum ExportFormat: String, CaseIterable, Sendable {
    case epub
    case kindle

    /// Kindle resolves the same way the USB route does — AZW3 via Calibre
    /// when installed, else the engine's own MOBI.
    public func fileExtension(calibreAvailable: Bool) -> String {
        switch self {
        case .epub:   return "epub"
        case .kindle: return calibreAvailable ? "azw3" : "mobi"
        }
    }

    public func label(calibreAvailable: Bool) -> String {
        switch self {
        case .epub:
            return "EPUB — for emailing to Kindle, and most e-readers"
        case .kindle:
            return "\(fileExtension(calibreAvailable: calibreAvailable).uppercased()) — for USB sideload to Kindle"
        }
    }
}

public enum Export {
    /// EPUB is always available (it is the conversion's primary output).
    /// The Kindle format needs either Calibre (converts from the current
    /// EPUB) or an already-built .mobi to refresh.
    nonisolated public static func available(for epub: URL,
                                             calibreAvailable: Bool) -> [ExportFormat] {
        var formats: [ExportFormat] = [.epub]
        let mobi = epub.deletingPathExtension().appendingPathExtension("mobi")
        if calibreAvailable || FileManager.default.fileExists(atPath: mobi.path) {
            formats.append(.kindle)
        }
        return formats
    }
}
