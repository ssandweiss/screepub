import Foundation

public enum UpdateInstallError: Error, Equatable {
    case downloadFailed(String)
    case verificationFailed(String)
    case mountFailed(String)
    case appMissingInDMG
    /// Translocated bundle, read-only destination: places a swap can't reach.
    case notInstallable(String)
    case swapFailed(String)
}

/// Downloads a release DMG, proves it is ours, and swaps it into place.
///
/// Trust model: the release pipeline (app/release.sh) already Developer-ID-
/// signs and notarizes both the app and the DMG that carries it. Rather than
/// shipping a second key the way Sparkle does (EdDSA + appcast), the
/// installer pins codesign DESIGNATED REQUIREMENTS: Apple's anchor, the
/// Developer ID certificate chain, our Team ID, and (for the app) our bundle
/// identifier. A DMG built by anyone else fails the check no matter how the
/// download arrived, so the download channel doesn't need to be trusted.
///
/// The staged copy is verified BEFORE the swap, so the install destination
/// never holds an unverified bundle, and the final bundle is verified again
/// after the swap for good measure.
public enum UpdateInstaller {
    public static let teamID = "XSRB3D643J"
    public static let bundleID = "com.darkwell.screepub"

    // MARK: - Requirements

    /// Requirement for Screepub.app: Developer ID chain, our team, our
    /// bundle identifier. field...6.2.6 is the Developer ID intermediate CA;
    /// field...6.1.13 is a Developer ID Application leaf.
    public static let appRequirement: String =
        "anchor apple generic and identifier \"\(bundleID)\""
            + " and certificate 1[field.1.2.840.113635.100.6.2.6] exists"
            + " and certificate leaf[field.1.2.840.113635.100.6.1.13] exists"
            + " and certificate leaf[subject.OU] = \"\(teamID)\""

    /// Requirement for the DMG container: same chain and team. A codesigned
    /// DMG's identifier is its filename stem, not a bundle id, so the
    /// identifier is deliberately not pinned here.
    public static let dmgRequirement: String =
        "anchor apple generic"
            + " and certificate 1[field.1.2.840.113635.100.6.2.6] exists"
            + " and certificate leaf[field.1.2.840.113635.100.6.1.13] exists"
            + " and certificate leaf[subject.OU] = \"\(teamID)\""

    // MARK: - Verification

    /// `codesign --verify` the target against a designated requirement.
    /// Throws with codesign's own words when the target fails.
    public static func verify(_ target: URL, requirement: String) throws {
        let out = try runToolData("/usr/bin/codesign", [
            "--verify", "--deep", "--strict",
            "--test-requirement", "=\(requirement)",
            target.path,
        ])
        guard out.status == 0 else {
            let detail = out.stderr.isEmpty ? "codesign exit \(out.status)" : out.stderr
            throw UpdateInstallError.verificationFailed(detail)
        }
    }

    // MARK: - Download

    /// Fetch the release DMG into the temporary directory. The download
    /// channel is untrusted by design; verification is what vouches for
    /// the bytes. `progress` receives the completed fraction (0...1) as
    /// bytes arrive, on the session's delegate queue.
    public static func downloadDMG(
        from url: URL,
        session: URLSession = .shared,
        progress: (@Sendable (Double) -> Void)? = nil
    ) async throws -> URL {
        let tmp: URL
        let response: URLResponse
        do {
            (tmp, response) = try await session.download(from: url, delegate: progress.map(DownloadProgress.init))
        } catch {
            throw UpdateInstallError.downloadFailed(error.localizedDescription)
        }
        if let http = response as? HTTPURLResponse, !(200..<300).contains(http.statusCode) {
            throw UpdateInstallError.downloadFailed("HTTP \(http.statusCode)")
        }
        let dest = FileManager.default.temporaryDirectory
            .appendingPathComponent("Screepub-update-\(UUID().uuidString).dmg")
        do {
            try FileManager.default.moveItem(at: tmp, to: dest)
        } catch {
            throw UpdateInstallError.downloadFailed(error.localizedDescription)
        }
        return dest
    }

