# Formatting Umbrella Implementation Plan (Phase A detailed)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Land the keep-break batch (spec: `../specs/2026-07-30-keep-break-improvements-design.md`), then sequence the rich-formatting spec's two phases and one combined device pass behind it.

**Architecture:** Four phases. Phase A (fully detailed below) is six small independent items on one branch: an options knob, three CSS emissions, a MOBI markup emission, an OPF meta, and doc corrections. Phases B and C implement the rich-formatting spec (`../specs/2026-07-30-rich-formatting-design.md`) and each gets its own detailed plan written via superpowers:writing-plans at phase start, so their plans are written against the post-A codebase instead of going stale. Phase D is one combined device pass settling every pending registry verdict.

**Tech Stack:** Bun/TypeScript engine (bun:test), SwiftPM app (kit-check executable, no XCTest), jszip EPUB3, hand-built MOBI dialect, epubcheck via brew.

**Umbrella sequencing (why A first):** Phase A builds the shared MOBI options plumbing (`tokensToMobiHtml` gains a FormatOptions param) and runs the new-knob ritual once as a worked example; rich-formatting phase 2 needs both. Phase B (underline) touches only the parser and can start any time after A merges.

---

## Phase A: the keep-break batch

Branch: `keep-break-batch` off current main. One task = one commit.

### Task 1: the printSplitMinimums option

**Files:**
- Modify: `src/options.ts`
- Modify: `format-defaults.json`
- Test: `tests/options.test.ts`

- [ ] **Step 1: Write the failing test**

In `tests/options.test.ts`, inside `describe('resolveFormatOptions', ...)` after the `justifyText` test:

```ts
  test('printSplitMinimums defaults to true and accepts a boolean', () => {
    expect(resolveFormatOptions({}).printSplitMinimums).toBe(true);
    expect(resolveFormatOptions({ printSplitMinimums: false }).printSplitMinimums).toBe(false);
    expect(
      resolveFormatOptions({ printSplitMinimums: 'no' } as Record<string, unknown>).printSplitMinimums,
    ).toBe(true);
  });
```

Also update the comment on the canonical-file test from "Sixteen literals" to "Seventeen literals".

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/options.test.ts`
Expected: FAIL (`printSplitMinimums` does not exist on the resolved type / undefined not true).

- [ ] **Step 3: Implement**

`src/options.ts`, in `interface FormatOptions` after `justifyText`:

```ts
  /** print split minimums: never strand a single dialogue/action line at
   * a page edge (widows/orphans 2); off packs tight (1) (registry #17) */
  printSplitMinimums: boolean;
```

In `DEFAULT_FORMAT_OPTIONS` after `justifyText: false,`:

```ts
  printSplitMinimums: true,
```

In `resolveFormatOptions`'s return object after `justifyText`:

```ts
    printSplitMinimums: bool('printSplitMinimums'),
```

`format-defaults.json`: change the last line pair so the file ends:

```json
  "justifyText": false,
  "printSplitMinimums": true
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test tests/options.test.ts && bunx tsc --noEmit`
Expected: PASS, clean typecheck. (kit-check stays green for now: Swift's JSONDecoder ignores the unknown 17th key until Task 7 adds the field.)

- [ ] **Step 5: Commit**

```bash
git add src/options.ts format-defaults.json tests/options.test.ts
git commit -m "printSplitMinimums option: the print two-line rule gets a knob (registry #17)"
```

### Task 2: widows/orphans CSS emission

**Files:**
- Modify: `src/epub/css.ts`
- Test: `tests/options.test.ts`

- [ ] **Step 1: Write the failing test**

In `tests/options.test.ts`, inside `describe('screenplayCss with options', ...)`:

```ts
  test('printSplitMinimums controls widows/orphans on dialogue and action', () => {
    const on = screenplayCss(resolveFormatOptions({}));
    expect(on.match(/p\.dialogue\s*{[^}]*}/)![0]).toContain('widows: 2');
    expect(on.match(/p\.dialogue\s*{[^}]*}/)![0]).toContain('orphans: 2');
    expect(on.match(/p\.action\s*{[^}]*}/)![0]).toContain('widows: 2');
    const off = screenplayCss(resolveFormatOptions({ printSplitMinimums: false }));
    expect(off.match(/p\.action\s*{[^}]*}/)![0]).toContain('orphans: 1');
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/options.test.ts`
Expected: FAIL (no widows in the emitted rules).

- [ ] **Step 3: Implement**

`src/epub/css.ts`, inside `screenplayCss` next to the other derived consts:

```ts
  // Print split minimums (registry #17): the two-line rule at page edges.
  // Honored by KFX (fw 5.12.3+) and RMSDK (Kobo epub, tolino); harmlessly
  // ignored by KF8/MOBI/kepub e-ink. 1 = the documented tight-packing
  // trade for readers who hate bottom-of-page gaps.
  const minLines = o.printSplitMinimums ? 2 : 1;
