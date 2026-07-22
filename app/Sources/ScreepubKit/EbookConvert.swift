import Foundation

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

    nonisolated public static func toolURL() -> URL? {
        let candidates = [
            "/Applications/calibre.app/Contents/MacOS/ebook-convert",
            "/opt/homebrew/bin/ebook-convert",
            "/usr/local/bin/ebook-convert",
        ]
        for path in candidates where FileManager.default.isExecutableFile(atPath: path) {
            return URL(fileURLWithPath: path)
        }
        return nil
    }

    nonisolated public static var isAvailable: Bool { toolURL() != nil }

    /// Convert an EPUB to AZW3 next to it. Reuses an existing .azw3 that is
    /// newer than the EPUB. Blocking — call from a background task.
    @discardableResult
    nonisolated public static func toAzw3(_ epub: URL) throws -> URL {
        guard let tool = toolURL() else { throw ConvertError.calibreMissing }
        let azw3 = epub.deletingPathExtension().appendingPathExtension("azw3")

        let fm = FileManager.default
        if fm.fileExists(atPath: azw3.path),
           let azw3Date = try? azw3.resourceValues(forKeys: [.contentModificationDateKey]).contentModificationDate,
           let epubDate = try? epub.resourceValues(forKeys: [.contentModificationDateKey]).contentModificationDate,
           azw3Date > epubDate {
            return azw3
        }

        let process = Process()
        process.executableURL = tool
        process.arguments = [epub.path, azw3.path]
        let stderr = Pipe()
        process.standardOutput = Pipe()
        process.standardError = stderr
        try process.run()
        process.waitUntilExit()

        guard process.terminationStatus == 0, fm.fileExists(atPath: azw3.path) else {
            let detail = String(data: stderr.fileHandleForReading.readDataToEndOfFile(), encoding: .utf8)?
                .trimmingCharacters(in: .whitespacesAndNewlines) ?? "no error output"
            throw ConvertError.failed(String(detail.suffix(300)))
        }
        return azw3
    }
}
