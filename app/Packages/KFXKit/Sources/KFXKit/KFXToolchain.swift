import Foundation

/// Produce sideload-able KFX on macOS, with setup handled.
///
/// KFX is the format that gets Amazon's Enhanced Typesetting renderer on a
/// Kindle. That matters because renderer selection follows the FILE FORMAT,
/// not the delivery route: a sideloaded AZW3 is drawn by the legacy engine
/// (no keep support, no widow/orphan control), while a sideloaded KFX is
/// drawn by the modern one — device-verified 2026-07-29, same book both
/// ways on firmware 5.19.2.
///
/// The only KFX writer in existence is inside Amazon's Kindle Previewer, so
/// the chain is necessarily:
///
///   EPUB → Calibre's ebook-convert + jhowell's KFX Output plugin
///        → (plugin drives Kindle Previewer, headless, no sign-in)
///        → KPF → (plugin repacks) → .kfx
///
/// Division of labor: the USER installs Calibre and Kindle Previewer (both
/// free; we can't redistribute either). KFXKit carries the plugin zip and
/// installs it into the user's Calibre itself — that's `installPlugin()`,
/// the one step an app can take off the user's plate. Everything runs
/// locally; nothing in this chain touches the network.
/// A tool exited non-zero; `detail` is the tail of its stderr.
public struct ToolRunError: Error, Sendable { public let detail: String }

public enum KFXToolchain {

    // MARK: - Component discovery

    /// What's present on this machine. `pluginInstalled` is only meaningful
    /// when `calibre` is true (the plugin lives inside Calibre).
    public struct Status: Equatable, Sendable {
        public let calibre: Bool
        public let previewer: Bool
        public let pluginInstalled: Bool
        public var ready: Bool { calibre && previewer && pluginInstalled }
    }

    /// Blocking (spawns `calibre-customize` to list plugins, ~1s of Python
    /// startup) — call from a background task, never the main thread.
    nonisolated public static func status() -> Status {
        let calibre = calibreCustomizeURL() != nil
        return Status(
            calibre: calibre,
            previewer: previewerURL() != nil,
            pluginInstalled: calibre && pluginInstalled()
        )
    }

    nonisolated public static func previewerURL() -> URL? {
        existing("/Applications/Kindle Previewer 3.app")
    }

    /// One scanner for every Calibre CLI tool. The install locations are a
    /// single list here so `status().calibre` and EbookConvert's discovery
    /// can never disagree about whether Calibre exists.
    nonisolated public static func calibreTool(_ name: String) -> URL? {
        let candidates = [
            "/Applications/calibre.app/Contents/MacOS/\(name)",
            "/opt/homebrew/bin/\(name)",
            "/usr/local/bin/\(name)",
        ]
        for path in candidates where FileManager.default.isExecutableFile(atPath: path) {
            return URL(fileURLWithPath: path)
        }
        return nil
    }

    nonisolated public static func calibreCustomizeURL() -> URL? {
        calibreTool("calibre-customize")
    }

    nonisolated public static func ebookConvertURL() -> URL? {
        calibreTool("ebook-convert")
    }

    /// Where to send the user for the two pieces they install themselves.
    public static let calibreDownloadURL = URL(string: "https://calibre-ebook.com/download_osx")!
    public static let previewerDownloadURL = URL(string: "https://kdp.amazon.com/en_US/help/topic/G202131170")!

    // MARK: - Plugin

    /// Matches both jhowell's canonical name and known forks
    /// ("KFX Output (Fix Traditional Chinese)").
    private static let pluginMarker = "KFX Output"

    /// Blocking — see `status()`.
    nonisolated public static func pluginInstalled() -> Bool {
        guard let customize = calibreCustomizeURL(),
              let output = try? run(tool: customize, arguments: ["--list-plugins"]) else { return false }
        return output.contains(pluginMarker)
    }

    nonisolated public static func bundledPluginURL() -> URL? {
        Bundle.module.url(forResource: "Vendor/KFX_Output_plugin", withExtension: "zip")
            ?? Bundle.module.url(forResource: "KFX_Output_plugin", withExtension: "zip", subdirectory: "Vendor")
    }

    public enum SetupError: Error, LocalizedError {
        case calibreMissing
        case pluginResourceMissing
        case installFailed(String)

        public var errorDescription: String? {
            switch self {
            case .calibreMissing:
                return "Calibre isn't installed — it hosts the KFX plugin."
            case .pluginResourceMissing:
                return "The bundled KFX plugin is missing from this build."
            case .installFailed(let detail):
                return "Couldn't install the KFX plugin into Calibre: \(detail)"
            }
        }
    }

    /// Install the vendored plugin into the user's Calibre. Idempotent —
    /// `calibre-customize -a` replaces an existing copy. Blocking.
    nonisolated public static func installPlugin() throws {
        guard let customize = calibreCustomizeURL() else { throw SetupError.calibreMissing }
        guard let zip = bundledPluginURL() else { throw SetupError.pluginResourceMissing }
        do {
            _ = try run(tool: customize, arguments: ["-a", zip.path])
        } catch let error as ToolRunError {
            throw SetupError.installFailed(error.detail)
        }
        guard pluginInstalled() else {
            throw SetupError.installFailed("calibre-customize succeeded but the plugin doesn't list")
        }
    }

    // MARK: - Conversion

    public enum ConvertError: Error, LocalizedError {
        case toolchainNotReady(Status)
        case failed(String)

        public var errorDescription: String? {
            switch self {
            case .toolchainNotReady(let s):
                var missing: [String] = []
                if !s.calibre { missing.append("Calibre") }
                if !s.previewer { missing.append("Kindle Previewer") }
                if s.calibre && !s.pluginInstalled { missing.append("the KFX plugin") }
                return "KFX conversion needs \(missing.joined(separator: " and "))."
            case .failed(let detail):
                return "KFX conversion failed: \(detail)"
            }
        }
    }

