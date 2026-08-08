import AppKit
import ScreepubKit

/// Owns the format pop-up in the save panel's accessory view and keeps the
/// panel's filename extension in step with the selection.
@MainActor
final class ExportAccessory: NSObject {
    private let panel: NSSavePanel
    private let stem: String
    private let calibre: Bool
    private let kfxReady: Bool
    let formats: [ExportFormat]
    let view = NSView(frame: NSRect(x: 0, y: 0, width: 460, height: 52))
    private let popup = NSPopUpButton(frame: NSRect(x: 76, y: 12, width: 372, height: 25))

    init(panel: NSSavePanel, stem: String, formats: [ExportFormat],
         calibre: Bool, kfxReady: Bool) {
        self.panel = panel
        self.stem = stem
        self.formats = formats
        self.calibre = calibre
        self.kfxReady = kfxReady
        super.init()

        let label = NSTextField(labelWithString: "Format:")
        label.frame = NSRect(x: 8, y: 16, width: 62, height: 18)
        label.alignment = .right
        view.addSubview(label)

        for format in formats {
            popup.addItem(withTitle: format.label(calibreAvailable: calibre, kfxReady: kfxReady))
        }
        popup.target = self
        popup.action = #selector(formatChanged)
        view.addSubview(popup)
        applyExtension()
    }

    var selected: ExportFormat { formats[max(0, popup.indexOfSelectedItem)] }

    @objc private func formatChanged() { applyExtension() }

    private func applyExtension() {
        panel.nameFieldStringValue =
            stem + "." + selected.fileExtension(calibreAvailable: calibre, kfxReady: kfxReady)
    }
}

enum ExportPanel {
    /// Save panel defaulting to the Desktop, with the purpose-labeled format
    /// selector. `completion` runs only when the user confirms, and
    /// `onCancel` when the panel closes without a choice.
    ///
    /// `onCancel` is required rather than optional on purpose. A caller
    /// almost always announces the panel before opening it, and that
    /// announcement is invisible from here — only the caller can take it
    /// back. Making it optional is how the cancelled save came to leave
    /// "choose where to save" on screen until the next conversion.
    @MainActor
    /// `kfxReady` comes from the caller's cached KFXToolchain status —
    /// probing it here would block the main thread on a spawned process.
    static func present(epub: URL,
                        stem: String,
                        kfxReady: Bool,
                        onCancel: @escaping () -> Void,
                        completion: @escaping (URL, ExportFormat) -> Void) {
        let calibre = EbookConvert.isAvailable
        let formats = Export.available(for: epub, calibreAvailable: calibre)
        let panel = NSSavePanel()
        panel.directoryURL = FileManager.default
            .urls(for: .desktopDirectory, in: .userDomainMask).first
        panel.canCreateDirectories = true
        panel.title = "Save a Copy"

        let accessory = ExportAccessory(panel: panel, stem: stem, formats: formats,
                                        calibre: calibre, kfxReady: kfxReady)
        panel.accessoryView = accessory.view

        panel.begin { response in
            // Anything short of a confirmed choice means no file was
            // written: a Cancel, or the .OK-with-no-url case that is not
            // supposed to happen. Both leave the caller's announcement
            // standing with nothing coming to replace it, so both retract.
            guard response == .OK, let url = panel.url else {
                onCancel()
                return
            }
            completion(url, accessory.selected)
        }
    }
}
