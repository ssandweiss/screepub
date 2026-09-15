# Retired coverage: what `bun test` does not have

This is the decision record for behaviour that only `app/` — the frozen
SwiftUI Mac app — still asserts, and for the features behind that behaviour.

It exists because of one measurement, taken on 2026-09-14 and reproducible:
**171 of the 264 `check()` sites in `app/Sources/KitCheck/main.swift` — 65% —
assert behaviour that exists nowhere else in this repository.** The ADR
(`docs/adr/2026-09-12-cross-platform-tauri.md`) said "`kit-check` becomes
`bun test`". For about a third of it, that happened. For the sections below,
it did not, and the deferral has been carried unremarked from piece A through
piece E2.

Spec: `docs/superpowers/specs/2026-09-14-retire-swiftui-design.md`. This file
is what makes its **Gate 2** checkable rather than remembered:

> Gate 2 — the replacement does what the thing being retired does, or the gap
> is written down and accepted by name.

`tests/app-references.test.ts` reads this file and fails if a section is
listed without a decision.

## Read this before reading the table

**No decision has been made.** Every value in the Decision column is a
**recommendation** from the session that measured the gap, and it is marked
RECOMMENDED for that reason. The owner of the product decides whether a
feature comes back; nobody here has the standing to retire one by writing
`accept-loss` in a table and moving on. A row is settled only when the owner
says so and the release notes for the version that drops it name it — which
is Gate 2's actual requirement, and which this file does not satisfy on its
own.

The useful question for each row is not "is the test replaced?" It is: **is
this feature coming back, or is it gone?** Most of these sections cover
things the Tauri app does not have at all — there is no updater, no Apple
Books route, no Send-to-Kindle route, no email-to-Kindle route, no "save a
copy", no Cancel. So each section below answers four questions that make
deciding cheap: what the feature is, what the Swift tests actually assert
about it, what it would cost to port, and what a user loses if it does not
come back.

Where a decision is `port`, the ADR's rule holds: **the port lands in
`src/`**, not in Rust. Rust is a window, not a brain.

## The decisions

| Section | Checks | Decision (SETTLED 2026-09-14) | In one line |
| --- | --- | --- | --- |
| `send-menu` | 45 | `port` | The ordering, the remembered choice and the catalog are pure logic and the largest single block of unreplaced coverage. |
| `mail-and-books` | 5 | `port` | Apple Books is the product's only route to an iPhone; it is one `open`. |
| `feedback-url` | 5 | `port` | ~20 lines of pure URL building, and the only bug-report path the product has. |
| `engine-cancellation` | 10 (part) | `port` | A long conversion that cannot be stopped is a regression a user meets on day one. |
| `updater-version-compare` | 17 | `port` | Pure; carries a downgrade defence that was found the hard way once already. |
| `update-selection` | 17 | `port` | Same unit as the above: pure, no network, no keys. |
| `update-decoding` | 14 | `port` | Same unit. |
| `update-error-descriptions` | 11 | `port` | Same unit; the difference between a message and "The operation couldn't be completed." |
| `self-update-installer` | 26 | **`port`** (was `accept-loss`) | macOS codesign pinning and in-place bundle swap. Its own piece, with its own secrets question. |
| `release-notes-parsing` | 21 | `accept-loss` | Of the Swift assertions only. The feature is replaced in kind and nothing is lost. |
| `kfx-install-plugin` | not a kit-check section | `accept-loss` | Detection ports; installation is a 485 KB GPL-3 binary and a packaging decision. |

The four update rows above the installer are deliberately one unit: they are
`UpdateCheck`'s pure half, they only earn their keep together, and they are
all worthless if the answer to **"does the app ever tell the user a newer
version exists?"** is no. That single product question decides 59 of the 171
checks.

**ANSWERED 2026-09-14 by the owner: yes, and more than notify — the new app
gets a FULL self-update, ported.** So all four update rows stay `port`, and
`self-update-installer` moves from `accept-loss` to `port` with them, which
is a change of 26 checks on top of the 59. That row was parked because it is
"macOS codesign pinning and in-place bundle swap, its own piece, with its own
secrets question", and all of that is still true: it is the largest single
item in the retirement and it should be scoped as its own piece rather than
folded into F. Tauri ships an updater plugin whose design differs from
`UpdateInstall.swift`'s, so "ported" here means the BEHAVIOUR and its
assertions, not a line-by-line translation — in particular the downgrade
defence and the pinned designated requirement have to survive whatever
mechanism replaces them, because those are the two things that make the
update channel not need to be trusted.

