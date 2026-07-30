// swift-tools-version: 6.0
import PackageDescription

// Standalone on purpose: nothing in here knows about screenplays. If you
// want "produce sideload-able KFX on macOS, with setup handled" in your own
// app, this directory lifts out of this repo as-is (MIT — see LICENSE; the
// vendored Calibre plugin it carries is GPL-3, see Sources/KFXKit/Vendor/).
let package = Package(
    name: "KFXKit",
    platforms: [.macOS(.v14)],
    products: [
        .library(name: "KFXKit", targets: ["KFXKit"]),
    ],
    targets: [
        .target(
            name: "KFXKit",
            resources: [.copy("Vendor")]
        ),
    ]
)
