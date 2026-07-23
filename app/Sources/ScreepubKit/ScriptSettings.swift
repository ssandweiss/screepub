import Foundation

/// Per-script formatting overrides, stored beside the script's .fountain
/// in the library: `<Stem>.screepub.json`. Absent sidecar = global defaults.
public enum ScriptSettings {
    nonisolated public static func sidecarURL(forFountain fountain: URL) -> URL {
        fountain.deletingPathExtension().appendingPathExtension("screepub.json")
    }

    nonisolated public static func load(forFountain fountain: URL, fallback: FormatSettings) -> FormatSettings {
        let url = sidecarURL(forFountain: fountain)
        guard let data = try? Data(contentsOf: url),
              let settings = try? JSONDecoder().decode(FormatSettings.self, from: data) else {
            return fallback
        }
        return settings
    }

    nonisolated public static func save(_ settings: FormatSettings, forFountain fountain: URL) throws {
        try JSONEncoder().encode(settings).write(to: sidecarURL(forFountain: fountain))
    }
}
