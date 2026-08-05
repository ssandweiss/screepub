# Rich formatting: underline + font family/size — design

Date: 2026-07-30
Status: approved (phases and approaches settled in brainstorming)

## Goal

Teach the pipeline to preserve richer formatting from screenplay PDFs:

- **Phase 1**: underline detection, completing the bold/italic/underline trio
  (bold/italic already work, registry §9d).
- **Phase 2**: block-level font family and size shifts (text-message inserts,
  chyrons, letters, on-screen text), carried through the `.fountain` artifact
  and rendered in EPUB/MOBI.

## Settled decisions

| Decision | Choice |
| --- | --- |
| Scope | Full fidelity, phased: underline first, family/size second |
| Family/size granularity | Block-level only; no inline runs |
| Fountain representation | `[[fmt: ...]]` notes convention (spec-legal, other tools ignore) |
| Rendering knob | One knob `preserveFontShifts`, default **true**, gates rendering only |
| Underline detection | Operator-list geometry scan (no new dependencies) |
| Note vocabulary | Mapped + coarse: family `mono|serif|sans|cursive`, size `-1|+1|+2` |

## Current state (what exists)

- `stampFontStyles` (src/parser/extract.ts) marks pdf.js text items
  bold/italic from PostScript font names; `joinLine` folds styled runs into a
  `styledText` variant with Fountain emphasis. Classification always uses
  plain text; only dialogue/action emit styled. EPUB renders em/strong, MOBI
  renders i/b (registry §9d).
- Underline is a documented §9d limitation: drawn as vector graphics, never
  detected. Both renderers already handle `_..._` (EPUB `span.underline`,
  MOBI `<u>`), so the gap is purely detection. The MOBI replacement has no
  pinning test.
  **Provenance corrected 2026-08-04:** this spec previously said the MOBI
  replacement landed in the v0.4.2 merge train. It did not. `git log -S'<u>'
  -- src/mobi/` returns only the squashed root commit, so it has been there
  since the repo went public. The conclusion is unaffected (the code exists
  either way, so phase 1 still touches no renderer production code), but the
  date was wrong and is worth not repeating.
- Font family and size are discarded after the bold/italic check. Fountain has
  no syntax for either.

## Verified facts (probed 2026-07-30, de-risking the design)

1. **fountain-js (^1.2.4) preserves `[[...]]` notes verbatim** in token text.
   A note line glued directly above a block (no blank line between) merges
   into that block's token; an inline note leading a dialogue line survives in
   the dialogue token. The notes channel is therefore lossless through the
   tokenizer. Corollary: today any hand-written note renders as literal text
   in the output, which violates the spec's notes-are-invisible rule; phase 2
   fixes this generally.
2. **pdf.js (6.1.200) folds painting into `constructPath`**: args are
   `[paintOp, packedPathData, minMax Float32Array]`. The minMax bounding box
   alone distinguishes an underline (flat, short) from a box (tall) or a
   full-width rule. Verified against real generator output: Final Draft draws
   33 paths in 8 pages with save/restore/transform state; Highland draws a
   few; Celtx draws none (so zero false-positive exposure there).
3. **tools/make-fixture.py writes raw PDF content streams**, so fixtures can
   draw underline rects (`re f`) and add a second font resource (`/F2` + `Tf`)
   with a few lines of Python. No new tooling.

## Phase 1: underline

### Detection (src/parser/extract.ts)

- New `collectUnderlineMarks(opList, viewport)`: single walk over
  `fnArray`/`argsArray`, maintaining the CTM through `save`/`restore`/
  `transform`. For each `constructPath`: read paint op (args[0]) and minMax
  bbox (args[2]); transform bbox by the CTM. Keep marks that are:
  - flat: height ≤ 2.5pt,
  - real: width ≥ 4pt,
  - not furniture: width < 85% of page width (kills header/footer rules).
  Output `{x0, x1, y}`. Rotated CTMs are skipped. The pass is wrapped in
  try/catch: any failure yields no underlines (same best-effort philosophy as
  `stampFontStyles`).
