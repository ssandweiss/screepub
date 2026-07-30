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
        UserDefaults.standard.set(Date().timeIntervalSince1970, forKey: "updateLastChecked")
        do {
            let update = try await UpdateCheck.latest(currentVersion: Self.currentVersion)
            available = update
            return .success(update)
        } catch {
            return .failure(error)
        }
    }

    /// Launch-time check, gated twice: the opt-in, then the daily throttle.
    /// Failures are silent; a background courtesy must never nag.
    func checkIfDue() async {
        let defaults = UserDefaults.standard
        let stamp = defaults.double(forKey: "updateLastChecked")
        guard UpdateCheck.shouldCheck(
            optedIn: defaults.bool(forKey: "updateOptIn"),
            lastChecked: stamp > 0 ? Date(timeIntervalSince1970: stamp) : nil,
            now: Date()) else { return }
        defaults.set(Date().timeIntervalSince1970, forKey: "updateLastChecked")
        available = try? await UpdateCheck.latest(currentVersion: Self.currentVersion)
    }

    /// Download, verify, swap, relaunch. Every failure lands in `phase`
    /// for the footer to render; the release page stays the fallback.
    func install() async {
        guard let update = available, !busy else { return }
        let destination = Bundle.main.bundleURL
        do {
            phase = .downloading(nil)
            // The delegate already thins chunks to whole-percent steps.
            let dmg = try await UpdateInstaller.downloadDMG(from: update.downloadURL) { [weak self] fraction in
                Task { @MainActor in self?.phase = .downloading(fraction) }
            }
            defer { try? FileManager.default.removeItem(at: dmg) }

            phase = .installing
            // Verification and the swap are blocking Process work; keep it
            // off the main actor so the page doesn't freeze mid-install.
            try await Task.detached(priority: .userInitiated) {
                try UpdateInstaller.install(dmg: dmg, over: destination)
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
        NSWorkspace.shared.openApplication(at: appURL, configuration: config) { _, _ in
            DispatchQueue.main.async { NSApp.terminate(nil) }
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
        case .swapFailed(let detail):
            return "couldn't replace the app: \(detail)"
        }
    }
}
