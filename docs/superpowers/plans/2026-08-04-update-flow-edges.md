# Update Flow Edges Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The updater says what actually went wrong, and offers one answer per question instead of two.

**Architecture:** Deliverable 1 is entirely inside ScreepubKit and fully testable: `UpdateCheckError` gains `LocalizedError` and `malformedResponse` gains a payload. Deliverable 2 moves the release-notes sheet's presentation state from `ContentView`'s `@State` onto `UpdateController`, so the menu-bar alert and the footer popover can both raise it, and gives the main scene an identity so a closed window can be reopened first.

**Tech Stack:** Swift 6 / SwiftUI / SwiftPM. No XCTest (CommandLineTools only); Swift tests are `check()` assertions in the `kit-check` executable.

**Spec:** `docs/superpowers/specs/2026-08-04-update-flow-edges-design.md`

---

## Orientation (read before Task 1)

- Work in the worktree at `.claude/worktrees/release-notes-in-app`, branch `worktree-release-notes-in-app`. Do not `cd` to the parent repo.
- `kit-check` assertions go immediately BEFORE the final two lines of `app/Sources/KitCheck/main.swift`:
  ```swift
  print(failures == 0 ? "kit-check: all passed" : "kit-check: \(failures) FAILED")
  exit(failures == 0 ? 0 : 1)
  ```
  It already provides `check(_:_:)` and `repoRoot`. Do not redeclare `repoRoot`.
- Build with `swift build -c release` from `app/`. Run tests with `swift run -c release kit-check` from `app/`.
- `kit-check` links ScreepubKit but NOT ScreepubApp. Tasks 3 and 4 therefore have no automated tests, deliberately. Do not invent a harness and do not add ScreepubApp to kit-check.
- **Copy rule for anything a user reads:** no em dashes. Use colons or full stops.

---

### Task 1: Errors describe themselves

**Files:**
- Modify: `app/Sources/ScreepubKit/UpdateCheck.swift`
- Test: `app/Sources/KitCheck/main.swift`

- [ ] **Step 1: Write the failing test**

Append to `app/Sources/KitCheck/main.swift`, before the final print/exit pair:

```swift
// — Update error descriptions —
// These strings reach an NSAlert in manualUpdateCheck(). Without
// LocalizedError, Swift bridges to NSError and localizedDescription becomes
// "The operation couldn't be completed. (UpdateCheckError error 2.)", which
// is what the user was being shown.
let describedErrors: [(UpdateCheckError, String)] = [
    (.rateLimited, "rateLimited"),
    (.network("HTTP 503"), "network"),
    (.malformedResponse("index 1: key 'draft' not found"), "malformedResponse"),
    (.noDownloadableAsset, "noDownloadableAsset"),
]
for (error, label) in describedErrors {
    check(error.errorDescription?.isEmpty == false,
          "\(label) has a non-empty errorDescription")
    // The assertion that actually fails if the conformance is ever dropped.
    check(error.localizedDescription.contains("couldn't be completed") == false
            && error.localizedDescription.contains("couldn’t be completed") == false,
          "\(label) does not fall back to Foundation's placeholder")
}

check(UpdateCheckError.network("HTTP 503").localizedDescription.contains("503"),
      "network carries its detail into the description")
check(UpdateCheckError.malformedResponse("key 'draft' not found")
        .localizedDescription.contains("key 'draft' not found"),
      "malformedResponse carries its detail into the description")

// The boundary: proves the `try?` was really replaced, rather than the
// payload being filled with a constant.
do {
    _ = try UpdateCheck.candidates(from: Data("not json".utf8))
    check(false, "malformed JSON should throw")
} catch UpdateCheckError.malformedResponse(let detail) {
    check(!detail.isEmpty, "a decode failure carries the decoder's own reason")
} catch {
    check(false, "wrong error for malformed JSON: \(error)")
}
```

Note the two spellings of "couldn't": Foundation uses a typographic apostrophe (U+2019). Checking only the ASCII form would pass vacuously.

- [ ] **Step 2: Run to verify it fails**

Run: `cd app && swift build -c release`
Expected: FAIL. `malformedResponse` takes no argument yet, and `errorDescription` does not exist.

