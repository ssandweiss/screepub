import Foundation

/// Per-script formatting overrides, stored beside the script's .fountain
/// in the library: `<Stem>.screepub.json`. Absent sidecar = global defaults.
public enum ScriptSettings {
    nonisolated public static func sidecarURL(forFountain fountain: URL) -> URL {
        fountain.deletingPathExtension().appendingPathExtension("screepub.json")
    }

    /// All-optional mirror of FormatSettings so a sidecar written by an
    /// older or newer schema still decodes: unknown keys are ignored by
    /// JSONDecoder, and missing keys just decode to nil rather than
    /// failing the whole document. Every present field is then overlaid
    /// onto `fallback`, mirroring the engine's resolveFormatOptions merge
    /// semantics — so schema growth can't wipe a user's per-script tuning.
    private struct PartialFormatSettings: Codable {
        var scenePageBreaks: Bool?
        var dialogueSideMarginPct: Double?
        var cueIndentPct: Double?
        var parentheticalIndentPct: Double?
        var elementSpacingEm: Double?
        var keepSceneHeadingWithScene: Bool?
        var keepSpeechesWhole: Bool?
        var fontFamily: String?
        var rejoinSplitDialogue: Bool?
        var contdMode: String?
        var cueAlignment: String?
        var includeTitlePage: Bool?
        var showSceneNumbers: Bool?
        var showPageMarkers: Bool?
        var dualDialogue: String?
        var justifyText: Bool?
    }

    nonisolated public static func load(forFountain fountain: URL, fallback: FormatSettings) -> FormatSettings {
        let url = sidecarURL(forFountain: fountain)
        guard let data = try? Data(contentsOf: url),
              let partial = try? JSONDecoder().decode(PartialFormatSettings.self, from: data) else {
            return fallback
        }
        var merged = fallback
        if let v = partial.scenePageBreaks { merged.scenePageBreaks = v }
        if let v = partial.dialogueSideMarginPct { merged.dialogueSideMarginPct = v }
        if let v = partial.cueIndentPct { merged.cueIndentPct = v }
        if let v = partial.parentheticalIndentPct { merged.parentheticalIndentPct = v }
        if let v = partial.elementSpacingEm { merged.elementSpacingEm = v }
        if let v = partial.keepSceneHeadingWithScene { merged.keepSceneHeadingWithScene = v }
        if let v = partial.keepSpeechesWhole { merged.keepSpeechesWhole = v }
        if let v = partial.fontFamily { merged.fontFamily = v }
        if let v = partial.rejoinSplitDialogue { merged.rejoinSplitDialogue = v }
        if let v = partial.contdMode { merged.contdMode = v }
        if let v = partial.cueAlignment { merged.cueAlignment = v }
        if let v = partial.includeTitlePage { merged.includeTitlePage = v }
        if let v = partial.showSceneNumbers { merged.showSceneNumbers = v }
        if let v = partial.showPageMarkers { merged.showPageMarkers = v }
        if let v = partial.dualDialogue { merged.dualDialogue = v }
        if let v = partial.justifyText { merged.justifyText = v }
        return merged
    }

    nonisolated public static func save(_ settings: FormatSettings, forFountain fountain: URL) throws {
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.sortedKeys, .prettyPrinted]
        let data = try encoder.encode(settings)
        try data.write(to: sidecarURL(forFountain: fountain), options: .atomic)
    }
}
