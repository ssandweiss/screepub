# Cue Rescue & Inline Page Markers Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop the classifier losing character cues (and the speeches beneath them) to over-strict text heuristics; make page markers an inline reference with real EPUB3 pagination; trim the result view.

**Architecture:** Part A adds a roster-based rescue pass inside `parseLines`, where `blocks[i]` and `elements[i]` are still 1:1 so indent is available without changing `ScreenplayElement`. Part B holds each page marker and injects it into the next block as a floated `<span>` that doubles as an `epub:type="pagebreak"` anchor, with a `page-list` nav. Part C is SwiftUI label/metric changes.

**Tech Stack:** Bun/TypeScript (`bun test`), SwiftUI/SwiftPM (`kit-check`), epubcheck.

**Spec:** `docs/superpowers/specs/2026-07-28-cue-rescue-and-page-markers-design.md`

**Three independent parts.** A (parser), B (EPUB rendering), C (app UI) touch disjoint files and can be implemented, reviewed, or reverted separately. Do them in order; do not bundle their commits.

**Baselines to preserve (capture again before starting):**
- `Meteor Anne — Aaron Schoonover | 104p 147sc 66ch`
- `Intimacy Party — Courtney Hoffman | 94p 78sc 22ch`
- `bun test` 220 pass / 0 fail; `kit-check` 55 ok.
- Character counts MAY rise in Part A where rescues happen. Pages and scenes must not move.

---

## File Structure

- **Modify** `src/parser/classify.ts` — curly-apostrophe support in `CHARACTER_NAME`; export a `normalizeCueName` helper.
- **Create** `src/parser/rescue.ts` — the rescue pass. Its own file: one responsibility, independently testable, and keeps `classify.ts` from growing.
- **Modify** `src/parser/index.ts` — call the rescue pass as step 3.5.
- **Modify** `tests/parser.test.ts` — Part A tests.
- **Modify** `src/epub/html.ts`, `src/epub/css.ts`, `src/epub/build.ts`, `src/mobi/html.ts` — Part B.
- **Modify** `app/Sources/ScreepubApp/Theme.swift`, `ContentView.swift`, `ReaderRail.swift` — Part C.
- **Modify** `docs/formatting-options-log.md` — registry entries for A and B.

---

# PART A — Roster-based cue rescue

## Task A1: Curly apostrophes in `CHARACTER_NAME`

**Files:** Modify `src/parser/classify.ts:22`, `tests/parser.test.ts`

- [ ] **Step 1: Write the failing test**

Append inside the `character names` describe block in `tests/parser.test.ts`:

```ts
    // MAN OF HER DREAMS types ANNA’S MOM with a curly apostrophe. The name
    // pattern allowed only the straight ', so every bare instance fell to
    // action — while "ANNA’S MOM (O.S.)" passed, because an extension takes
    // a different branch that never reaches CHARACTER_NAME.
    test('character name with a curly apostrophe', () => {
      const block = makeBlock({ text: 'ANNA’S MOM', indent: 40 });
      const result = classifyBlock(block, null);
      expect(result.type).toBe('character');
      expect(result.character).toBe('ANNA’S MOM');
    });

    test('character name with a straight apostrophe still works', () => {
      const block = makeBlock({ text: "ANNA'S DAD", indent: 40 });
      const result = classifyBlock(block, null);
      expect(result.type).toBe('character');
      expect(result.character).toBe("ANNA'S DAD");
    });
```

- [ ] **Step 2: Run to verify it fails**

Run: `bun test tests/parser.test.ts`
Expected: the curly test FAILS (`expected "action" to be "character"`); the straight one passes.

- [ ] **Step 3: Implement**

In `src/parser/classify.ts`, replace line 22:

```ts
const CHARACTER_NAME = /^[A-Z][A-Z0-9\s'’\/&#-]*(\s*\([^)]+\))*\.{0,3}$/;
```

