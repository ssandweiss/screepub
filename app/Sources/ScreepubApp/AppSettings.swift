import Foundation
import ScreepubKit

/// UserDefaults keys + assembly of engine-facing settings. SwiftUI views
/// bind these same keys via @AppStorage; this helper reads them at
/// conversion time.
enum AppSettings {
    static let outputFolderKey = "outputFolder"

    /// Default library folder: ~/Documents/Screepub
    static var defaultOutputFolder: URL {
        FileManager.default.homeDirectoryForCurrentUser
            .appendingPathComponent("Documents")
            .appendingPathComponent("Screepub")
    }

    static var outputFolder: URL {
        let stored = UserDefaults.standard.string(forKey: outputFolderKey) ?? ""
        return stored.isEmpty ? defaultOutputFolder : URL(fileURLWithPath: (stored as NSString).expandingTildeInPath)
    }

    static func formatSettings() -> FormatSettings {
        let d = UserDefaults.standard
        let def = FormatSettings.defaults
        func double(_ key: String, _ fallback: Double) -> Double {
            d.object(forKey: key) as? Double ?? fallback
        }
        func bool(_ key: String, _ fallback: Bool) -> Bool {
            d.object(forKey: key) as? Bool ?? fallback
        }
        return FormatSettings(
            scenePageBreaks: bool("fmtScenePageBreaks", def.scenePageBreaks),
            dialogueSideMarginPct: double("fmtDialogueMargin", def.dialogueSideMarginPct),
            cueIndentPct: double("fmtCueIndent", def.cueIndentPct),
            parentheticalIndentPct: double("fmtParenIndent", def.parentheticalIndentPct),
            elementSpacingEm: double("fmtSpacing", def.elementSpacingEm),
            keepSceneHeadingWithScene: bool("fmtKeepHeading", def.keepSceneHeadingWithScene),
            fontFamily: d.string(forKey: "fmtFont") ?? def.fontFamily,
            rejoinSplitDialogue: bool("fmtRejoin", def.rejoinSplitDialogue),
            contdMode: d.string(forKey: "fmtContd") ?? def.contdMode,
            cueAlignment: d.string(forKey: "fmtCueAlign") ?? def.cueAlignment,
            includeTitlePage: bool("fmtTitlePage", def.includeTitlePage),
            showSceneNumbers: bool("fmtSceneNumbers", def.showSceneNumbers),
            showPageMarkers: bool("fmtPageMarkers", def.showPageMarkers)
        )
    }

    /// Reset all formatting keys so @AppStorage bindings fall back to defaults.
    static func resetFormatting() {
        for key in ["fmtScenePageBreaks", "fmtDialogueMargin", "fmtCueIndent", "fmtParenIndent",
                    "fmtSpacing", "fmtKeepHeading", "fmtFont", "fmtRejoin", "fmtContd",
                    "fmtCueAlign", "fmtTitlePage", "fmtSceneNumbers", "fmtPageMarkers"] {
            UserDefaults.standard.removeObject(forKey: key)
        }
    }
}
