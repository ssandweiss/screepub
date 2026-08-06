import Foundation

/// Result contract of `screepub --json` (see src/cli.ts).
public struct EngineResult: Codable, Sendable {
    public struct EngineError: Codable, Sendable {
        public let code: String
        public let message: String
    }

    public let ok: Bool
    public let title: String?
    public let author: String?
    public let pages: Int?
    public let scenes: Int?
    public let characters: Int?
    public let topCharacters: [String]?
    public let warnings: [String]?
    public let epubPath: String?
    public let mobiPath: String?
    public let fountainPath: String?
    public let previewHtmlPath: String?
    public let debugPath: String?
    public let error: EngineError?
}

public enum EngineFailure: Error, LocalizedError {
    case notFound
    case badOutput(String)
    case cancelled

    public var errorDescription: String? {
        switch self {
        case .notFound: return "screepub-engine is missing from the app bundle."
        case .badOutput(let detail): return detail
        case .cancelled: return "Conversion cancelled."
        }
    }
}

/// One stage the engine reports while converting. Mirrors `ConvertStage` in
/// src/convert.ts; anything unrecognized is ignored rather than fataled, so
/// adding a stage engine-side cannot break an older app.
public enum ConvertStage: String, Sendable {
    case parse
    case render
}

/// Handle for a conversion in flight. `Engine.convert` runs a subprocess and
/// blocks, so cancellation cannot be a `Task.isCancelled` check inside the
/// call: the blocking read never returns on its own. The caller holds this,
/// and `cancel()` terminates the child, which unblocks the read.
public final class ConversionControl: @unchecked Sendable {
    private let lock = NSLock()
    private var process: Process?
    private var cancelledFlag = false

    public init() {}

    public var isCancelled: Bool {
        lock.lock(); defer { lock.unlock() }
        return cancelledFlag
    }

    /// Terminates the running child, if any. Safe to call before the process
    /// exists: the flag is checked at adopt time, so a cancel that lands in
    /// the window between `run()` and `adopt()` still takes effect.
    public func cancel() {
        lock.lock()
        cancelledFlag = true
        let running = process
        lock.unlock()
        running?.terminate()
    }

    /// Returns false when cancel() already fired, meaning the caller should
    /// terminate immediately rather than wait for a conversion nobody wants.
    fileprivate func adopt(_ p: Process) -> Bool {
        lock.lock(); defer { lock.unlock() }
        guard !cancelledFlag else { return false }
        process = p
        return true
    }
}

/// Splits the engine's stderr into whole lines, routes `{"progress":…}` to
/// the callback, and keeps everything else as the diagnostic tail used when
/// stdout fails to decode. Fed from a `readabilityHandler`, so every touch of
/// its state is behind a lock.
private final class StderrSink: @unchecked Sendable {
    private struct Line: Decodable {
        struct Progress: Decodable {
            let stage: String
            let percent: Double
        }
        let progress: Progress
    }

    private let lock = NSLock()
    private var pending = Data()
    private var other: [String] = []
    private let onProgress: (@Sendable (ConvertStage, Double) -> Void)?

    init(onProgress: (@Sendable (ConvertStage, Double) -> Void)?) {
        self.onProgress = onProgress
    }

    func feed(_ chunk: Data) {
        lock.lock()
        pending.append(chunk)
        var complete: [Data] = []
        // A chunk boundary can land mid-line, so only whole lines are
        // parsed and the remainder stays buffered for the next chunk.
        while let nl = pending.firstIndex(of: UInt8(ascii: "\n")) {
            complete.append(pending[pending.startIndex..<nl])
            pending = pending[pending.index(after: nl)...]
        }
        var toReport: [(ConvertStage, Double)] = []
        for raw in complete {
            if let line = try? JSONDecoder().decode(Line.self, from: raw),
               let stage = ConvertStage(rawValue: line.progress.stage) {
                toReport.append((stage, line.progress.percent / 100))
            } else if let text = String(data: raw, encoding: .utf8),
                      !text.trimmingCharacters(in: .whitespaces).isEmpty {
                other.append(text)
            }
        }
        lock.unlock()
        // Outside the lock: the callback hops to the main actor and must not
        // be able to deadlock against another chunk arriving.
        for (stage, fraction) in toReport { onProgress?(stage, fraction) }
    }

