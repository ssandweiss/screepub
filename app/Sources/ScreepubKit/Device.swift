import Foundation

/// A supported e-reader family. Volume-mounted vendors are detected by
/// their on-disk signatures; reMarkable never mounts and is reached over
/// its USB web interface instead (see RemarkableDevice).
public enum DeviceKind: String, CaseIterable, Sendable {
    case kindle
    case kobo
    case tolino
    case remarkable

    public var displayName: String {
        switch self {
        case .kindle: return "Kindle"
        case .kobo: return "Kobo"
        case .tolino: return "tolino"
        case .remarkable: return "reMarkable"
        }
    }
}

public struct ConnectedDevice: Identifiable, Equatable, Sendable {
    public let kind: DeviceKind
    public let name: String
    /// Mounted volume root; nil for reMarkable (network route).
    public let volume: URL?

    public init(kind: DeviceKind, name: String, volume: URL?) {
        self.kind = kind
        self.name = name
        self.volume = volume
    }

    public var id: String { volume?.path ?? kind.rawValue }
}

public enum DeviceDetect {
    /// Vendor signature of a mounted volume, or nil for a plain drive.
    /// Kobo firmware maintains a `.kobo` folder at the root; tolino mounts
    /// under its brand name; Kindle keeps the existing documents/ check.
    nonisolated public static func classify(_ volume: URL) -> DeviceKind? {
        if KindleDevice.isKindleVolume(volume) { return .kindle }
        let fm = FileManager.default
        var isDir: ObjCBool = false
        if fm.fileExists(atPath: volume.appendingPathComponent(".kobo").path, isDirectory: &isDir),
           isDir.boolValue {
            return .kobo
        }
        if volumeName(volume).localizedCaseInsensitiveContains("tolino")
            || volume.lastPathComponent.localizedCaseInsensitiveContains("tolino") {
            return .tolino
        }
        return nil
    }

    /// All recognized devices among currently mounted volumes.
    nonisolated public static func mounted() -> [ConnectedDevice] {
        let volumes = FileManager.default.mountedVolumeURLs(
            includingResourceValuesForKeys: [.volumeNameKey],
            options: [.skipHiddenVolumes]
        ) ?? []
        return volumes.compactMap { volume in
            guard let kind = classify(volume) else { return nil }
            return ConnectedDevice(kind: kind, name: volumeName(volume), volume: volume)
        }
    }

    nonisolated static func volumeName(_ volume: URL) -> String {
        (try? volume.resourceValues(forKeys: [.volumeNameKey]).volumeName)
            ?? volume.lastPathComponent
    }
}

public enum DeviceTransfer {
    public enum TransferError: Error, LocalizedError {
        case noVolume
        public var errorDescription: String? { "Device has no mounted volume." }
    }

    /// Copy a book to its vendor's expected location: Kindle → documents/,
    /// Kobo → volume root, tolino → Books/ at the root (subfolders of it
    /// aren't reliably indexed; the folder is created if missing).
    /// Replaces any previous copy. Returns the destination URL.
    @discardableResult
    nonisolated public static func copy(_ file: URL, to device: ConnectedDevice) throws -> URL {
        guard let volume = device.volume else { throw TransferError.noVolume }
        let destDir: URL
        switch device.kind {
        case .kindle:
            return try KindleDevice.copy(file, to: volume)
        case .kobo:
            destDir = volume
        case .tolino:
            destDir = volume.appendingPathComponent("Books")
        case .remarkable:
            throw TransferError.noVolume
        }
        try FileManager.default.createDirectory(at: destDir, withIntermediateDirectories: true)
        let dest = destDir.appendingPathComponent(file.lastPathComponent)
        try Export.copy(file, to: dest)
        return dest
    }
}