- [ ] **Step 3: Add the payload and the conformance**

In `app/Sources/ScreepubKit/UpdateCheck.swift`, find this exact block:

```swift
public enum UpdateCheckError: Error, Equatable {
    case rateLimited
    case network(String)
    case malformedResponse
    /// The release exists but carries no .dmg — a half-uploaded release, say.
    case noDownloadableAsset
}
```

Replace all of it with:

```swift
public enum UpdateCheckError: Error, Equatable, LocalizedError {
    case rateLimited
    case network(String)
    /// Carries the decoder's own reason. One malformed element fails the
    /// whole batch of up to thirty releases, so the index it names is the
    /// entire diagnosis.
    case malformedResponse(String)
    /// The release exists but carries no .dmg — a half-uploaded release, say.
    case noDownloadableAsset

    /// Read aloud by the alert in `manualUpdateCheck()`. Without this,
    /// `localizedDescription` is Foundation's "The operation couldn't be
    /// completed. (UpdateCheckError error N.)" and `network`'s payload never
    /// reaches anyone. These say what happened; the alert supplies the
    /// apology, so these must not add a second one.
    public var errorDescription: String? {
        switch self {
        case .rateLimited:
            return "GitHub limits unauthenticated checks to 60 an hour per network address."
        case .network(let detail):
            return detail
        case .malformedResponse(let detail):
            return "GitHub's response could not be read: \(detail)"
        case .noDownloadableAsset:
            return "The newest release has no .dmg attached yet."
        }
    }
}
```

- [ ] **Step 4: Carry the decoder's reason**

In the same file, find this exact block inside `candidates(from:)`:

```swift
        guard let releases = try? JSONDecoder().decode([GitHubRelease].self, from: data) else {
            throw UpdateCheckError.malformedResponse
        }
```

Replace it with:

```swift
        let releases: [GitHubRelease]
        do {
            releases = try JSONDecoder().decode([GitHubRelease].self, from: data)
        } catch {
            // DecodingError names the array index and the key. That is the
            // whole diagnosis when one bad element fails thirty releases.
            throw UpdateCheckError.malformedResponse(error.localizedDescription)
        }
```

- [ ] **Step 5: Fix the one other pattern match**

`app/Sources/KitCheck/main.swift` already contains an older assertion matching the case without a payload. Find:

```swift
} catch UpdateCheckError.malformedResponse {
    check(true, "malformed JSON throws malformedResponse")
```

Change the pattern to bind and ignore the payload:

```swift
} catch UpdateCheckError.malformedResponse(_) {
    check(true, "malformed JSON throws malformedResponse")
```

Then search the whole tree for any other match you missed:

Run: `grep -rn "malformedResponse" app/Sources/`
Expected: every occurrence either constructs the case with an argument or matches it with `(_)` or `(let ...)`.

- [ ] **Step 6: Run to verify it passes**

Run: `cd app && swift run -c release kit-check 2>&1 | grep -E "errorDescription|placeholder|carries|decode failure|kit-check:"`
Expected: every listed line starts `  ok`, run ends `kit-check: all passed`.

- [ ] **Step 7: Prove the placeholder assertion has teeth**

Temporarily remove `LocalizedError` from the conformance list (leave `Error, Equatable`), rebuild, and run kit-check.
Expected: the four "does not fall back to Foundation's placeholder" assertions FAIL, and the two "carries its detail" assertions FAIL.

Then restore it, rebuild, confirm all pass and `git status --porcelain` is empty. Report both outputs.

- [ ] **Step 8: Commit**

```bash
git add app/Sources/ScreepubKit/UpdateCheck.swift app/Sources/KitCheck/main.swift
git commit -m "Update errors say what happened"
```

---

### Task 2: The alert stops apologizing twice

**Files:**
- Modify: `app/Sources/ScreepubApp/ScreepubApp.swift`

No test step: this is ScreepubApp, which `kit-check` does not link.

- [ ] **Step 1: Read the current failure branch**

Run: `grep -n "didn't go through" app/Sources/ScreepubApp/ScreepubApp.swift`

It currently reads:

```swift
        alert.informativeText = "The request didn't go through. Check your connection and try again. (\(error.localizedDescription))"
```

- [ ] **Step 2: Rewrite it**

