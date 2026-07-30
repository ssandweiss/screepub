// swift-tools-version: 6.0
import PackageDescription

let package = Package(
    name: "ScreepubApp",
    platforms: [.macOS(.v14)],
    dependencies: [
        // In-repo package, deliberately self-contained (own LICENSE) so it
        // can graduate to its own repository without a rewrite.
        .package(path: "Packages/KFXKit"),
    ],
    targets: [
        .target(name: "ScreepubKit",
                dependencies: ["KFXKit"],
                path: "Sources/ScreepubKit"),
        .executableTarget(
            name: "ScreepubApp",
            dependencies: ["ScreepubKit", "KFXKit"],
            path: "Sources/ScreepubApp"
        ),
        // Behavior checks as a plain executable — CommandLineTools ships
        // neither XCTest nor swift-testing. Run: swift run kit-check
        .executableTarget(
            name: "kit-check",
            dependencies: ["ScreepubKit", "KFXKit"],
            path: "Sources/KitCheck"
        ),
    ]
)
