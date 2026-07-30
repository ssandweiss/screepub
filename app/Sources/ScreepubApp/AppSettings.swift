import Foundation
import ScreepubKit

/// UserDefaults keys + assembly of engine-facing settings. SwiftUI views
/// bind these same keys via @AppStorage; this helper reads them at
/// conversion time.
enum AppSettings {
    static let outputFolderKey = "outputFolder"
    /// The consent gate for the app's only self-initiated network request.
    /// One constant, used by every reader and writer: a typo'd literal in
    /// any one site would silently split the Settings toggle from the
    /// launch check that obeys it.
    static let updateOptInKey = "updateOptIn"
    static let updateLastCheckedKey = "updateLastChecked"

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
            showPageMarkers: bool("fmtPageMarkers", def.showPageMarkers),
            dualDialogue: d.string(forKey: "fmtDual") ?? def.dualDialogue,
            justifyText: bool("fmtJustify", def.justifyText)
        )
    }

    /// Write a full FormatSettings back to the same keys `formatSettings()`
    /// reads — used to promote a script's tuned sidecar to the app default.
    static func setFormatSettings(_ s: FormatSettings) {
        let d = UserDefaults.standard
        d.set(s.scenePageBreaks, forKey: "fmtScenePageBreaks")
        d.set(s.dialogueSideMarginPct, forKey: "fmtDialogueMargin")
        d.set(s.cueIndentPct, forKey: "fmtCueIndent")
        d.set(s.parentheticalIndentPct, forKey: "fmtParenIndent")
        d.set(s.elementSpacingEm, forKey: "fmtSpacing")
        d.set(s.keepSceneHeadingWithScene, forKey: "fmtKeepHeading")
        d.set(s.fontFamily, forKey: "fmtFont")
        d.set(s.rejoinSplitDialogue, forKey: "fmtRejoin")
        d.set(s.contdMode, forKey: "fmtContd")
        d.set(s.cueAlignment, forKey: "fmtCueAlign")
        d.set(s.includeTitlePage, forKey: "fmtTitlePage")
        d.set(s.showSceneNumbers, forKey: "fmtSceneNumbers")
        d.set(s.showPageMarkers, forKey: "fmtPageMarkers")
        d.set(s.dualDialogue, forKey: "fmtDual")
        d.set(s.justifyText, forKey: "fmtJustify")
    }

    /// Reset all formatting keys so @AppStorage bindings fall back to defaults.
    static func resetFormatting() {
        for key in ["fmtScenePageBreaks", "fmtDialogueMargin", "fmtCueIndent", "fmtParenIndent",
                    "fmtSpacing", "fmtKeepHeading", "fmtFont", "fmtRejoin", "fmtContd",
                    "fmtCueAlign", "fmtTitlePage", "fmtSceneNumbers", "fmtPageMarkers",
                    "fmtDual", "fmtJustify"] {
            UserDefaults.standard.removeObject(forKey: key)
        }
    }
}
