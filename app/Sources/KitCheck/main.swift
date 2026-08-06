// ScreepubKit behavior checks, as a plain executable because
// CommandLineTools ships neither XCTest nor swift-testing.
// Run: swift run kit-check   (exits non-zero on failure)
import Foundation
import Network
import ScreepubKit
import KFXKit

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
    <div class="dialogue-block"><p class="character">DEV</p>
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

// — the --json contract, from the SHARED committed sample: bun test pins
// the producer's key set against this exact file, kit-check proves the
// consumer decodes it — a key rename must break a suite before the app.
// (Regression 2026-07-30: the CLI emitted previewHtmlPath/debugPath that
// EngineResult silently couldn't read.)
let repoRoot = URL(fileURLWithPath: #filePath) // app/Sources/KitCheck/main.swift
    .deletingLastPathComponent().deletingLastPathComponent()
    .deletingLastPathComponent().deletingLastPathComponent()
let contractSample = repoRoot.appendingPathComponent("tests/fixtures/engine-result-sample.json")
if let sampleData = try? Data(contentsOf: contractSample) {
    let decoded = try? JSONDecoder().decode(EngineResult.self, from: sampleData)
    check(decoded != nil, "the committed contract sample decodes into EngineResult")
    check(decoded?.title == "Sample Script", "sample fields survive the decode")
    check(decoded?.previewHtmlPath != nil, "EngineResult reads previewHtmlPath")
    check(decoded?.debugPath != nil, "EngineResult reads debugPath")
    check(decoded?.topCharacters == ["MARGO", "DEV", "NIECE"], "arrays decode intact")
} else {
    print("  --  contract sample not found (partial checkout); decode untested here")
}

// — format defaults, from the SAME canonical file the engine suite pins:
// FormatSettings has non-optional fields, so a key renamed or missing in
// the JSON fails the decode and a value drifted fails the equality; a
// field the Swift mirror never grew is invisible to both (the decoder
// ignores unknown keys), so per-field assertions below cover that side —
let defaultsFile = repoRoot.appendingPathComponent("format-defaults.json")
if let defaultsData = try? Data(contentsOf: defaultsFile) {
    let canonical = try? JSONDecoder().decode(FormatSettings.self, from: defaultsData)
    check(canonical != nil, "canonical format-defaults.json decodes into FormatSettings")
    check(canonical == FormatSettings.defaults,
          "FormatSettings.defaults matches the canonical file the engine pins")
} else {
    print("  --  format-defaults.json not found (partial checkout); sync untested here")
}

check(FormatSettings.defaults.keepSpeechesWhole == false,
      "keepSpeechesWhole defaults off — speeches flow; atomicity is opt-in")

check(FormatSettings.defaults.printSplitMinimums == true,
      "printSplitMinimums defaults ON (the print two-line rule)")
check(FormatSettings.defaults.preserveFontShifts == true,
      "preserveFontShifts defaults ON (block font shifts render)")

// — reMarkable endpoint sanity (regression: an IP literal in source once
// arrived empty and the force-unwrapped URL(string:) crashed at launch) —
check(RemarkableDevice.endpoint.absoluteString == "http://" + [10, 11, 99, 1].map(String.init).joined(separator: "."),
      "reMarkable endpoint is the fixed USB address")
check(RemarkableDevice.endpoint.host()?.isEmpty == false, "reMarkable endpoint has a non-empty host")

// — reMarkable transfer semantics, against a local stand-in for the
//   tablet's USB web interface. The real interface's /upload writes into
//   the LAST-LISTED folder (server-side state), so "upload to root" is
//   only true if root is listed immediately before the POST. —
final class StubRemarkable: @unchecked Sendable {
    private let listener: NWListener
    private let lock = NSLock()
    private var recorded: [String] = []
    private var documentsStatusLocked = 200

    var requests: [String] { lock.lock(); defer { lock.unlock() }; return recorded }
    var documentsStatus: Int {
        get { lock.lock(); defer { lock.unlock() }; return documentsStatusLocked }
        set { lock.lock(); documentsStatusLocked = newValue; lock.unlock() }
    }
    func reset() { lock.lock(); recorded = []; lock.unlock() }

    var baseURL: URL { URL(string: "http://127.0.0.1:\(listener.port!.rawValue)")! }

    init() throws {
        listener = try NWListener(using: .tcp, on: .any)
        let ready = DispatchSemaphore(value: 0)
        listener.stateUpdateHandler = { if case .ready = $0 { ready.signal() } }
        listener.newConnectionHandler = { [weak self] conn in
            conn.start(queue: .global())
            self?.receive(conn, buffered: Data())
        }
        listener.start(queue: .global())
        ready.wait()
    }

    private func receive(_ conn: NWConnection, buffered: Data) {
        conn.receive(minimumIncompleteLength: 1, maximumLength: 1 << 16) { [weak self] chunk, _, done, _ in
            guard let self else { return conn.cancel() }
            var buf = buffered
            if let chunk { buf.append(chunk) }
            guard let headerEnd = buf.range(of: Data("\r\n\r\n".utf8)) else {
                return done ? conn.cancel() : self.receive(conn, buffered: buf)
            }
            let head = String(decoding: buf[..<headerEnd.lowerBound], as: UTF8.self)
            let contentLength = head.components(separatedBy: "\r\n")
                .first { $0.lowercased().hasPrefix("content-length:") }
                .flatMap { Int($0.dropFirst("content-length:".count).trimmingCharacters(in: .whitespaces)) } ?? 0
            guard buf.count - headerEnd.upperBound >= contentLength else {
                return done ? conn.cancel() : self.receive(conn, buffered: buf)
            }
            let parts = head.components(separatedBy: "\r\n")[0].components(separatedBy: " ")
            let method = parts.first ?? "?", path = parts.count > 1 ? parts[1] : "?"
            self.lock.lock()
            self.recorded.append("\(method) \(path)")
            self.lock.unlock()
            let status = path.hasPrefix("/documents") ? self.documentsStatus : 200
            let reply = "HTTP/1.1 \(status) \(status == 200 ? "OK" : "Error")\r\n"
                + "Content-Length: 2\r\nConnection: close\r\n\r\n[]"
            conn.send(content: Data(reply.utf8), completion: .contentProcessed { _ in conn.cancel() })
        }
    }
}

if let stub = try? StubRemarkable() {
    let rmFile = tempDir("remarkable").appendingPathComponent("Script.epub")
    try! Data("epub".utf8).write(to: rmFile)
    try? await RemarkableDevice.upload(rmFile, to: stub.baseURL)
    check(stub.requests == ["GET /documents/", "POST /upload"],
          "upload lists the root folder immediately before posting (got: \(stub.requests))")

    stub.reset()
    check(await RemarkableDevice.probe(at: stub.baseURL), "probe succeeds against a serving web interface")
    check(stub.requests == ["GET /documents/"],
          "probe asks for the documents listing, not the bare root (got: \(stub.requests))")

    // A cancelled listing must abort the send: a blind POST would land the
    // file in whatever folder the tablet last showed.
    stub.reset()
    stub.documentsStatus = 500
    let listingError: Error?
    do { try await RemarkableDevice.upload(rmFile, to: stub.baseURL); listingError = nil }
    catch { listingError = error }
    check(listingError != nil, "upload fails when the root listing fails")
    check(!stub.requests.contains("POST /upload"), "no blind POST after a failed root listing")
    stub.documentsStatus = 200

    // Paper Pro's web interface caps uploads at 100 MB; reject before any
    // bytes move (sparse file: big on disk, instant to make).
    stub.reset()
    let big = tempDir("remarkable-big").appendingPathComponent("big.epub")
    FileManager.default.createFile(atPath: big.path, contents: nil)
    let bigHandle = try! FileHandle(forWritingTo: big)
    try! bigHandle.truncate(atOffset: 100 * 1024 * 1024 + 1)
    try! bigHandle.close()
    let oversize: Error?
    do { try await RemarkableDevice.upload(big, to: stub.baseURL); oversize = nil }
    catch { oversize = error }
    check(oversize != nil, "a file over the tablet's 100 MB cap is rejected")
    check(oversize?.localizedDescription.contains("100 MB") == true,
          "the oversize message names the cap")
    check(stub.requests.isEmpty, "the oversize rejection makes no network request")
} else {
    check(false, "local stub server starts for reMarkable checks")
}
check(!(await RemarkableDevice.probe(at: URL(string: "http://127.0.0.1:1")!, timeout: 0.5)),
      "probe reports false when nothing is serving")

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
fs.keepSpeechesWhole = true
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

// Every PartialFormatSettings field's merge line in ScriptSettings.load
// needs the same proof printSplitMinimums got in 5630525: a sidecar value
// that merely equals FormatSettings.defaults passes whether or not that
// field's `if let v = partial.x { merged.x = v }` line exists at all,
// because `merged` starts life as a copy of `fallback`. So every row here
// writes the OPPOSITE of the default and checks that exact field came
// through the merge — the override direction is what makes it a real
// assertion instead of a tautology.
//
// This table is also what turns the "Adding a field?" comment atop
// FormatSettings.swift from aspirational into enforced: a field missing
// its merge line, or a merge line silently deleted, fails a named row here
// instead of passing every check in the suite. And a field added WITH its
// merge line but WITHOUT a row here — which would otherwise pass every
// check silently — is caught by the completeness check right after the
// loop below, which diffs this table's field names against
// FormatSettings' own encoded keys. Add a field to PartialFormatSettings?
// Add its row here too, or one of the two checks catches the gap.
struct SidecarOverrideCase {
    let field: String
    let json: String
    let apply: (inout FormatSettings) -> Void
}

let sidecarOverrideCases: [SidecarOverrideCase] = [
    .init(field: "scenePageBreaks", json: #"{"scenePageBreaks": true}"#,
          apply: { $0.scenePageBreaks = true }),
    .init(field: "dialogueSideMarginPct", json: #"{"dialogueSideMarginPct": 5}"#,
          apply: { $0.dialogueSideMarginPct = 5 }),
    .init(field: "cueIndentPct", json: #"{"cueIndentPct": 10}"#,
          apply: { $0.cueIndentPct = 10 }),
    .init(field: "parentheticalIndentPct", json: #"{"parentheticalIndentPct": 5}"#,
          apply: { $0.parentheticalIndentPct = 5 }),
    .init(field: "elementSpacingEm", json: #"{"elementSpacingEm": 1.5}"#,
          apply: { $0.elementSpacingEm = 1.5 }),
    .init(field: "keepSceneHeadingWithScene", json: #"{"keepSceneHeadingWithScene": false}"#,
          apply: { $0.keepSceneHeadingWithScene = false }),
    .init(field: "keepSpeechesWhole", json: #"{"keepSpeechesWhole": true}"#,
          apply: { $0.keepSpeechesWhole = true }),
    .init(field: "fontFamily", json: #"{"fontFamily": "serif"}"#,
          apply: { $0.fontFamily = "serif" }),
    .init(field: "rejoinSplitDialogue", json: #"{"rejoinSplitDialogue": false}"#,
          apply: { $0.rejoinSplitDialogue = false }),
    .init(field: "contdMode", json: #"{"contdMode": "strip"}"#,
          apply: { $0.contdMode = "strip" }),
    .init(field: "cueAlignment", json: #"{"cueAlignment": "indented"}"#,
          apply: { $0.cueAlignment = "indented" }),
    .init(field: "includeTitlePage", json: #"{"includeTitlePage": false}"#,
          apply: { $0.includeTitlePage = false }),
    .init(field: "showSceneNumbers", json: #"{"showSceneNumbers": true}"#,
          apply: { $0.showSceneNumbers = true }),
    .init(field: "showPageMarkers", json: #"{"showPageMarkers": true}"#,
          apply: { $0.showPageMarkers = true }),
    .init(field: "dualDialogue", json: #"{"dualDialogue": "sequential"}"#,
          apply: { $0.dualDialogue = "sequential" }),
    .init(field: "justifyText", json: #"{"justifyText": true}"#,
          apply: { $0.justifyText = true }),
    .init(field: "printSplitMinimums", json: #"{"printSplitMinimums": false}"#,
          apply: { $0.printSplitMinimums = false }),
    .init(field: "preserveFontShifts", json: #"{"preserveFontShifts": false}"#,
          apply: { $0.preserveFontShifts = false }),
]

for sidecarCase in sidecarOverrideCases {
    let caseFountain = lib.appendingPathComponent("Override-\(sidecarCase.field).fountain")
    try! Data(sidecarCase.json.utf8).write(to: ScriptSettings.sidecarURL(forFountain: caseFountain))
    let caseLoaded = ScriptSettings.load(forFountain: caseFountain, fallback: FormatSettings.defaults)
    var expected = FormatSettings.defaults
    sidecarCase.apply(&expected)
    // Whole-struct equality is strictly stronger than a per-field check:
    // each row's sidecar JSON carries exactly one key, so a correct merge
    // must equal `expected` (defaults with just that field overridden) —
    // proving the merge clobbered nothing else, not just that the target
    // field landed.
    check(caseLoaded == expected,
          "sidecar merge line overrides \(sidecarCase.field) against its default fallback")
}

// The table above is only complete if every FormatSettings field has a
// row — otherwise a field added WITH its merge line but WITHOUT a row
// here passes silently, and the "Adding a field?" comment goes back to
// being aspirational. FormatSettings mirrors PartialFormatSettings
// one-to-one and is Codable, so its encoded keys are the authority on
// what a complete table covers.
if let encodedDefaults = try? JSONEncoder().encode(FormatSettings.defaults),
   let decodedObject = try? JSONSerialization.jsonObject(with: encodedDefaults) as? [String: Any] {
    let allFields = Set(decodedObject.keys)
    let coveredFields = Set(sidecarOverrideCases.map(\.field))
    check(coveredFields == allFields,
          "every FormatSettings field has a sidecar override row (missing: \(allFields.subtracting(coveredFields)))")
} else {
    check(false, "FormatSettings.defaults encodes to a JSON object")
}

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
check(DevicePreset.matching(FormatSettings.defaults) == .kindleEink,
      "baseline defaults are recognised as the Kindle e-ink preset")
check(DevicePreset.matching(DevicePreset.phone.settings) == .phone,
      "phone preset settings are recognised as the phone preset")
var tuned = FormatSettings.defaults
tuned.dialogueSideMarginPct = 7
check(DevicePreset.matching(tuned) == nil,
      "settings tuned away from every preset match none")

// — export formats —
let exDir = tempDir("export")
let exEpub = exDir.appendingPathComponent("Script.epub")
try! Data("epub".utf8).write(to: exEpub)

check(ExportFormat.epub.fileExtension(calibreAvailable: false, kfxReady: false) == "epub",
      "epub format uses .epub")
check(ExportFormat.kindle.fileExtension(calibreAvailable: true, kfxReady: false) == "azw3",
      "kindle format is azw3 when Calibre is available")
check(ExportFormat.kindle.fileExtension(calibreAvailable: false, kfxReady: false) == "mobi",
      "kindle format falls back to mobi without Calibre")
check(ExportFormat.epub.label(calibreAvailable: false, kfxReady: false).contains("email"),
      "epub label states its purpose")
check(ExportFormat.kindle.label(calibreAvailable: true, kfxReady: false).contains("sideload"),
      "kindle label states its purpose")

check(Export.available(for: exEpub, calibreAvailable: true) == [.epub, .kindle],
      "with Calibre both formats offered")
check(Export.available(for: exEpub, calibreAvailable: false) == [.epub],
      "without Calibre and without a .mobi, only epub offered")
let exMobi = exDir.appendingPathComponent("Script.mobi")
try! Data("mobi".utf8).write(to: exMobi)
check(Export.available(for: exEpub, calibreAvailable: false) == [.epub, .kindle],
      "an existing .mobi makes the kindle format available")

// Scripts arrive with the draft date in the filename — "THE LAST VIDEO
// STORE 01.02.26.pdf" — so there are dots in the stem, not just the
// extension. Script.epub can't catch a regression in sibling-path
// derivation for that shape; this can.
let dottedEpub = exDir.appendingPathComponent("THE LAST VIDEO STORE 01.02.26.epub")
try! Data("epub".utf8).write(to: dottedEpub)
let dottedMobi = exDir.appendingPathComponent("THE LAST VIDEO STORE 01.02.26.mobi")
try! Data("mobi".utf8).write(to: dottedMobi)
check(Export.available(for: dottedEpub, calibreAvailable: false) == [.epub, .kindle],
      "dotted script filename still finds its sibling .mobi")

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

let equalMoment = Date()
try! FileManager.default.setAttributes([.modificationDate: equalMoment], ofItemAtPath: stEpub.path)
try! FileManager.default.setAttributes([.modificationDate: equalMoment], ofItemAtPath: stMobi.path)
check(Export.needsRegeneration(stMobi, freshRelativeTo: stEpub),
      "kindle artifact with the same mtime as the epub is treated as stale")

let goneEpubDir = tempDir("stale-missing-epub")
let goneEpub = goneEpubDir.appendingPathComponent("Gone.epub")
let orphanMobi = goneEpubDir.appendingPathComponent("Gone.mobi")
try! Data("m".utf8).write(to: orphanMobi)
check(Export.needsRegeneration(orphanMobi, freshRelativeTo: goneEpub),
      "artifact present but epub missing is treated as stale")

// — Export.copy —
let copyDir = tempDir("export-copy")
let copySrc = copyDir.appendingPathComponent("Source.epub")
let copyDest = copyDir.appendingPathComponent("Dest.epub")
try! Data("v1".utf8).write(to: copySrc)
try! Export.copy(copySrc, to: copyDest)
check((try? String(contentsOf: copyDest, encoding: .utf8)) == "v1", "Export.copy copies content")
try! Data("v2".utf8).write(to: copySrc)
try! Export.copy(copySrc, to: copyDest)
check((try? String(contentsOf: copyDest, encoding: .utf8)) == "v2", "Export.copy re-copy overwrites")

// — route ordering: this IS the send menu, so it is checked here rather
//   than re-derived as conditionals in two views —
let kindleDev = ConnectedDevice(kind: .kindle, name: "Kindle", volume: URL(fileURLWithPath: "/Volumes/Kindle"))
let rmDev = ConnectedDevice(kind: .remarkable, name: "reMarkable", volume: nil)

check(ResultActions.routes(devices: [kindleDev])[0].destination == .device(kindleDev),
      "a plugged-in Kindle is the default route")
check(ResultActions.routes(devices: [], booksAvailable: true)[0].destination == .appleBooks,
      "no device -> Apple Books leads, being local and instant")
check(ResultActions.routes(devices: [], booksAvailable: false)[0].destination == .sendToKindle,
      "no device and no Books -> Send to Kindle leads")
check(ResultActions.routes(devices: [rmDev])[0].destination != .device(rmDev),
      "reMarkable never arrives as a volume device")
check(ResultActions.routes(devices: [], remarkableDocked: true)[0].destination == .remarkable,
      "a docked reMarkable outranks Books")
check(ResultActions.routes(devices: [kindleDev], remarkableDocked: true)[0].destination == .device(kindleDev),
      "a plugged-in volume still wins over a docked reMarkable")

// Save is the floor: some route is always offered, whatever is connected.
for books in [true, false] {
    for mail in [true, false] {
        let r = ResultActions.routes(devices: [], booksAvailable: books, canEmailToKindle: mail)
        check(!r.isEmpty, "routes never empty (books:\(books) mail:\(mail))")
        check(r.contains { $0.destination == .saveCopy },
              "Save is always offered (books:\(books) mail:\(mail))")
        check(Set(r.map(\.id)).count == r.count,
              "no duplicate routes (books:\(books) mail:\(mail))")
    }
}
// Email stays in the catalog when Apple Mail isn't the default client —
// that's fixable at the desk — but flagged unavailable, because the
// degraded mailto: hand-off would silently drop the attachment.
let emailAbsent = ResultActions.routes(devices: [], canEmailToKindle: false)
    .first(where: { $0.destination == .emailToKindle })
check(emailAbsent?.available == false,
      "email route listed but unavailable when Apple Mail can't attach")
check(emailAbsent?.detail.contains("Apple Mail") == true,
      "email placeholder's detail names the fix")
check(ResultActions.routes(devices: [], canEmailToKindle: true)
        .first(where: { $0.destination == .emailToKindle })?.available == true,
      "email route sendable when Apple Mail is the default")
check(!ResultActions.routes(devices: [], booksAvailable: false)
        .contains { $0.destination == .appleBooks },
      "Books route hidden when Books is absent")

// — a remembered choice outranks the ordering heuristic —
let allRoutes = ResultActions.routes(devices: [kindleDev], booksAvailable: true)
check(ResultActions.preselected(in: allRoutes, lastChosen: nil).destination == .device(kindleDev),
      "first run falls back to the ordering")
check(ResultActions.preselected(in: allRoutes, lastChosen: "sendToKindle").destination == .sendToKindle,
      "a remembered choice wins over a plugged-in device")
check(ResultActions.preselected(in: allRoutes, lastChosen: "appleBooks").destination == .appleBooks,
      "remembered Apple Books survives a connected Kindle")
// A remembered route that is structurally gone (Books not installed) must
// not strand the user.
let noBooks = ResultActions.routes(devices: [], booksAvailable: false)
check(ResultActions.preselected(in: noBooks, lastChosen: "appleBooks").destination == .sendToKindle,
      "a structurally absent remembered route falls back instead of vanishing")
check(Destination.device(kindleDev).storageKey == "device:kindle",
      "device key is by kind, not volume path")

// — the menu is a catalog, not a status display: every physical
//   destination is always listed; detection only flips availability —
let bare = ResultActions.routes(devices: [])
for kindName in ["Kindle", "Kobo", "tolino", "reMarkable"] {
    check(bare.contains { $0.title == kindName && !$0.available },
          "\(kindName) is listed while disconnected, flagged unavailable")
}
check(bare[0].available, "the first route is always sendable")
check(bare.prefix(while: \.available).count == bare.filter(\.available).count,
      "unavailable routes sink below every available one")
check(bare.filter { !$0.available }.allSatisfy { $0.detail.contains("USB") || $0.detail.contains("Apple Mail") },
      "every placeholder's detail says how to make it available")
let koboDev = ConnectedDevice(kind: .kobo, name: "KOBOeReader", volume: kobo)
let withKobo = ResultActions.routes(devices: [koboDev])
check(withKobo.filter { $0.destination.storageKey == "device:kobo" }.count == 1,
      "a connected Kobo replaces its placeholder rather than joining it")
check(withKobo.first { $0.destination.storageKey == "device:kobo" }?.available == true,
      "the connected Kobo row is sendable")

// Two same-kind devices must stay individually addressable. The old UI
// keyed its buttons by volume path; if the picker's row identity is only
// the kind, the second Kindle's row collides with the first, selection
// resolves first-match, and a send aimed at the second device lands on
// the first one's volume.
let kindleTwin = ConnectedDevice(kind: .kindle, name: "KINDLE2", volume: URL(fileURLWithPath: "/Volumes/KINDLE2"))
let twins = ResultActions.routes(devices: [kindleDev, kindleTwin])
check(Set(twins.map(\.id)).count == twins.count,
      "route ids stay unique with two same-kind devices connected")
let twinRow = twins.first { $0.title == "KINDLE2" }
check(twinRow.map { row in
        if case .device(let d) = row.destination { return d.volume?.path == "/Volumes/KINDLE2" }
        return false
      } == true,
      "the second device's row carries the second device's volume")
check(ResultActions.preselected(in: twins, lastChosen: "device:kindle").available,
      "a remembered kindle with twins connected resolves to a sendable row")

// The button names exactly what fires. With Amazon's Send to Kindle app
// installed the executor launches the APP — the consolidation dropped
// main's adaptive label and froze the wording on "web".
check(ResultActions.routes(devices: [], sendToKindleApp: true)
        .first(where: { $0.destination == .sendToKindle })?.button == "Send to Kindle app",
      "send-to-kindle button says app when the app will launch")
check(ResultActions.routes(devices: [], sendToKindleApp: false)
        .first(where: { $0.destination == .sendToKindle })?.button == "Send to Kindle web",
      "send-to-kindle button says web when the browser uploader fires")

// The reMarkable slip must name the actual payload: fountain input has no
// original PDF, and the executor falls back to uploading the EPUB.
check(ResultActions.routes(devices: [], remarkableDocked: true, inputIsPDF: false)
        .first(where: { $0.destination == .remarkable })?.detail.contains("EPUB") == true,
      "reMarkable detail names the EPUB when there is no original PDF")
check(ResultActions.routes(devices: [], remarkableDocked: true, inputIsPDF: true)
        .first(where: { $0.destination == .remarkable })?.detail.contains("original PDF") == true,
      "reMarkable detail names the PDF when one exists")

// A pre-0.4 Screepub stored the user's @kindle.com address. The Settings
// field is gone by design, but an address the user already gave us must
// keep pre-addressing the compose — deleting the field must not demote
// existing users from zero-typing to lookup-and-type on every send.
UserDefaults.standard.set("  someone_123@kindle.com  ", forKey: "kindleEmail")
check(SendToKindle.legacyStoredAddress == "someone_123@kindle.com",
      "a stored kindle address is honored, trimmed")
UserDefaults.standard.set("   ", forKey: "kindleEmail")
check(SendToKindle.legacyStoredAddress == nil, "a blank stored address reads as absent")
UserDefaults.standard.removeObject(forKey: "kindleEmail")
check(SendToKindle.legacyStoredAddress == nil, "no stored address reads as absent")

// A remembered device stays chosen while unplugged — the routing slip keeps
// the user's intent and SEND waits for the hardware — but a first run never
// guesses at something that isn't there.
check(ResultActions.preselected(in: bare, lastChosen: "device:kobo").destination.storageKey == "device:kobo",
      "a remembered Kobo stays chosen while unplugged")
check(!ResultActions.preselected(in: bare, lastChosen: "device:kobo").available,
      "…and is flagged unavailable so the view can hold SEND")
check(ResultActions.preselected(in: bare, lastChosen: nil).available,
      "first run never preselects an unavailable route")

// — the SEND button reads the route's own verb, so the click is never a
//   surprise: Copy is USB-offline, Add is local, Upload/Send/Email name
//   exactly what fires —
check(ResultActions.routes(devices: [kindleDev]).first?.button == "Copy to Kindle",
      "device route's button verb is Copy, named for the device")
check(ResultActions.routes(devices: [], remarkableDocked: true).first?.button == "Upload to reMarkable",
      "reMarkable route's button verb is Upload")
check(ResultActions.routes(devices: []).first?.button == "Add to Apple Books",
      "Books route's button verb is Add")
check(ResultActions.routes(devices: [], booksAvailable: false).first?.button == "Send to Kindle web",
      "web route's button carries its mechanism, since the pair exists")
check(ResultActions.routes(devices: [], canEmailToKindle: true)
        .first(where: { $0.destination == .emailToKindle })?.button == "Send to Kindle email",
      "email route's button carries its mechanism")
// The two wireless Kindle routes read as siblings — same name, different
// mechanism — so the menu shows them as a matched pair.
check(ResultActions.routes(devices: []).first(where: { $0.destination == .sendToKindle })?.title == "Send to Kindle web",
      "web route title names the mechanism")
check(ResultActions.routes(devices: [], canEmailToKindle: true)
        .first(where: { $0.destination == .emailToKindle })?.title == "Send to Kindle email",
      "email route title names the mechanism")
check(ResultActions.routes(devices: []).first(where: { $0.destination == .saveCopy })?.button == "Save a Copy…",
      "save route's button stays an ellipsis action")

// — version comparison for the updater —
check(UpdateCheck.isNewer("v0.4.0", than: "0.3.0"), "tag with a v prefix compares cleanly")
check(UpdateCheck.isNewer("0.10.0", than: "0.9.0"),
      "0.10.0 beats 0.9.0 — string ordering would get this backwards")
check(!UpdateCheck.isNewer("0.3.0", than: "0.3.0"), "same version is not an update")
check(!UpdateCheck.isNewer("0.2.9", than: "0.3.0"), "older version is not an update")
check(UpdateCheck.isNewer("0.3.0", than: "0.3.0-dev"),
      "a dev build is offered the matching stable release")
check(!UpdateCheck.isNewer("0.3.0-beta.1", than: "0.3.0"),
      "a pre-release does not supersede the release")
check(UpdateCheck.isNewer("1.0.0", than: "0.99.99"), "major bump wins")
check(!UpdateCheck.isNewer("0.3.0+ci.7", than: "0.3.0"), "build metadata is not a version bump")

// git describe stamps dev builds "0.3.0-1-g<sha>" — one commit PAST the
// tag. Semver would read that suffix as a pre-release BELOW 0.3.0, and the
// updater would then offer (and install) a genuine downgrade on every dev
// build. Describe suffixes mean at-or-past the tag, never before it.
check(!UpdateCheck.isNewer("0.3.0", than: "0.3.0-1-g965cb10"),
      "a describe-distance build is not offered its own tag (downgrade)")
check(!UpdateCheck.isNewer("v0.3.0", than: "0.3.0-1-g965cb10-dirty"),
      "a dirty describe-distance build is not offered its own tag")
check(!UpdateCheck.isNewer("0.3.0", than: "0.3.0-dirty"),
      "an at-tag dirty build is not offered its own tag")
check(UpdateCheck.isNewer("0.3.1", than: "0.3.0-1-g965cb10"),
      "a genuinely newer release still reaches a describe-distance build")

// — update checks are opt-in and throttled: no consent, no request —
let checkNow = Date(timeIntervalSince1970: 1_800_000_000)
check(!UpdateCheck.shouldCheck(optedIn: false, lastChecked: nil, now: checkNow),
      "never checks without opt-in, even on a first launch")
check(UpdateCheck.shouldCheck(optedIn: true, lastChecked: nil, now: checkNow),
      "first opted-in launch checks")
check(!UpdateCheck.shouldCheck(optedIn: true, lastChecked: checkNow.addingTimeInterval(-3600), now: checkNow),
      "an hour-old check is fresh enough — one request a day at most")
check(UpdateCheck.shouldCheck(optedIn: true, lastChecked: checkNow.addingTimeInterval(-25 * 3600), now: checkNow),
      "a day-old check re-checks")
check(!UpdateCheck.shouldCheck(optedIn: true, lastChecked: checkNow.addingTimeInterval(3600), now: checkNow),
      "a clock set backwards does not trigger a check storm")

// — self-update installer: requirement pinning and swap mechanics —
check(UpdateInstaller.appRequirement
        == "anchor apple generic and identifier \"com.darkwell.screepub\""
         + " and certificate 1[field.1.2.840.113635.100.6.2.6] exists"
         + " and certificate leaf[field.1.2.840.113635.100.6.1.13] exists"
         + " and certificate leaf[subject.OU] = \"XSRB3D643J\"",
      "app requirement pins anchor, Developer ID chain, bundle id, and team")
check(UpdateInstaller.dmgRequirement
        == "anchor apple generic"
         + " and certificate 1[field.1.2.840.113635.100.6.2.6] exists"
         + " and certificate leaf[field.1.2.840.113635.100.6.1.13] exists"
         + " and certificate leaf[subject.OU] = \"XSRB3D643J\"",
      "dmg requirement pins the chain and team (a dmg's identifier is its filename)")

// Verification must REJECT everything that isn't ours. /bin/ls is Apple-
// signed with the wrong everything; a text file has no signature at all.
check((try? UpdateInstaller.verify(URL(fileURLWithPath: "/bin/ls"),
                                   requirement: UpdateInstaller.appRequirement)) == nil,
      "an Apple-signed binary that isn't ours fails verification")
let unsigned = tempDir("unsigned").appendingPathComponent("not-an-app.txt")
try! Data("hello".utf8).write(to: unsigned)
check((try? UpdateInstaller.verify(unsigned, requirement: UpdateInstaller.dmgRequirement)) == nil,
      "an unsigned file fails verification")

// Positive verification needs a real Developer ID build. The installed
// /Applications/Screepub.app is one on the maintainer's machine; skip
// gracefully anywhere it isn't.
let installedApp = URL(fileURLWithPath: "/Applications/Screepub.app")
if FileManager.default.fileExists(atPath: installedApp.path) {
    let info = Process()
    info.executableURL = URL(fileURLWithPath: "/usr/bin/codesign")
    info.arguments = ["-dvv", installedApp.path]
    let infoErr = Pipe()
    info.standardError = infoErr
    info.standardOutput = Pipe()
    try! info.run()
    info.waitUntilExit()
    let signInfo = String(data: infoErr.fileHandleForReading.readDataToEndOfFile(), encoding: .utf8) ?? ""
    if signInfo.contains("TeamIdentifier=\(UpdateInstaller.teamID)") {
        check((try? UpdateInstaller.verify(installedApp, requirement: UpdateInstaller.appRequirement)) != nil,
              "the installed Developer ID Screepub passes the pinned requirement")
    } else {
        print("  --  /Applications/Screepub.app is not a Developer ID build; positive verify untested here")
    }
} else {
    print("  --  no /Applications/Screepub.app; positive verify untested here")
}

// Swap mechanics, no signing involved: the new bundle lands, the old one
// is parked then cleaned, and a failed commit leaves the original alone.
let swapDir = tempDir("swap")
let swapDest = swapDir.appendingPathComponent("Fake.app")
try! FileManager.default.createDirectory(at: swapDest, withIntermediateDirectories: true)
try! Data("v1".utf8).write(to: swapDest.appendingPathComponent("marker"))
let stagedNew = swapDir.appendingPathComponent("staged-new")
try! FileManager.default.createDirectory(at: stagedNew, withIntermediateDirectories: true)
try! Data("v2".utf8).write(to: stagedNew.appendingPathComponent("marker"))
try! UpdateInstaller.commit(staged: stagedNew, into: swapDest)
check((try? String(contentsOf: swapDest.appendingPathComponent("marker"), encoding: .utf8)) == "v2",
      "commit swaps the new bundle into place")
check(!FileManager.default.fileExists(atPath: stagedNew.path),
      "commit consumes the staged copy")

let ghostStaged = swapDir.appendingPathComponent("never-existed")
check((try? UpdateInstaller.commit(staged: ghostStaged, into: swapDest)) == nil,
      "a commit with nothing staged throws")
check((try? String(contentsOf: swapDest.appendingPathComponent("marker"), encoding: .utf8)) == "v2",
      "...and leaves the installed bundle untouched")

// The rollback branch itself: the park succeeds, the staged move fails
// (an immutable staged bundle makes rename return EPERM), and the parked
// original MUST come back — this path is all that stands between a failed
// swap and an empty /Applications.
let rbDir = tempDir("rollback")
let rbDest = rbDir.appendingPathComponent("Fake.app")
try! FileManager.default.createDirectory(at: rbDest, withIntermediateDirectories: true)
try! Data("original".utf8).write(to: rbDest.appendingPathComponent("marker"))
let rbStaged = rbDir.appendingPathComponent("staged-locked")
try! FileManager.default.createDirectory(at: rbStaged, withIntermediateDirectories: true)
run(URL(fileURLWithPath: "/usr/bin/chflags"), ["uchg", rbStaged.path])
let rbOutcome = try? UpdateInstaller.commit(staged: rbStaged, into: rbDest)
run(URL(fileURLWithPath: "/usr/bin/chflags"), ["nouchg", rbStaged.path])
check(rbOutcome == nil, "a commit whose staged move fails throws")
check((try? String(contentsOf: rbDest.appendingPathComponent("marker"), encoding: .utf8)) == "original",
      "…and the parked original is restored to the destination")

let leftoverDir = tempDir("leftovers")
let leftoverApp = leftoverDir.appendingPathComponent("Fake.app")
try! FileManager.default.createDirectory(at: leftoverApp, withIntermediateDirectories: true)
let parked = leftoverDir.appendingPathComponent(".Fake.app.old-999")
let staleStage = leftoverDir.appendingPathComponent(".Fake.app.staged")
try! FileManager.default.createDirectory(at: parked, withIntermediateDirectories: true)
try! FileManager.default.createDirectory(at: staleStage, withIntermediateDirectories: true)
UpdateInstaller.cleanupLeftovers(near: leftoverApp)
check(!FileManager.default.fileExists(atPath: parked.path),
      "cleanup removes parked old bundles")
check(!FileManager.default.fileExists(atPath: staleStage.path),
      "cleanup removes a stale staged copy")
check(FileManager.default.fileExists(atPath: leftoverApp.path),
      "cleanup never touches the installed bundle")

check(UpdateInstaller.isTranslocated(URL(fileURLWithPath: "/private/var/folders/x/AppTranslocation/ABC/d/Screepub.app")),
      "a translocated bundle path is recognized")
check(!UpdateInstaller.isTranslocated(URL(fileURLWithPath: "/Applications/Screepub.app")),
      "a normal install location is not translocated")

// Preflight answers "can a swap land here?" BEFORE any bytes download —
// discovering translocation only after a full DMG download wastes the
// download and then deletes the very DMG the failure message points at.
check((try? UpdateInstaller.preflight(
        destination: URL(fileURLWithPath: "/private/var/folders/x/AppTranslocation/ABC/d/Screepub.app"))) == nil,
      "preflight rejects a translocated bundle before any download")
let preflightDir = tempDir("preflight")
let preflightApp = preflightDir.appendingPathComponent("Fake.app")
try! FileManager.default.createDirectory(at: preflightApp, withIntermediateDirectories: true)
check((try? UpdateInstaller.preflight(destination: preflightApp)) != nil,
      "preflight passes a writable install location")

// The signature proves a bundle is OURS; the version pin proves it is the
// RELEASE THE USER WAS PROMISED. Without it, any genuine older DMG passes
// every requirement and installs as a downgrade replay.
let vDir = tempDir("version-pin")
let vApp = vDir.appendingPathComponent("Fake.app")
try! FileManager.default.createDirectory(at: vApp.appendingPathComponent("Contents"), withIntermediateDirectories: true)
try! """
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>CFBundleShortVersionString</key><string>0.1.0</string>
</dict></plist>
""".write(to: vApp.appendingPathComponent("Contents/Info.plist"), atomically: true, encoding: .utf8)
check(UpdateInstaller.bundleShortVersion(of: vApp) == "0.1.0",
      "bundleShortVersion reads the app's Info.plist")
check((try? UpdateInstaller.requireVersion(vApp, expected: "0.4.0")) == nil,
      "a genuine older bundle fails the version pin (downgrade replay)")
check((try? UpdateInstaller.requireVersion(vApp, expected: "0.1.0")) != nil,
      "the promised version passes the pin")
check((try? UpdateInstaller.requireVersion(vApp, expected: "v0.1.0")) != nil,
      "the pin normalizes tag prefixes")
let vNoPlist = vDir.appendingPathComponent("Empty.app")
try! FileManager.default.createDirectory(at: vNoPlist, withIntermediateDirectories: true)
check((try? UpdateInstaller.requireVersion(vNoPlist, expected: "0.1.0")) == nil,
      "a bundle with no readable version fails the pin rather than passing")

// End-to-end against a real release DMG, when one is provided:
//   SCREEPUB_UPDATE_DMG=path/to/Screepub-macOS.dmg swift run kit-check
if let dmgPath = ProcessInfo.processInfo.environment["SCREEPUB_UPDATE_DMG"] {
    let dmg = URL(fileURLWithPath: dmgPath)
    let e2eDest = tempDir("e2e").appendingPathComponent("Screepub.app")
    do {
        try UpdateInstaller.install(dmg: dmg, over: e2eDest, expectedVersion: nil)
        check(FileManager.default.fileExists(atPath: e2eDest.appendingPathComponent("Contents/MacOS/Screepub").path),
              "install(dmg:over:) lands a complete app bundle")
        check((try? UpdateInstaller.verify(e2eDest, requirement: UpdateInstaller.appRequirement)) != nil,
              "the installed bundle still passes the pinned requirement")
    } catch {
        check(false, "install(dmg:over:) succeeds on the release DMG (got: \(error))")
    }
} else {
    print("  --  SCREEPUB_UPDATE_DMG not set; full install flow untested here")
}

// — default mail client detection (value is machine-dependent) —
let isAppleMail = await MainActor.run { SendToKindle.defaultMailClientIsAppleMail }
check(isAppleMail == true || isAppleMail == false,
      "default-mail-client detection resolves without crashing")

// — Apple Books (the iOS route; Books ships with macOS but can be absent) —
check(AppleBooks.isAvailable == (AppleBooks.appURL != nil),
      "Books availability agrees with the resolved app URL")
if let books = AppleBooks.appURL {
    check(FileManager.default.fileExists(atPath: books.path),
          "resolved Books.app actually exists on disk")
    check(books.pathExtension == "app", "Books resolves to an app bundle")
} else {
    // A machine without Books must hide the button rather than offer a
    // no-op: send() returning false is what the views key off.
    let sent = await MainActor.run { AppleBooks.send(URL(fileURLWithPath: "/tmp/none.epub")) }
    check(sent == false, "send() reports failure when Books is absent")
}

final class ErrLines: @unchecked Sendable {
    private let lock = NSLock()
    private(set) var lines: [String] = []
    func append(_ s: String) { lock.lock(); lines.append(s); lock.unlock() }
}

// — KFX toolchain (environment-dependent, like the ebook-convert checks) —
check(ExportFormat.kindle.fileExtension(calibreAvailable: true, kfxReady: true) == "kfx",
      "kindle export prefers kfx when the toolchain is ready")
check(ExportFormat.kindle.fileExtension(calibreAvailable: true, kfxReady: false) == "azw3",
      "kindle export falls back to azw3 without the toolchain")
check(ExportFormat.kindle.fileExtension(calibreAvailable: false, kfxReady: false) == "mobi",
      "kindle export bottoms out at mobi")
check(ExportFormat.kindle.label(calibreAvailable: true, kfxReady: true).contains("best quality"),
      "kfx label says why it's preferred")
check(KFXToolchain.bundledPluginURL() != nil,
      "vendored plugin zip resolves from the package resources")

// Both Calibre rungs draw their preprocessing guards from ONE constant —
// pin the trio so an accidental edit is loud (the values are the
// device-verified 2026-07-29 recipe).
check(KFXToolchain.calibreFormatGuards ==
        ["--page-breaks-before=/", "--chapter-mark=none", "--disable-remove-fake-margins"],
      "the calibre format guards are the device-verified trio")

// The runner must deliver COMPLETE output even when a child floods both
// pipes past the 64KB buffer: the drains join on EOF before anything reads
// the streams, so no tail chunk can be lost to a torn-down handler
// mid-flight. A lost stdout tail here is how "KFX Output" goes missing
// from --list-plugins and a working toolchain silently falls to AZW3.
let flood = (try? KFXToolchain.run(
    tool: URL(fileURLWithPath: "/bin/sh"),
    arguments: ["-c",
        "dd if=/dev/zero bs=1024 count=200 2>/dev/null | tr '\\0' 'x'; printf 'END-OF-STDOUT'; dd if=/dev/zero bs=1024 count=200 2>/dev/null | cat >&2"])) ?? ""
check(flood.hasSuffix("END-OF-STDOUT"), "runner captures the stdout tail under a two-pipe flood")
check(flood.count == 200 * 1024 + 13, "runner loses no stdout bytes under flood")

// An interrupted conversion must never leave a partial file at the final
// .kfx path — the ladder's staleness reuse would trust it forever (mtime
// newer than the EPUB) and copy a corrupt book on every later send. The
// tool writes into a hidden same-directory scratch instead, and only a
// COMPLETED conversion is renamed into place.
let kfxScratch = KFXToolchain.scratchURL(for: URL(fileURLWithPath: "/tmp/lib/Script.epub"))
check(kfxScratch.lastPathComponent == ".Script.partial.kfx",
      "KFX scratch is hidden, same-stem, and keeps the .kfx extension")
check(kfxScratch.deletingLastPathComponent().path == "/tmp/lib",
      "KFX scratch stays in the output directory (promote is a same-volume rename)")

let kfxStatus = KFXToolchain.status()
check(kfxStatus.ready == (kfxStatus.calibre && kfxStatus.previewer && kfxStatus.pluginInstalled),
      "toolchain readiness is exactly its three components")
if kfxStatus.ready {
    // The full chain, through the new Swift path: mini EPUB → plugin →
    // Kindle Previewer → repack → .kfx. Slow (~20s) but this is the one
    // assertion that proves the product code end to end.
    let miniEpub = makeMiniScriptEpub()
    let stages = ErrLines()
    if let kfx = try? KFXToolchain.convert(miniEpub, onStage: { stages.append($0) }) {
        check(FileManager.default.fileExists(atPath: kfx.path), "KFX conversion produces a file")
        let size = (try? FileManager.default.attributesOfItem(atPath: kfx.path)[.size] as? Int) ?? 0
        check(size > 10_000, "KFX output is plausibly a book, not a stub")
        check(!stages.lines.isEmpty, "conversion reported progress stages while running")
        check(stages.lines.contains { $0.contains("Amazon") },
              "the long Previewer wait is named as a stage")
        check(!FileManager.default.fileExists(atPath: KFXToolchain.scratchURL(for: miniEpub).path),
              "no scratch remains after a completed conversion")
    } else {
        check(false, "KFX conversion failed with a ready toolchain")
    }
} else {
    print("  --  KFX toolchain incomplete on this machine; conversion untested here")
}

// — Engine progress and cancellation —
// The conversion page showed an indeterminate spinner because the engine
// said nothing until it finished. These checks cover the reporting channel
// and the cancel path; the engine's own share is covered by
// tests/cli.test.ts and tests/extract.test.ts.
let fixture = repoRoot.appendingPathComponent("tests/fixtures/screenplay.pdf")

if Engine.binaryURL() == nil {
    print("  --  no engine binary; run bun build first. Engine checks skipped")
} else if !FileManager.default.fileExists(atPath: fixture.path) {
    print("  --  committed fixture missing; Engine checks skipped")
} else {
    // Progress arrives, climbs, and finishes. The callback fires on the
    // pipe's read queue, so the collector has to be safe to share.
    final class Ticks: @unchecked Sendable {
        private let lock = NSLock()
        private var values: [Double] = []
        func add(_ v: Double) { lock.lock(); values.append(v); lock.unlock() }
        var all: [Double] { lock.lock(); defer { lock.unlock() }; return values }
    }
    let ticks = Ticks()
    do {
        let result = try Engine.convert(
            input: fixture, force: false, outputDir: tempDir("progress"),
            includeMobi: false,
            onProgress: { _, fraction in ticks.add(fraction) }
        )
        check(result.ok, "engine converts the committed fixture")

        let seen = ticks.all
        check(!seen.isEmpty, "conversion reported progress at least once")
        check(seen == seen.sorted(), "reported progress never goes backwards")
        check(seen.last.map { $0 >= 0.99 } ?? false, "progress reaches 100% at the end")
    } catch {
        check(false, "engine conversion with progress threw: \(error)")
    }

    // Cancelling before the run starts is the deterministic half of the
    // cancel path: a mid-flight cancel on a five-page fixture would race the
    // conversion itself. Both go through the same adopt/terminate gate.
    let control = ConversionControl()
    control.cancel()
    do {
        _ = try Engine.convert(
            input: fixture, force: false, outputDir: tempDir("cancelled"),
            includeMobi: false, control: control
        )
        check(false, "a pre-cancelled conversion should not return a result")
    } catch EngineFailure.cancelled {
        check(true, "a cancelled conversion throws EngineFailure.cancelled")
    } catch {
        check(false, "cancelled conversion threw the wrong error: \(error)")
    }

    // Progress is opt-in: no callback means no --progress flag, so stderr
    // stays the diagnostic channel it has always been.
    do {
        let quiet = try Engine.convert(
            input: fixture, force: false, outputDir: tempDir("quiet"), includeMobi: false
        )
        check(quiet.ok, "conversion without a progress callback still succeeds")
    } catch {
        check(false, "conversion without progress threw: \(error)")
    }
}

// — Update selection —
// Pure over ReleaseCandidate, so every rule below is checked without a
// network. GitHubRelease stays private; this is the seam kit-check can reach.
func candidate(
    _ tag: String,
    dmg: Bool = true,
    body: String? = "notes",
    draft: Bool = false,
    prerelease: Bool = false
) -> ReleaseCandidate {
    ReleaseCandidate(
        tag: tag,
        notesURL: URL(string: "https://example.invalid/\(tag)")!,
        dmgURL: dmg ? URL(string: "https://example.invalid/\(tag).dmg")! : nil,
        body: body,
        isDraft: draft,
        isPrerelease: prerelease
    )
}

do {
    let picked = try UpdateCheck.select(
        releases: [candidate("v0.6.0"), candidate("v0.5.0"), candidate("v0.4.2")],
        currentVersion: "0.4.2"
    )
    check(picked?.version == "0.6.0", "selection takes the newest release")
    check(picked?.notes.map(\.version) == ["0.6.0", "0.5.0"],
          "notes cover every version newer than the installed one")
    // The app presents the release-notes sheet with .sheet(item:), which
    // identifies presentations by this id — it has to track `version`
    // exactly, or two different releases could collide onto one
    // presentation (or a genuine update stop being seen as "new").
    check(picked?.id == picked?.version,
          "AvailableUpdate.id is its version, the key .sheet(item:) presents on")
} catch {
    check(false, "selection threw unexpectedly: \(error)")
}

do {
    // The newest release sits in the MIDDLE of the input array, not first
    // or last. That defeats a naive `.first` (picks v0.5.0) AND a naive
    // `.last`-after-reversal fix (picks v0.6.0) — only an actual sort by
    // version, not by position, lands on v0.9.0 here.
    let picked = try UpdateCheck.select(
        releases: [candidate("v0.5.0"), candidate("v0.9.0"), candidate("v0.6.0")],
        currentVersion: "0.4.2"
    )
    check(picked?.version == "0.9.0", "selection finds the newest release when it's not first in the input")
    check(picked?.notes.map(\.version) == ["0.9.0", "0.6.0", "0.5.0"],
          "notes stay newest-first regardless of input order")
} catch {
    check(false, "scrambled-order selection threw unexpectedly: \(error)")
}

do {
    let picked = try UpdateCheck.select(
        releases: [candidate("v0.7.0", draft: true),
                   candidate("v0.6.5", prerelease: true),
                   candidate("v0.6.0")],
        currentVersion: "0.4.2"
    )
    check(picked?.version == "0.6.0", "drafts and prereleases are skipped")
    check(picked?.notes.count == 1, "skipped releases contribute no notes")
} catch {
    check(false, "draft/prerelease selection threw: \(error)")
}

do {
    let none = try UpdateCheck.select(
        releases: [candidate("v0.4.2"), candidate("v0.4.1")],
        currentVersion: "0.4.2"
    )
    check(none == nil, "nothing newer means no update")
} catch {
    check(false, "up-to-date selection threw: \(error)")
}

do {
    _ = try UpdateCheck.select(
        releases: [candidate("v0.6.0", dmg: false)],
        currentVersion: "0.4.2"
    )
    check(false, "a newest release with no .dmg should throw")
} catch UpdateCheckError.noDownloadableAsset {
    check(true, "a newest release with no .dmg throws noDownloadableAsset")
} catch {
    check(false, "wrong error for a missing .dmg: \(error)")
}

do {
    let picked = try UpdateCheck.select(
        releases: [candidate("v0.6.0", body: nil)],
        currentVersion: "0.4.2"
    )
    check(picked?.notes.first?.markdown == "",
          "a release with no body still contributes an empty note")
} catch {
    check(false, "nil-body selection threw: \(error)")
}

// — Update decoding —
// The exact shape GitHub returns, including the body field the old decoder
// silently dropped.
// v0.6.0 and v0.5.0 stay first/last so the pre-existing body/dmg assertions
// below still target them unchanged; the draft and prerelease releases sit
// in between, each with its own .dmg so they are otherwise valid releases
// and the flag under test is the only thing distinguishing them.
let releasesJSON = """
[
  {"tag_name":"v0.6.0","html_url":"https://example.invalid/6","draft":false,
   "prerelease":false,"body":"# Screepub 0.6.0\\n\\nNewer.",
   "assets":[{"name":"Screepub-0.6.0.dmg",
              "browser_download_url":"https://example.invalid/6.dmg"}]},
  {"tag_name":"v0.7.0","html_url":"https://example.invalid/7","draft":true,
   "prerelease":false,"body":"# Screepub 0.7.0\\n\\nDraft.",
   "assets":[{"name":"Screepub-0.7.0.dmg",
              "browser_download_url":"https://example.invalid/7.dmg"}]},
  {"tag_name":"v0.6.5","html_url":"https://example.invalid/6.5","draft":false,
   "prerelease":true,"body":"# Screepub 0.6.5\\n\\nPrerelease.",
   "assets":[{"name":"Screepub-0.6.5.dmg",
              "browser_download_url":"https://example.invalid/6.5.dmg"}]},
  {"tag_name":"v0.5.0","html_url":"https://example.invalid/5","draft":false,
   "prerelease":false,"body":"# Screepub 0.5.0\\n\\nOlder.","assets":[]}
]
"""
do {
    let decoded = try UpdateCheck.candidates(from: Data(releasesJSON.utf8))
    check(decoded.count == 4, "decoding reads every release in the array")
    check(decoded.first?.body?.contains("Newer.") == true,
          "the release body is decoded, not dropped")
    check(decoded.first?.dmgURL != nil, "the .dmg asset is found")
    check(decoded.last?.dmgURL == nil, "a release with no assets has no dmgURL")

    // isDraft/isPrerelease gate whether select() can ever offer this release
    // as an update, so each flag is checked propagating true on the release
    // that sets it, and false on releases that don't set it — a mapping
    // that hardcodes either value, or swaps the two fields, fails one of
    // these four checks.
    let draftCandidate = decoded.first(where: { $0.tag == "v0.7.0" })
    check(draftCandidate?.isDraft == true,
          "the draft flag propagates from GitHub's JSON to the candidate")
    let prereleaseCandidate = decoded.first(where: { $0.tag == "v0.6.5" })
    check(prereleaseCandidate?.isPrerelease == true,
          "the prerelease flag propagates from GitHub's JSON to the candidate")

    let plainNewer = decoded.first(where: { $0.tag == "v0.6.0" })
    check(plainNewer?.isDraft == false, "an ordinary release decodes isDraft false")
    check(plainNewer?.isPrerelease == false, "an ordinary release decodes isPrerelease false")
    let plainOlder = decoded.first(where: { $0.tag == "v0.5.0" })
    check(plainOlder?.isDraft == false, "the other ordinary release decodes isDraft false")
    check(plainOlder?.isPrerelease == false, "the other ordinary release decodes isPrerelease false")
} catch {
    check(false, "decoding valid release JSON threw: \(error)")
}

do {
    _ = try UpdateCheck.candidates(from: Data("not json".utf8))
    check(false, "malformed JSON should throw")
} catch UpdateCheckError.malformedResponse(_) {
    check(true, "malformed JSON throws malformedResponse")
} catch {
    check(false, "wrong error for malformed JSON: \(error)")
}

// — Release notes parsing —
// The committed 0.5.0 notes are the fixture, but they are only the PROSE
// half of what GitHub actually publishes: release.yml copies this file
// verbatim and then appends a machine-generated trailer ("\n\n---\n\n",
// an install paragraph, and a fenced SHA-256 block — see the "Publish
// GitHub Release" step). ReleaseNotes.parse stops at that "---" rather
// than rendering the trailer, which the equality check below proves.
let notesFixture = repoRoot.appendingPathComponent("docs/releases/0.5.0.md")
if let markdown = try? String(contentsOf: notesFixture, encoding: .utf8) {
    let blocks = ReleaseNotes.parse(markdown)

    // CRLF must parse identically to LF: components(separatedBy: .newlines)
    // splits "\r" and "\n" independently rather than treating "\r\n" as one
    // separator, so an unnormalized CRLF file turns every real line break
    // into a phantom blank line and shatters blocks mid-sentence. Equality
    // against the LF parse is the strong form a reviewer asked for: a
    // block-COUNT check alone could miss two shatters that happened to sum
    // back to the same total.
    let crlfMarkdown = markdown
        .replacingOccurrences(of: "\r\n", with: "\n")
        .replacingOccurrences(of: "\n", with: "\r\n")
    check(ReleaseNotes.parse(crlfMarkdown) == blocks,
          "CRLF line endings parse to the same blocks as LF")

    // The real GitHub release body, synthesized the way release.yml's
    // "Publish GitHub Release" step actually builds it: this file's bytes,
    // then its literal appended trailer. Parsing that full body must equal
    // parsing the file alone — this is the assertion that would have
    // caught the trailer rendering as five extra blocks (a "---"
    // paragraph, two install paragraphs, a "SHA-256:" line, and one long
    // paragraph of raw hex) on every version shown in the sheet.
    let publishedTrailer = "\n\n---\n\n"
        + "Notarized universal build for macOS 14+ (Apple Silicon and Intel).\n\n"
        + "**Install:** download `Screepub-macOS.dmg`, open it, drag Screepub to Applications, and double-click.\n\n"
        + "SHA-256:\n"
        + "\n```\n"
        + "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa  Screepub-macOS.dmg\n"
        + "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb  screepub-cli-macos-arm64.tar.gz\n"
        + "cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc  screepub-cli-macos-x64.tar.gz\n"
        + "```\n"
    let publishedBody = markdown + publishedTrailer
    check(ReleaseNotes.parse(publishedBody) == blocks,
          "the release.yml trailer (---, install paragraphs, SHA-256 block) parses identically to the notes file alone")

    var sections = 0, bullets = 0, paragraphs = 0, asides = 0
    var leads: [String] = []
    for block in blocks {
        switch block {
        case .section: sections += 1
        case .bullet(let lead, _): bullets += 1; if let lead { leads.append(lead) }
        case .paragraph: paragraphs += 1
        case .aside: asides += 1
        }
    }
    check(sections >= 1, "parses ## headings into sections")
    check(bullets >= 1, "parses - lines into bullets")
    check(paragraphs >= 1, "parses prose into paragraphs")
    check(asides == 1, "parses the trailing italic note into an aside")

    check(leads.contains("No more orphaned lines."),
          "a bold lead becomes the bullet's lead, without asterisks")

    let titleText = blocks.contains { block in
        if case .section(let t) = block { return t.contains("Screepub 0.5.0") }
        if case .paragraph(let t) = block { return t.contains("# Screepub") }
        return false
    }
    check(!titleText, "the # title line produces no block")

    // No text lost. Every word in the source, minus markdown punctuation,
    // the dropped title LINE, and any HTML comment marker, must survive
    // into some block — checked by COUNT, not just membership. A Set
    // comparison cannot see a single dropped occurrence of a word that
    // recurs elsewhere: proof is dropping "page" from the lede alone
    // ("about page turns" -> "about turns") still passes a Set diff,
    // because "page" survives in other bullets in this same fixture.
    func wordCounts(_ s: String) -> [String: Int] {
        s.replacingOccurrences(of: "*", with: " ")
         .replacingOccurrences(of: "#", with: " ")
         .replacingOccurrences(of: "-", with: " ")
         .split(whereSeparator: { $0 == " " || $0.isNewline })
         .reduce(into: [:]) { counts, word in counts[String(word), default: 0] += 1 }
    }
    var rendered = ""
    for block in blocks {
        switch block {
        case .section(let t): rendered += " " + t
        case .bullet(let lead, let body): rendered += " " + (lead ?? "") + " " + body
        case .paragraph(let t): rendered += " " + t
        case .aside(let t): rendered += " " + t
        }
    }
    // Mirrors ReleaseNotes' own stripHTMLComments (private, so duplicated
    // here rather than exposed as public API just for this check): a
    // marker is markup, not prose, so it is excluded from what "no text
    // lost" demands the parser keep — the same way the # title line is
    // excluded below, and for the same reason.
    func stripComments(_ s: String) -> String {
        var result = ""
        var remainder = Substring(s)
        while let open = remainder.range(of: "<!--") {
            result += remainder[remainder.startIndex..<open.lowerBound]
            if let close = remainder.range(of: "-->", range: open.upperBound..<remainder.endIndex) {
                remainder = remainder[close.upperBound...]
            } else {
                remainder = remainder[remainder.endIndex...]
            }
        }
        result += remainder
        return result
    }
    // Excluding the whole document minus a fixed word list would also
    // excuse a lost "Screepub" or "0.5.0" wherever they appear in real
    // prose (lines 8, 36, 41 of this fixture use "Screepub"). Filtering
    // just the title LINE keeps the check blind only to what it should be:
    // the one line the parser is specified to drop.
    let bodyOnly = markdown
        .components(separatedBy: .newlines)
        .filter { !$0.trimmingCharacters(in: .whitespaces).hasPrefix("# ") }
        .map(stripComments)
        .joined(separator: "\n")
    let sourceCounts = wordCounts(bodyOnly)
    let renderedCounts = wordCounts(rendered)
    let shortfalls = sourceCounts.compactMap { word, needed -> String? in
        let have = renderedCounts[word] ?? 0
        guard have < needed else { return nil }
        return "\(word): \(have)/\(needed)"
    }.sorted()
    check(shortfalls.isEmpty, "no text is lost in parsing (shortfalls: \(shortfalls.prefix(5)))")
} else {
    check(false, "could not read the 0.5.0 notes fixture")
}

check(ReleaseNotes.parse("").isEmpty, "empty input parses to no blocks")
check(ReleaseNotes.parse("Mystery: [a link](x) and `code`.").count == 1,
      "unrecognized syntax degrades to one paragraph rather than vanishing")

// GitHub hides a release-notes-template.md marker like
// "<!-- caveat: registry-17 -->" because it renders markdown to HTML; our
// sheet renders these blocks as plain SwiftUI Text, so a marker left in
// would show up to the reader as literal text. The parser must drop it
// while keeping the prose it trails.
let markerBlocks = ReleaseNotes.parse(
    "- Inert if ignored, so this is safe. <!-- caveat: registry-17 -->"
)
check(markerBlocks.count == 1, "a marker line still parses to exactly one block")
if case .bullet(_, let body)? = markerBlocks.first {
    check(body.contains("Inert if ignored, so this is safe."),
          "the marker bullet keeps its prose")
    check(!body.contains("<!--") && !body.contains("-->") && !body.contains("registry-17"),
          "the marker bullet drops the comment tags and marker text alike")
} else {
    check(false, "a bullet with a trailing HTML comment still parses to a bullet")
}

// — adversarial inputs: markdown punctuation with no content behind it —
// flush() used to check emptiness on the joined text BEFORE splitLead and
// unemphasize stripped markdown, so a line that was only "**" survived as
// an empty block. Re-checked AFTER the strip, all four of these must
// vanish rather than produce a stray empty bullet, paragraph, or dash.
check(ReleaseNotes.parse("- **").isEmpty,
      "a bullet that is only markdown punctuation yields no block")
check(ReleaseNotes.parse("**").isEmpty,
      "a paragraph that is only markdown punctuation yields no block")
check(ReleaseNotes.parse("- ****").isEmpty,
      "a fully-empty bold bullet yields no block rather than an empty-but-non-nil lead")
check(ReleaseNotes.parse("- ").isEmpty,
      "a bullet marker with nothing after it yields no block, not a stray dash")
check(ReleaseNotes.parse("## **Bold** Heading") == [.section("Bold Heading")],
      "a heading's inline bold is flattened, same as every other block")

// — Update error descriptions —
// These strings reach an NSAlert in manualUpdateCheck(). Without
// LocalizedError, Swift bridges to NSError and localizedDescription becomes
// "The operation couldn't be completed. (UpdateCheckError error 2.)", which
// is what the user was being shown.
let describedErrors: [(UpdateCheckError, String)] = [
    (.rateLimited, "rateLimited"),
    (.network("HTTP 503"), "network"),
    (.malformedResponse("index 1: key 'draft' not found"), "malformedResponse"),
    (.noDownloadableAsset, "noDownloadableAsset"),
]
for (error, label) in describedErrors {
    check(error.errorDescription?.isEmpty == false,
          "\(label) has a non-empty errorDescription")
    // The assertion that actually fails if the conformance is ever dropped.
    check(error.localizedDescription.contains("couldn't be completed") == false
            && error.localizedDescription.contains("couldn’t be completed") == false,
          "\(label) does not fall back to Foundation's placeholder")
}

check(UpdateCheckError.network("HTTP 503").localizedDescription.contains("503"),
      "network carries its detail into the description")
check(UpdateCheckError.malformedResponse("key 'draft' not found")
        .localizedDescription.contains("key 'draft' not found"),
      "malformedResponse carries its detail into the description")

// Invalid JSON, which reaches describe()'s .dataCorrupted arm with an empty
// codingPath. That arm has no decoder-sourced text to check, so non-empty is
// the strongest assertion it admits. The missing-key case below is what
// proves a real reason reached the payload rather than a constant.
do {
    _ = try UpdateCheck.candidates(from: Data("not json".utf8))
    check(false, "malformed JSON should throw")
} catch UpdateCheckError.malformedResponse(let detail) {
    check(!detail.isEmpty, "a decode failure carries the decoder's own reason")
} catch {
    check(false, "wrong error for malformed JSON: \(error)")
}

// The stronger boundary: a non-empty string alone doesn't prove the detail
// is the decoder's OWN reason rather than a hardcoded stand-in like
// "decode failed", which "not json" above can't rule out either since it
// has no array to index into. A syntactically valid array with one bad
// element can: the detail must name both the missing key and which
// element was bad.
do {
    let oneBadElement = """
    [
      {"tag_name":"v0.6.0","html_url":"https://example.invalid/6","draft":false,
       "prerelease":false,"body":"ok","assets":[]},
      {"html_url":"https://example.invalid/5","draft":false,
       "prerelease":false,"body":"ok","assets":[]}
    ]
    """
    _ = try UpdateCheck.candidates(from: Data(oneBadElement.utf8))
    check(false, "a release missing tag_name should throw")
} catch UpdateCheckError.malformedResponse(let detail) {
    check(detail.contains("tag_name"), "the decode failure names the missing key")
    check(detail.contains("1"), "the decode failure names which element was bad")
} catch {
    check(false, "wrong error for a missing key: \(error)")
}

print(failures == 0 ? "kit-check: all passed" : "kit-check: \(failures) FAILED")
exit(failures == 0 ? 0 : 1)
