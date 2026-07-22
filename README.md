# Screepub

Screenplay PDF → reflowable EPUB3 that reads cleanly on Kindle. Three-stage
pipeline: **PDF → Fountain → EPUB** — the `.fountain` intermediate is kept as
a durable, editable artifact.

The PDF parsing (element classification by normalized indent, boilerplate and
watermark suppression, shooting-script scene numbers, title-page detection) is
ported nearly verbatim from nightwatch's table-read parser
(`nightwatch/src/lib/tableread/parser/`).

## Usage

```bash
bun src/cli.ts <input.pdf | input.fountain> [options]
```

| Option | Effect |
| --- | --- |
| `-o, --output <file>` | EPUB path (default `<input>.epub`) |
| `--fountain <file>` | Fountain path (default `<input>.fountain` for PDF input) |
| `--no-fountain` | skip the intermediate `.fountain` file |
| `--title` / `--author` | override detected metadata |
| `--force` | convert even if it doesn't look like a screenplay |
| `--debug` | dump classified elements to `<input>.elements.json` |

Scanned/image-only PDFs are rejected with a clear message (no OCR fallback);
documents with no scene headings *and* no dialogue are rejected unless
`--force`.

## What the EPUB gets right

- **Em-based indents** — dialogue/parenthetical/cue structure survives any
  reader font size (fixed-inch indents are what consumer converters get wrong).
- **Keep-with-next** on character cues and parentheticals — a cue never
  orphans from its dialogue at a page break.
- **Scene-level TOC** — one chapter per slugline, plus landmarks.
- **Title page** generated from the script's detected title/author.
- **Page furniture stripped** — page numbers, `(MORE)`/`(CONT'D)` page-break
  splits rejoined, revision slugs, draft stamps, watermarks.

## Development

```bash
bun test          # unit + integration suite
bunx tsc --noEmit # typecheck
```

Integration tests run against real script PDFs in `fixtures/` (gitignored —
copy structurally different scripts in; sourced from nightwatch uploads).
Validate outputs with `epubcheck` (brew-installed), then Kindle Previewer /
Send-to-Kindle for a device check.

## Architecture

```
src/
  parser/     ported nightwatch parser (extract → group → classify →
              scene numbers → title pages → boilerplate suppression)
  fountain/   elements → Fountain text (forcing syntax, (MORE)/(CONT'D) rejoin)
  epub/       fountain-js tokens → XHTML chapters → EPUB3 (jszip)
  convert.ts  orchestration + scanned/non-screenplay guards
  cli.ts      argument parsing and output
```

Design spec: `docs/superpowers/specs/2026-07-22-screepub-design.md`.