- Matching: a text item is underlined when some mark satisfies both:
  - y within [baseline − 3.5pt, baseline + 0.5pt] (excludes strikethrough,
    which sits mid x-height above the baseline, and the next line's marks),
  - horizontal overlap ≥ 60% of the item's x-range.
- If a real script ever shows batched multi-subpath underlines (one path,
  several rules), the refinement is decoding `packedPathData` into per-subpath
  bboxes. Not built until needed.

### Style plumbing

- `TextItem` gains `underline?: boolean`.
- `joinLine` style key gains `u` (keys are subsets of {b, i, u}); the
  punctuation-only guard is unchanged (no lone `_,_`).
- `EMPHASIS_MARK` becomes open/close pairs (mixed marks are not palindromes).
  Canonical nesting: underscore innermost, stars outside:
  `_x_`, `*_x_*`, `**_x_**`, `***_x_***`. Both renderers' existing regex
  order (stars first, underscore last) composes these correctly (verified).
- No `serialize.ts` change: underscores ride `styledText` into dialogue and
  action exactly like bold/italic. Cues/slugs/parens: detected but never
  emitted (invariant unchanged). Classification never sees markers.

### Rendering

- EPUB: no change (underscore replacement + `span.underline` CSS exist).
- MOBI: no change (the `_..._` → `<u>` replacement has existed since the root
  commit, not since v0.4.2 as this spec first claimed); phase 1 only adds the
  missing pinning test.

### Testing (TDD, failing tests first)

- Unit: mark-to-item matcher (pure geometry); `joinLine` with `u` runs and
  combos; a pinning test for MOBI `inline()`'s existing underscore case.
- Fixture: make-fixture.py draws rects under one dialogue phrase and one
  action phrase, plus three decoys (full-width rule, mid-height strike, and
  a table-style border row just below the text band, the Beat-furniture
  shape); integration test asserts the emitted Fountain contains the
  underscores and not the decoys. Regenerate the committed fixture.
- Sweep: full fixture suite + epubcheck + real-PDF spot checks (final-draft
  exercises path-heavy pages; celtx exercises the zero-path case; a
  Beat-generated PDF, if the local set has one, exercises table-cell
  furniture borders, the likeliest real-world underline false positive).

### Files touched

`src/parser/extract.ts`, `tools/make-fixture.py` + regenerated
`tests/fixtures/`, tests, `docs/formatting-options-log.md` (§9d amended:
limitation replaced by the detection mechanism). No renderer production
changes at all in phase 1.

## Phase 2: font family/size

### Detection (src/parser/extract.ts)

- Dominant (family bucket, size) computed over the document, weighted by
  character count. Size from the text transform's vertical scale
  (`transform[3]` for unrotated text, which screenplays are); family bucket from the
  resolved PostScript base name (subset prefix `ABCDEF+` stripped):
  - courier/mono/lettergothic/prestige → `mono` (Letter Gothic and
    Prestige Elite are real screenplay monospace faces; match the joined
    name, NOT bare "gothic", which would swallow Century Gothic, a sans)
  - times/georgia/garamond/roman → `serif`
  - script/hand/brush/comic → `cursive`
  - everything else → `sans`
  Bold/italic name tokens are style, not family, and are ignored here.
- A line gets `fmt` only when ≥ 80% of its character weight agrees on the
  same deviation:
  - family bucket ≠ dominant bucket, and/or
  - size step vs dominant: ratio ≤ 0.85 → `-1`; 1.15–1.4 → `+1`; > 1.4 →
    `+2`; each additionally requires ≥ 1.5pt absolute delta (float jitter
    can never fire).
- A uniform Courier-12 screenplay produces zero fmt anywhere, by construction.

### Blocks and elements

- `RawLine.fmt` and `TextBlock.fmt`; `buildBlock` sets block fmt only when
  every line agrees (block-level-only). An fmt change is also a block break in
  `shouldBreak`, so a deviant block glued to plain action still isolates.
- `classify.ts` carries fmt from block to element mechanically. fmt is never a
  classification input; the parser stays format-option-free.
- Because detection and serialization are unconditional, an fmt-bearing PDF
  produces different `.fountain` output than today regardless of the knob
  (new notes, block isolation at fmt boundaries). That is the design, not a
  regression; uniform single-font screenplays stay byte-identical by
  construction.
- Title-page elements never reach body serialization, so the oversized title
  emits nothing. Page numbers and suppressed boilerplate are likewise outside
  the body path.

### Serialization (src/fountain/serialize.ts)

- Scope: action and dialogue elements only (mirrors `styledText` scope).
- Placement (both forms verified against fountain-js):
  - action: note on its own line glued directly above the block's first line,
    no blank line between;
  - dialogue: note inline, leading the first dialogue line of the element,
    space-separated.
- Grammar: `[[fmt: <family>]]`, `[[fmt: <size>]]`, `[[fmt: <family> <size>]]`
  with family ∈ `mono|serif|sans|cursive`, size ∈ `-1|+1|+2`.
- Notes are ALWAYS serialized regardless of the knob: the `.fountain` is
  stable under settings flips, so the app cache re-renders without
  re-parsing the PDF.

### Rendering (src/epub/html.ts, src/epub/css.ts, src/mobi/html.ts)

- Both renderers strip ALL `[[...]]` notes from rendered text (spec-correct
  invisibility; fixes the pre-existing wart). Stripping happens on raw token
  text before escaping.
- With `preserveFontShifts` on, a leading valid fmt note adds classes to that
  block's paragraphs (for a dialogue token, every `<p class="dialogue">` it
  emits): `fmt-mono|fmt-serif|fmt-sans|fmt-cursive` and
  `fmt-minus1|fmt-plus1|fmt-plus2`.
