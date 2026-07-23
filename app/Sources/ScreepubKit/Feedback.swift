import Foundation

/// Builds a pre-filled GitHub "new issue" URL for in-app feedback / bug
/// reports. The URL-building is pure (and kit-checked); the app opens the
/// result with NSWorkspace.
public enum Feedback {
    /// The repository's new-issue endpoint. (Filing needs a GitHub account
    /// with access — fine for collaborators and once the repo is public.)
    nonisolated public static let newIssueBase =
        "https://github.com/ssandweiss/screepub/issues/new"

    /// A pre-filled issue: a short instruction, an optional context block
    /// (e.g. a conversion error), and an environment footer so reports
    /// arrive with the app + OS versions already filled in.
    nonisolated public static func newIssueURL(
        appVersion: String,
        osVersion: String,
        context: String? = nil
    ) -> URL {
        var body = "<!-- Describe the issue or suggestion. -->\n\n"
        if let context, !context.isEmpty {
            body += "\n**What happened:**\n\(context)\n"
        }
        body += "\n---\nScreepub \(appVersion) · \(osVersion)\n"

        var components = URLComponents(string: newIssueBase)!
        components.queryItems = [URLQueryItem(name: "body", value: body)]
        // URLComponents percent-encodes queries but leaves "+" literal,
        // which query parsers read as a space — encode it explicitly.
        components.percentEncodedQuery = components.percentEncodedQuery?
            .replacingOccurrences(of: "+", with: "%2B")
        return components.url!
    }
}
