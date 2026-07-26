// ScreepubKit behavior checks, as a plain executable because
// CommandLineTools ships neither XCTest nor swift-testing.
// Run: swift run kit-check   (exits non-zero on failure)
import Foundation
import ScreepubKit

var failures = 0
@MainActor
func check(_ condition: Bool, _ label: String) {
    if condition {
        print("  ok  \(label)")
    } else {
        print("FAIL  \(label)")
        failures += 1
    }
}

func tempDir(_ name: String) -> URL {
    let dir = FileManager.default.temporaryDirectory
        .appendingPathComponent("screepub-kitcheck-\(UUID().uuidString)")
        .appendingPathComponent(name)
    try! FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
    return dir
}

// — Kindle volume detection —
let kindle = tempDir("Kindle")
try! FileManager.default.createDirectory(at: kindle.appendingPathComponent("documents"), withIntermediateDirectories: true)
check(KindleDevice.isKindleVolume(kindle), "volume named Kindle with documents/ detected")

let noName = tempDir("NO NAME")
for sub in ["documents", "system"] {
    try! FileManager.default.createDirectory(at: noName.appendingPathComponent(sub), withIntermediateDirectories: true)
}
check(KindleDevice.isKindleVolume(noName), "unnamed volume with documents/ + system/ detected")

let empty = tempDir("Kindle-empty")
check(!KindleDevice.isKindleVolume(empty), "volume without documents/ rejected")

let stick = tempDir("USB STICK")
try! FileManager.default.createDirectory(at: stick.appendingPathComponent("documents"), withIntermediateDirectories: true)
check(!KindleDevice.isKindleVolume(stick), "generic thumb drive rejected")

// — copy semantics —
let src = kindle.deletingLastPathComponent().appendingPathComponent("Test.epub")
try! Data("v1".utf8).write(to: src)
let dest = try! KindleDevice.copy(src, to: kindle)
check(dest.path.hasSuffix("Kindle/documents/Test.epub"), "copy lands in documents/")
check((try? String(contentsOf: dest, encoding: .utf8)) == "v1", "copy preserves content")
try! Data("v2".utf8).write(to: src)
try! KindleDevice.copy(src, to: kindle)
check((try? String(contentsOf: dest, encoding: .utf8)) == "v2", "re-copy overwrites")

// — multi-vendor device detection —
let kobo = tempDir("KOBOeReader")
try! FileManager.default.createDirectory(at: kobo.appendingPathComponent(".kobo"), withIntermediateDirectories: true)
check(DeviceDetect.classify(kobo) == .kobo, "volume with .kobo dir detected as Kobo")

let tolino = tempDir("tolino")
check(DeviceDetect.classify(tolino) == .tolino, "volume named tolino detected as tolino")

check(DeviceDetect.classify(kindle) == .kindle, "Kindle volume classified as kindle")
check(DeviceDetect.classify(stick) == nil, "generic thumb drive classifies as no device")

// — per-vendor copy destinations —
let book = kobo.deletingLastPathComponent().appendingPathComponent("Script.epub")
try! Data("epub".utf8).write(to: book)

let koboDest = try! DeviceTransfer.copy(book, to: ConnectedDevice(kind: .kobo, name: "Kobo", volume: kobo))
check(koboDest.path.hasSuffix("KOBOeReader/Script.epub"), "Kobo copy lands at volume root")

let tolinoDest = try! DeviceTransfer.copy(book, to: ConnectedDevice(kind: .tolino, name: "tolino", volume: tolino))
check(tolinoDest.path.hasSuffix("tolino/Books/Script.epub"), "tolino copy lands in Books/ (created)")

let kindleDest = try! DeviceTransfer.copy(book, to: ConnectedDevice(kind: .kindle, name: "Kindle", volume: kindle))
check(kindleDest.path.hasSuffix("Kindle/documents/Script.epub"), "Kindle copy still lands in documents/")

// — ebook-convert discovery (environment-dependent: only consistency) —
if let tool = EbookConvert.toolURL() {
    check(FileManager.default.isExecutableFile(atPath: tool.path), "discovered ebook-convert is executable")
    check(EbookConvert.isAvailable, "isAvailable agrees with toolURL")
} else {
    check(!EbookConvert.isAvailable, "isAvailable agrees with missing toolURL")
    print("  --  calibre not installed; AZW3 conversion untested here")
}

