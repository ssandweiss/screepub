import Foundation

/// A release newer than the one running.
public struct AvailableUpdate: Equatable, Sendable {
    public let version: String
    public let downloadURL: URL
    public let releaseNotesURL: URL

    public init(version: String, downloadURL: URL, releaseNotesURL: URL) {
        self.version = version
        self.downloadURL = downloadURL
        self.releaseNotesURL = releaseNotesURL
    }
}

public enum UpdateCheckError: Error, Equatable {
    case rateLimited
    case network(String)
    case malformedResponse
    /// The release exists but carries no .dmg — a half-uploaded release, say.
    case noDownloadableAsset
}

/// Asks GitHub whether a newer release exists. Deliberately not a framework:
/// the whole mechanism is one request and a version comparison, and adding a
/// dependency for that would cost more than it saves — the app links only
/// Apple's frameworks and it's worth keeping that true.
///
/// This is the ONLY network request Screepub's app makes on its own behalf,
/// it carries no identifying information, and it happens only with consent:
/// either the user opted in on the welcome page (throttled to one request a
/// day, see `shouldCheck`), or they chose Check for Updates… themselves.
/// The conversion engine still makes none at all.
public enum UpdateCheck {
    public static let defaultRepository = "ssandweiss/screepub"

    // MARK: - Consent and cadence

    /// At most one automatic request a day — a release cadence measured in
    /// weeks doesn't justify more.
    public static let checkInterval: TimeInterval = 24 * 60 * 60

    /// Whether a launch-time check may fire. No opt-in, no request — the
    /// opt-in is the entire authorization, and it defaults to off. A
    /// `lastChecked` in the future (clock set backwards) counts as fresh
    /// rather than triggering a storm of retries.
    public static func shouldCheck(optedIn: Bool, lastChecked: Date?, now: Date) -> Bool {
        guard optedIn else { return false }
        guard let lastChecked else { return true }
        return now.timeIntervalSince(lastChecked) >= checkInterval
    }

    // MARK: - Version comparison

    /// Strip a leading `v` and any build metadata, so `v0.3.0` and `0.3.0`
    /// compare equal and `0.3.0+ci.7` is treated as `0.3.0`.
    public static func normalized(_ version: String) -> String {
        var v = version.trimmingCharacters(in: .whitespacesAndNewlines)
        if v.hasPrefix("v") || v.hasPrefix("V") { v.removeFirst() }
        if let plus = v.firstIndex(of: "+") { v = String(v[v.startIndex..<plus]) }
        return v
    }

    /// True when `candidate` is a strictly newer release than `current`.
    ///
    /// Compares numerically per component, because string ordering puts
    /// "0.10.0" BEFORE "0.9.0" — the classic way a version check quietly
    /// stops offering updates after the tenth minor release.
    ///
    /// A pre-release ("0.4.0-beta.1", and note the dev builds that call
    /// themselves "0.1.0-dev") sorts BELOW the same numbers without a
    /// suffix, per semver. So a running dev build is offered the matching
    /// stable release, which is what you want.
    public static func isNewer(_ candidate: String, than current: String) -> Bool {
        let (candNums, candPre) = parts(normalized(candidate))
        let (currNums, currPre) = parts(normalized(current))

        let width = max(candNums.count, currNums.count)
        for i in 0..<width {
            let a = i < candNums.count ? candNums[i] : 0
            let b = i < currNums.count ? currNums[i] : 0
            if a != b { return a > b }
        }
        // Numerically equal: a release beats a pre-release of the same
        // numbers, and two pre-releases fall back to comparing their tags.
        switch (candPre, currPre) {
        case (nil, nil):     return false
        case (nil, _?):      return true
        case (_?, nil):      return false
        case let (c?, r?):   return c.compare(r, options: .numeric) == .orderedDescending
        }
    }

    /// -> (numeric components, pre-release tag if any)
    private static func parts(_ version: String) -> ([Int], String?) {
        let pre: String?
        let core: String
        if let dash = version.firstIndex(of: "-") {
            core = String(version[version.startIndex..<dash])
            pre = String(version[version.index(after: dash)...])
        } else {
            core = version
            pre = nil
        }
        return (core.split(separator: ".").map { Int($0) ?? 0 }, pre)
    }

    // MARK: - Asking GitHub

    /// Returns the newer release, or nil when already current.
    public static func latest(
        currentVersion: String,
        repository: String = defaultRepository,
        session: URLSession = .shared
    ) async throws -> AvailableUpdate? {
        let url = URL(string: "https://api.github.com/repos/\(repository)/releases/latest")!
        var request = URLRequest(url: url)
        request.timeoutInterval = 15
        request.setValue("application/vnd.github+json", forHTTPHeaderField: "Accept")
        // GitHub rejects requests without one. Carries the app name and
        // version only — no machine, account, or user identifier.
        request.setValue("Screepub/\(currentVersion)", forHTTPHeaderField: "User-Agent")

        let data: Data
        let response: URLResponse
        do {
            (data, response) = try await session.data(for: request)
        } catch {
            throw UpdateCheckError.network(error.localizedDescription)
        }
        if let http = response as? HTTPURLResponse {
            // Unauthenticated callers get 60 requests an hour per address.
            // Worth naming, because it presents as a mystery failure.
            if http.statusCode == 403 || http.statusCode == 429 {
                throw UpdateCheckError.rateLimited
            }
            guard (200..<300).contains(http.statusCode) else {
                throw UpdateCheckError.network("HTTP \(http.statusCode)")
            }
        }

        guard let release = try? JSONDecoder().decode(GitHubRelease.self, from: data) else {
            throw UpdateCheckError.malformedResponse
        }
        guard isNewer(release.tagName, than: currentVersion) else { return nil }
        guard let dmg = release.assets.first(where: { $0.name.hasSuffix(".dmg") }) else {
            throw UpdateCheckError.noDownloadableAsset
        }
        return AvailableUpdate(
            version: normalized(release.tagName),
            downloadURL: dmg.browserDownloadURL,
            releaseNotesURL: release.htmlURL
        )
    }

    private struct GitHubRelease: Decodable {
        let tagName: String
        let htmlURL: URL
        let assets: [Asset]

        struct Asset: Decodable {
            let name: String
            let browserDownloadURL: URL

            enum CodingKeys: String, CodingKey {
                case name
                case browserDownloadURL = "browser_download_url"
            }
        }

        enum CodingKeys: String, CodingKey {
            case tagName = "tag_name"
            case htmlURL = "html_url"
            case assets
        }
    }
}
