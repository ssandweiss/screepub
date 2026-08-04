# In-App Release Notes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When the app says a revision is ready, the reader can read what changed in every version since theirs without leaving the app.

**Architecture:** The update check moves from `/releases/latest` to `/releases`, and splits into two pure, public functions (`candidates(from:)` decodes, `select(releases:currentVersion:)` chooses) around the one impure URLSession call. A small line-based parser turns each release's markdown body into `NoteBlock` values, and a SwiftUI sheet renders them over the main window with the install action kept on the same surface.

**Tech Stack:** Swift 6 / SwiftUI / SwiftPM. No XCTest exists in this project (CommandLineTools only), so all Swift tests are assertions in the `kit-check` executable, run with `swift run -c release kit-check`.

**Spec:** `docs/superpowers/specs/2026-08-04-in-app-release-notes-design.md`

---

## Orientation (read before Task 1)

- Work in the worktree at `.claude/worktrees/release-notes-in-app`, branch `worktree-release-notes-in-app`. Do not `cd` to the main checkout.
- `kit-check` tests are appended to `app/Sources/KitCheck/main.swift` **immediately before** its final two lines:
  ```swift
  print(failures == 0 ? "kit-check: all passed" : "kit-check: \(failures) FAILED")
  exit(failures == 0 ? 0 : 1)
  ```
  The file provides `check(_ condition: Bool, _ label: String)` and a `repoRoot` URL already. Do not redeclare `repoRoot`.
- `UpdateCheck.normalized(_:)` and `UpdateCheck.isNewer(_:than:)` are already `public static`. Reuse them; do not write a second version comparison.
- Run the Swift build with `swift build -c release` from the `app/` directory.

---

### Task 1: `ReleaseNote`, `ReleaseCandidate`, and pure selection

**Files:**
- Modify: `app/Sources/ScreepubKit/UpdateCheck.swift`
- Test: `app/Sources/KitCheck/main.swift`

- [ ] **Step 1: Write the failing test**

Append to `app/Sources/KitCheck/main.swift`, before the final `print`/`exit` pair:

```swift
// — Update selection —
// Pure over ReleaseCandidate, so every rule below is checked without a
// network. GitHubRelease stays private; this is the seam kit-check can reach.
func candidate(
    _ tag: String,
    dmg: Bool = true,
    body: String? = "notes",
    draft: Bool = false,
    prerelease: Bool = false
) -> ReleaseCandidate {
    ReleaseCandidate(
        tag: tag,
        notesURL: URL(string: "https://example.invalid/\(tag)")!,
        dmgURL: dmg ? URL(string: "https://example.invalid/\(tag).dmg")! : nil,
        body: body,
        isDraft: draft,
        isPrerelease: prerelease
    )
}

do {
    let picked = try UpdateCheck.select(
        releases: [candidate("v0.6.0"), candidate("v0.5.0"), candidate("v0.4.2")],
        currentVersion: "0.4.2"
    )
    check(picked?.version == "0.6.0", "selection takes the newest release")
    check(picked?.notes.map(\.version) == ["0.6.0", "0.5.0"],
          "notes cover every version newer than the installed one")
} catch {
    check(false, "selection threw unexpectedly: \(error)")
}

do {
    let picked = try UpdateCheck.select(
        releases: [candidate("v0.7.0", draft: true),
                   candidate("v0.6.5", prerelease: true),
                   candidate("v0.6.0")],
        currentVersion: "0.4.2"
    )
    check(picked?.version == "0.6.0", "drafts and prereleases are skipped")
    check(picked?.notes.count == 1, "skipped releases contribute no notes")
} catch {
    check(false, "draft/prerelease selection threw: \(error)")
}

do {
    let none = try UpdateCheck.select(
        releases: [candidate("v0.4.2"), candidate("v0.4.1")],
        currentVersion: "0.4.2"
    )
    check(none == nil, "nothing newer means no update")
} catch {
    check(false, "up-to-date selection threw: \(error)")
}

do {
    _ = try UpdateCheck.select(
        releases: [candidate("v0.6.0", dmg: false)],
        currentVersion: "0.4.2"
    )
    check(false, "a newest release with no .dmg should throw")
} catch UpdateCheckError.noDownloadableAsset {
    check(true, "a newest release with no .dmg throws noDownloadableAsset")
} catch {
    check(false, "wrong error for a missing .dmg: \(error)")
}

do {
    let picked = try UpdateCheck.select(
        releases: [candidate("v0.6.0", body: nil)],
        currentVersion: "0.4.2"
    )
    check(picked?.notes.first?.markdown == "",
          "a release with no body still contributes an empty note")
} catch {
    check(false, "nil-body selection threw: \(error)")
}
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd app && swift build -c release`
Expected: FAIL, `cannot find 'ReleaseCandidate' in scope`.