    // MARK: - Install

    /// A quarantined app launched from Downloads runs translocated on a
    /// randomized read-only mount; from there the real bundle location is
    /// unknowable and a self-swap is impossible. The caller falls back to
    /// opening the DMG for a manual drag.
    public static func isTranslocated(_ bundleURL: URL) -> Bool {
        bundleURL.path.contains("/AppTranslocation/")
    }

    /// Verify the DMG, mount it, verify the app inside, stage a copy next
    /// to `destination`, verify the staged bytes, then swap. The mount is
    /// always detached, success or failure.
    public static func install(dmg: URL, over destination: URL) throws {
        guard !isTranslocated(destination) else {
            throw UpdateInstallError.notInstallable(
                "running translocated; open the DMG and drag Screepub to Applications instead")
        }
        let parent = destination.deletingLastPathComponent()
        guard FileManager.default.isWritableFile(atPath: parent.path) else {
            throw UpdateInstallError.notInstallable("\(parent.path) is not writable")
        }

        try verify(dmg, requirement: dmgRequirement)

        let mountPoint = try mount(dmg)
        defer { unmount(mountPoint) }
        guard let newApp = appInside(mountPoint) else {
            throw UpdateInstallError.appMissingInDMG
        }
        try verify(newApp, requirement: appRequirement)

        let staged = parent.appendingPathComponent(".\(destination.lastPathComponent).staged")
        try? FileManager.default.removeItem(at: staged)
        do {
            try FileManager.default.copyItem(at: newApp, to: staged)
        } catch {
            throw UpdateInstallError.swapFailed(error.localizedDescription)
        }
        stripQuarantine(staged)
        // The copy that will actually run is the one that must pass.
        do {
            try verify(staged, requirement: appRequirement)
        } catch {
            try? FileManager.default.removeItem(at: staged)
            throw error
        }

        try commit(staged: staged, into: destination)
        try verify(destination, requirement: appRequirement)
    }

    /// Park the old bundle, rename the staged one into place. On failure the
    /// original is restored, so the destination is never left empty. The
    /// parked bundle is removed when possible; a still-running old binary
    /// keeps it alive until `cleanupLeftovers` on the next launch.
    public static func commit(staged: URL, into destination: URL) throws {
        let fm = FileManager.default
        guard fm.fileExists(atPath: staged.path) else {
            throw UpdateInstallError.swapFailed("nothing staged at \(staged.path)")
        }
        let parent = destination.deletingLastPathComponent()
        let aside = parent.appendingPathComponent(
            ".\(destination.lastPathComponent).old-\(ProcessInfo.processInfo.processIdentifier)")
        do {
            if fm.fileExists(atPath: destination.path) {
                try fm.moveItem(at: destination, to: aside)
            }
            try fm.moveItem(at: staged, to: destination)
        } catch {
            if !fm.fileExists(atPath: destination.path), fm.fileExists(atPath: aside.path) {
                try? fm.moveItem(at: aside, to: destination)
            }
            try? fm.removeItem(at: staged)
            throw UpdateInstallError.swapFailed(error.localizedDescription)
        }
        try? fm.removeItem(at: aside)
    }

    /// Remove anything a previous swap parked or an interrupted install left
    /// staged beside the bundle. Called at launch by the (new) app.
    public static func cleanupLeftovers(near bundleURL: URL) {
        let fm = FileManager.default
        let parent = bundleURL.deletingLastPathComponent()
        let parkedPrefix = ".\(bundleURL.lastPathComponent).old-"
        for item in (try? fm.contentsOfDirectory(at: parent, includingPropertiesForKeys: nil)) ?? []
        where item.lastPathComponent.hasPrefix(parkedPrefix) {
            try? fm.removeItem(at: item)
        }
        try? fm.removeItem(at: parent.appendingPathComponent(".\(bundleURL.lastPathComponent).staged"))
    }

