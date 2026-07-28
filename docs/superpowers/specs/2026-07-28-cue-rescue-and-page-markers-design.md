# Cue Rescue & Inline Page Markers — design

2026-07-28 · approved in brainstorm. Three **independent** changes shipped
together; each can be implemented, reviewed, or reverted without the
others.

- **Part A** — stop the classifier losing character cues (and the speeches
  under them) to over-strict text heuristics.
- **Part B** — page markers become an inline reference instead of costing
  a line, plus real EPUB3 pagination semantics.
- **Part C** — result-view trim: smaller brass buttons, no overflow menu,
  plainer labels.

---

# Part A — Roster-based cue rescue

## The problem

Three separate bug reports, all "a character name wasn't recognized":

| What the writer typed | Guard that vetoed it | Where |
| --- | --- | --- |
| `REALITY HOST (O.S)` | `DIALOGUE_EXTENSIONS` demanded the closing period | METEOR ANNE p7 (fixed 2026-07-27, §9e) |
| `ANNA’S MOM` | `CHARACTER_NAME` allows `'` but not `’` | MAN OF HER DREAMS p70-71 |
| `mike` | the ≥80 % uppercase ratio check | MAN OF HER DREAMS p34 |

These are not edge cases. They are one architectural flaw with three
faces.

## Root cause

`isLikelyCharacterName` (classify.ts) is a **veto stack**: eight text
heuristics layered on top of the geometric signal. The parser's thesis is
classification by indent, but any one of those guards can overrule
position. They exist to stop action text at cue indent being read as a
name; they are tuned tightly enough to also reject ordinary human typing
variance — a dropped period, a smart quote, a missed shift key.

**The failure is doubly destructive.** Rejecting the cue leaves no active
character, so the speech beneath it also falls to `action`. In MAN OF HER
DREAMS that swallowed **9 dialogue paragraphs across 8 missed cues**. The
reader loses the lines, not just the name.

**The smoking gun** — same name, same page, different result:

```
p70  character  'ANNA’S MOM (O.S.)'   ✅ takes the DIALOGUE_EXTENSIONS
                                          branch, returns before
                                          CHARACTER_NAME is ever tested
p70  action     'ANNA’S MOM'          ❌ falls through to CHARACTER_NAME,
                                          which rejects the curly quote
```

Whether a cue is recognized depends on which code path its incidental
punctuation happens to take.

## The insight the fix rests on

**Every missed name is confidently recognized elsewhere in the same
script.** MIKE 19×, ANNA’S MOM 1×, ANNA’S DAD 1×. The document carries its
own answer key; the parser never consults it.

## Design

### A1. Rescue pass (the general fix)

A second pass that promotes `action` elements back to `character` when the
document's own evidence says they are cues.

**Where it runs.** `ScreenplayElement` does **not** carry `indent` — only
`RawLine` and `TextBlock` do (verified in types.ts). But inside
`parseLines`, `blocks[i]` and `elements[i]` are strictly 1:1 (one
`classifyBlock` per block, pushed in order). So the pass runs there as
**step 3.5**, after the classify loop and before `attachSceneNumbers`,
with both arrays in hand. **No type change, no indent field added to
elements** — the geometry stays available exactly where it already exists.

**Roster.** Built from pass 1: every `baseCharacter` on an element typed
`character`. Normalized key (see A2). Names appearing only once still
count — ANNA’S MOM qualifies on a single `(O.S.)` sighting.

**Promotion requires ALL of:**
1. The element is currently `action`.
2. Its block indent is within `CHARACTER_MIN..CHARACTER_MAX` (35–50).
3. Its normalized text matches a roster key exactly.
4. The next element is `action` **and** its block indent is within
   `DIALOGUE_MIN..DIALOGUE_MAX` (25–35) — i.e. there is a speech under it
   that also got misfiled.

On promotion: retype to `character` (carrying `character` / `baseCharacter`
from the roster entry, so the rescued spelling normalizes to the
established one), then retype the following dialogue-indent run to
`dialogue` with that character, stopping at the first element that is not
dialogue-indent action.

**Why this is safe.** It cannot invent characters — only rescue instances
of names the script already established. A false positive needs an action
line that exactly matches an established character name, sits in the cue
indent band, *and* is followed by dialogue-indent text. It is also
self-correcting across scripts: it does not care *which* guard rejected
the line, so it catches the fourth and fifth variants nobody has hit yet.

