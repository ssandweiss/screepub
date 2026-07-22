# Screepub — Screenplay PDF → Reflowable EPUB3 (design)

Date: 2026-07-22
Status: approved-by-brief (built from the user's carry-over brief; autonomous session)

## Goal

A lightweight CLI that converts a screenplay PDF into a reflowable EPUB3 that
reads cleanly on Kindle: sluglines, character cues, dialogue, and
parentheticals preserved with structure-scaled indents, scene-level TOC, and a
generated title page. Pipeline: **PDF → Fountain → EPUB** with the `.fountain`
file as the durable intermediate artifact.

## Key decision: TypeScript/Bun, not Python

The brief suggested Python (`pdfplumber`/`jouvence`/`ebooklib`), but the user
directed pulling as much as possible from nightwatch's table-read parser
(`nightwatch/src/lib/tableread/parser/`), which is TypeScript. That parser is
~700 lines of battle-tested logic — indent normalization as % of page width,
block grouping, a 10-priority classifier, boilerplate/watermark suppression,
shooting-script scene numbers, title-page detection, character age variants —
with unit tests. Porting it to Python would re-introduce every edge-case bug
it already fixed. So: **Bun + TypeScript CLI, parser reused nearly verbatim.**

Stack: `pdfjs-dist` (extraction, same as nightwatch), `fountain-js` (Fountain
parsing — existing grammar, not hand-rolled), `jszip` (EPUB packaging).
No React, no server — one binary-style CLI (`bun src/cli.ts` / bin `screepub`).

## Architecture

```
src/
  parser/        ported from nightwatch (types, extract, group, classify,
                 boilerplate, title-page, index) — pdfjs legacy build for
                 headless Bun/Node, no worker
  fountain/
    serialize.ts elements → Fountain text (title block, scene numbers,
                 (MORE)/(CONT'D) page-break rejoin, forced transitions)
  epub/
    html.ts      fountain-js tokens → XHTML chapters (one per scene)
    css.ts       em-based screenplay stylesheet
    build.ts     EPUB3 zip: mimetype, container.xml, package.opf, nav.xhtml
  cli.ts         parseArgs, orchestration, scanned-PDF bail-out
```

- **Single rendering path:** PDF input serializes to Fountain, then the same
  `fountain-js → HTML → EPUB` path renders it. `.fountain` input is accepted
  directly. Round-tripping validates the serializer on every run.
- **(MORE)/(CONT'D):** drop `(MORE)` parentheticals; when a `(CONT'D)` cue
  directly follows dialogue by the same character across a page break, merge
  the speech and drop the repeated cue. Mid-scene `(CONT'D)` after action is
  kept (authentic screenplay convention).
- **Scanned PDFs:** if extraction yields near-zero text (< ~3 lines/page
  average), exit with a clear "no text layer — needs OCR" error. No silent
  garbage. OCR fallback is out of scope for v1.

## EPUB details

- Em-based indents so structure survives font-size changes (the thing consumer
  converters get wrong): dialogue ~1.5em both sides, parenthetical deeper,
  character cue deeper still; action full-width; transitions right-aligned.
- `break-after: avoid` on character cues and parentheticals (keep-with-next).
- TOC (`nav.xhtml` + landmarks) built from scene headings; one XHTML file per
  scene keeps files small for Send-to-Kindle.
- Title page generated from the Fountain title block (title/author pulled from
  detected title-page elements; `--title`/`--author` override).

## CLI surface

```
screepub <input.pdf|input.fountain> [-o out.epub] [--fountain out.fountain]
         [--title T] [--author A] [--debug]
```

Defaults: output next to input, `.fountain` written alongside for PDF input.
`--debug` dumps classified elements as JSON for tuning.

## Testing / validation

- Ported nightwatch parser unit tests (bun:test) + new tests for serializer
  and EPUB builder using synthetic element fixtures.
- Fixture PDFs: 3–4 structurally different real scripts copied from
  `nightwatch/uploads/scope/` into `fixtures/` (gitignored — user's own data,
  large binaries). Full-pipeline smoke tests assert sane scene/character
  counts and valid zip structure.
- `epubcheck` on outputs when available; Kindle Previewer / Send-to-Kindle is
  a manual user step.

## Risks

- Non-standard PDF templates (stage 1) — mitigated by the normalized-percent
  indent model and testing across multiple real scripts from uploads.
- `pdfjs-dist` under Bun headless — verified early; fallback is running the
  CLI under Node (no code change).
