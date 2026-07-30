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

## Governing rules

**The cue is sacred; the default stays proven.** A character cue never
strands at a page bottom: the existing keep (cue + parentheticals +
first dialogue line) is the default and remains unchanged — it has been
working in practice. Beyond that first line, dialogue may flow across
the break like prose, because reflow cannot inject `(MORE)`/`(CONT'D)`
at the seam (the break position is decided per-reader at render time;
EPUB offers no hook; Kindle strips scripting; fixed layout would forfeit
reflow).

**Atomic speeches are a choice, not the default.** For readers who
prefer a speech never to split — accepting occasional white space as the
price — a new format option makes whole dialogue blocks unbreakable.
Physics still wins: a speech taller than a full page must break
somewhere (CSS `avoid` yields when impossible) and then breaks bare.

## Changes

1. **New option: `keepSpeechesWhole` (bool, default false).** When on,
   `.dialogue-block` gains `page-break-inside: avoid; break-inside:
   avoid`, making each speech atomic. (The dual-dialogue table is
   ALREADY unconditionally unbreakable today — that stays as existing
   behavior, bounded by change 5, independent of this option.) When off
   (default), behavior is exactly today's: the inner
   keep (cue + parentheticals + first line, epub/html.ts closeSpeech)
   protects the cue and speeches may flow. The inner keep also remains
   when the option is on, as a degradation layer for renderers that
   ignore block-level avoid. Full knob protocol: `src/options.ts`
   interface + defaults + resolve, `format-defaults.json`,
   `FormatSettings.swift`, app Formatting settings UI (a toggle beside
   the existing keep option), per-script sidecar picks it up via
   FormatSettings coding, and BOTH pinned suites (options.test.ts,
   kit-check) gain the key in the same change — the three-way default
   pinning demands it. Registry entry in formatting-options-log.md.
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

- All existing option defaults unchanged; the one NEW option
  (`keepSpeechesWhole`) defaults false, so default output changes only
  via changes 2-5, never via dialogue handling.
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

- options.test.ts: `keepSpeechesWhole` defaults false and round-trips;
  format-defaults.json gains the key (pinning assertion at :36 keeps
  passing only when both move together); keepSceneHeadingWithScene
  toggle now asserts the CSS gate instead of the wrapper (:114).
- kit-check: FormatSettings decodes the new key; defaults still match
  the canonical file (main.swift:205-212).
- epub.test.ts: dialogue-block carries break-inside avoid ONLY when
  `keepSpeechesWhole` is on; heading wrapper GONE (assertions at
  :57-:82 change); h2 avoid present when its option is on, absent when
  off; transition rule present; tall dual emits sequential markup while
  a short dual stays a table.
- App: FormattingSettings pane gains the toggle; sidecar round-trip
  covered by existing ScriptSettings checks once the field exists.

## Risks

- `break-after: avoid` not binding on KFX would strand headings —
  covered by verification step 3 with a named fallback.
- Line-count estimation for dual fallback is approximate (font size and
  device width vary); the threshold only needs to catch clearly-tall
  exchanges, not be exact.
- Speeches taller than a page break bare — accepted by design.
