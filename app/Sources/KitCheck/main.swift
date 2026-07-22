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

print(failures == 0 ? "kit-check: all passed" : "kit-check: \(failures) FAILED")
exit(failures == 0 ? 0 : 1)
