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
    public let error: EngineError?
}

public enum EngineFailure: Error, LocalizedError {
    case notFound
    case badOutput(String)

    public var errorDescription: String? {
        switch self {
        case .notFound: return "screepub-engine is missing from the app bundle."
        case .badOutput(let detail): return detail
        }
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
        previewHtml: URL? = nil
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

        let process = Process()
        process.executableURL = engine
        process.arguments = args
        let stdout = Pipe()
        let stderr = Pipe()
        process.standardOutput = stdout
        process.standardError = stderr

        try process.run()
        let data = stdout.fileHandleForReading.readDataToEndOfFile()
        process.waitUntilExit()

        guard let result = try? JSONDecoder().decode(EngineResult.self, from: data) else {
            let err = String(data: stderr.fileHandleForReading.readDataToEndOfFile(), encoding: .utf8)
            throw EngineFailure.badOutput(err?.trimmingCharacters(in: .whitespacesAndNewlines) ?? "engine produced no output")
        }
        return result
    }
}
