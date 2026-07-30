import Foundation

/// The one "is this app on disk" probe, shared by every route that fronts
/// an external application.
func existingApp(atPath path: String) -> URL? {
    FileManager.default.fileExists(atPath: path) ? URL(fileURLWithPath: path) : nil
}