```

Replace the `p.action` and `p.dialogue` rules:

```css
p.action {
  margin: ${em(gap)} 0;
  text-align: ${bodyAlign};
  widows: ${minLines};
  orphans: ${minLines};
}
```

```css
p.dialogue {
  margin: 0;
  text-align: ${bodyAlign};
  widows: ${minLines};
  orphans: ${minLines};
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test tests/options.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/epub/css.ts tests/options.test.ts
git commit -m "Dialogue and action carry widows/orphans: 2 by default, 1 for tight packing"
```

### Task 3: the column spelling for wrapper keeps

**Files:**
- Modify: `src/epub/css.ts`
- Test: `tests/options.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
  test('wrapper keeps carry the column spelling in a separate rule', () => {
    const css = screenplayCss(DEFAULT_FORMAT_OPTIONS);
    const rule = css.match(/\.keep-together,\s*table\.dual-dialogue\s*{[^}]*}/);
    expect(rule).not.toBeNull();
    expect(rule![0]).toContain('-webkit-column-break-inside: avoid');
    // iBooks bug: the column spelling must not share a declaration block
    // with page-break-inside, or Books ignores BOTH.
    expect(rule![0]).not.toContain('page-break-inside');
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/options.test.ts`
Expected: FAIL (rule absent).

- [ ] **Step 3: Implement**

`src/epub/css.ts`, directly after the `.keep-together { ... }` rule:

```css
/* Multicol-paginating engines (kepub, the Readium family) honor the old
   column spelling. SEPARATE rule on purpose: iBooks drops BOTH forms when
   they share one declaration block (BlitzTricks). Unguarded on purpose:
   the engines that need it largely predate @supports. */
.keep-together, table.dual-dialogue { -webkit-column-break-inside: avoid; }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test tests/options.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/epub/css.ts tests/options.test.ts
git commit -m "Wrapper keeps learn the column spelling (kepub/Readium), in its own rule for iBooks"
```

### Task 4: page marker dims by opacity

**Files:**
- Modify: `src/epub/css.ts`
- Test: `tests/options.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
  test('page marker dims via opacity, not a hardcoded gray', () => {
    const css = screenplayCss(DEFAULT_FORMAT_OPTIONS);
    const rule = css.match(/span\.page-marker\s*{[^}]*}/)![0];
    expect(rule).toContain('opacity: 0.6');
    expect(rule).not.toContain('#777777');
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/options.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

In `span.page-marker`, replace `color: #777777;` with `opacity: 0.6;` and amend the comment above the rule: the marker dims relative to the theme's own text color, so it recedes correctly in dark and sepia modes; engines without opacity render it full-strength (harmless).

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test`
Expected: PASS across the suite (catches any snapshot-ish assertions elsewhere that mention #777777).

- [ ] **Step 5: Commit**

```bash
git add src/epub/css.ts tests/options.test.ts
git commit -m "Page marker dims via opacity so every theme keeps it legible"
```

### Task 5: MOBI scene breaks

**Files:**
- Modify: `src/mobi/html.ts`
- Modify: `src/convert.ts:85`
- Test: `tests/mobi.test.ts`

- [ ] **Step 1: Write the failing test**

In `tests/mobi.test.ts` (add `Fountain` and options imports if not present):

```ts
import { DEFAULT_FORMAT_OPTIONS, resolveFormatOptions } from '../src/options';

test('scenePageBreaks emits mbp:pagebreak before every scene heading except the first', () => {
  const src = 'INT. A - DAY\n\nAction.\n\nINT. B - NIGHT\n\nMore.\n';
  const { tokens } = new Fountain().parse(src, true);
  const off = tokensToMobiHtml(tokens, { title: 'T' });
  const on = tokensToMobiHtml(tokens, { title: 'T' }, resolveFormatOptions({ scenePageBreaks: true }));
  // The title page always contributes exactly one pagebreak of its own.
  expect(off.match(/<mbp:pagebreak\/>/g)!.length).toBe(1);
  expect(on.match(/<mbp:pagebreak\/>/g)!.length).toBe(2);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/mobi.test.ts`
Expected: FAIL (extra argument rejected by tsc at runtime type level, or count is 1 with the option on).

- [ ] **Step 3: Implement**

`src/mobi/html.ts`:

```ts
import type { FormatOptions } from '../options';
import { DEFAULT_FORMAT_OPTIONS } from '../options';

export function tokensToMobiHtml(
  tokens: Token[],
  meta: MobiMeta,
  format: FormatOptions = DEFAULT_FORMAT_OPTIONS,
): string {
```

Above the token loop add `let sawScene = false;`. The `scene_heading` case becomes:

```ts
      case 'scene_heading':
        closeSpeech();
        // The only break primitive this dialect has (registry #1's MOBI
        // arm). out.push, not push(): a pending page marker belongs to
        // the heading block, never to the break itself.
        if (format.scenePageBreaks && sawScene) out.push('<mbp:pagebreak/>');
        sawScene = true;
        push(`<p><b>${esc(text)}</b></p>`);
        break;
```

`src/convert.ts:85`: pass the options through:

```ts
    ? buildMobi({ title: meta.title, author: meta.author, html: tokensToMobiHtml(tokens, meta, format) })
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test tests/mobi.test.ts && bunx tsc --noEmit`
Expected: PASS, clean typecheck.

- [ ] **Step 5: Commit**

```bash
git add src/mobi/html.ts src/convert.ts tests/mobi.test.ts
git commit -m "MOBI learns scene page breaks: mbp:pagebreak, the dialect's one primitive"
```

### Task 6: Apple Books specified-fonts meta

**Files:**
- Modify: `src/epub/build.ts:40-46`
- Test: `tests/epub.test.ts`

- [ ] **Step 1: Write the failing test**

In `tests/epub.test.ts`, next to the existing `package.opf carries metadata...` test (reuse that test's zip-building helper lines verbatim; only the assertions differ):

```ts
  test('OPF declares the ibooks prefix and specified-fonts meta', async () => {
    const zip = await JSZip.loadAsync(await buildTestEpub()); // the file's existing builder pattern
    const opf = await zip.file('OEBPS/package.opf')!.async('string');
    expect(opf).toContain(
      'prefix="ibooks: http://vocabulary.itunes.apple.com/rdf/ibooks/vocabulary-extensions-1.0/"',
    );
    expect(opf).toContain('<meta property="ibooks:specified-fonts">true</meta>');
  });
```

(If the neighboring test builds inline rather than via a helper, copy its exact build lines in place of `buildTestEpub()`.)

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/epub.test.ts`
Expected: FAIL (neither string present).

- [ ] **Step 3: Implement**

`src/epub/build.ts` line 40, the package element gains the prefix attribute:

```xml
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="uid" xml:lang="en" prefix="ibooks: http://vocabulary.itunes.apple.com/rdf/ibooks/vocabulary-extensions-1.0/">
```

In the metadata block after the `dcterms:modified` meta:

```xml
    <meta property="ibooks:specified-fonts">true</meta>
```

With a short comment in the template-producing code: Books ignores publisher font-family and lets the user Justify setting stomp text-align unless this meta is present (device-map §3); every other reader ignores it.

- [ ] **Step 4: Run tests + epubcheck**

Run: `bun test tests/epub.test.ts`
Expected: PASS.
Then: convert any committed fixture and validate:

```bash
bun src/cli.ts tests/fixtures/screenplay.pdf --out /tmp/ibooks-meta-check && epubcheck /tmp/ibooks-meta-check/*.epub
```

Expected: 0 errors (the prefix declaration is what keeps epubcheck quiet about the ibooks property). Adjust the --out invocation to the CLI's actual flags (`bun src/cli.ts --help`) if they differ.

- [ ] **Step 5: Commit**

```bash
git add src/epub/build.ts tests/epub.test.ts
git commit -m "OPF carries ibooks:specified-fonts so Books honors our font and ragged-right"
```

### Task 7: the Swift side of the knob

**Files:**
- Modify: `app/Sources/ScreepubKit/FormatSettings.swift`
- Modify: `app/Sources/ScreepubKit/ScriptSettings.swift:16-33` (PartialFormatSettings + merge)
- Modify: `app/Sources/ScreepubApp/AppSettings.swift:28-87` (formatSettings / setFormatSettings / resetFormatting)
- Test: `app/Sources/KitCheck/main.swift` (~line 217)

- [ ] **Step 1: Write the failing check**

`app/Sources/KitCheck/main.swift`, next to the existing `keepSpeechesWhole` default check (~line 217):

```swift
check(FormatSettings.defaults.printSplitMinimums == true,
      "printSplitMinimums defaults ON (the print two-line rule)")
```

- [ ] **Step 2: Run to verify it fails**

Run: `(cd app && swift run -c release kit-check)`
Expected: BUILD FAILURE (no such member) — that is this task's failing state.

- [ ] **Step 3: Implement**

`FormatSettings.swift`: add after `justifyText` in all three places:

```swift
    public var printSplitMinimums: Bool
```

```swift
        justifyText: false,
        printSplitMinimums: true
```

```swift
        dualDialogue: String, justifyText: Bool, printSplitMinimums: Bool
```

```swift
        self.printSplitMinimums = printSplitMinimums
```

`ScriptSettings.swift`: `var printSplitMinimums: Bool?` in PartialFormatSettings, and in the merge:

```swift
        if let v = partial.printSplitMinimums { merged.printSplitMinimums = v }
```

`AppSettings.swift`: in `formatSettings()`'s returned initializer:

```swift
            printSplitMinimums: bool("fmtSplitMinimums", def.printSplitMinimums)
```

in `setFormatSettings`:

```swift
        d.set(s.printSplitMinimums, forKey: "fmtSplitMinimums")
```

and `"fmtSplitMinimums"` appended to `resetFormatting()`'s key array.

- [ ] **Step 4: Run to verify it passes**

Run: `(cd app && swift run -c release kit-check)`
Expected: all checks pass, including "canonical format-defaults.json decodes into FormatSettings" and the defaults-equality check (Task 1 already added the JSON key).

- [ ] **Step 5: Commit**

```bash
git add app/Sources/ScreepubKit/FormatSettings.swift app/Sources/ScreepubKit/ScriptSettings.swift app/Sources/ScreepubApp/AppSettings.swift app/Sources/KitCheck/main.swift
git commit -m "FormatSettings mirrors printSplitMinimums through the sidecar and defaults trio"
```

### Task 8: the rail toggle

**Files:**
- Modify: `app/Sources/ScreepubApp/ReaderRail.swift:29-33`

- [ ] **Step 1: Add the toggle**

In the `Section("Page")` block, after the `keepSpeechesWhole` toggle's caption `Text`:

```swift
                Toggle("Print-style split minimums", isOn: binding(\.printSplitMinimums))
                Text("Never leaves a single line of a speech or paragraph alone at a page edge. Off packs pages tighter. Applies on new-format Kindle (KFX) and Kobo/tolino.")
                    .font(.caption)
                    .foregroundStyle(.secondary)
```

- [ ] **Step 2: Compile**

Run: `(cd app && swift build)`
Expected: builds clean. (No kit-check coverage: the rail is UI; the binding compiles against the Task 7 field or not at all.)

- [ ] **Step 3: Commit**

```bash
git add app/Sources/ScreepubApp/ReaderRail.swift
git commit -m "Reader rail: Print-style split minimums toggle in the Page group"
```

### Task 9: doc corrections and new invariants

**Files:**
- Modify: `docs/device-map.md` (§2.1 rendering bullet, §5 registry-corrections block, §5 "Now" item 2, new §6)
- Modify: `CLAUDE.md` (CSS invariant bullet)
- Modify: `src/epub/css.ts` (header comment)
- Modify: `docs/formatting-options-log.md` (#17 new, #1, #5, #6b, #8b, #8c)

- [ ] **Step 1: device-map §2.1** — replace the "Rendering (Amazon's own publishing guidelines...)" bullet with:

> Rendering (live KDP help pages + device tests; the 2026.2 guidelines
> PDF's Appendix B is stale and self-contradictory — cite the web pages,
> not the PDF): `max-width` ignored by both renderer generations;
> horizontal margins in %, vertical in em, body margins 0 (§11.3.5);
> body `line-height` unsettable (KFX line height is fixed; KF8 clamps
> near 1.2). Break/keep CSS: **KFX honors `page-break-*`/`break-*`
> including `avoid`, and `widows`/`orphans` from fw 5.12.3** (Kindle
> Previewer 3.35/3.36 added them circa 2019; jhowell's device tests plus
> our #5a/#8b passes confirm) — but ONLY on top-level blocks: any
> html/body background makes the converter synthesize a wrapper block
> and every keep dies silently (MobileRead t=330798). KF8/AZW3 honors
> `always` only; file splits remain the only hard break there. The
> Publisher Font toggle protects `font-family` only.

- [ ] **Step 2: device-map §5** — in "Registry corrections to carry", rewrite the first bullet to match (sideloaded EPUB unread stays; the ET-ignores claim goes); in the "Now" list, mark item 2 (ibooks meta) as landed by this batch with the date.

- [ ] **Step 3: device-map new §6** — append a "Fragmentation support matrix (researched 2026-07-30)" section containing exactly this table and source list:

```markdown
| Property | KFX/ET | KF8/AZW3 | MOBI 6 | Kobo epub (RMSDK) | Kobo kepub e-ink | tolino | Apple Books |
|---|---|---|---|---|---|---|---|
| `break-inside: avoid` | YES, top-level blocks only (tested) | NO for text blocks (images only) | NO | NO | NO | = Kobo column by gen | YES via the column spelling, separate rule |
| `break-before/after: always` | YES | YES | `<mbp:pagebreak/>` only | YES | NO (split files) | YES (Gen A) | YES |
| `break-before/after: avoid` | YES, fw-dependent (tested) | NO | NO | YES (RMSDK's one strength) | NO | likely YES (RMSDK, untested) | NO (WebKit lacks it) |
| `widows`/`orphans` | YES from fw 5.12.3 | NO | NO | YES (tested) | reads them (patch-lore) | = RMSDK | likely (WebKit, untested) |
| New XHTML file = page break | YES | YES | YES | YES | YES (the only reliable break) | YES | YES |

Sources: KDP Text Guidelines GH4DRT75GWWAGBTU; Kindle Previewer release
notes 3.35/3.36; MobileRead t=330798 (avoid is KFX-only; top-level
blocks; background wrapper trap), t=328903 (RMSDK widows/orphans),
t=346874 (kepub ignores break CSS; split files); kobolabs/epub-spec;
clagnut.com/blog/2426 (WebKit lacks break-after: avoid). The 2026.2
guidelines PDF Appendix B contradicts the live pages and lost.
```

- [ ] **Step 4: CLAUDE.md** — extend the EPUB CSS invariant bullet with: "No html/body background-color ever (KFX honors keeps only on top-level blocks; a root background synthesizes a wrapper and silently kills them all), and CSS values stay 2.1-vintage (RMSDK can blank the whole book on modern functions like min())."

- [ ] **Step 5: css.ts header** — add the same two traps as one-liners to the geometry-rules comment block. While in this file, apply two comment-precision fixes carried over from Unit 1's review: (a) the `minLines` comment says a single-paragraph speech "never splits and this rule never fires for it", which overstates — `break-inside: avoid` yields when the block cannot fit a page, exactly as this same file already caveats for #8c ("`avoid` yields where it cannot be honored"); match that voice. (b) The new trailing inventory paragraph says "the only rule here whose OFF state still emits a value", which is true of the break inventory but false of the file (`justifyText` off emits `text-align: left`); scope it to "the only rule in this inventory", and stop calling the single forced break a "list".

- [ ] **Step 6: registry** — add entry #17 (text below), plus: #1 gains "MOBI arm: `<mbp:pagebreak/>` before each scene heading except the first (2026-07-30)"; #5 and #8b each gain a line noting the wrapper keeps now also carry `-webkit-column-break-inside: avoid` in a separate rule (iBooks same-rule bug; kepub/Readium coverage); #6b gains "the OPF's `ibooks:specified-fonts` meta (2026-07-30) is what makes this knob hold in Apple Books"; #8c's pending-verdict paragraph gains: "Include the longest speech in the set at the largest font size: a kept block taller than one page historically made Previewer fail to render (jhowell 2016), and blank-page pushes are the failure Blitz disables Kindle keeps to avoid."

Registry #17 entry, verbatim:

```markdown
### 17. Print split minimums (option, default ON; 2026-07-30)
- **What:** `printSplitMinimums` emits `widows`/`orphans` on `p.dialogue`
  and `p.action`: ON = 2 (print's two-line rule at page edges,
  pagination-reference §2), OFF = 1 (tight packing, the community's
  documented space-reclaim trick).
- **Device support:** KFX honors widows/orphans from fw 5.12.3 (Kindle
  Previewer 3.35 added them ~2019); RMSDK (Kobo epub, tolino) honors
  book CSS (MobileRead t=328903). Ignored: KF8/AZW3, MOBI. Unverified
  on kepub e-ink (patch-lore says its WebKit reads them; not confirmed
  on device). Apple Books: WebKit implements the properties; untested.
  The registry's old belief that ET ignores them traced to the stale
  2026.2 guidelines PDF appendix; live KDP pages + device tests win.
- **Interaction (load-bearing):** #8b's `.keep-together` is ALWAYS on and
  wraps cue + parentheticals + the FIRST dialogue paragraph in
  `break-inside: avoid`. A single-paragraph speech therefore never
  splits and its widows/orphans never fire. This rule bites on the TAIL
  paragraphs of multi-paragraph speeches and on action. With #8c also
  ON, whole speeches are atomic and the dialogue arm is fully inert;
  the action arm is unaffected in every mode.
- **App option:** "Print-style split minimums" (reader rail, Page group).
- **Device verdict: pending —** next KFX pass. Test with a MULTI-paragraph
  speech or a long action block, NOT a short speech: a short speech moves
  whole because of #8b's keep, which would validate the wrong rule. Does
  the tail hold 2+2, and OFF hold 1+1?
- **Code:** `src/options.ts`, `src/epub/css.ts`, app FormatSettings +
  ReaderRail.
```

- [ ] **Step 7: Commit**

```bash
git add docs/device-map.md docs/formatting-options-log.md CLAUDE.md src/epub/css.ts
git commit -m "Docs: KFX keep truth replaces the stale PDF claim; two new CSS invariants; registry #17"
```

### Task 10: full verification sweep

- [ ] **Step 1:** `bun test` — expected: full suite green (340+).
- [ ] **Step 2:** `bunx tsc --noEmit` — expected: clean.
- [ ] **Step 3:** Fixture sweep: convert every PDF in `tests/fixtures/` AND the real `/fixtures/` set via `bun src/cli.ts`; read each CLI summary line (title — author, pages · scenes · characters) against the recorded tables; no drift allowed (stage-1 untouched, so any drift is a bug).
- [ ] **Step 4:** `epubcheck` each generated EPUB — expected: 0 errors. Note: `-webkit-column-break-inside` may draw a CSS *warning*; warnings are acceptable, errors are not.
- [ ] **Step 5:** `app/build-app.sh` then `(cd app && swift run -c release kit-check)` — expected: bundle builds (engine sidecar re-embedded), kit-check fully green.
- [ ] **Step 6:** Commit anything the sweep touched, then merge `keep-break-batch` to main per the repo's review flow (superpowers:requesting-code-review before merge).

---

## Phase B: rich-formatting phase 1 (underline)

Not detailed here on purpose. At phase start, run superpowers:writing-plans against `../specs/2026-07-30-rich-formatting-design.md` §Phase 1 and save as `2026-07-30-rich-formatting-phase1.md`. Scope reminders for that plan: parser-only (`src/parser/extract.ts` + make-fixture.py + tests); the three underline decoys include the Beat table-border shape; MOBI/EPUB renderers unchanged except the missing MOBI `<u>` pinning test.

## Phase C: rich-formatting phase 2 (font family/size)

Same procedure: plan written at phase start as `2026-07-30-rich-formatting-phase2.md`, against spec §Phase 2. It inherits from Phase A: `tokensToMobiHtml` already takes FormatOptions (extend, don't re-plumb), and the `printSplitMinimums` commits are the worked example for the `preserveFontShifts` knob ritual (options.ts → format-defaults.json → options.test.ts → FormatSettings → PartialFormatSettings → AppSettings trio → kit-check → rail).

## Phase D: the combined device pass (Sam-owned, one sideload session)

One KFX build + one Apple Books handoff of a real script carrying: a MULTI-paragraph speech and a long action block near page seams, the set's longest speech, a CUT TO: near a seam, a dual-dialogue exchange, an underlined phrase (post-B), and a font-shifted insert (post-C). Verdicts to land, each in its registry slot:

- [ ] #17 printSplitMinimums: 2+2 holds at seams; OFF gives 1+1. Use a multi-paragraph speech or action, never a short speech: #8b's always-on keep moves a short speech whole and would validate the wrong rule.
- [ ] #8c keepSpeechesWhole ON: kept speech moves whole; gap size noted; the oversize speech breaks bare without blank pages.
- [ ] #16 transitions: no CUT TO: opens a page.
- [ ] #10b tall dual exchange behavior.
- [ ] Apple Books: ragged-right holds with the user's Justify setting ON (item 5's meta).
- [ ] Post-B/C: underline renders on device; font shifts render and degrade sanely.

After the pass: registry verdict edits, app bundle rebuild if anything changed, and the umbrella is done.
