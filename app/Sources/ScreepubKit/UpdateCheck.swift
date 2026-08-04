import Foundation

/// One version's notes, exactly as published.
public struct ReleaseNote: Equatable, Sendable {
    public let version: String
    public let markdown: String

    public init(version: String, markdown: String) {
        self.version = version
        self.markdown = markdown
    }
}

/// A release as `select` sees it. GitHub's JSON shape stays private in
/// `GitHubRelease`; this is the public seam so selection can be tested
/// without a network and without exposing the wire format.
public struct ReleaseCandidate: Equatable, Sendable {
    public let tag: String
    public let notesURL: URL
    public let dmgURL: URL?
    public let body: String?
    public let isDraft: Bool
    public let isPrerelease: Bool

    public init(
        tag: String,
        notesURL: URL,
        dmgURL: URL?,
        body: String?,
        isDraft: Bool = false,
        isPrerelease: Bool = false
    ) {
        self.tag = tag
        self.notesURL = notesURL
        self.dmgURL = dmgURL
        self.body = body
        self.isDraft = isDraft
        self.isPrerelease = isPrerelease
    }
}

/// A release newer than the one running.
public struct AvailableUpdate: Equatable, Sendable {
    public let version: String
    public let downloadURL: URL
    public let releaseNotesURL: URL
    /// Every version newer than the installed one, newest first.
    public let notes: [ReleaseNote]

    public init(
        version: String,
        downloadURL: URL,
        releaseNotesURL: URL,
        notes: [ReleaseNote] = []
    ) {
        self.version = version
        self.downloadURL = downloadURL
        self.releaseNotesURL = releaseNotesURL
        self.notes = notes
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
        // EXCEPT a git-describe suffix ("1-g965cb10", "-dirty"): that marks
        // a build AT or PAST the tag, so the tag is never an update for it —
        // treating it as a pre-release would install a downgrade on every
        // post-tag dev build.
        switch (candPre, currPre) {
        case (nil, nil):     return false
        case (nil, let r?): return !isDescribeSuffix(r)
        case (_?, nil):      return false
        case let (c?, r?):
            if isDescribeSuffix(r) { return false }
            return c.compare(r, options: .numeric) == .orderedDescending
        }
    }

    /// git describe output after the tag: "N-g<hex>", optionally "-dirty",
    /// or bare "dirty" for an at-tag build with local changes.
    private static func isDescribeSuffix(_ pre: String) -> Bool {
        if pre == "dirty" { return true }
        var body = pre
        if body.hasSuffix("-dirty") { body.removeLast("-dirty".count) }
        let pieces = body.split(separator: "-", maxSplits: 1)
        guard pieces.count == 2,
              !pieces[0].isEmpty, pieces[0].allSatisfy(\.isNumber),
              pieces[1].first == "g", pieces[1].count >= 5,
              pieces[1].dropFirst().allSatisfy(\.isHexDigit) else { return false }
        return true
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

    // MARK: - Choosing

    /// Picks the update to offer and the notes to show with it. Pure: no
    /// network, no clock. Drafts and prereleases are GitHub's own flags on
    /// the release, which is a different thing from a semver pre-release
    /// tag inside the version string; `isNewer` handles the latter.
    public static func select(
        releases: [ReleaseCandidate],
        currentVersion: String
    ) throws -> AvailableUpdate? {
        let newer = releases
            .filter { !$0.isDraft && !$0.isPrerelease }
            .filter { isNewer($0.tag, than: currentVersion) }
            // Sorted with the same comparison used to filter, rather than
            // trusting the order GitHub returned.
            .sorted { isNewer($0.tag, than: $1.tag) }

        guard let newest = newer.first else { return nil }
        guard let dmg = newest.dmgURL else {
            throw UpdateCheckError.noDownloadableAsset
        }

        return AvailableUpdate(
            version: normalized(newest.tag),
            downloadURL: dmg,
            releaseNotesURL: newest.notesURL,
            notes: newer.map {
                ReleaseNote(
                    version: normalized($0.tag),
                    markdown: $0.body?
                        .trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
                )
            }
        )
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