- [ ] **Step 3: Add the types**

In `app/Sources/ScreepubKit/UpdateCheck.swift`, find this exact block near the top of the file:

```swift
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
```

Replace all of it with:

```swift
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
```

- [ ] **Step 4: Add `select`**

In the same file, inside `public enum UpdateCheck`, immediately above the `// MARK: - Asking GitHub` comment:

```swift
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
```

- [ ] **Step 5: Run to verify it passes**

Run: `cd app && swift run -c release kit-check 2>&1 | grep -E "selection|notes cover|drafts|nothing newer|\.dmg|empty note|kit-check:"`
Expected: every listed line starts `  ok`, and the run ends `kit-check: all passed`.

- [ ] **Step 6: Commit**

```bash
git add app/Sources/ScreepubKit/UpdateCheck.swift app/Sources/KitCheck/main.swift
git commit -m "Update selection becomes a pure function over a public candidate"
```

---

### Task 2: Fetch every release, not just the latest

**Files:**
- Modify: `app/Sources/ScreepubKit/UpdateCheck.swift`
- Test: `app/Sources/KitCheck/main.swift`

- [ ] **Step 1: Write the failing test**

Append to `app/Sources/KitCheck/main.swift`, before the final `print`/`exit` pair:

```swift
// — Update decoding —
// The exact shape GitHub returns, including the body field the old decoder
// silently dropped.
let releasesJSON = """
[
  {"tag_name":"v0.6.0","html_url":"https://example.invalid/6","draft":false,
   "prerelease":false,"body":"# Screepub 0.6.0\\n\\nNewer.",
   "assets":[{"name":"Screepub-0.6.0.dmg",
              "browser_download_url":"https://example.invalid/6.dmg"}]},
  {"tag_name":"v0.5.0","html_url":"https://example.invalid/5","draft":false,
   "prerelease":false,"body":"# Screepub 0.5.0\\n\\nOlder.","assets":[]}
]
"""
do {
    let decoded = try UpdateCheck.candidates(from: Data(releasesJSON.utf8))
    check(decoded.count == 2, "decoding reads every release in the array")
    check(decoded.first?.body?.contains("Newer.") == true,
          "the release body is decoded, not dropped")
    check(decoded.first?.dmgURL != nil, "the .dmg asset is found")
    check(decoded.last?.dmgURL == nil, "a release with no assets has no dmgURL")
} catch {
    check(false, "decoding valid release JSON threw: \(error)")
}

do {
    _ = try UpdateCheck.candidates(from: Data("not json".utf8))
    check(false, "malformed JSON should throw")
} catch UpdateCheckError.malformedResponse {
    check(true, "malformed JSON throws malformedResponse")
} catch {
    check(false, "wrong error for malformed JSON: \(error)")
}
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd app && swift build -c release`
Expected: FAIL, `type 'UpdateCheck' has no member 'candidates'`.

- [ ] **Step 3: Widen `GitHubRelease`**

In `app/Sources/ScreepubKit/UpdateCheck.swift`, replace the `private struct GitHubRelease` declaration's stored properties and `CodingKeys` so the struct reads:

```swift
    private struct GitHubRelease: Decodable {
        let tagName: String
        let htmlURL: URL
        let assets: [Asset]
        let body: String?
        let draft: Bool
        let prerelease: Bool

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
            case assets, body, draft, prerelease
        }
    }
```

- [ ] **Step 4: Add `candidates(from:)`**

In the same file, immediately above the `select` function added in Task 1:

```swift
    /// Decodes GitHub's releases array into the public candidate shape.
    /// Separate from `select` so both halves of the check are testable and
    /// only the URLSession call in `latest` is not.
    public static func candidates(from data: Data) throws -> [ReleaseCandidate] {
        guard let releases = try? JSONDecoder().decode([GitHubRelease].self, from: data) else {
            throw UpdateCheckError.malformedResponse
        }
        return releases.map { release in
            ReleaseCandidate(
                tag: release.tagName,
                notesURL: release.htmlURL,
                dmgURL: release.assets
                    .first(where: { $0.name.hasSuffix(".dmg") })?.browserDownloadURL,
                body: release.body,
                isDraft: release.draft,
                isPrerelease: release.prerelease
            )
        }
    }
```