// — AZW3 conversion keeps the dialogue column (environment-dependent) —
// Calibre's remove-fake-margins heuristic sees per-block side margins on
// most of a screenplay's paragraphs and deletes them as "publisher page
// margins" — collapsing the dialogue column to full width on device.
@discardableResult
func run(_ tool: URL, _ args: [String], cwd: URL? = nil) -> Int32 {
    let p = Process()
    p.executableURL = tool
    p.arguments = args
    p.currentDirectoryURL = cwd
    p.standardOutput = Pipe()
    p.standardError = Pipe()
    try! p.run()
    p.waitUntilExit()
    return p.terminationStatus
}

func makeMiniScriptEpub() -> URL {
    let root = tempDir("mini-epub")
    let oebps = root.appendingPathComponent("OEBPS")
    let metainf = root.appendingPathComponent("META-INF")
    try! FileManager.default.createDirectory(at: oebps, withIntermediateDirectories: true)
    try! FileManager.default.createDirectory(at: metainf, withIntermediateDirectories: true)

    try! "application/epub+zip".write(to: root.appendingPathComponent("mimetype"), atomically: true, encoding: .utf8)
    try! """
    <?xml version="1.0" encoding="UTF-8"?>
    <container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
      <rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles>
    </container>
    """.write(to: metainf.appendingPathComponent("container.xml"), atomically: true, encoding: .utf8)
    try! """
    <?xml version="1.0" encoding="UTF-8"?>
    <package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="uid">
      <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
        <dc:identifier id="uid">urn:uuid:kitcheck-mini-script</dc:identifier>
        <dc:title>KitCheck Mini Script</dc:title>
        <dc:language>en</dc:language>
        <meta property="dcterms:modified">2026-01-01T00:00:00Z</meta>
      </metadata>
      <manifest>
        <item id="text" href="text.xhtml" media-type="application/xhtml+xml"/>
        <item id="css" href="style.css" media-type="text/css"/>
        <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
      </manifest>
      <spine><itemref idref="text"/></spine>
    </package>
    """.write(to: oebps.appendingPathComponent("content.opf"), atomically: true, encoding: .utf8)
    try! """
    .dialogue-block { margin-top: 1em; margin-bottom: 1em; margin-left: 20%; margin-right: 20%; }
    p.character { text-align: center; }
    p { margin: 0; }
    """.write(to: oebps.appendingPathComponent("style.css"), atomically: true, encoding: .utf8)
    let speech = """
    <div class="dialogue-block"><p class="character">ANNE</p>
    <p class="dialogue">Enough dialogue that the fake-margin heuristic sees a screenplay.</p></div>
    """
    try! """
    <?xml version="1.0" encoding="UTF-8"?>
    <html xmlns="http://www.w3.org/1999/xhtml"><head><title>Mini</title>
    <link rel="stylesheet" type="text/css" href="style.css"/></head><body>
    <p class="action">A hallway.</p>
    \(String(repeating: speech, count: 24))
    </body></html>
    """.write(to: oebps.appendingPathComponent("text.xhtml"), atomically: true, encoding: .utf8)
    try! """
    <?xml version="1.0" encoding="UTF-8"?>
    <html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops"><head><title>nav</title></head>
    <body><nav epub:type="toc"><ol><li><a href="text.xhtml">Script</a></li></ol></nav></body></html>
    """.write(to: oebps.appendingPathComponent("nav.xhtml"), atomically: true, encoding: .utf8)

    let epub = root.deletingLastPathComponent().appendingPathComponent("mini.epub")
    let zip = URL(fileURLWithPath: "/usr/bin/zip")
    run(zip, ["-X0", epub.path, "mimetype"], cwd: root)
    run(zip, ["-Xr9", epub.path, "META-INF", "OEBPS"], cwd: root)
    return epub
}

/// The `.dialogue-block { ... }` rule body from every stylesheet the given
/// exploded-book HTML links, concatenated.
func linkedDialogueRules(html: URL, stylesDir: URL) -> String {
    guard let doc = try? String(contentsOf: html, encoding: .utf8) else { return "" }
    var rules = ""
    for cssFile in (try? FileManager.default.contentsOfDirectory(at: stylesDir, includingPropertiesForKeys: nil)) ?? [] {
        guard doc.contains("styles/\(cssFile.lastPathComponent)"),
              let css = try? String(contentsOf: cssFile, encoding: .utf8),
              let start = css.range(of: ".dialogue-block") else { continue }
        let after = css[start.upperBound...]
        rules += after[..<(after.firstIndex(of: "}") ?? after.endIndex)]
    }
    return rules
}