    /// EPUB → sibling `.kfx`. Blocking and slow — measured 16–24s, and
    /// almost all of it is Kindle Previewer cold-starting, so short and
    /// long scripts cost about the same. Call from a background task.
    ///
    /// `onStage` fires on a background thread as the conversion crosses
    /// its phases — hop to the main actor before touching UI. Without it
    /// the 20-second wait is indistinguishable from a hang, which is why
    /// it exists.
    ///
    /// Flags mirror the AZW3 recipe and for the same reason: they stop
    /// Calibre's PREPROCESSING (which runs before any output plugin) from
    /// re-breaking scenes and stripping the dialogue column's margins. The
    /// 2026-07-29 device verdict was produced with this recipe.
    @discardableResult
    nonisolated public static func convert(
        _ epub: URL,
        precheckedReady: Bool = false,
        onStage: (@Sendable (String) -> Void)? = nil
    ) throws -> URL {
        // status() spawns calibre-customize (~1s); a caller that just
        // probed can vouch instead of paying for the same fact twice.
        if !precheckedReady {
            let current = status()
            guard current.ready else { throw ConvertError.toolchainNotReady(current) }
        }
        guard let tool = ebookConvertURL() else {
            throw ConvertError.toolchainNotReady(status())
        }
        let kfx = epub.deletingPathExtension().appendingPathExtension("kfx")
        var lineHandler: (@Sendable (String) -> Void)? = nil
        if let report = onStage {
            lineHandler = { line in
                if let named = stage(for: line) { report(named) }
            }
        }
        do {
            _ = try run(tool: tool, arguments: [
                epub.path, kfx.path,
                "--page-breaks-before=/",
                "--chapter-mark=none",
                "--disable-remove-fake-margins",
            ], onLine: lineHandler)
        } catch let error as ToolRunError {
            throw ConvertError.failed(error.detail)
        }
        guard FileManager.default.fileExists(atPath: kfx.path) else {
            throw ConvertError.failed("ebook-convert exited cleanly but produced no .kfx")
        }
        return kfx
    }

    /// Map ebook-convert's stdout to something a person waiting can read.
    /// The long silence lives inside "Running KFX Output" — that's the
    /// Previewer cold start — so that stage names the wait and its size.
    private nonisolated static func stage(for line: String) -> String? {
        if line.contains("Converting input") {
            return "preparing the book…"
        }
        if line.contains("Running transforms") {
            return "formatting for Kindle…"
        }
        if line.contains("Running KFX Output") || line.contains("Creating KFX Output") {
            return "Amazon's converter is running — usually about 20 seconds…"
        }
        if line.contains("converted EPUB to KPF") {
            return "repacking for the device…"
        }
        return nil
    }

    // MARK: - Process plumbing

    /// Line-buffers a pipe as data arrives, instead of after exit — the
    /// difference between progress and a post-mortem.
    private final class LineStream: @unchecked Sendable {
        private let lock = NSLock()
        private var buffer = Data()
        private(set) var all = Data()
        private let onLine: @Sendable (String) -> Void

        init(onLine: @escaping @Sendable (String) -> Void) {
            self.onLine = onLine
        }

        func consume(_ chunk: Data) {
            guard !chunk.isEmpty else { return }
            lock.lock()
            all.append(chunk)
            buffer.append(chunk)
            var lines: [String] = []
            while let nl = buffer.firstIndex(of: UInt8(ascii: "\n")) {
                let lineData = buffer.subdata(in: buffer.startIndex..<nl)
                buffer.removeSubrange(buffer.startIndex...nl)
                if let line = String(data: lineData, encoding: .utf8) { lines.append(line) }
            }
            lock.unlock()
            for line in lines { onLine(line) }
        }
    }

    /// Run a tool to completion, streaming stdout line-by-line as it
    /// arrives. Public because this is the package's one subprocess
    /// runner: it drains both pipes concurrently (a chatty child fills a
    /// 64KB pipe buffer and deadlocks against waitUntilExit otherwise),
    /// and callers should inherit that guard rather than re-derive it.
    @discardableResult
    public nonisolated static func run(
        tool: URL,
        arguments: [String],
        onLine: (@Sendable (String) -> Void)? = nil
    ) throws -> String {
        let process = Process()
        process.executableURL = tool
        process.arguments = arguments
        let out = Pipe(), err = Pipe()
        process.standardOutput = out
        process.standardError = err
        let stdout = LineStream(onLine: onLine ?? { _ in })
        let stderr = LineStream(onLine: { _ in })
        out.fileHandleForReading.readabilityHandler = { stdout.consume($0.availableData) }
        err.fileHandleForReading.readabilityHandler = { stderr.consume($0.availableData) }
        try process.run()
        process.waitUntilExit()
        out.fileHandleForReading.readabilityHandler = nil
        err.fileHandleForReading.readabilityHandler = nil
        // Handlers can lag exit; scoop whatever's left in the pipes.
        stdout.consume(out.fileHandleForReading.readDataToEndOfFile())
        stderr.consume(err.fileHandleForReading.readDataToEndOfFile())
        guard process.terminationStatus == 0 else {
            let detail = String(data: stderr.all, encoding: .utf8)?
                .trimmingCharacters(in: .whitespacesAndNewlines) ?? "no error output"
            throw ToolRunError(detail: String(detail.suffix(300)))
        }
        return String(data: stdout.all, encoding: .utf8) ?? ""
    }

    private nonisolated static func existing(_ path: String) -> URL? {
        FileManager.default.fileExists(atPath: path) ? URL(fileURLWithPath: path) : nil
    }
}