- CSS: family classes are font-family stacks; sizes are `0.85em`, `1.2em`,
  `1.5em`. Vertical-in-em invariant holds; no line-height, no max-width.
  A block family class locally overrides the body `fontFamily` option.
- MOBI: size steps render as `<font size="-1|+1|+2">`; family is dropped
  (MOBI 6 face support unreliable; documented in the registry).
- Malformed `[[fmt: ...]]` content: stripped, no classes, never crashes.
- The app preview inherits via `tokensToPreviewHtml` automatically.

### Options plumbing

- `options.ts`: `preserveFontShifts: boolean`, default `true`, plus
  `resolveFormatOptions` entry.
- Three-way default pin updated together: `format-defaults.json`,
  `options.test.ts`, app `kit-check`.
- App: `FormatSettings` field + Settings toggle row.
- Registry: new section documenting vocabulary, thresholds, the
  always-serialize/knob-gates-render split, and the general note-stripping
  correction.

### Testing (TDD)

- Fixture: variant with a second font resource (Helvetica) for a chyron
  action block plus an oversized insert line; asserts the exact
  `[[fmt: ...]]` notes in the emitted Fountain.
- Unit: name→bucket mapping, step thresholds, line/block agreement, note
  placement (glued/inline forms), renderer knob on/off, note invisibility in
  both renderers, MOBI size wrap.
- Pins re-pinned; fixture sweep + epubcheck; real-PDF sweep by generator.

### Files touched

`src/parser/extract.ts`, `src/parser/types.ts`, `src/parser/group.ts`,
`src/parser/classify.ts` (mechanical carry), `src/fountain/serialize.ts`,
`src/epub/html.ts`, `src/epub/css.ts`, `src/mobi/html.ts`, `src/options.ts`,
`format-defaults.json`, app `FormatSettings` + Settings UI + kit-check,
tests, fixtures, registry.

## Invariants preserved

- Classification always uses PLAIN text; styled variants and fmt annotations
  ride beside it and never feed classification.
- Only dialogue/action emit styled text or fmt notes. Markers never appear in
  cues, parens, or slugs.
- EPUB CSS: horizontal in %, vertical in em, no max-width, no body
  line-height. New size classes use em; no line-height anywhere.
- Parser stays format-option-free: detection and serialization are
  unconditional; the knob gates rendering only.
- pdf.js rules unchanged (transfer, modern build, getOperatorList before font
  reads, static worker import).
- Real fixtures stay out of committed tests/docs; new fixtures are invented
  and generated by make-fixture.py.

## Out of scope (explicit non-goals)

- Inline (mid-line) family/size runs.
- Emitting underline on cues/slugs/parens, and slug/cue house-style options
  (e.g. "underline all sluglines" as a CSS knob) — separate feature if ever.
- MOBI font-family rendering.
- Canvas/pixel-based detection (node-canvas dependency rejected).
- Text-layer underscore-glyph "underlines" (old Celtx style): pre-existing
  behavior, untouched.
- Embedding actual fonts from the PDF into the EPUB.

## Sequencing

1. Phase 1 lands first (no conflict-zone files, no renderer changes).
2. Phase 2 was gated on `page-span-rules` and the mini-slug stack merging;
   that precondition was met when the v0.4.2 merge train landed both
   (2026-07-30), so phase 2 is unblocked and simply follows phase 1.
3. This spec is sequenced with the keep-break batch
   (2026-07-30-keep-break-improvements-design.md) by one umbrella
   implementation plan: the batch lands first and builds the shared MOBI
   options plumbing plus the knob-ritual worked example that phase 2 here
   reuses, and one combined device pass settles every pending registry
   verdict in a single sideload session.
