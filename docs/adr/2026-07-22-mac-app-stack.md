# ADR: Mac app stack — SwiftUI shell + Bun-compiled engine sidecar

Date: 2026-07-22 · Status: accepted (user-approved)

## Decision

The Screepub Mac app is a **SwiftUI shell** that invokes the existing
TypeScript converter as a **standalone sidecar binary** produced by
`bun build --compile`. The engine stays the single source of truth shared
by the CLI, the future Calibre plugin, and the app.

## MVP scope (user-defined)

Take a PDF → convert to the acceptable format → send to an e-ink device.
Kindle ecosystem first. Formatting toggles come after MVP (registry:
`docs/formatting-options-log.md`).

## Why not the alternatives

- **Rust/Tauri:** pays a cross-platform complexity tax for a Mac-only
  app, weaker native idioms than SwiftUI, and no mature Fountain/PDF-text
  ecosystem — would force an engine rewrite or keep the sidecar anyway.
- **Full Swift engine now:** feasible (PDFKit extracts text with
  coordinates) but re-risks every hard-won parser fix. Deferred to an
  optional phase 2, where the fixture PDFs + current outputs act as a
  golden-master harness so a port can be verified against the TS engine.
- **Electron:** not lightweight; rejected outright.

## Consequences / notes

- App shells out to the sidecar with `--json`; the JSON contract is the
  app↔engine API. Human output stays for terminal use.
- Sidecar embeds the Bun runtime (~60MB app payload) — accepted for MVP;
  phase-2 Swift port is the remedy if it ever matters.
- Send-to-device: recent Kindles use MTP over USB (not mountable on
  macOS), so the dependable path is Amazon Send-to-Kindle (app if
  installed — it is NOT on this machine — else web upload/email).
- USB sideload requires AZW3: Kindle firmware does not index sideloaded
  EPUBs at all (verified on the user's device 2026-07-22 — the file
  copies but never appears in the library). Send-to-Kindle only accepts
  EPUB because Amazon converts server-side; Calibre's "Send to Device"
  converts to AZW3 locally first. Screepub's USB route does the same via
  Calibre's `ebook-convert` (EPUB→AZW3, ~1s, cached next to the EPUB).
- Standalone USB (no Calibre): the engine writes its own **MOBI 6**
  (`--mobi`; src/mobi/) — a PalmDB container with uncompressed UTF-8
  HTML in the old renderer's dialect (blockquote speeches, bold cues,
  right-flush transitions). Kindles index sideloaded MOBI. The app
  prefers Calibre AZW3 (keeps full EPUB styling) and falls back to the
  engine MOBI, so USB works with zero external dependencies. Priority
  rationale: the user's own device is an older Kindle on a family
  Amazon account, often offline — USB is their primary route.
- Build tooling: Swift 6.3 CommandLineTools only (no full Xcode on this
  machine) → SwiftPM executable target + scripted .app bundle assembly
  + ad-hoc codesign. No Xcode project files.