- [ ] **Step 5: Point `latest` at the list**

In `latest(currentVersion:repository:session:)`, change the URL line from:

```swift
        let url = URL(string: "https://api.github.com/repos/\(repository)/releases/latest")!
```

to:

```swift
        // The list, not /latest: the sheet shows every version since the
        // installed one. 30 is a bound rather than a page size — a reader
        // more than 30 releases behind sees the newest 30, which beats
        // paginating for a case that will not happen.
        let url = URL(string: "https://api.github.com/repos/\(repository)/releases?per_page=30")!
```

Then find this exact block at the end of the same function:

```swift
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
```

Replace all of it with:

```swift
        return try select(
            releases: try candidates(from: data),
            currentVersion: currentVersion
        )
```

Every rule that block enforced now lives in `select`, which is why the checks disappear here rather than moving.

- [ ] **Step 6: Run to verify it passes**

Run: `cd app && swift run -c release kit-check 2>&1 | grep -E "decoding|body is decoded|dmg|malformed|kit-check:"`
Expected: every listed line starts `  ok`, run ends `kit-check: all passed`.

- [ ] **Step 7: Commit**

```bash
git add app/Sources/ScreepubKit/UpdateCheck.swift app/Sources/KitCheck/main.swift
git commit -m "Fetch the releases list and decode the notes body"
```

---

### Task 3: Parse release notes into blocks

**Files:**
- Create: `app/Sources/ScreepubKit/ReleaseNotes.swift`
- Test: `app/Sources/KitCheck/main.swift`

- [ ] **Step 1: Write the failing test**

Append to `app/Sources/KitCheck/main.swift`, before the final `print`/`exit` pair:

```swift
// — Release notes parsing —
// The committed 0.5.0 notes are the fixture because release.yml publishes
// that exact file as the GitHub release body.
let notesFixture = repoRoot.appendingPathComponent("docs/releases/0.5.0.md")
if let markdown = try? String(contentsOf: notesFixture, encoding: .utf8) {
    let blocks = ReleaseNotes.parse(markdown)

    var sections = 0, bullets = 0, paragraphs = 0, asides = 0
    var leads: [String] = []
    for block in blocks {
        switch block {
        case .section: sections += 1
        case .bullet(let lead, _): bullets += 1; if let lead { leads.append(lead) }
        case .paragraph: paragraphs += 1
        case .aside: asides += 1
        }
    }
    check(sections >= 1, "parses ## headings into sections")
    check(bullets >= 1, "parses - lines into bullets")
    check(paragraphs >= 1, "parses prose into paragraphs")
    check(asides == 1, "parses the trailing italic note into an aside")

    check(leads.contains("No more orphaned lines."),
          "a bold lead becomes the bullet's lead, without asterisks")

    let titleText = blocks.contains { block in
        if case .section(let t) = block { return t.contains("Screepub 0.5.0") }
        if case .paragraph(let t) = block { return t.contains("# Screepub") }
        return false
    }
    check(!titleText, "the # title line produces no block")

    // No text lost. Every word in the source, minus markdown punctuation and
    // the dropped title, must survive into some block.
    func words(_ s: String) -> Set<String> {
        Set(s.replacingOccurrences(of: "*", with: " ")
             .replacingOccurrences(of: "#", with: " ")
             .replacingOccurrences(of: "-", with: " ")
             .split(whereSeparator: { $0 == " " || $0.isNewline })
             .map(String.init))
    }
    var rendered = ""
    for block in blocks {
        switch block {
        case .section(let t): rendered += " " + t
        case .bullet(let lead, let body): rendered += " " + (lead ?? "") + " " + body
        case .paragraph(let t): rendered += " " + t
        case .aside(let t): rendered += " " + t
        }
    }
    let sourceWords = words(markdown).subtracting(["Screepub", "0.5.0"])
    let missing = sourceWords.subtracting(words(rendered))
    check(missing.isEmpty, "no text is lost in parsing (missing: \(missing.sorted().prefix(5)))")
} else {
    check(false, "could not read the 0.5.0 notes fixture")
}

check(ReleaseNotes.parse("").isEmpty, "empty input parses to no blocks")
check(ReleaseNotes.parse("Mystery: [a link](x) and `code`.").count == 1,
      "unrecognized syntax degrades to one paragraph rather than vanishing")
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd app && swift build -c release`
Expected: FAIL, `cannot find 'ReleaseNotes' in scope`.