// — reMarkable endpoint sanity (regression: an IP literal in source once
// arrived empty and the force-unwrapped URL(string:) crashed at launch) —
check(RemarkableDevice.endpoint.absoluteString == "http://" + [10, 11, 99, 1].map(String.init).joined(separator: "."),
      "reMarkable endpoint is the fixed USB address")
check(RemarkableDevice.endpoint.host()?.isEmpty == false, "reMarkable endpoint has a non-empty host")

// — KEPUB conversion (environment-dependent) —
func fileContains(_ url: URL, _ needle: String) -> Bool {
    let p = Process()
    p.executableURL = URL(fileURLWithPath: "/usr/bin/zipgrep")
    p.arguments = ["-q", needle, url.path]
    p.standardOutput = Pipe()
    p.standardError = Pipe()
    try? p.run()
    p.waitUntilExit()
    return p.terminationStatus == 0
}

if EbookConvert.isAvailable {
    let epub = makeMiniScriptEpub()
    if let kepub = try? EbookConvert.toKepub(epub) {
        check(kepub.lastPathComponent.hasSuffix(".kepub.epub"), "KEPUB output named .kepub.epub for Kobo renderer")
        check(fileContains(kepub, "koboSpan"), "KEPUB output carries koboSpan markup")
    } else {
        check(false, "EbookConvert.toKepub succeeds on minimal screenplay EPUB")
    }
}

if EbookConvert.isAvailable, let tool = EbookConvert.toolURL() {
    let calibreDebug = tool.deletingLastPathComponent().appendingPathComponent("calibre-debug")
    if FileManager.default.isExecutableFile(atPath: calibreDebug.path) {
        let epub = makeMiniScriptEpub()
        if let azw3 = try? EbookConvert.toAzw3(epub) {
            let exploded = epub.deletingLastPathComponent().appendingPathComponent("exploded")
            run(calibreDebug, ["-x", azw3.path, exploded.path])
            let textDir = exploded.appendingPathComponent("text")
            let stylesDir = exploded.appendingPathComponent("styles")
            let bodyHtml = ((try? FileManager.default.contentsOfDirectory(at: textDir, includingPropertiesForKeys: nil)) ?? [])
                .first { (try? String(contentsOf: $0, encoding: .utf8))?.contains("dialogue-block") == true }
            if let bodyHtml {
                let rule = linkedDialogueRules(html: bodyHtml, stylesDir: stylesDir)
                check(rule.contains("20%"), "AZW3 keeps dialogue-block side margins (got: \(rule.replacingOccurrences(of: "\n", with: " ")))")
            } else {
                check(false, "exploded AZW3 contains a dialogue-block content file")
            }
        } else {
            check(false, "EbookConvert.toAzw3 succeeds on minimal screenplay EPUB")
        }
    } else {
        print("  --  calibre-debug not found beside ebook-convert; AZW3 geometry untested here")
    }
}

// — per-script settings sidecar —
let lib = tempDir("library")
let fountain = lib.appendingPathComponent("Test Script.fountain")
try! Data("Title: T".utf8).write(to: fountain)
check(ScriptSettings.sidecarURL(forFountain: fountain).lastPathComponent == "Test Script.screepub.json",
      "sidecar path derives from fountain stem")
var fs = FormatSettings.defaults
fs.dialogueSideMarginPct = 27
try! ScriptSettings.save(fs, forFountain: fountain)
let loaded = ScriptSettings.load(forFountain: fountain, fallback: FormatSettings.defaults)
check(loaded == fs, "sidecar round-trips settings")
let missing = lib.appendingPathComponent("Other.fountain")
check(ScriptSettings.load(forFountain: missing, fallback: FormatSettings.defaults) == FormatSettings.defaults,
      "absent sidecar falls back to defaults")

let garbageFountain = lib.appendingPathComponent("Garbage.fountain")
try! Data("not json".utf8).write(to: ScriptSettings.sidecarURL(forFountain: garbageFountain))
check(ScriptSettings.load(forFountain: garbageFountain, fallback: FormatSettings.defaults) == FormatSettings.defaults,
      "corrupt sidecar (invalid JSON) falls back to defaults")

