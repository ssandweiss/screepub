# Formatting decisions log — future Mac app options registry

Every formatting behavior Screepub applies, logged as it was tuned
(2026-07-22, initial build + two Meteor Anne feedback rounds). The print
geometry and Kindle CSS constraints behind these choices live in
`docs/screenplay-format-reference.md` — read that first when adjusting. Each entry is
written to become a **toggle or slider in the planned Mac app**: what it
does, why the default is what it is, the knob it implies, and where it
lives in code. CLI flags exist only where noted — everything else is
currently hardcoded and needs surfacing when the app happens.

## Layout & flow

### 1. Continuous scene flow (no page break per scene)
- **What:** scenes are anchored `<section>`s packed into one body XHTML
  file; files split only past a size budget, at a scene boundary. Spine
  boundaries force page breaks in every reader — one-file-per-scene made
  every slugline start a fresh page (the first Meteor Anne complaint).
- **Default:** continuous, 250 KB/file budget.
- **App option:** toggle "Start each scene on a new page" (off) +
  advanced: file-size budget.
- **Code:** `src/epub/html.ts` (`tokensToBody`, `DEFAULT_MAX_FILE_BYTES`).

### 2. Centered dialogue column — % geometry (v2)
- **What:** dialogue is a narrow column with **percentage side margins**
  (20%/20% → ~60% column, print is 58%); cue indents **+33%** of the
  column and parenthetical **+17%** (print +1.2"/+0.6" of the 3.5" col).
- **History:** v1 used em left-indents (hugged left — wrong); v1.5 used
  `margin: auto` + `max-width: 21em` — looked right in browsers but
  **Kindle strips `max-width`**, so dialogue ran full width on device
  (the "runs the full width" bug). Amazon's own guidance: horizontal
  margins in `%`, vertical in `em`. Never reintroduce max-width.
- **Default:** 20% side margins; cue +33%; paren +17%/8%.
- **App options:** column width (as side-margin %), cue indent %, paren
  indent %; per-device presets (phone may want a shallower cue indent —
  see reference doc §4).
- **Code:** `src/epub/css.ts` (`.dialogue-block`, `p.character`,
  `p.parenthetical`).

### 3. Vertical rhythm between elements
- **What:** a full blank line (`1em`) between action paragraphs, dialogue
  blocks, transitions, centered text; bumped from the original tighter
  0.8em (third Meteor Anne complaint). Inside a dialogue block
  (cue → paren → lines) spacing stays at 0 — that tightness is correct.
- **Default:** 1em between elements; scene heading 1.6em above / 0.8em
  below; mini-slug 1.4em above / 1em below.
- **App option:** "Element spacing" slider (compact 0.6 → airy 1.4em);
  possibly independent scene-heading spacing.
- **Code:** `src/epub/css.ts`.

### 4. Relative-unit scaling (principle, not an option)
- **What:** no fixed units anywhere — **horizontal structure in `%`**
  (scales with screen width; Kindle's prescription) and **vertical rhythm
  in `em`** (scales with font size). This split is the core fix over
  consumer converters — never expose an option that reintroduces
  pt/px/inches.

### 5. Keep-with-next — minimal chain (v2)
- **What:** `break-after: avoid` on scene headings and character cues
  ONLY. v1 also chained parentheticals; every avoid link grows the
  unbreakable chunk a renderer pushes to the next page, and pushed
  chunks show up as occasional blank-bottom "weird page breaks."
- **Default:** heading + cue avoid; parenthetical breaks freely.
- **App options:** "Keep scene heading with scene" toggle (dropping it
  is the next lever if gaps persist on e-ink); cue avoid stays always-on.
- **Code:** `src/epub/css.ts`.

### 6. Typeface & line height (v2)
- **What:** `"Courier Prime", "Courier New", Courier, monospace`. The v1
  `line-height: 1.45` override is REMOVED — Enhanced Typesetting expects
  default line height on body text and the reader's own line-spacing
  setting owns within-paragraph spacing.
- **App options:** font menu only. Do NOT offer a line-height slider for
  Kindle targets — it would silently not work; between-element spacing
  (option 3) is the honest spacing knob we control.
- **Code:** `src/epub/css.ts` (`body`).

## Cleanup & rejoining

### 7. Right-margin revision stars — dropped
- **What:** star-only text items at >80% page width are production markup
  (revised-draft line markers). Dropped at extraction; leaving them in
  created bogus action elements that **reset dialogue context and
  fragmented speeches** (found via Meteor Anne 11.10.25: PAMELA's lines).
  Author-written `*emphasis*` at text indents is untouched.
- **Default:** drop.
- **App option:** "Revision marks: hide / show right-aligned gutter ✱" —
  showing them needs a serializer+CSS path (float-right span), not built.
- **Code:** `src/parser/extract.ts` (`revisionMarginX`).

### 8. (MORE) / (CONT'D) page-break rejoin
- **What:** `(MORE)` markers dropped by text match regardless of how the
  indent classified them; a `(CONT'D)` cue (straight or curly apostrophe)
  directly following the same character's dialogue merges into one
  speech. Mid-scene `(CONT'D)` after intervening action keeps its cue
  (authentic convention).
- **Default:** rejoin on.
- **App options:** toggle "Rejoin dialogue split by page breaks";
  possible extra: "strip all (CONT'D) extensions" (not built).
- **Code:** `src/fountain/serialize.ts` (`prepare`, `MORE_PAREN`, `CONTD`).

### 9. Page furniture stripping
- **What:** page numbers (bare/dashed/labeled), shooting-script scene
  numbers, revision slugs ("Blue Rev. (6/12/26)"), draft stamps, header
  dates; plus recurrence-based watermark suppression (text on ≥ max(3,
  40% of pages) distinct pages). Ported from nightwatch.
- **Default:** all stripping on; recurrence threshold 40%/3 pages.
- **App options:** master toggle unlikely to be wanted; expose the
  watermark recurrence threshold as advanced only.
- **Code:** `src/parser/classify.ts`, `src/parser/boilerplate.ts`.

### 10. Final Draft double-print dedup
- **What:** FD double-prints (MORE)/(CONT'D) furniture at identical
  coordinates with a zero-width item between copies → text doubled
  ("RYAN (CONT'D)RYAN (CONT'D)") and merges failed. Exact-overlap
  duplicates deduped at extraction.
- **Default:** always on; not an option (pure artifact fix). Log only.
- **Code:** `src/parser/extract.ts` (dup check in item join).

## Metadata & navigation

### 11. Generated title page
- **What:** standalone title page from the detected title block
  (title-cased if ALL-CAPS) + "Written by" credit. Contact info, WGA
  numbers, copyright, draft stamps on the PDF's title page are excluded.
  `--title` / `--author` CLI overrides exist.
- **App options:** include/exclude title page; editable title/author
  fields (already CLI-exposed).
- **Code:** `src/fountain/serialize.ts` (`extractTitleMeta`),
  `src/epub/build.ts` (`titlePageXhtml`).

### 12. Scene-level TOC
- **What:** every slugline becomes a TOC entry (nav.xhtml) linking to its
  anchor; landmarks for title page / begin-reading.
- **Default:** on, labeled "Scenes".
- **App options:** TOC on/off; possible "TOC every N scenes" for
   150-scene scripts where the drawer gets long.
- **Code:** `src/epub/html.ts` (toc), `src/epub/build.ts` (`navXhtml`).

### 13. Shooting-script scene numbers — kept in Fountain, hidden in EPUB
- **What:** scene numbers ("1A.", "2.2.") attach to headings and
  serialize as Fountain `#1A.#`, but the EPUB heading renders without
  them (fountain-js splits them off; the HTML layer doesn't re-add).
- **Default:** hidden in EPUB.
- **App option:** "Show scene numbers in headings" — small change in
  `src/epub/html.ts` (`scene_heading` case, `t.scene_number`).

## Guards (behavior, not formatting — app should surface as dialogs)

### 14. Scanned-PDF bail-out
- <3 text lines/page average → error "run OCR first", no silent garbage.
  `src/convert.ts` (`MIN_LINES_PER_PAGE`).

### 15. Not-a-screenplay guard
- 0 scenes **and** 0 dialogue → error unless `--force` (caught a pitch
  deck in testing). 0 scenes with dialogue → warning only.
  `src/convert.ts`.

## Mac app notes

- All knobs above funnel into two seams: **CSS generation**
  (`src/epub/css.ts` — make it a function of an options object) and
  **serializer/packing flags** (`tokensToBody` opts, `prepare` in the
  serializer). The parser layer should stay option-free.
- The `.fountain` intermediate is the natural preview/re-render boundary:
  app can cache stage 1 and re-run stages 2–3 live as options change.
- Validation habit worth keeping in the app: `epubcheck` after every
  render config change (all tweaks above shipped at 0 errors/0 warnings
  across the five-generator fixture set + Meteor Anne).