(`’` added to the character class — the codebase already treats curly
and straight apostrophes as equivalent for `(CONT'D)`, registry §8.)

- [ ] **Step 4: Verify**

Run: `bun test tests/parser.test.ts`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add src/parser/classify.ts tests/parser.test.ts
git commit -m "fix: character names may contain a curly apostrophe"
```

---

## Task A2: `normalizeCueName` helper

**Files:** Modify `src/parser/classify.ts`, `tests/parser.test.ts`

- [ ] **Step 1: Write the failing test**

Add a new top-level describe in `tests/parser.test.ts` (and add `normalizeCueName` to the existing import from `../src/parser/classify`):

```ts
describe('normalizeCueName', () => {
  test('straightens curly apostrophes', () => {
    expect(normalizeCueName('ANNA’S MOM')).toBe("ANNA'S MOM");
  });
  test('upper-cases', () => {
    expect(normalizeCueName('mike')).toBe('MIKE');
  });
  test('strips a trailing extension', () => {
    expect(normalizeCueName('ANNA’S MOM (O.S.)')).toBe("ANNA'S MOM");
    expect(normalizeCueName("MIKE (CONT'D)")).toBe('MIKE');
  });
  test('collapses internal whitespace and trims', () => {
    expect(normalizeCueName('  REALITY   HOST  ')).toBe('REALITY HOST');
  });
  test('leaves an ordinary name alone', () => {
    expect(normalizeCueName('KARINA')).toBe('KARINA');
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `bun test tests/parser.test.ts`
Expected: FAIL — `normalizeCueName` is not exported.

- [ ] **Step 3: Implement**

Add to `src/parser/classify.ts` (exported, near the other helpers):

```ts
/**
 * Canonical key for comparing a candidate cue against the character
 * roster: smart quotes straightened, case folded, extensions dropped.
 * Deliberately lossy — it exists to match "mike" and "ANNA’S MOM" to
 * names the script already established, not to display.
 */
export function normalizeCueName(text: string): string {
  return text
    .replace(/[‘’ʼ]/g, "'")
    .replace(/(\s*\([^)]*\))+\s*$/, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toUpperCase();
}
```

- [ ] **Step 4: Verify**

Run: `bun test tests/parser.test.ts`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add src/parser/classify.ts tests/parser.test.ts
git commit -m "kit: normalizeCueName — canonical key for roster matching"
```

---

## Task A3: The rescue pass

**Files:** Create `src/parser/rescue.ts`; Modify `tests/parser.test.ts`

- [ ] **Step 1: Write the failing test**

Add a new top-level describe in `tests/parser.test.ts`. Import: `import { rescueCues } from '../src/parser/rescue';`

```ts
describe('rescueCues', () => {
  // elements[i] pairs with blocks[i]; only indent is read off the block.
  const el = (over: Partial<ScreenplayElement> & { type: string; text: string }) =>
    ({ id: 'x', pageNum: 1, isTitlePage: false, isReadable: true, ...over }) as ScreenplayElement;
  const blk = (indent: number) => makeBlock({ text: '', indent });

  test('promotes a lowercase cue when the name is in the roster', () => {
    const elements = [
      el({ type: 'character', text: 'MIKE', character: 'MIKE', baseCharacter: 'MIKE' }),
      el({ type: 'dialogue', text: 'Hello.', character: 'MIKE' }),
      el({ type: 'action', text: 'mike' }),
      el({ type: 'action', text: 'Oh, yes. The dreaded poo-shi.' }),
    ];
    const blocks = [blk(40), blk(30), blk(40), blk(30)];
    rescueCues(elements, blocks);
    expect(elements[2].type).toBe('character');
    expect(elements[2].baseCharacter).toBe('MIKE');
    expect(elements[3].type).toBe('dialogue');
    expect(elements[3].character).toBe('MIKE');
  });

  test('promotes a curly-apostrophe cue seen once with an extension', () => {
    const elements = [
      el({ type: 'character', text: 'ANNA’S MOM (O.S.)', character: 'ANNA’S MOM', baseCharacter: 'ANNA’S MOM' }),
      el({ type: 'dialogue', text: 'Hi.', character: 'ANNA’S MOM' }),
      el({ type: 'action', text: 'ANNA’S MOM' }),
      el({ type: 'action', text: 'Why don’t we start with something smaller.' }),
    ];
    const blocks = [blk(40), blk(30), blk(40), blk(30)];
    rescueCues(elements, blocks);
    expect(elements[2].type).toBe('character');
    expect(elements[3].type).toBe('dialogue');
  });

  test('does NOT promote a name absent from the roster', () => {
    const elements = [
      el({ type: 'action', text: 'STRANGER' }),
      el({ type: 'action', text: 'Some line.' }),
    ];
    rescueCues(elements, [blk(40), blk(30)]);
    expect(elements[0].type).toBe('action');
  });

  test('does NOT promote outside the character indent band', () => {
    const elements = [
      el({ type: 'character', text: 'MIKE', character: 'MIKE', baseCharacter: 'MIKE' }),
      el({ type: 'dialogue', text: 'Hi.', character: 'MIKE' }),
      el({ type: 'action', text: 'MIKE' }),
      el({ type: 'action', text: 'Some line.' }),
    ];
    rescueCues(elements, [blk(40), blk(30), blk(10), blk(30)]);
    expect(elements[2].type).toBe('action');
  });

  test('does NOT promote when the next line is not dialogue-indent', () => {
    const elements = [
      el({ type: 'character', text: 'MIKE', character: 'MIKE', baseCharacter: 'MIKE' }),
      el({ type: 'dialogue', text: 'Hi.', character: 'MIKE' }),
      el({ type: 'action', text: 'MIKE' }),
      el({ type: 'action', text: 'Some action at action indent.' }),
    ];
    rescueCues(elements, [blk(40), blk(30), blk(40), blk(10)]);
    expect(elements[2].type).toBe('action');
  });

  test('retypes the whole speech run and stops at the boundary', () => {
    const elements = [
      el({ type: 'character', text: 'MIKE', character: 'MIKE', baseCharacter: 'MIKE' }),
      el({ type: 'dialogue', text: 'Hi.', character: 'MIKE' }),
      el({ type: 'action', text: 'mike' }),
      el({ type: 'action', text: 'Line one.' }),
      el({ type: 'action', text: 'Line two.' }),
      el({ type: 'action', text: 'She leaves the room.' }),
    ];
    rescueCues(elements, [blk(40), blk(30), blk(40), blk(30), blk(30), blk(10)]);
    expect(elements[3].type).toBe('dialogue');
    expect(elements[4].type).toBe('dialogue');
    expect(elements[5].type).toBe('action');
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `bun test tests/parser.test.ts`
Expected: FAIL — cannot resolve `../src/parser/rescue`.

- [ ] **Step 3: Implement**

Create `src/parser/rescue.ts`:

```ts
import type { ScreenplayElement, TextBlock } from './types';
import { INDENT_RANGES } from './types';
import { normalizeCueName } from './classify';

/**
 * Second pass: promote `action` elements back to `character` when the
 * document's own evidence says they are cues.
 *
 * Classification is geometric, but `isLikelyCharacterName` layers text
 * heuristics on top that can overrule position — a dropped period, a smart
 * quote, a missed shift key. Each rejection costs TWO elements, because
 * with no active character the speech underneath falls to action too.
 *
 * Every name this rescues is already recognized elsewhere in the same
 * script, so the roster is the corroboration. It cannot invent characters.
 *
 * `elements[i]` pairs with `blocks[i]` — parseLines pushes exactly one
 * element per block, in order. Mutates `elements` in place.
 */
export function rescueCues(elements: ScreenplayElement[], blocks: TextBlock[]): void {
  const roster = new Map<string, string>(); // normalized -> established baseCharacter
  for (const el of elements) {
    if (el.type === 'character' && el.baseCharacter) {
      roster.set(normalizeCueName(el.baseCharacter), el.baseCharacter);
    }
  }
  if (roster.size === 0) return;

  const indentOf = (i: number) => blocks[i]?.indent ?? -1;
  const inCueBand = (i: number) =>
    indentOf(i) >= INDENT_RANGES.CHARACTER_MIN && indentOf(i) <= INDENT_RANGES.CHARACTER_MAX;
  const inSpeechBand = (i: number) =>
    indentOf(i) >= INDENT_RANGES.DIALOGUE_MIN && indentOf(i) <= INDENT_RANGES.DIALOGUE_MAX;

  for (let i = 0; i < elements.length - 1; i++) {
    const el = elements[i];
    if (el.type !== 'action') continue;
    if (!inCueBand(i)) continue;

    const established = roster.get(normalizeCueName(el.text ?? ''));
    if (!established) continue;

    // A cue is only a cue if a speech follows it.
    const next = elements[i + 1];
    if (!next || next.type !== 'action' || !inSpeechBand(i + 1)) continue;

    el.type = 'character';
    el.character = established;
    el.baseCharacter = established;

    for (let j = i + 1; j < elements.length; j++) {
      if (elements[j].type !== 'action' || !inSpeechBand(j)) break;
      elements[j].type = 'dialogue';
      elements[j].character = established;
    }
  }
}
```

- [ ] **Step 4: Verify**

Run: `bun test tests/parser.test.ts`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add src/parser/rescue.ts tests/parser.test.ts
git commit -m "kit: roster-based cue rescue pass"
```

---

## Task A4: Wire the pass into the pipeline

**Files:** Modify `src/parser/index.ts`

- [ ] **Step 1: Add the call**

In `src/parser/index.ts`, the classify loop currently ends and is followed by `// Step 4: Attach scene numbers`. Insert between them:

```ts
  // Step 3.5: Rescue cues the text heuristics rejected. Runs HERE because
  // `blocks` is still in scope and aligned 1:1 with `elements` —
  // ScreenplayElement carries no indent, and adding one just for this
  // would widen the type for every consumer.
  rescueCues(elements, blocks);
```

Add to the imports at the top:

```ts
import { rescueCues } from './rescue';
```

- [ ] **Step 2: Verify the whole suite**

Run: `bun test && bunx tsc --noEmit`
Expected: all pass, tsc silent.

- [ ] **Step 3: Acceptance — the reported bugs**

```bash
bun src/cli.ts "$HOME/Downloads/Man of Her Dreams 10.31.25.pdf" -o /tmp/mhd.epub --debug --json
```
Then inspect `/tmp/mhd.elements.json`: every `mike` (p35) and `ANNA’S MOM` / `ANNA’S DAD` (p70-71) must be `type: "character"`, and the paragraphs after them `type: "dialogue"`. Expected: 8 cues rescued, 9 speech paragraphs recovered.

- [ ] **Step 4: Regression — summary lines for BOTH reference scripts**

```bash
bun src/cli.ts "$HOME/Downloads/METEOR ANNE 11.10.25.pdf" -o /tmp/ma.epub --json
bun src/cli.ts "$HOME/Downloads/IntimacyParty_6.21.26.pdf" -o /tmp/ip.epub --json
```
Expected: `104p 147sc` and `94p 78sc` unchanged. Character counts may rise; if pages or scenes move, STOP and investigate — that means the rescue is firing somewhere it shouldn't.

- [ ] **Step 5: Fixture sweep + epubcheck**

```bash
for f in fixtures/*.pdf; do bun src/cli.ts "$f" -o "/tmp/$(basename "$f" .pdf).epub" --json; done
```
Expected: 5 convert `ok:true`; `pitchdeck` → `not-screenplay`; `scanned` → `scanned`. Then `epubcheck` each produced EPUB: no errors or warnings.

- [ ] **Step 6: Commit**

```bash
git add src/parser/index.ts
git commit -m "fix: rescue cues the text heuristics rejected"
```

---

## Task A5: Registry entry

**Files:** Modify `docs/formatting-options-log.md`

- [ ] **Step 1: Add the entry**

Insert immediately after the `### 9e.` block:

```markdown
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
- **Also:** `CHARACTER_NAME` now accepts curly apostrophes (`ANNA’S MOM`),
  matching how §8 already treats `(CONT'D)`.
- **Code:** `src/parser/rescue.ts`, `src/parser/index.ts` (step 3.5),
  `src/parser/classify.ts` (`normalizeCueName`, `CHARACTER_NAME`).
```

- [ ] **Step 2: Commit**

```bash
git add docs/formatting-options-log.md
git commit -m "docs: registry 9f — cue rescue"
```

> **MIRROR TO NIGHTWATCH:** Tasks A1–A4 change `src/parser/`. Per CLAUDE.md these must be mirrored to nightwatch's `parser/lines.ts`. Note it in the final report; do not attempt the mirror from this repo.

---

# PART B — Inline page markers

## Task B1: Marker attaches to the next block

**Files:** Modify `src/epub/html.ts`, `src/epub/css.ts`, `tests/epub.test.ts`

- [ ] **Step 1: Read the current behavior first**

Read `src/epub/html.ts` `renderBlocks` (from ~line 67). Note: `emit(s, kind)` either pushes to `blocks` or into an open `speech` group, and the `synopsis` case currently emits its own `<p class="page-marker">`. You are replacing that emit with a deferred injection.

- [ ] **Step 2: Write the failing test**

Add to `tests/epub.test.ts` (match the file's existing import/idiom for building tokens — read a neighbouring test first):

```ts
test('page marker rides inside the next block, not its own paragraph', () => {
  const tokens = [
    { type: 'synopsis', text: 'pg 47' },
    { type: 'action', text: 'Anne crosses the room.' },
  ] as any;
  const html = renderBlocksForTest(tokens);
  expect(html).not.toMatch(/<p class="page-marker">/);
  expect(html).toMatch(/<span[^>]*class="page-marker"[^>]*>47\.<\/span>/);
  expect(html).toMatch(/<p class="action"><span[^>]*page-marker/);
});

test('a trailing page marker with no following block is dropped', () => {
  const tokens = [
    { type: 'action', text: 'Anne crosses the room.' },
    { type: 'synopsis', text: 'pg 48' },
  ] as any;
  const html = renderBlocksForTest(tokens);
  expect(html).not.toMatch(/page-marker/);
});
```

If `renderBlocks` is not exported, export it (or test through `tokensToBody` and assert on the joined file HTML) — pick whichever matches the file's existing tests and say which you chose.

- [ ] **Step 3: Run to verify it fails**

Run: `bun test tests/epub.test.ts`
Expected: FAIL — output still contains `<p class="page-marker">`.

- [ ] **Step 4: Implement**

In `renderBlocks`, add alongside the other locals:

```ts
  // Page markers ride inside the NEXT block instead of taking a line of
  // their own. The span doubles as the EPUB3 pagebreak anchor.
  let pendingMarker: string | null = null;
```

Replace the `synopsis` case body with:

```ts
      case 'synopsis': {
        const pg = /^pg\s+(\S+)$/.exec(text.trim());
        if (pg) {
          const label = escapeXml(pg[1]);
          pendingMarker =
            `<span epub:type="pagebreak" role="doc-pagebreak" id="pg${label}"` +
            ` title="${label}" class="page-marker">${label}.</span>`;
        }
        break;
      }
```

And inject inside `emit`, before the existing body:

```ts
  const emit = (s: string, kind = 'other') => {
    if (pendingMarker) {
      const open = /^<(p|h[1-6]|div)\b[^>]*>/.exec(s);
      if (open) {
        s = s.slice(0, open[0].length) + pendingMarker + s.slice(open[0].length);
        pendingMarker = null;
      }
    }
    if (speech) speech.push({ kind, html: s });
    else blocks.push(s);
  };
```

A marker still pending when `renderBlocks` returns is simply dropped.

- [ ] **Step 5: Replace the CSS**

In `src/epub/css.ts`, replace the `p.page-marker` rule with:

```css
/* Original PDF page numbers — a marginal reference, out of the flow so
   they cost no line. Horizontal in %, per the CSS invariants. */
span.page-marker {
  float: right;
  font-size: 0.75em;
  color: #777777;
  margin-left: 1%;
}
```

- [ ] **Step 6: Verify**

Run: `bun test && bunx tsc --noEmit`
Expected: all pass.

- [ ] **Step 7: Commit**

```bash
git add src/epub/html.ts src/epub/css.ts tests/epub.test.ts
git commit -m "feat: page markers ride inline instead of taking a line"
```

---

## Task B2: `page-list` nav

**Files:** Modify `src/epub/html.ts`, `src/epub/build.ts`, `tests/epub.test.ts`

- [ ] **Step 1: Read how sections become files**

Read `tokensToBody` in `src/epub/html.ts` (from line 191) — specifically where `sections` are assigned to `body.files` with ids. The nav needs, for each marker, its label and the id of the file it landed in. Collect that where the assignment happens; do not guess the structure.

- [ ] **Step 2: Extend the BookBody contract**

Add to the `BookBody` type (find it — likely `src/epub/types.ts` or the top of `html.ts`):

```ts
  /** Page markers, in document order, for the EPUB3 page-list nav. */
  pageList: { label: string; href: string }[];
```

`href` is `text/<fileId>.xhtml#pg<label>` — the same id `renderBlocks` stamps on the span in B1.

- [ ] **Step 3: Write the failing test**

```ts
test('page-list nav lists every marker and resolves to real ids', () => {
  const body = tokensToBody([
    { type: 'scene_heading', text: 'INT. ROOM - DAY' },
    { type: 'synopsis', text: 'pg 12' },
    { type: 'action', text: 'She waits.' },
  ] as any, { format: { ...DEFAULT_FORMAT_OPTIONS, showPageMarkers: true } });
  expect(body.pageList).toHaveLength(1);
  expect(body.pageList[0].label).toBe('12');
  const file = body.files.find((f) => body.pageList[0].href.includes(f.id));
  expect(file).toBeTruthy();
  expect(file!.content).toContain('id="pg12"');
});

test('no markers means no page-list entries', () => {
  const body = tokensToBody([
    { type: 'scene_heading', text: 'INT. ROOM - DAY' },
    { type: 'action', text: 'She waits.' },
  ] as any, {});
  expect(body.pageList).toHaveLength(0);
});
```

Adapt the token/option shape to whatever the neighbouring tests use — read one first.

- [ ] **Step 4: Run to verify it fails, then implement**

Run: `bun test tests/epub.test.ts` — expect FAIL on `pageList` being undefined.

Populate `pageList` in `tokensToBody` while assigning sections to files, then in `src/epub/build.ts` add a third nav after the `landmarks` nav, emitted **only when `body.pageList.length > 0`**:

```ts
${body.pageList.length ? `<nav epub:type="page-list" hidden="hidden">
  <ol>
${body.pageList.map((p) => `    <li><a href="${p.href}">${escapeXml(p.label)}</a></li>`).join('\n')}
  </ol>
</nav>` : ''}
```

- [ ] **Step 5: Verify, including epubcheck**

```bash
bun test && bunx tsc --noEmit
bun src/cli.ts "$HOME/Downloads/METEOR ANNE 11.10.25.pdf" -o /tmp/pm.epub --options <(echo '{"showPageMarkers":true}') --json
epubcheck /tmp/pm.epub
```
Expected: `No errors or warnings detected.` **This is the step most likely to fail** — epubcheck validates both the `pagebreak` element and that every `page-list` href resolves. If it complains that a `pagebreak` may not contain text, move the visible label out of the anchor span into a sibling span and keep the anchor empty; report the change.

- [ ] **Step 6: Commit**

```bash
git add src/epub/html.ts src/epub/build.ts tests/epub.test.ts
git commit -m "feat: EPUB3 page-list nav for original pagination"
```

---

## Task B3: MOBI parity + registry

**Files:** Modify `src/mobi/html.ts`, `docs/formatting-options-log.md`

- [ ] **Step 1: Mirror the inline marker**

`src/mobi/html.ts` has the same `synopsis` case (~line 104). Apply B1's deferred-injection approach so the two formats agree. MOBI 6 has no EPUB3 semantics — emit a plain `<span class="page-marker">47.</span>` with **no** `epub:type`, `role`, or `id`.

- [ ] **Step 2: Verify**

Run: `bun test && bunx tsc --noEmit`
Expected: all pass.

- [ ] **Step 3: Update registry §13a**

In `docs/formatting-options-log.md`, replace the `- **Code:**` line of §13a and append:

```markdown
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
```

- [ ] **Step 4: Commit**

```bash
git add src/mobi/html.ts docs/formatting-options-log.md
git commit -m "feat: MOBI page-marker parity; registry 13a rendering note"
```

> **Owner device gate:** markers are only worth shipping if they read well on the real Kindle. Sideload the AZW3 and confirm the number sits out of the way. If `float` is ignored on that firmware, the fallback is CSS-only: revert `span.page-marker` to a block with `margin: 0` and a tight `line-height`.

---

# PART C — Result-view trim

## Task C1: Smaller brass and outline buttons

**Files:** Modify `app/Sources/ScreepubApp/Theme.swift`

- [ ] **Step 1: Shrink both styles**

In `BradButtonStyle.makeBody`, change `.font(Theme.courier(13, .bold))` → `.font(Theme.courier(12, .bold))` and `.padding(.vertical, 9)` → `.padding(.vertical, 6)`. Leave kerning, corner radius, fill, and the pressed animation alone.

Apply the identical two changes to `OutlineButtonStyle` so primary and secondary buttons keep matching heights.

- [ ] **Step 2: Verify it builds**

Run: `cd app && swift build -c release`
Expected: `Build complete!`

- [ ] **Step 3: Commit**

```bash
git add app/Sources/ScreepubApp/Theme.swift
git commit -m "app: smaller brass and outline buttons"
```

---

## Task C2: Drop the menu, rename the labels

**Files:** Modify `app/Sources/ScreepubApp/ContentView.swift`, `app/Sources/ScreepubApp/ReaderRail.swift`

- [ ] **Step 1: Replace the `MORE WAYS…` menu with plain buttons**

In `ContentView.swift`, delete the entire `Menu { … } label: { Text("MORE WAYS…") … }` block (including its `.menuStyle`, `.font`, `.foregroundStyle`, `.frame` modifiers) and put in its place:

```swift
            Button(SendToKindle.appIsInstalled ? "SEND TO KINDLE APP" : "SEND TO KINDLE — WEB") {
                SendToKindle.sendViaAmazon(epub)
            }
            .buttonStyle(OutlineButtonStyle())

            // Only Apple Mail actually attaches the file: with a third-party
            // default client macOS degrades the compose to a mailto: URL,
            // which carries no attachment (RFC 6068) and still reports
            // success. Offer the route only where it works.
            if SendToKindle.defaultMailClientIsAppleMail {
                Button("EMAIL TO KINDLE…") { emailToKindle(epub, title: title) }
                    .buttonStyle(OutlineButtonStyle())
            }

            // reMarkable uploads over its USB web interface rather than
            // being copied to, so it never holds the primary slot.
            if remarkableUp {
                Button("SEND TO REMARKABLE — USB") { sendToRemarkable(epub: epub) }
                    .buttonStyle(OutlineButtonStyle())
            }
```

- [ ] **Step 2: Rename the two labels**

In `ContentView.swift`: `Button("READ SCRIPT")` → `Button("PREVIEW SCRIPT")`, and `Button("SAVE A COPY…")` → `Button("SAVE")`.

In `ReaderRail.swift`: `Button("Save a copy…")` → `Button("Save")` (sentence case is that panel's convention — do not shout).

- [ ] **Step 3: Fix the now-false comments**

`saveACopyStyle`'s doc comment in `ContentView.swift` refers to routes living under "More ways…", which no longer exists. Rewrite that sentence, and update the 2026-07-26 note about two brass buttons so it names the current labels (`PREVIEW SCRIPT` and the primary route out). Every claim must be true of the tree — this change has a history of comments outliving the code.

- [ ] **Step 4: Verify**

Run: `cd app && swift build -c release && swift run -c release kit-check`
Expected: `Build complete!`, 55 ok, exit 0.

- [ ] **Step 5: Rebuild and look at it**

```bash
app/build-app.sh && open app/dist/Screepub.app
```
Convert a PDF and confirm: three buttons (`PREVIEW SCRIPT`, `SAVE`, `SEND TO KINDLE — WEB`), no menu, labels not clipped at the window's minimum width, brass buttons visibly shorter. Screen access is granted, so take a screenshot and check rather than assuming.

- [ ] **Step 6: Commit**

```bash
git add app/Sources/ScreepubApp/ContentView.swift app/Sources/ScreepubApp/ReaderRail.swift
git commit -m "app: drop the overflow menu; PREVIEW SCRIPT / SAVE"
```

---

## Task C3: Final verification

- [ ] **Step 1: Everything**

```bash
bun test && bunx tsc --noEmit
cd app && swift build -c release && swift run -c release kit-check
```
Expected: 220+ pass / 0 fail, tsc silent, 55 kit-checks ok.

- [ ] **Step 2: Rebuild the bundle (it embeds the engine)**

```bash
app/build-app.sh
```
Expected: `built: …/app/dist/Screepub.app`.

- [ ] **Step 3: Commit anything outstanding**

```bash
git add -A && git commit -m "fix: issues found in final verification"
```

---

## Self-Review

- **Spec coverage:** A1 guard normalization → Task A1; A2 normalization helper → A2; A1 rescue pass → A3 + A4; registry → A5. B1 inline marker → B1; B2 pagebreak semantics → B1 (same span); B3 page-list → B2; B4 MOBI → B3. C1 button metrics → C1; C2 drop menu → C2; C3 labels → C2; C4 comment upkeep → C2 step 3. All covered.
- **Placeholder scan:** none. The two places that say "read this first" (B1 step 1, B2 step 1) are deliberate — `renderBlocks`' emit plumbing and `tokensToBody`'s file assignment must be read in situ rather than guessed, and each states the exact contract required.
- **Type consistency:** `normalizeCueName` (A2) is used identically in A3. `rescueCues(elements, blocks)` matches between A3 and A4. `pageList: {label, href}[]` matches between B2 steps 2, 3 and 4. The span id `pg<label>` is stamped in B1 and referenced by the href in B2. `INDENT_RANGES.CHARACTER_MIN/MAX` (35/50) and `DIALOGUE_MIN/MAX` (25/35) are the real values from types.ts.
- **Known risk:** B2's epubcheck step is the likeliest failure, and it carries its own remediation. A4's regression check is the tripwire for the rescue firing too broadly — pages/scenes moving means stop, not proceed.