let partialFountain = lib.appendingPathComponent("Partial.fountain")
try! Data(#"{"dialogueSideMarginPct": 9}"#.utf8).write(to: ScriptSettings.sidecarURL(forFountain: partialFountain))
let partialLoaded = ScriptSettings.load(forFountain: partialFountain, fallback: FormatSettings.defaults)
var expectedPartial = FormatSettings.defaults
expectedPartial.dialogueSideMarginPct = 9
check(partialLoaded == expectedPartial,
      "partial sidecar overlays present field, leaves rest at fallback")

// — feedback issue URL —
let feedback = Feedback.newIssueURL(appVersion: "0.1.0", osVersion: "macOS 15.0", context: "scanned: no text")
check(feedback.absoluteString.hasPrefix(Feedback.newIssueBase + "?"), "feedback URL targets the repo issue endpoint")
if let q = URLComponents(url: feedback, resolvingAgainstBaseURL: false)?
    .queryItems?.first(where: { $0.name == "body" })?.value {
    check(q.contains("Screepub 0.1.0") && q.contains("macOS 15.0"), "feedback body carries app + OS versions")
    check(q.contains("scanned: no text"), "feedback body includes the passed context")
} else {
    check(false, "feedback URL has a decodable body query item")
}
let plain = Feedback.newIssueURL(appVersion: "0.1.0", osVersion: "macOS 15.0")
check(!plain.absoluteString.isEmpty, "feedback URL builds without a context")

// — device presets —
check(DevicePreset.kindleEink.settings == FormatSettings.defaults, "Kindle e-ink preset equals the baseline defaults")
let phone = DevicePreset.phone.settings
check(phone.dualDialogue == "sequential", "phone preset uses sequential dual dialogue")
check(phone.dialogueSideMarginPct < FormatSettings.defaults.dialogueSideMarginPct, "phone preset widens the dialogue column")
check(DevicePreset.allCases.count == 2, "two device presets ship")

// — export formats —
let exDir = tempDir("export")
let exEpub = exDir.appendingPathComponent("Script.epub")
try! Data("epub".utf8).write(to: exEpub)

check(ExportFormat.epub.fileExtension(calibreAvailable: false) == "epub",
      "epub format uses .epub")
check(ExportFormat.kindle.fileExtension(calibreAvailable: true) == "azw3",
      "kindle format is azw3 when Calibre is available")
check(ExportFormat.kindle.fileExtension(calibreAvailable: false) == "mobi",
      "kindle format falls back to mobi without Calibre")
check(ExportFormat.epub.label(calibreAvailable: false).contains("email"),
      "epub label states its purpose")
check(ExportFormat.kindle.label(calibreAvailable: true).contains("sideload"),
      "kindle label states its purpose")

check(Export.available(for: exEpub, calibreAvailable: true) == [.epub, .kindle],
      "with Calibre both formats offered")
check(Export.available(for: exEpub, calibreAvailable: false) == [.epub],
      "without Calibre and without a .mobi, only epub offered")
let exMobi = exDir.appendingPathComponent("Script.mobi")
try! Data("mobi".utf8).write(to: exMobi)
check(Export.available(for: exEpub, calibreAvailable: false) == [.epub, .kindle],
      "an existing .mobi makes the kindle format available")

// — kindle artifact staleness —
let stDir = tempDir("stale")
let stEpub = stDir.appendingPathComponent("S.epub")
let stMobi = stDir.appendingPathComponent("S.mobi")
try! Data("e".utf8).write(to: stEpub)
check(Export.needsRegeneration(stMobi, freshRelativeTo: stEpub),
      "missing kindle artifact needs regeneration")

try! Data("m".utf8).write(to: stMobi)
try! FileManager.default.setAttributes(
    [.modificationDate: Date(timeIntervalSinceNow: -600)], ofItemAtPath: stMobi.path)
check(Export.needsRegeneration(stMobi, freshRelativeTo: stEpub),
      "kindle artifact older than the epub is stale")

try! FileManager.default.setAttributes(
    [.modificationDate: Date(timeIntervalSinceNow: 600)], ofItemAtPath: stMobi.path)
check(!Export.needsRegeneration(stMobi, freshRelativeTo: stEpub),
      "kindle artifact newer than the epub is fresh")

print(failures == 0 ? "kit-check: all passed" : "kit-check: \(failures) FAILED")
exit(failures == 0 ? 0 : 1)
