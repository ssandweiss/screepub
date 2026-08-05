# Screepub

Screenplay PDF → Fountain → reflowable EPUB3/MOBI, with a SwiftUI Mac app
that converts and sends to e-readers (Kindle first; Kobo/tolino via USB
volume signatures, reMarkable via its USB web interface — see
ScreepubKit's Device.swift/RemarkableDevice.swift). Engine is
Bun/TypeScript; the app shells out to it as a compiled sidecar.

## Commands

```bash
bun test                    # engine suite (integration tests need fixtures/)
bunx tsc --noEmit           # typecheck
bun src/cli.ts <pdf>        # convert (see --help; --json is the app contract)
app/build-app.sh            # engine sidecar + SwiftUI app → app/dist/Screepub.app
(cd app && swift run -c release kit-check)   # Swift-side behavior checks
epubcheck <out.epub>        # validate output (brew-installed)
```

## Architecture

- `src/parser/` — PDF → classified elements. Adapted from an earlier
  table-read parser by the same author and heavily extended here; this is
  now the only copy, so no cross-repo mirroring. Parser stays
  FORMAT-OPTION-FREE.
- `src/fountain/serialize.ts` — elements → Fountain. The `.fountain` is a
  durable artifact and the app's cache boundary. Beside it,
  `src/fountain/slug.ts` owns the stage-2 `PRIMARY_SLUG`/`isMiniSlug`
  discriminator both renderers import (registry #5b).
- `src/epub/` + `src/mobi/` — fountain-js tokens → EPUB3 (jszip) / MOBI 6
  (hand-built PalmDB container for dependency-free USB sideload).
- `src/options.ts` — FormatOptions, the single knob surface: CLI
  `--options file.json` ↔ app `FormatSettings`. Defaults are pinned to
  root `format-defaults.json` by BOTH suites (options.test.ts,
  kit-check) — change all three together or a suite fails.
- `src/convert.ts` — orchestration + scanned/non-screenplay guards.
- `app/` — SwiftPM (NO Xcode project; CommandLineTools only, so no
  XCTest/swift-testing — `kit-check` executable instead). ScreepubKit =
  logic, ScreepubApp = script-page-themed UI (Theme.swift).

## Non-negotiable invariants

- **Classification always uses PLAIN text.** Styled text (fountain
  emphasis from PDF font styles) rides in `styledText` beside it; only
  dialogue/action emit styled. Markers in cues/parens/slugs break parsing.
- **EPUB CSS: horizontal in %, vertical in em, no max-width, no body
  line-height.** Kindle strips max-width and owns line-height. Two more
  hard NOs: **never `background-color` on html or body** — it makes the KFX
  converter synthesize its own wrapper block and every keep in the book
  then dies silently (MobileRead t=330798). Our own nesting is fine:
  `section.scene` > `.dialogue-block` > `.keep-together` is device-
  confirmed to hold (registry #8b), so this is a ban on the root
  background, NOT a reason to flatten the DOM. And **CSS value SYNTAX
  stays CSS-2.1-vintage** — no `min()`/`clamp()`/`var()`, because Adobe
  RMSDK (Kobo's EPUB path, tolino) violates CSS error handling and can
  blank a whole book on a value function it cannot parse; CSS3 PROPERTIES
  that degrade harmlessly are fine (`opacity` on the page marker is the
  precedent). See docs/screenplay-format-reference.md before touching
  css.ts, and docs/device-map.md §6 for what each renderer honors.
- **Kindles never index sideloaded EPUBs.** USB = AZW3 via Calibre's
  ebook-convert (with flags that stop Calibre re-breaking scenes and
  stripping div margins — see EbookConvert.swift) or the engine's MOBI.
  **2026-07-29: sideloaded KFX renders with Enhanced Typesetting** — keeps
  hold, and it indexes — so KFX (Calibre + jhowell's KFX Output plugin +
  Kindle Previewer) beats AZW3 whenever that toolchain is present. The
  renderer follows the FORMAT, not the delivery route; registry §8b has
  the full verdict. AZW3/MOBI stay as fallbacks.
- **pdf.js:** getDocument TRANSFERS the buffer (never reuse bytes); modern
  build + DOMMatrix shim (legacy build breaks under bun test); fonts only
  resolve after getOperatorList (style detection needs it); the worker is
  statically imported for `bun build --compile`.
- Formatting behaviors are cataloged in **docs/formatting-options-log.md**
  — update it whenever one changes; it's the app's options registry.

## Working style

- TDD: failing test first (bun:test). Two fixture sets: `tests/fixtures/`
  is invented, committed, and runs in CI (regenerate with
  `tools/make-fixture.py`); root `/fixtures/` holds real scripts and is
  gitignored — never commit it, and never let a real title, author, or
  character name reach an assertion, a doc, or a screenshot.
- Committed fixtures: `screenplay.pdf` (clean happy path), `prose.pdf` and
  `blank-pages.pdf` (the not-a-screenplay and scanned guards), and
  **`torture.pdf`** — 14 sheets exercising every content-driven registry
  behavior, whose coverage is tracked row-by-row in
  `tools/torture-manifest.json`. `bun tools/device-checklist.ts` prints the
  device-side half of that manifest for a hardware pass. All four regenerate
  from `make-fixture.py`, and `tests/fixture-stability.test.ts` fails if the
  first three stop reproducing byte-for-byte.
- Fixture sweep + epubcheck after any stage-1/CSS change. Test
  end-to-end with real PDFs too; outputs land in the app library folder.
- **The corpus diff is the tool for "does this actually matter?"** Convert
  every script in root `/fixtures/` with and without a change and diff the
  `.fountain`. It is what proved the dual-dialogue fix was fixture-only, the
  page-furniture fix was worth shipping (celtx 19 lines), and a pdf.js bump
  was inert. Synthetic fixtures cannot answer that question.
- **Rebuild `torture.pdf` before any device pass.** A stale build once put
  an already-fixed defect in front of a reviewer and nearly cost a verdict.
- After engine changes, rebuild the app bundle (it embeds the sidecar).

## Context

Built first for an older USB-mass-storage Kindle that is often offline, so
USB is the primary route and everything works without a network. Public
repo, AGPL-3.0-or-later, © Darkwell Entertainment LLC; releases are
notarized DMGs built by CI on `v*` tags.