**Ordering.** Runs before `attachSceneNumbers`, `detectTitlePages`,
`suppressBoilerplate`, and `extractCharacters`, so rescued speeches count
toward character dialogue totals and the reported character list.

### A2. Normalization helper

One function, used for both roster keys and candidate lookup:
straighten `’ ‘ ʼ` to `'`, upper-case, collapse internal whitespace, strip
trailing `(…)` extensions. Exported so tests can pin it directly.

### A3. Guard normalization (the cheap, targeted half)

Independent of A1 and worth having on its own — A1 rescues a *second*
instance, but a name that is misspelled on **every** appearance never
enters the roster at all.

- `CHARACTER_NAME` accepts curly apostrophes (`’`) as well as `'`. The
  codebase already treats both forms as equivalent for `(CONT'D)`
  (registry §8), so this only brings the name pattern in line.
- Nothing else in the veto stack is loosened here. Widening the uppercase
  ratio to admit `mike` would invite action prose at cue indent; A1
  handles that case with the roster as corroboration instead.

## Testing

- **Unit (bun:test), TDD:** normalization (curly/straight, case,
  extension stripping); rescue promotes `mike` when MIKE is in the roster;
  rescue promotes `ANNA’S MOM`; **rescue does NOT fire** when the name is
  absent from the roster, when the indent is outside the cue band, or when
  the following line is not dialogue-indent; the rescued speech is
  retyped and stops at the right boundary.
- **Regression net:** both reference scripts' summary lines must be
  compared before/after — `Meteor Anne 104p 147sc 66ch` and
  `Intimacy Party 94p 78sc 22ch`. Character counts are *expected to rise*
  where rescues occur; pages and scenes must not move.
- **Fixture sweep** (7 fixtures: 5 convert, `pitchdeck` → `not-screenplay`,
  `scanned` → `scanned`) plus `epubcheck` on the outputs.
- **Acceptance:** in MAN OF HER DREAMS, p34 `mike` ×2 and p70-71
  `ANNA’S MOM`/`ANNA’S DAD` ×6 all classify as `character`, and the 9
  swallowed paragraphs come back as `dialogue`.

## Mirror

`src/parser/` is ported from nightwatch. **Both A1 and A3 must be mirrored
to nightwatch's `parser/lines.ts`** (per CLAUDE.md), as §9e was.

---

# Part B — Inline page markers

## The problem

`showPageMarkers` emits each marker as its own block:

```css
p.page-marker { text-align: right; font-size: 0.75em; color: #777777; margin: 1em 0 0 0; }
```

So every marker costs a full line **plus** 1em of leading — on a 104-page
script that is a lot of dead space for a reference the reader only
glances at.

## Design — visible float + EPUB3 semantics ("both")

### B1. Marker attaches to the following block

`src/epub/html.ts` currently emits the `= pg N` synopsis token immediately
as its own `<p>`. Instead, **hold the pending marker** and prepend it as a
`<span>` inside the next rendered block-level element, so it occupies no
line of its own. A marker with no following block (end of file) is
dropped.

CSS — note the project invariant, horizontal in %, vertical in em:

```css
span.page-marker {
  float: right;
  font-size: 0.75em;
  color: #777777;
  margin-left: 1%;
}
```

`float: right` takes it out of flow; body text wraps beside it.

### B2. The same span carries EPUB3 pagination

One element does both jobs:

```html
<span epub:type="pagebreak" role="doc-pagebreak" id="pg47" title="47" class="page-marker">47.</span>
```

`epub:type="pagebreak"` + `title` is the standard EPUB3 mechanism; capable
reading systems (Enhanced Typesetting Kindles, Apple Books) then expose
real page numbers and page-jump navigation. The XHTML docs already declare
`xmlns:epub`, so no plumbing is needed.

### B3. `page-list` nav

`src/epub/build.ts` already emits `toc` and `landmarks` navs in an EPUB
3.0 package. Add a third, hidden:

```html
<nav epub:type="page-list" hidden="hidden">
  <ol><li><a href="text/body001.xhtml#pg47">47</a></li>…</ol>
</nav>
```

