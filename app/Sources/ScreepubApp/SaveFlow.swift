import SwiftUI
import ScreepubKit
import KFXKit

/// The Save-a-Copy flow, shared by the result page and the reader rail so
/// the two cannot drift. (They already had: the rail's save produced AZW3
/// with no narration while the main window produced KFX with stages.)
///
/// The KFX toolchain is probed off-main BEFORE the panel opens — the
/// panel's filename extension must match what the conversion will produce,
/// and the probe spawns calibre-customize, too slow for the main thread.
/// The same probed answer is then trusted for the conversion itself, so
/// one save costs one probe.
@MainActor
enum SaveFlow {
    /// The probe leaves a gap between click and panel; a second click in
    /// that gap must not stack a second modeless panel (two panels means
    /// two concurrent exports racing the same sibling artifact paths).
    private static var inFlight = false

    static func present(
        epub: URL,
        fountainPath: String?,
        settings: FormatSettings,
        status: @escaping @MainActor (String) -> Void,
        failure: @escaping @MainActor (String) -> Void
    ) {
        guard !inFlight else { return }
        inFlight = true
        let stem = epub.deletingPathExtension().lastPathComponent
        Task {
            // The probe can cost ~1s of calibre-customize; say so instead
            // of letting the click read as ignored.
            status("checking Kindle formats…")
            let kfxReady = await Task.detached { KFXToolchain.status().ready }.value
            let calibre = EbookConvert.isAvailable
            inFlight = false
            status("choose where to save")
            ExportPanel.present(epub: epub, stem: stem, kfxReady: kfxReady) { destination, format in
                status("saving…")
                // freshKindleArtifact spawns Calibre or the engine — keep it
                // off the main actor or the whole UI stalls behind it.
                Task.detached {
                    do {
                        let source: URL
                        switch format {
                        case .epub:
                            source = epub
                        case .kindle:
                            source = try Export.freshKindleArtifact(
                                for: epub,
                                fountainPath: fountainPath,
                                format: settings,
                                calibreAvailable: calibre,
                                kfxReady: kfxReady,
                                onStage: { stage in
                                    Task { @MainActor in status("Kindle: \(stage)") }
                                })
                        }
                        try Export.copy(source, to: destination)
                        await MainActor.run {
                            status("saved to \(destination.deletingLastPathComponent().lastPathComponent)")
                        }
                    } catch {
                        await MainActor.run {
                            failure("save failed: \(error.localizedDescription)")
                        }
                    }
                }
            }
        }
    }
}
