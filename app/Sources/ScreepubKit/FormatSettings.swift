import Foundation

/// Mirror of the engine's FormatOptions (src/options.ts) — encoded to JSON
/// and passed via --options. Defaults must match DEFAULT_FORMAT_OPTIONS.
public struct FormatSettings: Codable, Sendable, Equatable {
    // Adding a field? Also update PartialFormatSettings + its merge in
    // ScriptSettings.swift, AppSettings.swift's formatSettings() /
    // setFormatSettings() / resetFormatting() trio, and the engine's
    // options.ts / DEFAULT_FORMAT_OPTIONS.
    public var scenePageBreaks: Bool
    public var dialogueSideMarginPct: Double
    public var cueIndentPct: Double
    public var parentheticalIndentPct: Double
    public var elementSpacingEm: Double
    public var keepSceneHeadingWithScene: Bool
    public var fontFamily: String
    public var rejoinSplitDialogue: Bool
    public var contdMode: String
    public var cueAlignment: String
    public var includeTitlePage: Bool
    public var showSceneNumbers: Bool
    public var showPageMarkers: Bool
    public var dualDialogue: String

    public static let defaults = FormatSettings(
        scenePageBreaks: false,
        dialogueSideMarginPct: 20,
        cueIndentPct: 33,
        parentheticalIndentPct: 17,
        elementSpacingEm: 1,
        keepSceneHeadingWithScene: true,
        fontFamily: "courier",
        rejoinSplitDialogue: true,
        contdMode: "auto",
        cueAlignment: "centered",
        includeTitlePage: true,
        showSceneNumbers: false,
        showPageMarkers: false,
        dualDialogue: "sideBySide"
    )

    public init(
        scenePageBreaks: Bool, dialogueSideMarginPct: Double, cueIndentPct: Double,
        parentheticalIndentPct: Double, elementSpacingEm: Double,
        keepSceneHeadingWithScene: Bool, fontFamily: String,
        rejoinSplitDialogue: Bool, contdMode: String, cueAlignment: String,
        includeTitlePage: Bool, showSceneNumbers: Bool, showPageMarkers: Bool,
        dualDialogue: String
    ) {
        self.scenePageBreaks = scenePageBreaks
        self.dialogueSideMarginPct = dialogueSideMarginPct
        self.cueIndentPct = cueIndentPct
        self.parentheticalIndentPct = parentheticalIndentPct
        self.elementSpacingEm = elementSpacingEm
        self.keepSceneHeadingWithScene = keepSceneHeadingWithScene
        self.fontFamily = fontFamily
        self.rejoinSplitDialogue = rejoinSplitDialogue
        self.contdMode = contdMode
        self.cueAlignment = cueAlignment
        self.includeTitlePage = includeTitlePage
        self.showSceneNumbers = showSceneNumbers
        self.showPageMarkers = showPageMarkers
        self.dualDialogue = dualDialogue
    }
}
