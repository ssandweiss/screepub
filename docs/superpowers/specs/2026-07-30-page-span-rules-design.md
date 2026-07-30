# Page-span rules: atomic speeches, flowing everything else

Date: 2026-07-30
Status: approved in discussion (visualized and talked through); pending
spec review
Branch: worktree-device-map (implementation on its own branch from main)
Grounding: docs/pagination-reference.md (industry rules + tool
measurements), device map §2 (which renderers honor keeps).

## Problem

Pages on keep-honoring renderers (KFX via sideload AND via Send-to-Kindle
server conversion; Apple Books) frequently render only half to two-thirds
full. Cause: unbreakable chunks larger than the space left on the page get
pushed whole. The two oversized chunks today are (a) the
`keepSceneHeadingWithScene` wrapper, which holds the heading plus the
ENTIRE first block of the scene (a whole speech or action paragraph), and
(b) dual-dialogue tables, unbreakable at any height. Meanwhile dialogue
itself is UNDER-protected: only cue + first line are held, so a speech can
split mid-speech with no marker — dialogue continuing at a page top with
its cue stranded on the previous page.

## Governing rule (the user's line in the sand)

**A speech is atomic.** Dialogue must never appear at the top of a page
while its character cue sits on the previous page, and a speech should not
split bare mid-flow. Reflow cannot inject `(MORE)`/`(CONT'D)` at the seam
(the break position is decided per-reader at render time; EPUB offers no
hook; Kindle strips scripting; fixed layout would forfeit reflow), so the
only honest mechanism is keeping the whole speech together and accepting
occasional white space. Exception, physics-imposed: a speech taller than a
full page must break somewhere — CSS `avoid` yields when impossible — and
then it breaks bare. Rare; accepted.

## Changes

1. **Dialogue blocks become atomic.** `.dialogue-block` gains
   `page-break-inside: avoid; break-inside: avoid`. The existing inner
   keep (cue + parentheticals + first line, epub/html.ts closeSpeech)
   REMAINS as a degradation layer for renderers that ignore block-level
   avoid but honor the smaller chunk. Same for dual-dialogue tables:
   already unbreakable, consistent with the rule.
2. **Scene-heading keep shrinks to the CSS chain.** Remove the
   heading-plus-first-block `div.keep-together` wrapper in renderScene
   (epub/html.ts:210-223). `keepSceneHeadingWithScene` (name and default
   unchanged: true) now gates the `page-break-after: avoid; break-after:
   avoid` rule on `h2.scene-heading` (currently unconditional,
   css.ts:56-57). Net effect: a dialogue-opening scene chains heading →
   atomic speech (similar chunk to today, per the governing rule); an
   action-opening scene holds heading + roughly one line and the action
   FLOWS — this is where the reclaimed page-fill comes from.
3. **Action flows freely.** No keeps on action paragraphs (unchanged),
   and no more wrapper capturing the scene's first action paragraph
   (change 2). Widows/orphans control does not exist under Enhanced
   Typesetting (ignores `widows`/`orphans`/`page-break-inside` on
   paragraphs — pagination-reference §"Kindle"), so line-granularity
   breaks in action are accepted, as in any book.
4. **Transitions never begin a page.** `p.transition` gains
   `page-break-before: avoid; break-before: avoid` — the one universal
   industry rule we currently skip. Unconditional (no option).
5. **Tall dual-dialogue exchanges fall back to sequential.** When
   `dualDialogue: "sideBySide"`, an exchange whose longer column exceeds
   a build-time line-count estimate (constant threshold; start at 12
   estimated rendered lines, tuned during verification) is emitted as
   sequential FOR THAT EXCHANGE ONLY. Rationale: a table probably cannot
   split on Kindle regardless of CSS, and sequential preserves the
   atomic-speech rule per speech while letting the page break between
   speeches. No new option; the threshold is a constant like the 250 KB
   file budget.

## Non-changes

- No new FormatOptions; `format-defaults.json` untouched (all three
  pinned suites unaffected on defaults).
- Parser and serializer untouched.
- MOBI path untouched (no stylesheet in the dialect; documented in the
  registry as a structural limitation).
- The AZW3 path keeps the existing ebook-convert guards; no new flags.

## Verification plan

1. bun test + fixture sweep + epubcheck (stage-1/CSS change protocol).
2. Purpose-built fixture: long opening monologue, action-opening scene,
   tall dual exchange, transition at a chunk boundary.
3. KFX via the in-repo toolchain, eyeballed in Kindle Previewer:
   confirm (a) `break-after: avoid` on the heading actually binds (the
   load-bearing assumption of change 2 — if it does NOT, fall back to a
   wrapper containing heading + first element only, and record the
   verdict in the registry), (b) atomic speeches hold, (c) pages fill.
4. Apple Books spot check (WebKit honors all of this natively).
5. Registry updates in formatting-options-log.md: rewrite #5a (keep
   mechanics), new entries for atomic dialogue blocks, transition
   break-before, dual fallback threshold; note MOBI exclusion.

## Test changes (TDD order)

- epub.test.ts: dialogue-block carries break-inside avoid; heading
  wrapper GONE (assertions at :57-:82 change); h2 avoid present when
  option on, absent when off; transition rule present; tall dual emits
  sequential markup while a short dual stays a table.
- options.test.ts: keepSceneHeadingWithScene toggle now asserts the CSS
  gate instead of the wrapper (:114).
- css.ts assertions updated accordingly.

## Risks

- `break-after: avoid` not binding on KFX would strand headings —
  covered by verification step 3 with a named fallback.
- Line-count estimation for dual fallback is approximate (font size and
  device width vary); the threshold only needs to catch clearly-tall
  exchanges, not be exact.
- Speeches taller than a page break bare — accepted by design.
