# Export & Email Routes — design

2026-07-25 · approved in brainstorm. Replaces the silently-failing
"EMAIL TO KINDLE…" compose handoff with explicit export affordances;
keeps the compose button only where it actually works (Apple Mail).
SMTP direct-send was considered and **rejected** — see Rejected below.

## Purpose

Get the converted file out of Screepub and into whatever the user
already uses — any mail client, a thumb drive, a mounted Kindle —
without the app owning credentials or depending on a mail client's
cooperation. Today's email button lies: it reports success while
silently dropping the attachment for most users.

## The bug this replaces (root cause, evidence-backed)

`SendToKindle.email` (SendToKindle.swift:21) calls
`NSSharingService(named: .composeEmail)`. Probed on the owner's Mac:

| Probe | Result |
| --- | --- |
| default `mailto:` handler | **Superhuman.app** (`com.superhuman.electron`) |
| `NSSharingService(named: .composeEmail).title` | **"Mail"** (Apple Mail's service) |
| `canPerform(withItems: [epub])` | **true** — so the guard passes |
| Mail in `sharingServices(forItems: [epub])` | **absent** |

The app requests *Apple Mail's* compose service. When the default client
is a third-party app, macOS degrades the request to a **`mailto:`
handoff**, and `mailto:` (RFC 6068) has no attachment field at all — the
`attach=` extension is deliberately ignored by modern clients as a
security hole. Recipient and subject survive; the file does not. Because
`canPerform` returns `true`, the app reports success — a silent failure.

Not patchable at that layer: Superhuman is an Electron app with no
macOS sharing service and no AppleScript dictionary, so `mailto:` is its
only integration point. The handoff **does** work correctly when Apple
Mail is the default client, which is why this went unnoticed.

## Rejected: SMTP direct send

Considered building credentialed SMTP send (nodemailer in the engine,
password in Keychain). Rejected because it is not evergreen for a public
app:

- Basic SMTP auth is eroding — Microsoft disables it per-tenant, Google
  and Apple require app-specific passwords gated behind 2FA.
- The OAuth escape hatch is closed: Gmail's send scope is "restricted,"
  needing Google verification and a client secret we would be shipping
  inside an open-source binary.
- It adds a third setup step on top of Amazon's two (find your
  `@kindle.com` address; add the sender to the Approved Personal
  Document E-mail List) — too much friction for the non-technical
  audience the README now targets.

Export puts the file in the user's hands and lets the tools they already
have do the sending. Nothing to store, nothing a provider can break.

## Format semantics (the trap this design must avoid)

The file you email is **not** the file you sideload:

- **Email → EPUB.** Amazon stopped accepting MOBI for Send to Kindle in
  2022; EPUB is accepted and converted server-side (and picks up
  Enhanced Typesetting, which is why the wireless route renders better
  than a sideload).
- **Manual USB sideload → AZW3/MOBI.** Per the project invariant,
  Kindles never index sideloaded EPUBs.

A single undifferentiated "export" would quietly fail one of these, so
the format choice is explicit and labeled by *purpose*, not extension.

## Components

### 1. `ExportFormat` (ScreepubKit — logic, kit-checkable)

An enum over what a converted script can be exported as, plus a resolver
that reports which are actually available for a given EPUB path:

- `.epub` — always available (it is the conversion's primary output).
- `.kindle` — the sideload format, resolving exactly as the USB route
  does today: **AZW3 via Calibre when installed, else the engine's
  MOBI**. Reusing that decision keeps export and USB consistent rather
  than introducing a second, divergent answer.

The resolver returns display labels stating the purpose ("EPUB — for
emailing to Kindle and most e-readers", "AZW3 — for USB sideload to
Kindle"), so the UI never has to hardcode format prose.

**Freshness rule (correctness, not polish):** the reader window
re-renders write only the EPUB (`includeMobi: false`), so a `.mobi`
sitting in the library can be **older than the current EPUB**. Before
exporting a Kindle-format file, compare its mtime to the EPUB's and
regenerate when missing or stale. Exporting a stale book is exactly the
kind of silent wrongness this whole spec exists to remove.

### 2. Export panel (ScreepubApp — UI)

`SAVE A COPY…` opens an `NSSavePanel`:
- defaults to the **Desktop** (the owner's stated intent: "save it to
  the desktop so someone could email it on their own"),
- filename defaults to the script's stem,
- an accessory view holds a format pop-up listing the available
  `ExportFormat`s, EPUB preselected; changing it updates the panel's
  extension,
- on confirm, copy (or regenerate-then-copy per the freshness rule).

### 3. Drag-out (ScreepubApp — UI)

`.onDrag` on the result card, vending the EPUB via `NSItemProvider`.
This is the shortest path for the motivating case: drag straight from
Screepub into a compose window in any mail client, with no intermediate
file on the Desktop.

### 4. `COPY KINDLE ADDRESS` (ScreepubApp — UI)

The app already stores the destination `@kindle.com` address
(`@AppStorage("kindleEmail")`). This copies it to the clipboard so it
can be pasted into any client. When unset, it points the user at
Settings rather than copying an empty string.

### 5. Conditional compose (ScreepubKit + ScreepubApp)

`SendToKindle` gains `defaultMailClientIsAppleMail` — resolve
`mailto:` via `NSWorkspace.urlForApplication(toOpen:)` and compare the
bundle identifier to `com.apple.mail`. The `EMAIL TO KINDLE…` button
renders **only when that is true**, where the attachment genuinely
works. Everyone else sees the export affordances instead of a button
that lies. `SendToKindle.email` itself is unchanged.

### 6. Guidance line (ScreepubApp — UI)

One line under the buttons: email the saved file to your `@kindle.com`
address from any mail app, and note that the **sending** address must be
on Amazon's Approved Personal Document E-mail List or the message is
silently discarded. This is the failure users would otherwise blame on
Screepub.

## Call sites

Both windows change identically, so behavior does not diverge:
- `ContentView.swift:325` (main result view) — full set.
- `ReaderRail.swift:93` (reader window rail) — same treatment; its
  `emailToKindle()` becomes the conditional-compose path and gains the
  export affordances.

`SHOW IN FINDER` stays (it already covers "give me everything, including
the `.fountain`"). USB, reMarkable, and Send-to-Kindle-app routes are
untouched.

## Error handling

- Export copy/regeneration failure → the existing `transferNote` /
  `errorLine` surfaces the reason; no silent success anywhere.
- Kindle-format regeneration invokes the engine (or Calibre) and can be
  slow; the UI shows in-flight state rather than appearing frozen.
- `COPY KINDLE ADDRESS` with no address set → directs to Settings.

## Testing

- **kit-check** (no XCTest in this project): `ExportFormat` availability
  against a temp dir containing `.epub` only vs `.epub` + `.mobi`; the
  stale-MOBI freshness comparison (touch an old mtime, assert it is
  reported stale); `defaultMailClientIsAppleMail` returns without
  crashing (its *value* is machine-dependent and must not be asserted).
- **Engine unaffected** — no `src/` changes, so `bun test` stays green
  as a regression net.
- **Manual:** save panel writes a valid file to the Desktop; drag-out
  attaches in a real mail client; clipboard round-trip.

## Out of scope (YAGNI)

SMTP/credentialed sending; OAuth; a share-sheet button
(`NSSharingServicePicker` offers no Mail entry for EPUB anyway, as the
probe showed); AZW3-vs-MOBI as a user-facing choice (the USB route's
existing rule decides); auto-detecting the user's `@kindle.com` address
(only Amazon knows it).