    // MARK: - DMG plumbing

    static func mount(_ dmg: URL) throws -> URL {
        let out: (status: Int32, stdout: Data, stderr: String)
        do {
            out = try runToolData("/usr/bin/hdiutil",
                                  ["attach", "-nobrowse", "-readonly", "-noautoopen", "-plist", dmg.path])
        } catch {
            throw UpdateInstallError.mountFailed(error.localizedDescription)
        }
        guard out.status == 0 else {
            throw UpdateInstallError.mountFailed(out.stderr.isEmpty ? "hdiutil exit \(out.status)" : out.stderr)
        }
        guard let plist = try? PropertyListSerialization.propertyList(from: out.stdout, format: nil),
              let dict = plist as? [String: Any],
              let entities = dict["system-entities"] as? [[String: Any]],
              let mountPath = entities.compactMap({ $0["mount-point"] as? String }).first else {
            throw UpdateInstallError.mountFailed("no mount point in hdiutil output")
        }
        return URL(fileURLWithPath: mountPath)
    }

    static func unmount(_ mountPoint: URL) {
        _ = try? runToolData("/usr/bin/hdiutil", ["detach", mountPoint.path, "-force"])
    }

    static func appInside(_ mountPoint: URL) -> URL? {
        let items = (try? FileManager.default.contentsOfDirectory(
            at: mountPoint, includingPropertiesForKeys: nil)) ?? []
        return items.first { $0.pathExtension == "app" }
    }

    /// The staged copy was verified against our pinned requirement; the
    /// quarantine flag would only invite Gatekeeper to translocate what we
    /// just proved is ours.
    private static func stripQuarantine(_ url: URL) {
        _ = try? runToolData("/usr/bin/xattr", ["-dr", "com.apple.quarantine", url.path])
    }

    /// Task-level delegate that forwards download progress. The async
    /// download API owns the file handling; this only watches the bytes.
    private final class DownloadProgress: NSObject, URLSessionDownloadDelegate {
        private let callback: @Sendable (Double) -> Void
        init(_ callback: @escaping @Sendable (Double) -> Void) { self.callback = callback }

        /// Chunks arrive thousands of times per DMG; the callback hops to
        /// the main actor, so forward only whole-percent steps. Delegate
        /// callbacks are serialized on the session's queue, so the stored
        /// percent needs no lock.
        private var lastPercent = -1

        func urlSession(_ session: URLSession, downloadTask: URLSessionDownloadTask,
                        didWriteData bytesWritten: Int64, totalBytesWritten: Int64,
                        totalBytesExpectedToWrite: Int64) {
            guard totalBytesExpectedToWrite > 0 else { return }
            let fraction = Double(totalBytesWritten) / Double(totalBytesExpectedToWrite)
            let percent = Int(fraction * 100)
            guard percent != lastPercent else { return }
            lastPercent = percent
            callback(fraction)
        }

        func urlSession(_ session: URLSession, downloadTask: URLSessionDownloadTask,
                        didFinishDownloadingTo location: URL) {}
    }

    // MARK: - Process plumbing

    private static func runToolData(_ path: String, _ args: [String]) throws -> (status: Int32, stdout: Data, stderr: String) {
        let p = Process()
        p.executableURL = URL(fileURLWithPath: path)
        p.arguments = args
        let outPipe = Pipe()
        let errPipe = Pipe()
        p.standardOutput = outPipe
        p.standardError = errPipe
        try p.run()
        let stdout = outPipe.fileHandleForReading.readDataToEndOfFile()
        let stderr = errPipe.fileHandleForReading.readDataToEndOfFile()
        p.waitUntilExit()
        return (p.terminationStatus,
                stdout,
                String(data: stderr, encoding: .utf8)?.trimmingCharacters(in: .whitespacesAndNewlines) ?? "")
    }
}
