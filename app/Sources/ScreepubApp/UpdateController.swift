import SwiftUI
import ScreepubKit

/// One shared brain for updates: the launch-time check, the menu's manual
/// check, and the download/verify/swap install all report through here, so
/// the footer can narrate whichever one is running.
@MainActor
final class UpdateController: ObservableObject {
    static let shared = UpdateController()

    enum Phase: Equatable {
        case idle
        /// Fraction complete when the server said how big the file is.
        case downloading(Double?)
        case installing
        case failed(String)
    }

    @Published var available: AvailableUpdate?
    /// The update whose notes should be on screen, or nil for no sheet.
    /// Lives here rather than in ContentView because two surfaces raise the
    /// same sheet now: the footer popover, and the menu bar's Check for
    /// Updates alert, which has no view context of its own.
    @Published var notesRequest: AvailableUpdate?
    @Published var phase: Phase = .idle

    var busy: Bool {
        switch phase {
        case .downloading, .installing: return true
        case .idle, .failed: return false
        }
    }

    static var currentVersion: String {
        Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? "unbundled"
    }

    /// The install promise, stated identically wherever consent is asked —
    /// it's security-relevant copy, so it must not drift between surfaces.
    static let installConsentText = "Downloads the disk image from GitHub, verifies its Apple signature against this project's Developer ID, then swaps this copy and relaunches. Nothing installs if verification fails."

    /// Menu-path check: user-initiated, so it skips the opt-in and the
    /// throttle — but it still lands in `available` and stamps the clock,
    /// so the silent launch check doesn't immediately repeat the work.
    func checkNow() async -> Result<AvailableUpdate?, Error> {
        clearStaleFailure()
        UserDefaults.standard.set(Date().timeIntervalSince1970, forKey: AppSettings.updateLastCheckedKey)
        do {
            let update = try await UpdateCheck.latest(currentVersion: Self.currentVersion)
            available = update
            return .success(update)
        } catch {
            return .failure(error)
        }
    }

    /// Launch-time check, gated twice: the opt-in, then the daily throttle.
    /// Failures are silent; a background courtesy must never nag — and it
    /// must never DESTROY state either: a throw here leaves a previously
    /// discovered update in place rather than wiping the footer notice.
    func checkIfDue() async {
        clearStaleFailure()
        let defaults = UserDefaults.standard
        let stamp = defaults.double(forKey: AppSettings.updateLastCheckedKey)
        guard UpdateCheck.shouldCheck(
            optedIn: defaults.bool(forKey: AppSettings.updateOptInKey),
            lastChecked: stamp > 0 ? Date(timeIntervalSince1970: stamp) : nil,
            now: Date()) else { return }
        defaults.set(Date().timeIntervalSince1970, forKey: AppSettings.updateLastCheckedKey)
        if let update = try? await UpdateCheck.latest(currentVersion: Self.currentVersion) {
            available = update
        }
    }

    /// A failed download or install must not brand the footer forever:
    /// any fresh look at updates (window reappearing, manual check)
    /// returns the phase to idle so the available affordance can render.
    private func clearStaleFailure() {
        if case .failed = phase { phase = .idle }
    }

    /// Download, verify, swap, relaunch. Every failure lands in `phase`
    /// for the footer to render; the release page stays the fallback.
    func install() async {
        guard let update = available, !busy else { return }
        let destination = Bundle.main.bundleURL
        do {
            // Translocation and a read-only install dir are knowable NOW —
            // failing after the download would waste ~100MB and then delete
            // the DMG the failure message points the user at.
            try UpdateInstaller.preflight(destination: destination)

            phase = .downloading(nil)
            // The delegate already thins chunks to whole-percent steps.
            let dmg = try await UpdateInstaller.downloadDMG(from: update.downloadURL) { [weak self] fraction in
                Task { @MainActor in self?.phase = .downloading(fraction) }
            }
            defer { try? FileManager.default.removeItem(at: dmg) }

            phase = .installing
            // Verification and the swap are blocking Process work; keep it
            // off the main actor so the page doesn't freeze mid-install.
            // The version pin means the DMG must carry the release the
            // popover promised, not merely a genuine Screepub.
            try await Task.detached(priority: .userInitiated) {
                try UpdateInstaller.install(dmg: dmg, over: destination, expectedVersion: update.version)
            }.value

            relaunch(destination)
        } catch let error as UpdateInstallError {
            phase = .failed(message(for: error))
        } catch {
            phase = .failed(error.localizedDescription)
        }
    }

    private func relaunch(_ appURL: URL) {
        let config = NSWorkspace.OpenConfiguration()
        config.createsNewApplicationInstance = true
        NSWorkspace.shared.openApplication(at: appURL, configuration: config) { [weak self] app, error in
            DispatchQueue.main.async {
                // Terminate ONLY when the new instance actually launched;
                // otherwise "relaunch" silently becomes "quit" and the
                // error dies in a discarded closure parameter.
                if app != nil {
                    NSApp.terminate(nil)
                } else {
                    self?.phase = .failed(
                        "the update installed, but relaunching failed"
                        + (error.map { ": \($0.localizedDescription)" } ?? "")
                        + ". Quit and reopen Screepub to run the new version.")
                }
            }
        }
    }

    private func message(for error: UpdateInstallError) -> String {
        switch error {
        case .downloadFailed(let detail):
            return "update download failed: \(detail)"
        case .verificationFailed:
            return "the update failed signature verification and was not installed"
        case .mountFailed(let detail):
            return "couldn't open the update image: \(detail)"
        case .appMissingInDMG:
            return "the update image carries no app"
        case .notInstallable(let detail):
            return detail
        case .versionMismatch(let found, let expected):
            return "the update image carries \(found), not the promised \(expected) — nothing was installed"
        case .swapFailed(let detail):
            return "couldn't replace the app: \(detail)"
        }
    }
}
