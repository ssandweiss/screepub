import Foundation
import KFXKit

/// What a converted script can be saved as. Labeled by *purpose*, because
/// the file you email is not the file you sideload: Amazon stopped
/// accepting MOBI for Send to Kindle in 2022, while Kindles never index a
/// sideloaded EPUB.
public enum ExportFormat: Sendable {
    case epub
    case kindle

    /// The Kindle sideload ladder, best rung first: KFX (Enhanced
    /// Typesetting — keeps hold, device-verified 2026-07-29) when the full
    /// toolchain is present; AZW3 with Calibre alone; the engine's own
    /// MOBI with nothing. Registry §8b has the verdict behind the order.
    public func fileExtension(calibreAvailable: Bool, kfxReady: Bool = false) -> String {
        switch self {
        case .epub:   return "epub"
        case .kindle: return kfxReady ? "kfx" : calibreAvailable ? "azw3" : "mobi"
        }
    }

    public func label(calibreAvailable: Bool, kfxReady: Bool = false) -> String {
        switch self {
        case .epub:
            return "EPUB — for emailing to Kindle, and most e-readers"
        case .kindle:
            let ext = fileExtension(calibreAvailable: calibreAvailable, kfxReady: kfxReady)
            let hint = kfxReady ? " (best quality)" : ""
            return "\(ext.uppercased()) — for USB sideload to Kindle\(hint)"
        }
    }
}

public enum Export {
    /// The sibling `.mobi` for a given EPUB — same directory, same stem.
    /// Shared by `available(for:)` and `freshKindleArtifact` so the
    /// derivation lives in exactly one place; call sites go through those
    /// two rather than deriving the path themselves.
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
    /// derives from. What it catches is a run that rewrote the EPUB but
    /// produced no new `.mobi` beside it — a re-conversion WITHOUT
    /// `--mobi`, which leaves the previous `.mobi` untouched, or one that
    /// died after the EPUB and before the `.mobi`. It says nothing about a
    /// half-written `.mobi`: cli.ts writes the EPUB first and the `.mobi`
    /// second, each to a temp file it then renames into place, so a
    /// partial `.mobi` never appears at the final path in the first
    /// place. Ties
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
        calibreAvailable: Bool,
        kfxReady: Bool = false,
        onStage: (@Sendable (String) -> Void)? = nil
    ) throws -> URL {
        if kfxReady {
            return try KFXToolchain.convert(epub, onStage: onStage)
        }
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