- [ ] **Step 3: Write the parser**

Create `app/Sources/ScreepubKit/ReleaseNotes.swift`:

```swift
import Foundation

/// One piece of a release note. The set is deliberately small: it covers
/// exactly what docs/release-notes-template.md produces.
public enum NoteBlock: Equatable, Sendable {
    case section(String)
    case bullet(lead: String?, body: String)
    case paragraph(String)
    case aside(String)
}

/// Turns a published release body into blocks the app can set in its own
/// type. Not a general markdown parser and not trying to be: the notes have
/// a fixed shape that CI enforces.
///
/// The invariant that matters: a line matching no rule becomes a paragraph
/// verbatim. Unknown syntax may render plainly, but it never disappears.
public enum ReleaseNotes {
    public static func parse(_ markdown: String) -> [NoteBlock] {
        var blocks: [NoteBlock] = []
        var pending: [String] = []
        var pendingIsBullet = false

        func flush() {
            guard !pending.isEmpty else { return }
            // Notes are hard-wrapped at 72 columns in the repo; joining lets
            // them reflow at whatever width the sheet is.
            let text = pending.joined(separator: " ")
                .trimmingCharacters(in: .whitespaces)
            let wasBullet = pendingIsBullet
            pending = []
            pendingIsBullet = false
            guard !text.isEmpty else { return }

            if wasBullet {
                let (lead, body) = splitLead(text)
                blocks.append(.bullet(lead: lead, body: body))
            } else if let inner = wholeItalic(text) {
                blocks.append(.aside(inner))
            } else {
                blocks.append(.paragraph(unemphasize(text)))
            }
        }

        for raw in markdown.components(separatedBy: .newlines) {
            let line = raw.trimmingCharacters(in: .whitespaces)

            if line.isEmpty { flush(); continue }
            if line.hasPrefix("## ") {
                flush()
                blocks.append(.section(String(line.dropFirst(3))))
                continue
            }
            // The sheet prints the version itself, so the title would double.
            if line.hasPrefix("# ") { flush(); continue }
            if line.hasPrefix("- ") {
                flush()
                pendingIsBullet = true
                pending.append(String(line.dropFirst(2)))
                continue
            }
            pending.append(line)
        }
        flush()
        return blocks
    }

    /// "**Lead.** rest" -> ("Lead.", "rest"). Anything else has no lead.
    private static func splitLead(_ text: String) -> (String?, String) {
        guard text.hasPrefix("**") else { return (nil, unemphasize(text)) }
        let afterOpen = text.index(text.startIndex, offsetBy: 2)
        guard let close = text.range(of: "**", range: afterOpen..<text.endIndex) else {
            return (nil, unemphasize(text))
        }
        let lead = String(text[afterOpen..<close.lowerBound])
        let rest = String(text[close.upperBound...])
            .trimmingCharacters(in: .whitespaces)
        return (lead, unemphasize(rest))
    }

    /// A paragraph that is italic end to end, which is how the notes carry
    /// their closing footnote.
    private static func wholeItalic(_ text: String) -> String? {
        guard text.count > 2,
              text.hasPrefix("*"), text.hasSuffix("*"),
              !text.hasPrefix("**") else { return nil }
        let inner = String(text.dropFirst().dropLast())
        guard !inner.contains("*") else { return nil }
        return inner
    }

    /// The sheet styles a bullet's lead itself, so inline bold is flattened
    /// rather than half-rendered. A stray asterisk reads worse than none.
    private static func unemphasize(_ text: String) -> String {
        text.replacingOccurrences(of: "**", with: "")
    }
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd app && swift run -c release kit-check 2>&1 | grep -E "parses|bold lead|title line|no text is lost|empty input|degrades|kit-check:"`
Expected: every listed line starts `  ok`, run ends `kit-check: all passed`.

- [ ] **Step 5: Commit**

```bash
git add app/Sources/ScreepubKit/ReleaseNotes.swift app/Sources/KitCheck/main.swift
git commit -m "Parse release notes into blocks, losing no text"
```

---

### Task 4: The sheet

**Files:**
- Create: `app/Sources/ScreepubApp/ReleaseNotesSheet.swift`

