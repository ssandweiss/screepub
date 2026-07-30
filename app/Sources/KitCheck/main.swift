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
// FormatSettings has non-optional fields, so a key renamed or missing on
// either side fails the decode, and a value drifted fails the equality —
let defaultsFile = repoRoot.appendingPathComponent("format-defaults.json")
if let defaultsData = try? Data(contentsOf: defaultsFile) {
    let canonical = try? JSONDecoder().decode(FormatSettings.self, from: defaultsData)
    check(canonical != nil, "canonical format-defaults.json decodes into FormatSettings")
    check(canonical == FormatSettings.defaults,
          "FormatSettings.defaults matches the canonical file the engine pins")
} else {
    print("  --  format-defaults.json not found (partial checkout); sync untested here")
}

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

print(failures == 0 ? "kit-check: all passed" : "kit-check: \(failures) FAILED")
exit(failures == 0 ? 0 : 1)
