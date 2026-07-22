# Formatting decisions log — future Mac app options registry

Every formatting behavior Screepub applies, logged as it was tuned
(2026-07-22, initial build + two Meteor Anne feedback rounds). The print
geometry and Kindle CSS constraints behind these choices live in
`docs/screenplay-format-reference.md` — read that first when adjusting. Each entry is
written as a **toggle or slider in the Mac app** (Settings → Formatting;
2026-07-22): the engine's FormatOptions (`src/options.ts`) is the single
knob surface, reachable via `--options file.json` on the CLI and mirrored
by `FormatSettings` in the app. Entries below marked "not built" remain
future work; everything else is live.

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

### 2b. Cue & parenthetical alignment (option, default centered)
- **What:** print's fixed cue indent only *optically* centers names on
  paper; reflowed to arbitrary screen widths it drifts left (user report
  2026-07-22: "centered items drooping left"). Default is now
  `text-align: center` within the dialogue column; `cueAlignment:
  'indented'` restores the % offsets (sliders apply only in that mode).
- **Code:** `src/options.ts`, `src/epub/css.ts`; app picker in
  Settings → Formatting.

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

### 5a. Scene heading keeps its context (keep-together wrapper)
- **What:** each slugline + the scene's first block share a
  `<div class="keep-together">` with `page-break-inside: avoid` — the
  KDP-documented container form ("headlines with paragraphs to keep
  together"), more reliably honored than `break-after: avoid` on the
  heading itself. A heading that would strand at a page bottom moves to
  the next page with its first paragraph; the gap left behind is the
  intended tradeoff (user-requested 2026-07-22).
- **Default:** on, heading + first block only (never more — bigger
  unbreakable chunks mean bigger gaps).
- **App option:** "Keep scene headings with their scene" toggle; advanced:
  blocks-to-keep count (1–2).
- **Code:** `src/epub/html.ts` (`renderScene`), `src/epub/css.ts`
  (`.keep-together`).

### 5. Keep-with-next — minimal chain (v2)
- **What:** `break-after: avoid` on scene headings and character cues
  ONLY. v1 also chained parentheticals; every avoid link grows the
  unbreakable chunk a renderer pushes to the next page, and pushed
  chunks show up as occasional blank-bottom "weird page breaks."
- **Default:** heading + cue avoid; parenthetical breaks freely.
- **App options:** none — cue avoid stays always-on; the heading behavior
  is governed by 5a's keep-together wrapper.
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

### 8a. (CONT'D) normalization (option, default auto)
- **What:** page-break (MORE)/(CONT'D) pairs are meaningless in reflow
  (rejoined by #8); mid-scene (CONT'D) marks a speaker continuing
  through action — standard but taste-dependent. `contdMode`: **auto**
  (default) strips source cues' (CONT'D) and re-adds it exactly where
  the rule applies (same speaker continues, reset at scene/transition);
  **strip** removes all; **keep** preserves the source.
- **Code:** `src/fountain/serialize.ts` (`lastSpeaker` tracking).

### 8b. Cue keeps its first dialogue line (always on)
- **What:** inside each dialogue block, cue + parentheticals + the first
  dialogue line share a `keep-together` wrapper (same KDP-documented
  container form as scene headings) so a cue never strands at a page
  bottom with its speech overleaf (user-requested 2026-07-22).
- **Code:** `src/epub/html.ts` (`closeSpeech`).

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

### 9a. Dual-margin scene numbers collapsed
- **What:** shooting scripts print the scene number in BOTH margins of
  the slugline row; joined they leaked as "2  2" action lines and never
  attached (IntimacyParty). Duplicated tokens collapse to one, which
  then classifies and attaches as the scene number.
- **Code:** `src/parser/extract.ts` (normal-line emit).

### 9b. Hybrid character cues
- **What:** CLEO/PANNI (shared), COP #2, MOM & DAD — the name pattern
  now allows / & # and digits; previously such cues fell to action and
  their speeches collapsed (IntimacyParty lyrics block).
- **Code:** `src/parser/classify.ts` (CHARACTER_NAME).

### 9c. Width-aware item joining
- **What:** gap detection now uses pdf.js's real item widths (falling
  back to the len×6 estimate) — fixes phantom spaces in split names
  ("Courtney Ho ffman") and sharpens dual-dialogue boundaries.
- **Code:** `src/parser/extract.ts` (`endX`).

### 10a. Dual dialogue — de-interleaved to sequential speeches
- **What:** simultaneous two-column speeches (Meteor Anne p48, Highland
  ×23 lines) previously interleaved into garbage because extraction joins
  by Y line. Now: a dual-cue line (two cue-shaped clusters) anchors a
  region; the column boundary starts at rightCueX−13% and refines only
  LEFTWARD to the right column's text edge (parentheticals sit deeper and
  must not drag it); body lines partition by start-x; regions end on a
  full-width (straddling) line, a cue-shaped left-only line, text left of
  the learned column edge, or a new dual-cue pair. Columns emit as left
  speech then right speech — the standard reflowable treatment.
- **Default:** on (correctness fix, not optional).
- **App option (future):** "Dual dialogue: sequential / side-by-side" —
  side-by-side needs Fountain `^` marking plus a two-cell table or
  inline-block rendering; KF8 tables make this feasible on Kindle but
  it's unbuilt. Known limitation: a short action line immediately after a
  dual block with no intervening cue can absorb into the left speech.
- **Code:** `src/parser/extract.ts` (`deinterleaveDualDialogue`).

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