    /// Everything stderr said that was not progress, for the failure path.
    func tail() -> String {
        lock.lock(); defer { lock.unlock() }
        var lines = other
        if let leftover = String(data: pending, encoding: .utf8),
           !leftover.trimmingCharacters(in: .whitespaces).isEmpty {
            lines.append(leftover)
        }
        return lines.joined(separator: "\n").trimmingCharacters(in: .whitespacesAndNewlines)
    }
}

public enum Engine {
    /// Locate the sidecar: bundled Resources first, then the dev fallback
    /// (running via `swift run` from the repo).
    nonisolated public static func binaryURL() -> URL? {
        if let bundled = Bundle.main.resourceURL?.appendingPathComponent("screepub-engine"),
           FileManager.default.isExecutableFile(atPath: bundled.path) {
            return bundled
        }
        let dev = URL(fileURLWithPath: #filePath) // app/Sources/ScreepubKit/Engine.swift
            .deletingLastPathComponent()
            .deletingLastPathComponent()
            .deletingLastPathComponent()
            .appendingPathComponent("build/screepub-engine")
        if FileManager.default.isExecutableFile(atPath: dev.path) {
            return dev
        }
        return nil
    }

    /// Run a conversion. Blocking — call from a background task.
    /// Outputs (.epub/.mobi/.fountain) land in `outputDir` (created on
    /// demand); formatting knobs travel as a temp --options JSON.
    nonisolated public static func convert(
        input: URL,
        force: Bool,
        outputDir: URL,
        format: FormatSettings = .defaults,
        includeMobi: Bool = true,
        previewHtml: URL? = nil,
        control: ConversionControl? = nil,
        onProgress: (@Sendable (ConvertStage, Double) -> Void)? = nil
    ) throws -> EngineResult {
        guard let engine = binaryURL() else { throw EngineFailure.notFound }

        try FileManager.default.createDirectory(at: outputDir, withIntermediateDirectories: true)
        let stem = input.deletingPathExtension().lastPathComponent
        let output = outputDir.appendingPathComponent(stem).appendingPathExtension("epub")

        let optionsFile = FileManager.default.temporaryDirectory
            .appendingPathComponent("screepub-options-\(UUID().uuidString).json")
        try JSONEncoder().encode(format).write(to: optionsFile)
        defer { try? FileManager.default.removeItem(at: optionsFile) }

        var args = [input.path, "-o", output.path, "--json", "--options", optionsFile.path]
        if includeMobi { args.append("--mobi") }
        if let previewHtml { args.append(contentsOf: ["--preview-html", previewHtml.path]) }
        if force { args.append("--force") }
        if onProgress != nil { args.append("--progress") }

        let process = Process()
        process.executableURL = engine
        process.arguments = args
        let stdout = Pipe()
        let stderr = Pipe()
        process.standardOutput = stdout
        process.standardError = stderr

        // stderr is drained continuously rather than after the fact. Two
        // reasons: progress has to arrive while it is still useful, and a
        // child that fills the stderr pipe buffer blocks forever if nobody
        // is reading — which --progress makes likely, since it now writes a
        // line per percent instead of staying silent.
        let sink = StderrSink(onProgress: onProgress)
        stderr.fileHandleForReading.readabilityHandler = { handle in
            let chunk = handle.availableData
            if chunk.isEmpty {
                handle.readabilityHandler = nil
            } else {
                sink.feed(chunk)
            }
        }

        try process.run()
        if control?.adopt(process) == false {
            // Cancelled in the window between run() and adopt().
            process.terminate()
        }

        let data = stdout.fileHandleForReading.readDataToEndOfFile()
        process.waitUntilExit()
        stderr.fileHandleForReading.readabilityHandler = nil

        if control?.isCancelled == true { throw EngineFailure.cancelled }

        guard let result = try? JSONDecoder().decode(EngineResult.self, from: data) else {
            let tail = sink.tail()
            throw EngineFailure.badOutput(tail.isEmpty ? "engine produced no output" : tail)
        }
        return result
    }
}