This requires the builder to know each marker's page label and the file it
landed in — collect them while rendering the body files and pass them to
the nav builder. Emit the nav only when there is at least one marker
(option off ⇒ no empty nav).

### B4. MOBI

`src/mobi/html.ts` has the same synopsis case. Apply B1's inline span so
the two formats agree; MOBI 6 has no EPUB3 semantics, so B2/B3 are
EPUB-only. If the legacy renderer ignores `float`, the marker degrades to
inline text at the start of the paragraph — acceptable, and exactly what
the device test below is for.

## Testing

- **Unit:** marker attaches to the *next* block rather than emitting its
  own `<p>`; a trailing marker with no following block is dropped;
  `page-list` nav appears only when markers exist and its hrefs resolve to
  ids that exist in the body files; markers off ⇒ no span, no nav, byte
  output unchanged from today.
- **`epubcheck` must stay clean** — a `pagebreak` span carrying visible
  text and a `page-list` whose targets must all resolve are both things
  epubcheck validates. This is the check most likely to bite.
- **Device gate (owner):** the markers are only worth shipping if they
  read well on the real Kindle. Sideload the AZW3 and confirm the number
  sits out of the way rather than interrupting the text; if `float` is
  ignored on that firmware, fall back to B-alternative (block marker with
  `margin: 0` and tight `line-height`), which is a CSS-only change.

## Out of scope

Re-flowing markers to true printed-page boundaries mid-speech (they still
defer to the next block boundary, per registry §13a); `dcterms:source`
metadata for the page-list; page markers for `.fountain` input (no pages
to number).

---

# Part C — Result-view trim

## The problem

The contextual layout shipped 2026-07-26 cut nine buttons to three, but
the brass buttons are still full-width and chunky, `MORE WAYS…` hides a
route behind a click, and two labels are wordier than they need to be.

## Design

### C1. Smaller brass buttons

`BradButtonStyle` (Theme.swift) is currently `courier(13, .bold)` with
`.padding(.vertical, 9)` and `.frame(maxWidth: .infinity)`. Reduce to
`courier(12, .bold)` and `.padding(.vertical, 6)`. Keep full width — the
buttons stay a clear column; they just stop dominating the page. Keep
`kerning`, corner radius, and the pressed-state animation untouched.

`OutlineButtonStyle` must be adjusted in step so primary and secondary
buttons keep matching heights; check it and match the new metrics.

### C2. Drop `MORE WAYS…`

The menu goes away entirely. Its contents become plain buttons, each
already conditional, so nothing new appears for a user it doesn't apply
to:

- **`SEND TO KINDLE — WEB`** (or `SEND TO KINDLE APP` when Amazon's app is
  installed) — now always visible, as requested.
- **`EMAIL TO KINDLE…`** — still gated on
  `SendToKindle.defaultMailClientIsAppleMail`, so it stays invisible on
  this owner's Mac (Superhuman) and appears only where the attachment
  actually survives.
- **`SEND TO REMARKABLE — USB`** — still gated on `remarkableUp`.

Net effect for the owner with nothing plugged in: **three buttons** —
`PREVIEW SCRIPT`, `SAVE`, `SEND TO KINDLE — WEB` — plus the copy-address
line and the tertiary text row. Same count as today, one fewer click to
reach the Kindle route.

### C3. Labels

| Now | Becomes |
| --- | --- |
| `READ SCRIPT` | `PREVIEW SCRIPT` |
| `SAVE A COPY…` | `SAVE` |

`SAVE` drops the ellipsis: with the shorter label the panel is the
obvious consequence, and the tertiary row already uses bare verbs. The
reader rail's equivalent (`Save a copy…`, sentence case per that panel's
convention) becomes `Save` for consistency.

### C4. Comment upkeep

`saveACopyStyle`'s doc comment names `MORE WAYS…` as where demoted routes
live; that becomes false the moment C2 lands. Rewrite it, along with the
note added 2026-07-26 about two brass buttons — still true, but it should
name the current label set.

## Testing

No new logic — `ResultActions.primary` is untouched, so its kit-checks
still cover which button is brass. Verification is a build plus a visual
pass on the running app (screen access is available now): confirm three
buttons, correct labels, no menu, and that the brass buttons read as
smaller without clipping their text at the window's minimum width.
