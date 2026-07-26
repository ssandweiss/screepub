import Foundation

/// What a converted script can be saved as. Labeled by *purpose*, because
/// the file you email is not the file you sideload: Amazon stopped
/// accepting MOBI for Send to Kindle in 2022, while Kindles never index a
/// sideloaded EPUB.
public enum ExportFormat: Sendable {
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
    /// The sibling `.mobi` for a given EPUB — same directory, same stem.
    /// Shared by `available(for:)` and `freshKindleArtifact` (and by UI
    /// call sites) so the derivation lives in exactly one place.
    nonisolated public static func mobiSibling(for epub: URL) -> URL {
        epub.deletingPathExtension().appendingPathExtension("mobi")
    }

    /// EPUB is always available (it is the conversion's primary output).
    /// The Kindle format needs either Calibre (converts from the current
    /// EPUB) or an already-built .mobi to refresh.
    nonisolated public static func available(for epub: URL,
                                             calibreAvailable: Bool) -> [ExportFormat] {
        var formats: [ExportFormat] = [.epub]
        if calibreAvailable || FileManager.default.fileExists(atPath: mobiSibling(for: epub).path) {
            formats.append(.kindle)
        }
        return formats
    }

    /// True when `artifact` is missing, or no newer than the EPUB it
    /// derives from. This catches a MOBI write that failed partway
    /// through, and a re-conversion run WITHOUT `--mobi`, which rewrites
    /// the EPUB and leaves the previous `.mobi` behind untouched. Ties
    /// count as stale (not fresh): `copyItem`, `rsync -t`, Time Machine
    /// restores, and archive extraction can all reproduce identical
    /// mtimes, and an unreadable EPUB mtime (deleted, unmounted, no
    /// permission) is treated as "definitely stale" rather than silently
    /// passing as fresh.
    nonisolated public static func needsRegeneration(_ artifact: URL,
                                                     freshRelativeTo epub: URL) -> Bool {
        let fm = FileManager.default
        guard fm.fileExists(atPath: artifact.path) else { return true }
        func modificationDate(_ url: URL, ifUnknown fallback: Date) -> Date {
            (try? fm.attributesOfItem(atPath: url.path)[.modificationDate] as? Date) ?? fallback
        }
        // Artifact side fails closed toward "regenerate" via .distantPast;
        // the EPUB side must fail closed the OTHER way — .distantFuture —
        // or an unreadable EPUB would compare as older than everything and
        // a stale artifact would be reported fresh.
        let artifactDate = modificationDate(artifact, ifUnknown: .distantPast)
        let epubDate = modificationDate(epub, ifUnknown: .distantFuture)
        return artifactDate <= epubDate
    }

    public enum ExportError: Error, LocalizedError {
        case cannotRegenerate
        case regenerationFailed(String)
        public var errorDescription: String? {
            switch self {
            case .cannotRegenerate:
                return "Can't rebuild the Kindle file — the script's .fountain is missing."
            case .regenerationFailed(let why):
                return "Couldn't rebuild the Kindle file: \(why)"
            }
        }
    }

    /// A Kindle-format file guaranteed current with `epub`.
    /// Calibre converts straight from the present EPUB, so that branch is
    /// fresh by construction; the MOBI branch re-runs the engine only when
    /// the staleness rule says the file is out of date.
    ///
    /// Note: the MOBI branch calls `Engine.convert`, which rewrites
    /// `epub` in place before it writes the `.mobi` beside it (see
    /// cli.ts) — this function can therefore mutate the EPUB it was
    /// handed, not just produce the Kindle file.
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
        let mobi = mobiSibling(for: epub)
        guard needsRegeneration(mobi, freshRelativeTo: epub) else { return mobi }
        guard let fountainPath else { throw ExportError.cannotRegenerate }
        let result = try Engine.convert(
            input: URL(fileURLWithPath: fountainPath),
            force: false,
            outputDir: epub.deletingLastPathComponent(),
            format: format,
            includeMobi: true
        )
        guard result.ok else {
            throw ExportError.regenerationFailed(result.error?.message ?? "engine error")
        }
        guard let mobiPath = result.mobiPath, FileManager.default.fileExists(atPath: mobiPath) else {
            throw ExportError.regenerationFailed("engine reported success but produced no .mobi")
        }
        return URL(fileURLWithPath: mobiPath)
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
