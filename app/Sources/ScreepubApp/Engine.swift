import Foundation

/// Result contract of `screepub --json` (see src/cli.ts).
struct EngineResult: Codable, Sendable {
    struct EngineError: Codable, Sendable {
        let code: String
        let message: String
    }

    let ok: Bool
    let title: String?
    let author: String?
    let pages: Int?
    let scenes: Int?
    let characters: Int?
    let topCharacters: [String]?
    let warnings: [String]?
    let epubPath: String?
    let fountainPath: String?
    let error: EngineError?
}

enum EngineFailure: Error {
    case notFound
    case badOutput(String)
}

enum Engine {
    /// Locate the sidecar: bundled Resources first, then the dev fallback
    /// (running via `swift run` from the repo).
    nonisolated static func binaryURL() -> URL? {
        if let bundled = Bundle.main.resourceURL?.appendingPathComponent("screepub-engine"),
           FileManager.default.isExecutableFile(atPath: bundled.path) {
            return bundled
        }
        let dev = URL(fileURLWithPath: #filePath) // app/Sources/ScreepubApp/Engine.swift
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
    nonisolated static func convert(input: URL, force: Bool) throws -> EngineResult {
        guard let engine = binaryURL() else { throw EngineFailure.notFound }

        let output = input.deletingPathExtension().appendingPathExtension("epub")
        var args = [input.path, "-o", output.path, "--json"]
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
