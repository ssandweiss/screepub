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

    /// True when `artifact` is missing or older than the EPUB it derives
    /// from. Reader re-renders rewrite only the EPUB, so a previously
    /// built .mobi silently goes out of date.
    nonisolated public static func needsRegeneration(_ artifact: URL,
                                                     freshRelativeTo epub: URL) -> Bool {
        let fm = FileManager.default
        guard fm.fileExists(atPath: artifact.path) else { return true }
        let mtime: (URL) -> Date = { url in
            (try? fm.attributesOfItem(atPath: url.path)[.modificationDate] as? Date) ?? .distantPast
        }
        return mtime(artifact) < mtime(epub)
    }

    public enum ExportError: Error, LocalizedError {
        case cannotRegenerate
        public var errorDescription: String? {
            "Can't rebuild the Kindle file — the script's .fountain is missing."
        }
    }

    /// A Kindle-format file guaranteed current with `epub`.
    /// Calibre converts straight from the present EPUB, so that branch is
    /// fresh by construction; the MOBI branch re-runs the engine only when
    /// the staleness rule says the file is out of date.
    ///
    /// Blocking (spawns Calibre or the engine) — call off the main thread.
    /// `format` must be the script's real settings, not `.defaults`, or the
    /// export silently loses the user's tuned formatting.
    nonisolated public static func freshKindleArtifact(
        for epub: URL,
        fountainPath: String?,
        format: FormatSettings,
        calibreAvailable: Bool
    ) throws -> URL {
        if calibreAvailable {
            return try EbookConvert.toAzw3(epub)
        }
        let mobi = epub.deletingPathExtension().appendingPathExtension("mobi")
        guard needsRegeneration(mobi, freshRelativeTo: epub) else { return mobi }
        guard let fountainPath else { throw ExportError.cannotRegenerate }
        _ = try Engine.convert(
            input: URL(fileURLWithPath: fountainPath),
            force: false,
            outputDir: epub.deletingLastPathComponent(),
            format: format,
            includeMobi: true
        )
        return mobi
    }

    /// Copy a produced artifact to the user's chosen destination,
    /// replacing whatever is there.
    nonisolated public static func copy(_ source: URL, to destination: URL) throws {
        let fm = FileManager.default
        if fm.fileExists(atPath: destination.path) {
            try fm.removeItem(at: destination)
        }
        try fm.copyItem(at: source, to: destination)
    }
}
