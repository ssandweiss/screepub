import Foundation

/// reMarkable tablets never mount as a volume (no mass storage, no MTP).
/// With "USB web interface" enabled in the tablet's storage settings, the
/// device serves HTTP at over a USB-ethernet link; files
/// are added with a multipart POST. EPUB and PDF only.
public enum RemarkableDevice {
    nonisolated public static let endpoint = URL(string: "")!

    public enum UploadError: Error, LocalizedError {
        case badResponse(Int)
        case unsupportedType(String)

        public var errorDescription: String? {
            switch self {
            case .badResponse(let code):
                return "reMarkable upload failed (HTTP \(code))."
            case .unsupportedType(let ext):
                return "reMarkable accepts PDF and EPUB, not .\(ext)."
            }
        }
    }

    /// True when the USB web interface answers — i.e. the tablet is docked
    /// over USB with the interface enabled. Cheap enough to poll.
    nonisolated public static func probe(timeout: TimeInterval = 1.5) async -> Bool {
        var request = URLRequest(url: endpoint, timeoutInterval: timeout)
        request.httpMethod = "GET"
        let config = URLSessionConfiguration.ephemeral
        config.timeoutIntervalForResource = timeout
        let session = URLSession(configuration: config)
        defer { session.invalidateAndCancel() }
        guard let (_, response) = try? await session.data(for: request) else { return false }
        return (response as? HTTPURLResponse)?.statusCode == 200
    }

    /// Upload a PDF or EPUB to the tablet's root folder.
    nonisolated public static func upload(_ file: URL) async throws {
        let ext = file.pathExtension.lowercased()
        guard ext == "pdf" || ext == "epub" else { throw UploadError.unsupportedType(ext) }

        let boundary = "screepub-\(UUID().uuidString)"
        var request = URLRequest(url: endpoint.appendingPathComponent("upload"), timeoutInterval: 30)
        request.httpMethod = "POST"
        request.setValue("multipart/form-data; boundary=\(boundary)", forHTTPHeaderField: "Content-Type")

        let mime = ext == "pdf" ? "application/pdf" : "application/epub+zip"
        var body = Data()
        body.append(Data("--\(boundary)\r\n".utf8))
        body.append(Data("Content-Disposition: form-data; name=\"file\"; filename=\"\(file.lastPathComponent)\"\r\n".utf8))
        body.append(Data("Content-Type: \(mime)\r\n\r\n".utf8))
        body.append(try Data(contentsOf: file))
        body.append(Data("\r\n--\(boundary)--\r\n".utf8))

        let (_, response) = try await URLSession.shared.upload(for: request, from: body)
        let code = (response as? HTTPURLResponse)?.statusCode ?? -1
        guard (200..<300).contains(code) else { throw UploadError.badResponse(code) }
    }
}