There is no test step here. `kit-check` links ScreepubKit, not ScreepubApp, and no XCTest exists; this task is verified by compiling and by the manual pass in Task 6.

- [ ] **Step 1: Write the view**

Create `app/Sources/ScreepubApp/ReleaseNotesSheet.swift`:

```swift
import SwiftUI
import AppKit
import ScreepubKit

/// Every version since the installed one, with the decision it informs kept
/// on the same surface. A popover was too narrow for prose and a second
/// window would have carried the notes away from the install button.
struct ReleaseNotesSheet: View {
    let update: AvailableUpdate
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        VStack(spacing: 0) {
            ScrollView {
                VStack(alignment: .leading, spacing: 22) {
                    ForEach(update.notes, id: \.version) { note in
                        VStack(alignment: .leading, spacing: 10) {
                            Slugline(text: "SCREEPUB \(note.version)")
                            let blocks = ReleaseNotes.parse(note.markdown)
                            if blocks.isEmpty {
                                Text("No notes were published for this version.")
                                    .font(Theme.courier(11))
                                    .foregroundStyle(Theme.inkMuted)
                            } else {
                                ForEach(Array(blocks.enumerated()), id: \.offset) { _, block in
                                    blockView(block)
                                }
                            }
                        }
                    }
                }
                .padding(.horizontal, 30)
                .padding(.vertical, 24)
                .frame(maxWidth: .infinity, alignment: .leading)
            }

            Rectangle()
                .fill(Theme.inkFaint.opacity(0.35))
                .frame(height: 1)

            VStack(spacing: 9) {
                Button("INSTALL AND RELAUNCH") {
                    dismiss()
                    Task { await UpdateController.shared.install() }
                }
                .buttonStyle(BradButtonStyle())
                Button("NOT NOW") { dismiss() }
                    .buttonStyle(OutlineButtonStyle())
                    .keyboardShortcut(.cancelAction)
                // The escape hatch: anything the parser renders badly is
                // still one click from the source.
                Button("READ ON GITHUB") {
                    NSWorkspace.shared.open(update.releaseNotesURL)
                }
                .buttonStyle(MarginButtonStyle())
            }
            .padding(.vertical, 16)
        }
        .frame(width: 460, height: 520)
        .background(Theme.paper)
    }

    @ViewBuilder
    private func blockView(_ block: NoteBlock) -> some View {
        switch block {
        case .section(let text):
            Text(text.uppercased())
                .font(Theme.courier(11, .bold))
                .kerning(0.7)
                .foregroundStyle(Theme.inkMuted)
                .padding(.top, 6)

        case .bullet(let lead, let body):
            HStack(alignment: .firstTextBaseline, spacing: 7) {
                Text("\u{2022}")
                    .font(Theme.courier(12))
                    .foregroundStyle(Theme.inkMuted)
                Group {
                    if let lead {
                        Text(lead).font(Theme.courier(12, .bold))
                            + Text(" " + body).font(Theme.courier(12))
                    } else {
                        Text(body).font(Theme.courier(12))
                    }
                }
                .foregroundStyle(Theme.ink)
                .lineSpacing(3)
                .fixedSize(horizontal: false, vertical: true)
            }

        case .paragraph(let text):
            Text(text)
                .font(Theme.courier(12))
                .foregroundStyle(Theme.ink)
                .lineSpacing(3)
                .fixedSize(horizontal: false, vertical: true)

        case .aside(let text):
            Text(text)
                .font(Theme.courier(11))
                .italic()
                .foregroundStyle(Theme.inkMuted)
                .lineSpacing(3)
                .fixedSize(horizontal: false, vertical: true)
        }
    }
}
```

- [ ] **Step 2: Verify it compiles**

Run: `cd app && swift build -c release`
Expected: `Build complete!` with no errors.

- [ ] **Step 3: Commit**

```bash
git add app/Sources/ScreepubApp/ReleaseNotesSheet.swift
git commit -m "The release notes sheet"
```

---

### Task 5: Wire the popover to the sheet

**Files:**
- Modify: `app/Sources/ScreepubApp/ContentView.swift`

- [ ] **Step 1: Add the presentation state**

In `struct ContentView`, immediately after the line `@State private var showUpdatePopover = false`, add:

```swift
    @State private var showReleaseNotes = false
```

- [ ] **Step 2: Present the sheet**

In `ContentView.body`, find the `.onDrop(of: [.fileURL], isTargeted: $dropTargeted)` modifier and add this modifier immediately **before** it:

