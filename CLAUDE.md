# Screepub

Screenplay PDF → Fountain → reflowable EPUB3/MOBI, with a SwiftUI Mac app
that converts and sends to Kindle. Engine is Bun/TypeScript; the app shells
out to it as a compiled sidecar.

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

- `src/parser/` — ported from nightwatch's table-read parser
  (`nightwatch/src/lib/tableread/parser/`), heavily extended here. Fixes
  must be mirrored between the repos (nightwatch's copy splits pure line
  logic into `parser/lines.ts`). Parser stays FORMAT-OPTION-FREE.
- `src/fountain/serialize.ts` — elements → Fountain. The `.fountain` is a
  durable artifact and the app's cache boundary.
- `src/epub/` + `src/mobi/` — fountain-js tokens → EPUB3 (jszip) / MOBI 6
  (hand-built PalmDB container for dependency-free USB sideload).
- `src/options.ts` — FormatOptions, the single knob surface: CLI
  `--options file.json` ↔ app `FormatSettings` (keep defaults in sync!).
- `src/convert.ts` — orchestration + scanned/non-screenplay guards.
- `app/` — SwiftPM (NO Xcode project; CommandLineTools only, so no
  XCTest/swift-testing — `kit-check` executable instead). ScreepubKit =
  logic, ScreepubApp = script-page-themed UI (Theme.swift).

## Non-negotiable invariants

- **Classification always uses PLAIN text.** Styled text (fountain
  emphasis from PDF font styles) rides in `styledText` beside it; only
  dialogue/action emit styled. Markers in cues/parens/slugs break parsing.
- **EPUB CSS: horizontal in %, vertical in em, no max-width, no body
  line-height.** Kindle strips max-width and owns line-height. See
  docs/screenplay-format-reference.md before touching css.ts.
- **Kindles never index sideloaded EPUBs.** USB = AZW3 via Calibre's
  ebook-convert (with flags that stop Calibre re-breaking scenes and
  stripping div margins — see EbookConvert.swift) or the engine's MOBI.
- **pdf.js:** getDocument TRANSFERS the buffer (never reuse bytes); modern
  build + DOMMatrix shim (legacy build breaks under bun test); fonts only
  resolve after getOperatorList (style detection needs it); the worker is
  statically imported for `bun build --compile`.
- Formatting behaviors are cataloged in **docs/formatting-options-log.md**
  — update it whenever one changes; it's the app's options registry.

## Working style

- TDD: failing test first (bun:test). Fixture sweep + epubcheck after any
  stage-1/CSS change: fixtures/ holds real scripts (gitignored — never
  commit, never publish; sourced from nightwatch/uploads/scope).
- Test scripts end-to-end with the user's real PDFs in ~/Downloads;
  outputs land in ~/Documents/Screepub (app library folder).
- After engine changes, rebuild the app bundle (it embeds the sidecar).

## Context

Built for the user's own older Kindle (USB mass storage, family Amazon
account, often offline) → USB is the primary route. Repo is private-local
today, headed to GitHub (private, eventually public — scrub personal
paths in docs and pick a license before flipping).
