# Formatting decisions log — future Mac app options registry

Every formatting behavior Screepub applies, logged as it was tuned
(2026-07-22, initial build + two feedback rounds on a real script). The print
geometry and Kindle CSS constraints behind these choices live in
`docs/screenplay-format-reference.md` — read that first when adjusting. Each entry is
written as a **toggle or slider in the Mac app** (the reader window's rail;
2026-07-22, moved out of Settings 2026-07-30): the engine's FormatOptions
(`src/options.ts`) is the single knob surface, reachable via
`--options file.json` on the CLI and mirrored by `FormatSettings` in the
app. Entries below marked "not built" remain future work; everything else
is live.

## Layout & flow

### 1. Continuous scene flow (no page break per scene)
- **What:** scenes are anchored `<section>`s packed into one body XHTML
  file; files split only past a size budget, at a scene boundary. Spine
  boundaries force page breaks in every reader — one-file-per-scene made
  every slugline start a fresh page (the first feedback-round complaint).
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
- **AZW3 route (2026-07-22):** Calibre's remove-fake-margins heuristic
  reads per-block side margins on most paragraphs — i.e. a screenplay's
  dialogue column — as publisher page margins and deletes them (any
  unit, % or em), collapsing dialogue to full width on device (user
  report: "left justified, full horizontal space"). An `--extra-css`
  em fallback was no fix: on multi-file EPUBs Calibre attaches extra
  CSS only to its generated inline ToC. Cure is
  `--disable-remove-fake-margins`, which lets the EPUB's own % geometry
  (and the `dialogueSideMarginPct` knob) flow through to AZW3
  unchanged. Guarded by the kit-check "AZW3 keeps dialogue-block side
  margins" check. Code: `app/Sources/ScreepubKit/EbookConvert.swift`.

### 2b. Cue & parenthetical alignment (option, default centered)
- **What:** print's fixed cue indent only *optically* centers names on
  paper; reflowed to arbitrary screen widths it drifts left (user report
  2026-07-22: "centered items drooping left"). Default is now
  `text-align: center` within the dialogue column; `cueAlignment:
  'indented'` restores the % offsets (sliders apply only in that mode).
- **Code:** `src/options.ts`, `src/epub/css.ts`; app picker in the reader
  rail's Dialogue group.

### 3. Vertical rhythm between elements
- **What:** a full blank line (`1em`) between action paragraphs, dialogue
  blocks, transitions, centered text; bumped from the original tighter
  0.8em (a later feedback-round complaint). Inside a dialogue block
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

