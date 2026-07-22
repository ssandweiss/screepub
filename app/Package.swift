// swift-tools-version: 6.0
import PackageDescription

let package = Package(
    name: "ScreepubApp",
    platforms: [.macOS(.v14)],
    targets: [
        .target(name: "ScreepubKit", path: "Sources/ScreepubKit"),
        .executableTarget(
            name: "ScreepubApp",
            dependencies: ["ScreepubKit"],
            path: "Sources/ScreepubApp"
        ),
        // Behavior checks as a plain executable — CommandLineTools ships
        // neither XCTest nor swift-testing. Run: swift run kit-check
        .executableTarget(
            name: "kit-check",
            dependencies: ["ScreepubKit"],
            path: "Sources/KitCheck"
        ),
    ]
)