Now that `errorDescription` is a real sentence, the parenthetical nesting is redundant. Replace that line with:

```swift
        // errorDescription is a complete message now, so it stands on its
        // own rather than being parenthesized inside a second apology.
        alert.informativeText = error.localizedDescription
```

**Corrected after review.** An earlier draft of this step appended "Check your connection and try again." to every error. That is wrong advice for two of the four cases: `noDownloadableAsset` means GitHub has not finished uploading a `.dmg`, and `malformedResponse` means the response arrived fine and could not be read. Neither is a connectivity problem. The advice now lives inside `network`'s own `errorDescription`, which is the only case where it is true, so each description is complete and correct on its own and this line simply shows it.

- [ ] **Step 3: Verify it compiles**

Run: `cd app && swift build -c release`
Expected: `Build complete!`

- [ ] **Step 4: Commit**

```bash
git add app/Sources/ScreepubApp/ScreepubApp.swift
git commit -m "Let the error speak for itself in the update alert"
```

---

### Task 3: Presentation state moves to the controller

**Files:**
- Modify: `app/Sources/ScreepubApp/UpdateController.swift`
- Modify: `app/Sources/ScreepubApp/ContentView.swift`

No test step: ScreepubApp.

- [ ] **Step 1: Add the published property**

In `app/Sources/ScreepubApp/UpdateController.swift`, find:

```swift
    @Published var available: AvailableUpdate?
```

Add immediately after it:

```swift
    /// The update whose notes should be on screen, or nil for no sheet.
    /// Lives here rather than in ContentView because two surfaces raise the
    /// same sheet now: the footer popover, and the menu bar's Check for
    /// Updates alert, which has no view context of its own.
    @Published var notesRequest: AvailableUpdate?
```

- [ ] **Step 2: Point ContentView at it**

In `app/Sources/ScreepubApp/ContentView.swift`, delete the local state declaration and its doc comment. Find the `@State private var releaseNotesUpdate: AvailableUpdate?` line together with the comment block directly above it, and remove both.

Then change the sheet modifier from:

```swift
        .sheet(item: $releaseNotesUpdate) { update in
```

to:

```swift
        .sheet(item: $updates.notesRequest) { update in
```

And change the popover call site from:

```swift
                    UpdatePopover(update: update) { releaseNotesUpdate = $0 }
```

to:

```swift
                    UpdatePopover(update: update) { updates.notesRequest = $0 }
```

- [ ] **Step 3: Verify no stale references remain**

Run: `grep -rn "releaseNotesUpdate" app/Sources/`
Expected: no output.

- [ ] **Step 4: Verify it compiles**

Run: `cd app && swift build -c release`
Expected: `Build complete!`

`updates` is declared `@ObservedObject private var updates = UpdateController.shared` at `ContentView.swift:32` (verified), so `$updates.notesRequest` produces a valid `Binding`. If the compiler objects, report it rather than working around it.

- [ ] **Step 5: Commit**

```bash
git add app/Sources/ScreepubApp/UpdateController.swift app/Sources/ScreepubApp/ContentView.swift
git commit -m "The release notes sheet is the controller's to raise"
```

---

### Task 4: The menu opens the sheet, reopening the window if it must

**Files:**
- Modify: `app/Sources/ScreepubApp/ScreepubApp.swift`

No test step: ScreepubApp. This is the task the spec flags as carrying a real risk; read its "window problem" section before starting.

- [ ] **Step 1: Give the main scene an identity**

`openWindow` cannot target a `WindowGroup` with no id. In `app/Sources/ScreepubApp/ScreepubApp.swift`, change:

```swift
        WindowGroup {
            ContentView()
```

to:

```swift
        WindowGroup(id: Self.mainWindowID) {
            ContentView()
```

and add this to the same `App` type, above `var body: some Scene`:

```swift
    /// The main window needs an id so `openWindow` can reopen it when the
    /// menu bar's Check for Updates runs with every window closed.
    static let mainWindowID = "main"
```

- [ ] **Step 2: Give the command access to openWindow**

`manualUpdateCheck()` is a free function with no environment. Extract the command into a `Commands` type that has one.

Find the existing command:

```swift
            CommandGroup(after: .appInfo) {
                Button("Check for Updates…") { Task { await manualUpdateCheck() } }
            }
```

Replace it with:

```swift
            UpdateCommands()
```

Then add this type at the end of the file:

```swift
/// Holds `openWindow` so `manualUpdateCheck` can reopen the main window
/// before raising the notes sheet. A free function cannot read the
/// environment; a `Commands` type can.
struct UpdateCommands: Commands {
    @Environment(\.openWindow) private var openWindow

    var body: some Commands {
        CommandGroup(after: .appInfo) {
            Button("Check for Updates…") {
                Task { await manualUpdateCheck(openWindow: openWindow) }
            }
        }
    }
}
```

- [ ] **Step 3: Take the parameter and use it**

Change the signature:

```swift
@MainActor func manualUpdateCheck() async {
```

to:

```swift
@MainActor func manualUpdateCheck(openWindow: OpenWindowAction) async {
```

Then find the "View Release" branch:

```swift
        case .alertSecondButtonReturn:
            NSWorkspace.shared.open(update.releaseNotesURL)
```

Replace it with:

```swift
        case .alertSecondButtonReturn:
            // Reopen first: the sheet needs a ContentView alive to present
            // it, and Check for Updates works from the menu bar with every
            // window closed. Setting the request into a windowless app
            // would silently do nothing, which is the worst of the options.
            if !NSApp.windows.contains(where: { $0.isVisible && $0.canBecomeMain }) {
                openWindow(id: ScreepubApp.mainWindowID)
            }
            UpdateController.shared.notesRequest = update
```

`ScreepubApp` is the `@main` type's real name (verified at `ScreepubApp.swift:62`), so `ScreepubApp.mainWindowID` resolves as written.

- [ ] **Step 4: Verify it compiles**

Run: `cd app && swift build -c release`
Expected: `Build complete!`

**If `@Environment(\.openWindow)` does not compile or does not deliver a working action inside `Commands`,** stop and take the spec's named contingency: keep `NSWorkspace.shared.open(update.releaseNotesURL)` for the no-window case only, and set `notesRequest` when a window exists. Do NOT silently pick this. Report which of the two you ended up with and why.

- [ ] **Step 5: Confirm the browser call is gone from this path**

Run: `grep -n "NSWorkspace.shared.open" app/Sources/ScreepubApp/ScreepubApp.swift`

Expected: `manualUpdateCheck`'s "View Release" branch no longer appears. Other uses in the file (feedback links, and ContentView's `.failed`-phase footer, which is deliberately unchanged) are fine.

- [ ] **Step 6: Commit**

```bash
git add app/Sources/ScreepubApp/ScreepubApp.swift
git commit -m "Check for Updates opens the notes in the app"
```

---

### Task 5: Full verification

- [ ] **Step 1: Every suite**

```bash
bun test
bunx tsc --noEmit
cd app && swift run -c release kit-check
```

Expected: `431 pass / 1 skip / 0 fail` (the skip wants the gitignored root `/fixtures/` and is normal in this worktree), typecheck silent, `kit-check: all passed`.

- [ ] **Step 2: Build the bundle**

Run: `./app/build-app.sh`
Expected: ends `built: .../app/dist/Screepub.app`.

- [ ] **Step 3: Report the manual checklist to the controller**

Do NOT drive the app yourself. Report that these five need a human, with a build whose version predates the newest published release:

1. Menu, Check for Updates, main window open. "View Release" opens the in-app sheet, no browser.
2. Same with the main window closed. The window reopens and the sheet appears over it.
3. The footer popover's release notes button still works, and both paths land on the same sheet.
4. An update whose install is already running still shows OK / View Release, and View Release opens the sheet.
5. Offline. The alert names the real cause and contains no "couldn't be completed".

---

## Notes for the implementer

- Deliverable 2 (Tasks 3 and 4) has no automated coverage, and that is stated rather than papered over. Do not add tests that assert nothing to make the task look covered.
- Task 4 is the one with genuine uncertainty. Its contingency is written into Step 4. Taking the contingency is an acceptable outcome; taking it silently is not.
- `AvailableUpdate` is already `Identifiable` (id = version) from the previous plan. Nothing here needs to add it.
