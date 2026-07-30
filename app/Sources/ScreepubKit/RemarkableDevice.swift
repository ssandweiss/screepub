import Foundation

/// reMarkable tablets never mount as a volume (no mass storage, no MTP).
/// With "USB web interface" enabled in the tablet's storage settings, the
/// device serves plain HTTP on its fixed USB-ethernet address (octets
/// below); files are added with a multipart POST. EPUB and PDF only.
public enum RemarkableDevice {
    /// The tablet's fixed address on the USB link, same on every unit.
    nonisolated public static let usbAddress =
        [10, 11, 99, 1].map(String.init).joined(separator: ".")

    nonisolated public static let endpoint: URL = {
        var components = URLComponents()
        components.scheme = "http"
        components.host = usbAddress
        return components.url!
    }()

    public enum UploadError: Error, LocalizedError {
        case badResponse(Int)
        case unsupportedType(String)
        case rootListingFailed(Int)
        case tooLarge(Int)

        public var errorDescription: String? {
            switch self {
            case .badResponse(let code):
                return "reMarkable upload failed (HTTP \(code))."
            case .unsupportedType(let ext):
                return "reMarkable accepts PDF and EPUB, not .\(ext)."
            case .rootListingFailed(let code):
                return "couldn't open the tablet's root folder (HTTP \(code)); nothing was uploaded."
            case .tooLarge(let bytes):
                return "this file is \(bytes / (1024 * 1024)) MB; the tablet's USB web interface accepts up to 100 MB."
            }
        }
    }

    /// The root-folder listing URL. Listing is also STATE on the tablet:
    /// /upload has no destination parameter and writes into whichever
    /// folder the interface listed last, so this GET doubles as the aim
    /// taken immediately before every shot.
    nonisolated private static func documentsURL(of endpoint: URL) -> URL {
        URL(string: "documents/", relativeTo: endpoint)!
    }

    /// True when the USB web interface answers — i.e. the tablet is docked
    /// over USB with the interface enabled. Cheap enough to poll.
    nonisolated public static func probe(at endpoint: URL = endpoint, timeout: TimeInterval = 1.5) async -> Bool {
        var request = URLRequest(url: documentsURL(of: endpoint), timeoutInterval: timeout)
        request.httpMethod = "GET"
        let config = URLSessionConfiguration.ephemeral
        config.timeoutIntervalForResource = timeout
        let session = URLSession(configuration: config)
        defer { session.invalidateAndCancel() }
        guard let (_, response) = try? await session.data(for: request) else { return false }
        return (response as? HTTPURLResponse)?.statusCode == 200
    }

    /// Upload a PDF or EPUB to the tablet's root folder. "Root" is made
    /// true, not assumed: /upload writes into the last-listed folder
    /// (server-side state), so root is listed first and a failed listing
    /// aborts the send rather than fire blind into the wrong folder.
    nonisolated public static func upload(_ file: URL, to endpoint: URL = endpoint) async throws {
        let ext = file.pathExtension.lowercased()
        guard ext == "pdf" || ext == "epub" else { throw UploadError.unsupportedType(ext) }

        // Paper Pro's web interface caps uploads at 100 MB — fail the
        // whole send before any bytes move or any state changes.
        let size = (try? file.resourceValues(forKeys: [.fileSizeKey]).fileSize) ?? 0
        guard size <= 100 * 1024 * 1024 else { throw UploadError.tooLarge(size) }

        var listing = URLRequest(url: documentsURL(of: endpoint), timeoutInterval: 10)
        listing.httpMethod = "GET"
        let (_, listResponse) = try await URLSession.shared.data(for: listing)
        let listCode = (listResponse as? HTTPURLResponse)?.statusCode ?? -1
        guard listCode == 200 else { throw UploadError.rootListingFailed(listCode) }

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
