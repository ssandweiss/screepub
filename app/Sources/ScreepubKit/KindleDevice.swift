import Foundation

/// USB-mounted Kindle detection and transfer. Older Kindles mount as a
/// mass-storage volume with a `documents/` folder (newer firmware is MTP
/// and never appears in /Volumes — those use the email/web routes).
public enum KindleDevice {
    /// A mounted volume looks like a Kindle when it has a `documents/`
    /// folder and either a Kindle-ish volume name or a `system/` folder.
    nonisolated public static func isKindleVolume(_ volume: URL) -> Bool {
        let fm = FileManager.default
        var isDir: ObjCBool = false
        let documents = volume.appendingPathComponent("documents")
        guard fm.fileExists(atPath: documents.path, isDirectory: &isDir), isDir.boolValue else {
            return false
        }
        let volName = (try? volume.resourceValues(forKeys: [.volumeNameKey]).volumeName) ?? ""
        if volName.localizedCaseInsensitiveContains("kindle")
            || volume.lastPathComponent.localizedCaseInsensitiveContains("kindle") {
            return true
        }
        return fm.fileExists(atPath: volume.appendingPathComponent("system").path)
    }

    /// All currently mounted Kindle volumes.
    nonisolated public static func mounted() -> [URL] {
        let volumes = FileManager.default.mountedVolumeURLs(
            includingResourceValuesForKeys: [.volumeNameKey],
            options: [.skipHiddenVolumes]
        ) ?? []
        return volumes.filter { isKindleVolume($0) }
    }

    /// Copy an EPUB into the device's documents folder (replacing any
    /// previous copy). Returns the destination URL.
    @discardableResult
    nonisolated public static func copy(_ file: URL, to volume: URL) throws -> URL {
        let fm = FileManager.default
        let dest = volume
            .appendingPathComponent("documents")
            .appendingPathComponent(file.lastPathComponent)
        if fm.fileExists(atPath: dest.path) {
            try fm.removeItem(at: dest)
        }
        try fm.copyItem(at: file, to: dest)
        return dest
    }

    /// Display name of a Kindle volume.
    nonisolated public static func name(of volume: URL) -> String {
        (try? volume.resourceValues(forKeys: [.volumeNameKey]).volumeName)
            ?? volume.lastPathComponent
    }
}
