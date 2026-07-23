# Screepub

Turn a screenplay PDF into something that actually reads well on a Kindle.

Three-stage pipeline — **PDF → Fountain → EPUB3/MOBI** — with a small Mac
app on top that converts with one drop and sends straight to a device.
The `.fountain` intermediate is kept as a durable, editable artifact.

## Why

Consumer converters turn screenplays into walls of text: dialogue loses
its column, cues detach from speeches, page geometry dies. Screepub
parses the PDF's *positions* (element classification by indent), rebuilds
real screenplay structure, and emits reflowable books that keep it at any
font size.

## The Mac app

`app/dist/Screepub.app` (build: `app/build-app.sh` — SwiftPM + a compiled
Bun sidecar, no Xcode needed). Drop a PDF (or `.fountain`) on the script-
page-styled window:

- **Transfer routes:** USB copy to a mounted Kindle (auto-converts to
  AZW3 via Calibre when installed, else the engine's own MOBI — Kindles
  never index sideloaded EPUBs), pre-addressed email to your
  @kindle.com address, or Amazon's Send-to-Kindle app/web. Kobo
  (plain EPUB, or KEPUB via Calibre — toggle in Settings) and tolino
  (EPUB into its Books folder) are detected the same way; a docked
  reMarkable (USB web interface enabled) gets the original PDF —
  native pagination plus pen annotation beats a reflow there.
- **Connected-device stamps:** the title page shows a stamp per
  detected device, live on connect/disconnect.
- **Script preview reader:** READ SCRIPT opens the converted script in
  a resizable window — the EPUB's actual markup, live-retunable via a
  formatting rail whose changes persist per script and re-render in
  place; send buttons ride along so you can proof → tweak → ship
  without switching windows.
- **Settings (⌘, or the gear on the page):** output library folder
  (default `~/Documents/Screepub`), Kindle email, Kobo KEPUB toggle,
  and a full Formatting tab with a live script-page preview.
- Guards surface clearly: scanned PDFs, non-screenplays (with Convert
  Anyway), password-protected files.

## What the conversion gets right

- **Structure by geometry:** indent-based element classification,
  dual-margin scene numbers, hybrid cues (`CLEO/PANNI`, `COP #2`),
  revision-star and watermark/boilerplate stripping, Final Draft
  double-print dedup, `(MORE)`/`(CONT'D)` page-break rejoin.
- **Dual dialogue** de-interleaved into clean sequential speeches.
- **Inline bold/italic** carried from PDF font styles into the book
  (underline isn't detectable in PDFs, but `_markers_` added by hand to
  the `.fountain` render).
- **Kindle-safe layout:** dialogue as a centered narrow column (% side
  margins — Kindle strips `max-width`), em vertical rhythm, cues and
  scene headings kept with their content across page breaks, scene-level
  TOC, generated title page.
- **Optional original-pagination markers** ("47." in the margin) so page
  count — the industry's evaluation metric — survives reflow.

All formatting behaviors are options (`src/options.ts`), exposed in the
app's Formatting settings and on the CLI via `--options file.json`.
The registry with rationale for each: `docs/formatting-options-log.md`.

## CLI

```bash
bun src/cli.ts <input.pdf | input.fountain> [options]
```

| Option | Effect |
| --- | --- |
| `-o, --output <file>` | EPUB path (default `<input>.epub`; companions follow it) |
| `--mobi` | also write a MOBI 6 (dependency-free USB sideload) |
| `--fountain <file>` / `--no-fountain` | intermediate `.fountain` control |
| `--options <file.json>` | formatting knobs (see the registry) |
| `--title` / `--author` | override detected metadata |
| `--force` | convert even if it doesn't look like a screenplay |
| `--json` | machine-readable result (the app↔engine contract) |
| `--debug` | dump classified elements JSON |

## Development

```bash
bun test                    # engine suite
bunx tsc --noEmit           # typecheck
app/build-app.sh            # build the Mac app
(cd app && swift run -c release kit-check)   # Swift-side checks
epubcheck out.epub          # validate
```

Integration tests run against real script PDFs in `fixtures/`
(gitignored — private material, bring your own structurally-different
scripts). Docs worth reading before changing layout code:
`docs/screenplay-format-reference.md` (print geometry + what Kindle's
renderer actually honors) and `docs/adr/` (stack decisions).

## Architecture

```
src/
  parser/     PDF → classified elements (ported from nightwatch's
              table-read parser, heavily extended)
  fountain/   elements → Fountain (title block, CONT'D normalization,
              dual-dialogue-safe, styled-text pass-through)
  epub/       fountain-js tokens → EPUB3 (jszip, options-driven CSS)
  mobi/       tokens → MOBI 6 (hand-built PalmDB container)
  options.ts  FormatOptions — the single knob surface
  convert.ts  orchestration + guards
  cli.ts      CLI + --json contract
app/
  Sources/ScreepubKit/   engine bridge, transfer routes (USB/email/web)
  Sources/ScreepubApp/   script-page UI + settings with live preview
```