```swift
        .sheet(isPresented: $showReleaseNotes) {
            if let update = updates.available {
                ReleaseNotesSheet(update: update)
            }
        }
```

- [ ] **Step 3: Give the popover a way to ask for the sheet**

In `private struct UpdatePopover`, replace the whole struct with:

```swift
private struct UpdatePopover: View {
    let update: AvailableUpdate
    /// Raised instead of opening a browser. ContentView owns the sheet,
    /// because a sheet presented by a view that is itself dismissing races
    /// its own presenter, and this popover dismisses as the button fires.
    let onReadNotes: () -> Void
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        VStack(spacing: 12) {
            Text("REV. \(update.version) IS READY")
                .font(Theme.courier(12, .bold))
                .kerning(0.8)
                .foregroundStyle(Theme.ink)
            Text(UpdateController.installConsentText)
                .font(Theme.courier(10))
                .foregroundStyle(Theme.inkMuted)
                .lineSpacing(2)
                .fixedSize(horizontal: false, vertical: true)
            Button("INSTALL AND RELAUNCH") {
                dismiss()
                Task { await UpdateController.shared.install() }
            }
            .buttonStyle(BradButtonStyle())
            Button("VIEW RELEASE NOTES") {
                dismiss()
                // One hop after the popover has gone, so the sheet is not
                // presented by a view on its way out.
                Task { @MainActor in onReadNotes() }
            }
            .buttonStyle(MarginButtonStyle())
        }
        .padding(16)
        .frame(width: 300)
        .background(Theme.paper)
    }
}
```

- [ ] **Step 4: Update the call site**

In `updateNote`, change:

```swift
                .popover(isPresented: $showUpdatePopover, arrowEdge: .top) {
                    UpdatePopover(update: update)
                }
```

to:

```swift
                .popover(isPresented: $showUpdatePopover, arrowEdge: .top) {
                    UpdatePopover(update: update) { showReleaseNotes = true }
                }
```

- [ ] **Step 5: Verify it compiles**

Run: `cd app && swift build -c release`
Expected: `Build complete!` with no errors.

- [ ] **Step 6: Commit**

```bash
git add app/Sources/ScreepubApp/ContentView.swift
git commit -m "Release notes open in the app, not the browser"
```

---

### Task 6: Full verification

**Files:** none modified unless a check fails.

- [ ] **Step 1: Run every suite**

```bash
bun test
bunx tsc --noEmit
cd app && swift run -c release kit-check
```

Expected: `432 pass` (1 skip is normal in this worktree: an integration test wants the gitignored root `/fixtures/`), typecheck silent, and `kit-check: all passed`.

- [ ] **Step 2: Confirm no stray reference to the old endpoint**

Run: `grep -rn "releases/latest" app/Sources/ docs/ README.md`
Expected: no hits in `app/Sources/`. Hits in prose are fine.

- [ ] **Step 3: Build the app bundle**

Run: `./app/build-app.sh`
Expected: ends `built: .../app/dist/Screepub.app`.

- [ ] **Step 4: Manual pass**

The update prompt only appears when a newer release exists, so drive it directly. Temporarily set `currentVersion` low by launching with an older version string, or check against the real repository from a build whose version predates the newest release. Confirm, in order:

1. The footer shows `rev. X available`.
2. Clicking it opens the popover with three affordances.
3. `VIEW RELEASE NOTES` closes the popover and opens the sheet. No browser opens.
4. The sheet shows a heading per version newer than the installed one, newest first.
5. Bullets show a bold lead followed by body text, with no visible asterisks.
6. `NOT NOW` and Escape both dismiss. `READ ON GITHUB` opens the browser.

- [ ] **Step 5: Commit any fixes, then report**

```bash
git add -A
git commit -m "Fixes from the manual update-prompt pass"
```

If nothing needed fixing, skip the commit and say so.

---

## Notes for the implementer

- **Do not** rewrite `isNewer` or `normalized`. They already handle `v` prefixes, git-describe suffixes and semver pre-release tags, and they are the only comparison in the app.
- **Do not** make `GitHubRelease` public. The whole point of `ReleaseCandidate` is that the wire format stays private while selection stays testable.
- The behavior change worth remembering, from the spec's risk section: the app no longer trusts GitHub's own "latest" designation. It picks the newest non-draft, non-prerelease entry itself. That is deliberate and deterministic, but it is a change, not just a wider fetch.