Consequence worth stating plainly: with an updater in the new app,
[ADR 2026-09-14](adr/2026-09-14-swift-app-update-path.md) does not change its
decision, but it loses one of its four supporting reasons. Its objection that
"the payload would remove the updater" no longer applies. The disqualifying
reason, architecture-blindness in the frozen updater, is being removed
separately by the universal bundle work. **Once both land, the case for
taking the `com.darkwell.screepub` identifier and migrating people
automatically should be re-opened rather than assumed closed.**

---

## `send-menu` — 45 checks

Source: `app/Sources/ScreepubKit/ResultActions.swift`, checked at
`KitCheck/main.swift:611-773`.

**The feature.** After a conversion, the Swift app offers a menu of places
the book can go: a mounted device (Kindle, Kobo, tolino), a docked
reMarkable, Apple Books, Amazon's Send to Kindle, a pre-addressed email to
the user's `@kindle.com` address, and "save a copy". The menu is a *catalog,
not a status display*: destinations the user owns are always listed, with
disconnected ones sunk to the bottom, flagged unavailable, and carrying a
detail line that says how to make them available ("plug it in over USB").
Each route has its own button verb — Copy, Add, Upload, Send, Email — so the
click is never a surprise.

**What the Swift tests assert.** Ordering (a plugged-in volume beats a docked
reMarkable beats Apple Books beats Send to Kindle); that `saveCopy` is always
offered, so the list is never empty whatever is connected; that route ids stay
unique with *two Kindles plugged in* (the old UI keyed rows by kind, and a
send aimed at the second device landed on the first one's volume); that a
remembered choice outranks the heuristic, but a remembered route that is
structurally gone falls back instead of stranding the user; that the email
route stays listed but unavailable when Apple Mail is not the default client,
because the degraded `mailto:` hand-off silently drops the attachment.

**Cost to port.** Moderate and mostly free of platform. The ordering, the
catalog, the id/storage-key split and the remembered-choice fallback are pure
functions over device kinds that `src/device/` already has — a day's work with
tests, and the assertions above translate almost line for line. The three
macOS hand-off routes it orders are a separate question (`mail-and-books`).

**What a user loses.** The Tauri app offers four device kinds
(`KINDS = ['kindle', 'kobo', 'tolino', 'remarkable']`) and no memory of what
the user chose last time. So: no "save a copy" (the floor route — the one that
always works), no memory across runs, and no catalog, meaning a disconnected
Kindle is invisible rather than listed-with-instructions. The two-same-kind-
devices defect is the one that would come back silently and misdeliver a file.

---

## `mail-and-books` — 5 checks

Source: `app/Sources/ScreepubKit/AppleBooks.swift`, `SendToKindle.swift`,
`InstalledApp.swift`, checked at `KitCheck/main.swift:975-999`.

**The feature.** Three OS hand-offs. Apple Books: add the EPUB to the Books
library, where iCloud carries it to every signed-in iPhone and iPad. Send to
Kindle: open Amazon's native app if installed, else its web uploader. Email to
Kindle: a pre-addressed Apple Mail compose with the book attached.

**What the Swift tests assert.** That Books availability agrees with the
resolved app URL; that a resolved `Books.app` exists on disk and is a bundle;
that on a machine *without* Books, `send()` returns false so the UI hides the
affordance instead of offering a button that does nothing; that default-mail-
client detection resolves without crashing.

**Cost to port.** Small for Books and the Send to Kindle web uploader — an
existence probe and an "open this file with that application", which is window
work. Real for email-to-Kindle: the Swift path builds an Apple Mail compose
with an attachment, and the kit-check comment is explicit that the portable
`mailto:` fallback **drops the attachment silently**, which is worse than not
offering it.

**What a user loses.** Apple Books is the *entire* iOS story: it is how a
script reaches an iPhone or iPad, with no cable and nothing uploaded anywhere
but the user's own iCloud. Losing it is not "one fewer button"; it is dropping
a platform. Books is also the best-rendering target Screepub has — it draws
with WebKit, so the `page-break-inside: avoid` rules a Kindle sideload ignores
are actually honoured there.

---

## `feedback-url` — 5 checks

Source: `app/Sources/ScreepubKit/Feedback.swift`, checked at
`KitCheck/main.swift:504-516`.

**The feature.** "Report a problem" opens a pre-filled GitHub issue carrying
the app version, the OS version, and the context of what just failed (for
example `scanned: no text`).

**What the Swift tests assert.** That the URL targets the repo's new-issue
endpoint; that the body query item is decodable and carries both versions and
the passed context; that it still builds with no context. Plus one defect
worth keeping: `URLComponents` leaves `+` literal in a query and parsers read
that as a space, so it is percent-encoded explicitly.

**Cost to port.** Trivial. Twenty lines of pure string building in `src/`, and
the five assertions port as-is.

**What a user loses.** The only path from "this PDF didn't convert" to a
report someone can act on. Without it the user is expected to find the
repository themselves and retype what happened — which mostly means the
report never arrives, and the parser defect never gets fixed.

---

## `engine-cancellation` — part of 10 checks

Source: `app/Sources/ScreepubKit/Engine.swift`, checked at
`KitCheck/main.swift:1067-1132`. **Progress is already covered** by
`tests/cli.test.ts`; cancellation is not, because `desktop/README.md` says
plainly: "There is no Cancel."

**The feature.** A running conversion can be stopped. A pre-cancelled
conversion never starts a process at all; both paths go through the same
adopt/terminate gate, so there is no window in which a cancelled run leaves an
orphan child.

**What the Swift tests assert.** That a pre-cancelled conversion throws
`EngineFailure.cancelled` rather than returning a result — the deterministic
half of the path, chosen on purpose because a mid-flight cancel on a five-page
fixture races the conversion.

**Cost to port.** Small. The Tauri shell already spawns the CLI as a child
process; cancelling is killing that child, deleting the partial output, and
reporting the distinct "cancelled" outcome rather than a failure. The
adopt-then-terminate ordering is the part to copy rather than reinvent.

**What a user loses.** The ability to stop. A feature-length script is a long
conversion, and dropping the wrong PDF on the window currently means waiting
it out or killing the app — and killing the app is exactly how a half-written
file gets left in the library.

---

## `updater-version-compare` — 17 checks · `update-selection` — 17 · `update-decoding` — 14 · `update-error-descriptions` — 11

Source: `app/Sources/ScreepubKit/UpdateCheck.swift`, checked at
`KitCheck/main.swift:774-812, 1133-1232, 1233-1296, 1468-1532`. Fifty-nine
checks, all pure, no network and no keys.

**The feature.** The app notices that a newer release exists and says so,
once a day at most, and only if the user opted in.

**What the Swift tests assert.**

- *Comparison*: `0.10.0` beats `0.9.0` (string ordering gets that backwards);
  a pre-release does not supersede its release; build metadata is not a bump;
  and the one that was a real defect — `git describe` stamps dev builds
  `0.3.0-1-g<sha>`, which semver reads as *below* `0.3.0`, so a naive
  comparison offers a genuine **downgrade** on every dev build.
- *Throttling and consent*: no opt-in, no request, not even on first launch;
  one check a day; and a clock set backwards does not trigger a check storm.
- *Selection*: the newest release wins; drafts and pre-releases are skipped;
  release notes cover every version newer than the installed one, not just the
  newest.
- *Decoding*: the exact JSON shape GitHub returns, including the `body` field
  an earlier decoder silently dropped.
- *Error descriptions*: without `LocalizedError`, Swift bridges these to
  `NSError` and the user is shown "The operation couldn't be completed.
  (UpdateCheckError error 2.)" — which is what was actually happening. The
  assertions check that each error says something, and that it does *not* fall
  back to Foundation's placeholder.

**Cost to port.** A day, if the feature is wanted. All four sections are pure
functions over a parsed release list; they need `fetch` and nothing else — no
key pair, no update manifest, no Tauri updater plugin, because *notifying* is
not *installing*. The 59 assertions translate directly.

**What a user loses.** Nothing they have today — the Tauri app has never
shipped an updater and `desktop/ui/notes.js` already says plainly that it does
not update itself. What is lost is future: a user on 0.6.0 stays on 0.6.0
until they happen to visit the repository. For an app whose whole premise is
working offline beside a USB Kindle, that may well be the right answer — which
is exactly why this is a product decision and not a porting decision.

---

## `self-update-installer` — 26 checks

Source: `app/Sources/ScreepubKit/UpdateInstall.swift`, checked at
`KitCheck/main.swift:813-974`.

**The feature.** Download the release DMG, prove it is ours, and swap the
installed app in place.

**What the Swift tests assert.** The trust model, which is the interesting
part: rather than shipping a second key the way Sparkle does, the installer
pins codesign **designated requirements** — Apple's anchor, the Developer ID
chain, our Team ID, and our bundle identifier — so a DMG built by anyone else
fails no matter how the download arrived and the download channel does not
have to be trusted. Around that: the staged copy is verified *before* the
swap, so the destination never holds an unverified bundle, and again after;
a genuine signature with the wrong version is a `versionMismatch` (a replay);
a translocated or read-only destination is `notInstallable` rather than a
half-done swap.

**Cost to port.** High, and it is the wrong shape for this repository.
Every mechanism above is macOS-specific (`codesign`, `hdiutil`, bundle
swapping) and would need a Windows and a Linux answer to be worth having in a
cross-platform app. Tauri's own updater exists but wants a key pair and an
update manifest — which the spec already names as its own piece with its own
secrets question, and which the ADR deferred once already.

**What a user loses.** Nothing today, for the same reason as the section
above. The hazard runs the other way, and F2 owns it: an *installed Swift* app
keeps polling for a `.dmg`, will find the Tauri one, and should refuse it
because the bundle identifiers differ. That refusal must be observed on a real
Mac before F2 ships. "Should refuse" is a prediction until someone watches it.

---

## `release-notes-parsing` — 21 checks

Source: `app/Sources/ScreepubKit/ReleaseNotes.swift`, checked at
`KitCheck/main.swift:1297-1467`.

**Replaced in kind, not ported, and nothing is lost.**
`tools/build-desktop-notes.ts` and `tests/desktop-notes.test.ts` parse the
same `docs/releases/<v>.md` into the same block shapes — headings, bullets,
prose, caveat — and assert the same property that matters ("no text is lost").
Different code, comparable coverage.

The `accept-loss` above therefore applies to the 21 Swift assertions only, and
is a bookkeeping statement rather than a product one. It is listed here so
that a reader counting the 171 unreplaced checks does not double-count it as a
feature gap: it is not one.

---

## `kfx-install-plugin` — not a kit-check section

Source: `app/Packages/KFXKit/.../KFXToolchain.swift:157` and the vendored
`Vendor/KFX_Output_plugin.zip` (485 KB, GPL-3, with `PROVENANCE.md`).

Not part of the 171, but it is the other thing in `app/` with no copy
anywhere, so it belongs in the same decision. `src/export/kfx.ts` ports
**discovery** (`pluginInstalled()` shells `calibre-customize --list-plugins`)
and nothing else, so after F3 the KFX ladder can still *detect* jhowell's KFX
Output plugin but Screepub can no longer *install* it.

**Cost to port.** The blocker is not the code — it is deciding how a
`bun build --compile` binary embeds a 485 KB binary asset, which piece A
deferred by name. Add a GPL-3 vendored binary moving into the repository
proper, and this is a packaging and licensing task, not an afternoon.

**What a user loses.** One step of setup. KFX is the best Kindle format
Screepub can produce, and today the app can put the plugin into the user's
Calibre for them; after F3 they would install it through Calibre's own plugin
browser first. The ladder still detects it and still falls back to AZW3/MOBI,
so nothing breaks — it is friction, not failure.

**Either way `THIRD-PARTY-NOTICES.md` must be corrected**: it cites two paths
inside `app/Packages/KFXKit` that would stop existing. That is F3 acceptance
criterion 13, and a dangling path in a license notice is a compliance defect
rather than a typo.