### 6b. Body text alignment — ragged-right by default (option)
- **What:** action and dialogue paragraphs are emitted with an explicit
  `text-align`. Screenplays are traditionally ragged-right (left
  aligned); some e-readers justify body text by default, opening
  distracting stretchy word gaps (observed on device 2026-07-22 —
  action lines stretched full-width). Default `justifyText: false`
  emits `text-align: left`, which overrides the reader's justification;
  `justifyText: true` emits `text-align: justify` for readers who
  prefer it. Cue/parenthetical alignment is governed separately (#2b);
  this knob is body text only.
- **Default:** ragged-right (`justifyText: false`).
- **App option:** "Justify body text" toggle (the reader rail's Text
  group).
- **Code:** `src/options.ts` (`justifyText`), `src/epub/css.ts`
  (`bodyAlign` → `p.action`, `p.dialogue`).

## Cleanup & rejoining

### 7. Right-margin revision stars — dropped
- **What:** star-only text items at >80% page width are production markup
  (revised-draft line markers). Dropped at extraction; leaving them in
  created bogus action elements that **reset dialogue context and
  fragmented speeches** (found via feedback-round testing 11.10.25: a
  character's dialogue lines). Author-written `*emphasis*` at text
  indents is untouched.
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
- **Stage-1 only (2026-07-30):** this and #8 are the ONLY two knobs
  consumed in `fountain/serialize.ts` rather than in `epub/`. They are
  written INTO the `.fountain`, which is the app's cache boundary, so on
  **Fountain input they cannot apply** — the decision is already frozen
  into the cue text. Rendering a fountain that carries `@MARGO (CONT'D)`
  with `contdMode: strip` keeps the (CONT'D); the same PDF converted with
  `strip` does not. This used to exit 0 and silently change nothing;
  `convertFountain` now returns a warning for the provable case (strip
  requested, `(CONT'D)` cues present), which reaches `--json`, the CLI's
  human output, and the app. #8 gets no runtime warning because
  `serialize.ts` drops `(MORE)` unconditionally, so an unrejoined split is
  indistinguishable from an ordinary same-speaker continuation — a guessed
  warning would be worse than this note. The reader rail groups both under
  "From the PDF" and says they apply on the next conversion.
- **Code:** `src/fountain/serialize.ts` (`lastSpeaker` tracking);
  `src/convert.ts` (`stageOneWarnings`, `CONTD_CUE`).

### 8b. Cue keeps its first dialogue line (always on)
- **SUPERSEDED IN PART — device verdict (2026-07-29, same-day A/B on
  device):** the 2026-07-22 conclusion below was a fact about a FORMAT,
  recorded as a fact about the delivery route. Same script, same
  Screepub EPUB, sideloaded over USB in both formats to the same Kindle
  (fw 5.19.2): the **AZW3 strands cues** exactly as documented; the
  **KFX holds every keep — no stranded cues**. Renderer selection
  follows the FILE FORMAT, not how the file arrived. Sideloaded KFX
  gets Enhanced Typesetting; "sideload = legacy renderer" is true only
  of AZW3/MOBI. (The sideloaded .kfx also indexes — it appeared on the
  shelf after a few seconds.) KFX chain: EPUB → jhowell's KFX Output
  plugin ≥2.x in Calibre (drives Kindle Previewer ≥3.32, then repacks
  KPF→KFX). A raw Previewer .kpf is NOT device-readable — it is a zip
  around a SQLite .kdf; the plugin's repack is mandatory. Not verified
  on pre-KFX hardware (< Paperwhite 3, 2015); AZW3 remains the fallback
  there and wherever the plugin/Previewer toolchain is absent.
- **Historical verdict (2026-07-22, photo-confirmed, AZW3 only):** the
  legacy renderer used for USB-sideloaded AZW3/MOBI honors NO keep
  mechanism: page-break-*:avoid ignored; single-cell table wrappers
  split mid-cell; single-paragraph fusion still orphans the cue line
  (no widow/orphan control); display:inline-block overflows the text
  horizontally off-screen. Do not re-attempt IN AZW3. Books delivered
  via Send-to-Kindle (email/app/web) get Enhanced Typesetting, which
  honors the CSS keeps (and, 2026-07-29: arrive as KFX — observed on
  device in documents/Downloads/Items01/). Dual-dialogue side-by-side
  tables photo-confirmed readable on device in AZW3; not yet
  re-verified in sideloaded KFX.
- **What:** inside each dialogue block, cue + parentheticals + the first
  dialogue line share a `keep-together` wrapper (same KDP-documented
  container form as scene headings) so a cue never strands at a page
  bottom with its speech overleaf (user-requested 2026-07-22).
- **Code:** `src/epub/html.ts` (`closeSpeech`).

### 9. Page furniture stripping
- **What:** page numbers (bare/dashed/labeled), shooting-script scene
  numbers, revision slugs ("Blue Rev. (6/12/26)"), draft stamps, header
  dates; plus recurrence-based watermark suppression (text on ≥ max(3,
  40% of pages) distinct pages).
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
  attached (found in testing). Duplicated tokens collapse to one, which
  then classifies and attaches as the scene number.
- **Inline variant (2026-07-22, found in another test script):** some
  generators put the numbers on the heading row itself ("2 EXT. WOODS -
  DAY 2"), which defeated the ^INT/^EXT anchor — 0 scenes detected.
  Classifier now strips a same-token leading/trailing number pair and
  attaches it as `sceneNumber` when the inner text is a slugline.
- **Code:** `src/parser/extract.ts` (normal-line emit),
  `src/parser/classify.ts` (`DUAL_MARGIN_HEADING`).

### 9b. Hybrid character cues
- **What:** MARGO/DEV (shared), COP #2, MOM & DAD — the name pattern
  now allows / & # and digits; previously such cues fell to action and
  their speeches collapsed (a lyrics block found in testing).
- **Code:** `src/parser/classify.ts` (CHARACTER_NAME).

### 9c. Width-aware item joining
- **What:** gap detection now uses pdf.js's real item widths (falling
  back to the len×6 estimate) — fixes phantom spaces in split names
  ("Jo hn Sm ith") and sharpens dual-dialogue boundaries.
- **Code:** `src/parser/extract.ts` (`endX`).

### 9d. Inline bold/italic pass-through
- **What:** per-item font styles detected from PostScript names
  ("CourierPrime-Italic" etc.; getOperatorList forces font resolution —
  getTextContent alone doesn't load fonts). Styled runs travel as
  fountain emphasis (*i*, **b**, ***bi***) in a `styledText` variant
  carried beside plain text; classification always uses plain, and only
  dialogue/action emit styled (markers would break cue/parenthetical/
  slug recognition). Rendered as em/strong (EPUB) and i/b (MOBI).
  Punctuation-only styled items never wrap alone (no "*,*").
- **Limitation:** underline is drawn as vector graphics in PDFs, not
  font data — NOT detected. The renderers do support `_underline_`
  markers, so hand-edits to the .fountain render correctly.
- **Code:** `src/parser/extract.ts` (`stampFontStyles`, `joinLine`),
  `src/epub/html.ts` + `src/mobi/html.ts` (`inlineEmphasis`/`inline`).

### 9e. Cue extensions tolerate a missing closing period
- **What:** `(O.S)`, `(V.O)`, `(O.C)` — the period-less spellings writers
  routinely type — now count as dialogue extensions. Previously only the
  fully punctuated `(O.S.)` matched, so the bare form skipped the
  extension branch and then hit the "periods only in ellipsis" guard:
  the cue fell to action and its speech collapsed with it (same failure
  shape as 9b). A script can spell one speaker BOTH ways — THE LAST
  VIDEO STORE has "RADIO VOICE (O.S)" on p7 and "RADIO VOICE (O.S.)" on
  p8, which
  rendered as description and cue respectively. Once both are cues, 8a
  correctly adds `(CONT'D)` to the second.
- **Not changed:** `(CONT'D)`/`(CONT.)` keep requiring their existing
  spellings — no reported miss, and loosening them buys nothing.
- **2026-07-30 — dotted names pass the period guard.** "Periods only in
  ellipsis" rejected every bare dotted cue (`MR. SMITH`, `J.J.`,
  `ANNA B.`, `E.B. WHITE`) while the extension branch admitted
  `MR. SMITH (V.O.)` — recognition depended on incidental punctuation,
  the same asymmetry as 9e's own bug. The guard now accepts periods in
  abbreviation position only: mid-name a period may cap a 1-4 letter run
  (`MR.`, `CAPT.`, `E.B.`), and at the end of the name only
  single-letter initials qualify (`ANNA B.`, `J.J.`). A period closing a
  longer final word (`HE STOPS.`, `STOP.`) is still sentence punctuation
  and still vetoes — the terminal rule protects the dialogue/cue band
  overlap, where a shouted `STOP.` becoming a phantom speaker would
  swallow the next line as its speech. `CHARACTER_NAME` admits `.` in
  its body to match. Verified: character-element counts across all five
  generator fixtures are byte-identical (none contains a dotted cue),
  so the corpus is untouched; the new shapes are pinned by unit tests.
- **Code:** `src/parser/classify.ts` (`DIALOGUE_EXTENSIONS`).

### 9f. Cue rescue from the character roster
- **What:** classification is geometric, but the text guards in
  `isLikelyCharacterName` can overrule position — a dropped period (9e), a
  curly apostrophe, a lowercase cue. Each rejection costs TWO elements:
  with no active character the speech underneath falls to action too (9
  paragraphs lost in one 94-page script). A second pass now promotes an
  `action` element back to `character` when ALL hold: cue-band indent, the
  normalized text matches a name already established elsewhere in the same
  script, and a dialogue-indent speech follows. It cannot invent
  characters — the roster is corroboration — and it is guard-agnostic, so
  it catches variants nobody has reported yet.
- **Ordering:** runs after boilerplate suppression (so a watermark can't
  be rescued into permanent immunity) and before character extraction (so
  rescued speeches reach the dialogue counts). Title-page elements are
  never rescued.
- **Also:** `CHARACTER_NAME` now accepts curly apostrophes (`MARGO’S MOM`),
  matching how §8 already treats `(CONT'D)`.
- **Code:** `src/parser/rescue.ts`, `src/parser/index.ts`,
  `src/parser/classify.ts` (`normalizeCueName`, `CHARACTER_NAME`).

### 10a. Dual dialogue — de-interleaved to sequential speeches
- **What:** simultaneous two-column speeches (seen in two different test
  scripts, one with 23 lines of dual dialogue) previously interleaved
  into garbage because extraction joins by Y line. Now: a dual-cue line
  (two cue-shaped clusters) anchors a region; the column boundary starts
  at rightCueX−13% and refines only
  LEFTWARD to the right column's text edge (parentheticals sit deeper and
  must not drag it); body lines partition by start-x; regions end on a
  full-width (straddling) line, a cue-shaped left-only line, text left of
  the learned column edge, or a new dual-cue pair. Columns emit as left
  speech then right speech — the standard reflowable treatment.
- **Default:** de-interleaving always on (correctness); rendering mode
  `dualDialogue: 'sideBySide'` (default) | `'sequential'`. Side-by-side:
  the right cue serializes with Fountain's `^`, and the renderer emits a
  full-width two-cell `table.dual-dialogue` (50/50, top-aligned,
  page-break-inside avoid) — tables are the one column construct
  Kindle's renderer honors. Wider than the dialogue column by design.
  MOBI gets a plain width-50% table.
- **App option:** the reader rail's Dialogue group → "Dual dialogue". Known
  limitation: a short action line immediately after a dual block with no
  intervening cue can absorb into the left speech.
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

### 13a. Original page-number markers (option, default off)
- **What:** `showPageMarkers` emits the PDF's printed pagination as small
  right-flush gray markers ("47.") at page boundaries — page count is how
  scripts are evaluated (1 page ≈ 1 minute), and reflow otherwise erases
  it. Numbering anchors to the stripped printed page-number furniture
  (mode of printed−sheet offsets, so the title page never counts and
  margin scene numbers can't pollute). Markers travel as fountain
  synopsis lines (`= pg N` — invisible to other fountain tools) and land
  only at block boundaries: a page turning mid-speech defers its marker
  to the next block. PDF input only (fountain has no pages).
- **Rendering:** the marker rides inside the next block as a floated
  `<span>`, so it costs no line (it used to be its own `<p>` with a 1em
  top margin). In EPUB the same span is the EPUB3 pagination anchor
  (`epub:type="pagebreak"` + `title`), and a hidden `page-list` nav gives
  capable readers real page numbers and page-jump. MOBI gets the floated
  span only. If a legacy renderer ignores `float`, the number degrades to
  inline text at the head of the paragraph.
- **Code:** `src/fountain/serialize.ts` (`printedPageOffset`),
  `src/epub/html.ts` + `src/mobi/html.ts` (synopsis case),
  `src/epub/css.ts` (`span.page-marker`), `src/epub/build.ts` (page-list).

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
  across the five-generator fixture set + additional real-world scripts).
- **Device routes (2026-07-22, KFX rung added 2026-07-29, not formatting
  knobs but adjacent):**
  Kindle → KFX to documents/ when the full toolchain is present (Calibre
  + KFX plugin + Kindle Previewer, §8b), AZW3 with Calibre alone, MOBI
  with neither — one ladder shared by the result page, the reader rail,
  and the save flow; Kobo → EPUB to volume root, or
  KEPUB via Calibre when the "as KEPUB" checkbox on the result page's
  send block is on — shown only while Kobo is the chosen destination
  (default OFF — Kobo's kepub renderer mis-justifies em-dashes/
  ellipses, endemic in dialogue; kit-check verifies koboSpan markup);
  tolino → EPUB into root `Books/`; reMarkable → original PDF over the
  USB web interface (its EPUB renderer re-typesets, so reflow adds
  nothing on a 7.8–11.8" screen). Detection: `.kobo` dir, tolino
  volume name, Kindle documents/, reMarkable HTTP probe.
- **Script preview reader (2026-07-22):** READ SCRIPT on the result page
  opens a window rendering the engine's real preview HTML
  (`--preview-html`; the same markup as the EPUB with the CSS inlined).
  The rail edits a per-script sidecar (`<Stem>.screepub.json`,
  ScriptSettings.swift, lenient per-field decode) with debounced,
  serialized re-renders from the cached .fountain; "Save as app
  defaults" promotes sidecar values to the global keys
  (AppSettings.setFormatSettings). Every re-render rewrites the
  library EPUB AND MOBI (atomic temp+rename, engine-side) so sends
  match the preview; main-window conversions also load the sidecar, so
  re-dropping a tuned script keeps its tuning (note: a NEW script whose
  filename stem matches an old one inherits that sidecar — treated as
  same-script-new-draft).
- **One formatting surface (2026-07-30):** the Settings → Formatting tab
  is gone. It carried all 15 knobs beside a hand-drawn schematic
  (`LayoutPreview`, deleted with it) while the reader rail carried only 11
  beside the real engine output — so the window that could show you a
  change was the one that could not make four of them
  (`keepSceneHeadingWithScene`, `includeTitlePage`, `rejoinSplitDialogue`,
  `contdMode`). The rail now owns all 15, grouped Page / Dialogue / Text /
  Content. Settings keeps General (library, updates) and Devices (default
  preset, KFX toolchain, tolino/reMarkable notes). **Adding a knob means
  adding one control to `ReaderRail.swift`** — there is deliberately no
  second surface to keep in sync. Settings sets the coarse default via a
  preset; per-script tuning belongs beside a live render.
- **Device presets (2026-07-22):** `DevicePreset` (ScreepubKit) bundles
  a full FormatSettings per device class — "Kindle e-ink (6\")" is the
  baseline (== defaults); "Phone / narrow screen" flips dual dialogue to
  sequential (side-by-side halves are an unreadable sliver on a narrow
  screen) and widens the dialogue column (10% side margins). Applying a
  preset replaces the whole FormatSettings — globally via Settings →
  Devices "Load device preset", or per-script via the reader rail's own
  "Load device preset" (then persisted to the sidecar). Responsive
  reflow is impossible in a fixed e-book, so a conversion-time preset is
  the mechanism. Adding a preset: extend the `DevicePreset` enum only —
  the two menus and kit-check iterate `allCases`.
