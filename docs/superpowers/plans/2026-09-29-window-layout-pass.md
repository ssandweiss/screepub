# Window layout pass Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** On a wide window the page fills the screen, the brads sit near the window's left edge, the margins are thin, Read gives the scene index a slot of its own, and Settings gives the preview about twice the room with each section in a box.

**Architecture:** Almost all CSS. The frame's four geometry tokens move from percentages of a capped page to pixels of the window (`brand/tokens.css`, copied into `desktop/ui/tokens.css` by `tools/build-desktop-tokens.ts`), and `style.css` moves the side margins from the sheet to the page so the sheet can be one capped, centred block. Each surface's rules in `surfaces.css` then fit that block. One small markup change: `tune.js` wraps the Settings foot in one element so it can be one box. One new colour token, `panel`.

**Tech Stack:** Plain CSS and ES modules in `desktop/ui/` (no build step), Bun + `bun:test` static tests that read the stylesheets rule by rule, the brand token generator, headless checks in the built-in browser pane through a scratch harness.

**Spec:** `docs/superpowers/specs/2026-09-29-window-layout-pass-design.md` (approved 2026-09-29).

**Working rules for this repo** (from `CLAUDE.md` and the owner):
- Run `bun test` from the worktree root, never a subfolder.
- No em dash in any text a person reads. Use colons or periods. New comments avoid them too.
- Never let a real screenplay title, author or character name into anything. The live check uses `tests/fixtures/field-station.pdf` only.
- Never touch the owner's real app settings, library or Calibre folder. The harness in Task 7 points `SCREEPUB_CONFIG_DIR`, `SCREEPUB_LIBRARY` and `CALIBRE_CONFIG_DIRECTORY` at scratch folders.
- Commit per task. Do not merge or push; the owner approves that.
- Each `git` command runs on its own (no `&&` chains with git in them): this session's worktree guard refuses compound git commands.

---

## File map

| File | What changes |
| --- | --- |
| `brand/tokens.css` | geometry tokens to pixels, `--block-max` replaces `--page-max`; `--panel` colour in both modes |
| `brand/tokens.json` | new `panel` colour |
| `desktop/ui/tokens.css` | regenerated, never hand-edited |
| `desktop/ui/style.css` | `.page` pads, `.sheet` is the capped centred block, `.rail` spans the window, foot and fault at `right: 0`, narrow rules move to `.page` |
| `desktop/ui/surfaces.css` | Convert column; Read's two-column reader; Settings split, preview height, section boxes |
| `desktop/ui/tune.js` | the foot wrapped in `.tune-foot` |
| `desktop/ui/read.js` | one comment that still describes the drawer |
| `brand/components/page-frame.html`, `brand/components/_preview.css` | draw the new frame |
| `tests/desktop-layout.test.ts` | NEW: every rule this pass adds |
| `tests/desktop-tokens.test.ts` | token list names `--block-max` |
| `tests/desktop-ui.test.ts` | the drawer-only scene-index test goes, the fault-line alignment test is rewritten |

---

### Task 1: The frame

**Files:**
- Create: `tests/desktop-layout.test.ts`
- Modify: `tests/desktop-tokens.test.ts:55`
- Modify: `tests/desktop-ui.test.ts:7800-7807` (the "stays aligned with the foot below 720px" test)
- Modify: `brand/tokens.css:71-74`
- Modify: `desktop/ui/style.css` (body comment, `.page`, `.sheet`, `.rail`, `.rev-foot`, `.engine-fault`, the 720px block)
- Regenerate: `desktop/ui/tokens.css`

- [ ] **Step 1: Write the failing tests**

Create `tests/desktop-layout.test.ts`:

```ts
// The window layout pass (docs/superpowers/specs/2026-09-29-window-layout-pass-design.md):
// the page fills the window, the brads sit near its left edge, Read gives
// the scene index a slot of its own, and Settings gives the preview the
// room. These read the stylesheets rule by rule, with comments stripped, so
// a selector or a value named in a comment can never satisfy a test.
import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const REPO = join(import.meta.dir, '..');
const UI = join(REPO, 'desktop', 'ui');

function css(path: string): string {
  return readFileSync(path, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
}
const windowCss = (name: string) => css(join(UI, name));

/** The first declaration block for a selector. Base rules come before the
 *  @media blocks in these files, so the first one is the base rule. */
function ruleBlock(sheet: string, selector: string): string {
  const at = sheet.indexOf(`${selector} {`);
  expect(at, `${selector} is missing`).toBeGreaterThan(-1);
  return sheet.slice(at, sheet.indexOf('}', at) + 1);
}

/** Every @media block for one query, joined, braces balanced. */
function mediaBlocks(sheet: string, query: string): string {
  const out: string[] = [];
  const head = `@media ${query} {`;
  let at = sheet.indexOf(head);
  while (at !== -1) {
    let i = sheet.indexOf('{', at);
    const start = i;
    let depth = 0;
    for (; i < sheet.length; i++) {
      if (sheet[i] === '{') depth++;
      else if (sheet[i] === '}' && --depth === 0) break;
    }
    out.push(sheet.slice(start, i + 1));
    at = sheet.indexOf(head, i);
  }
  expect(out.length, `no ${head} block`).toBeGreaterThan(0);
  return out.join('\n');
}

describe('the page fills the window (frame B)', () => {
  const brand = css(join(REPO, 'brand', 'tokens.css'));
  const style = windowCss('style.css');

  test('the frame is measured in pixels from the window, not as shares of a capped page', () => {
    expect(brand).toContain('--block-max: 1180px;');
    expect(brand).toContain('--binding-margin: 100px;');
    expect(brand).toContain('--page-right: 48px;');
    expect(brand).toContain('--hole-center: 44px;');
    expect(brand).not.toContain('--page-max');
  });

  test('nothing in the window still names the old page cap', () => {
    for (const name of ['style.css', 'surfaces.css', 'tokens.css']) {
      expect(`${name}: ${windowCss(name).includes('--page-max')}`).toBe(`${name}: false`);
    }
  });

  test('the page is not capped: its sides are the binding and the right margin', () => {
    const page = ruleBlock(style, '.page');
    expect(page).not.toContain('max-width');
    expect(page).toContain('padding: 0 var(--page-right) 0 var(--binding-margin)');
  });

  test('the sheet is one block, capped and centred, with no side padding of its own', () => {
    const sheet = ruleBlock(style, '.sheet');
    expect(sheet).toContain('max-width: var(--block-max)');
    expect(sheet).toContain('margin: 0 auto');
    expect(sheet).toContain('padding: var(--space-7) 0 var(--space-10)');
  });

  test('the brads are placed from the window’s left edge', () => {
    const rail = ruleBlock(style, '.rail');
    expect(rail).not.toContain('max-width');
    expect(rail).not.toContain('translateX');
    expect(rail).toMatch(/left:\s*0;/);
    expect(ruleBlock(style, '.rail svg')).toContain('left: var(--hole-center)');
  });

  test('the foot and the dead-engine line sit on the block’s right edge', () => {
    expect(ruleBlock(style, '.rev-foot')).toMatch(/right:\s*0;/);
    expect(ruleBlock(style, '.engine-fault')).toMatch(/right:\s*0;/);
  });

  test('a narrow window narrows the binding on the page, as before', () => {
    const narrow = mediaBlocks(style, '(max-width: 720px)');
    expect(narrow).toContain('.page { padding-left: 11%; padding-right: var(--space-4); }');
    expect(narrow).not.toContain('.sheet {');
  });
});
```

In `tests/desktop-tokens.test.ts`, line 55, change `'--page-max'` to `'--block-max'`:

```ts
      '--block-max', '--binding-margin', '--page-right', '--hole-center',
```

In `tests/desktop-ui.test.ts`, replace the test that starts `test('it stays aligned with the foot below 720px, like the foot itself', () => {` (inside `describe('the dead-engine line does not crowd the update label'`) with:

```ts
  test('it stays aligned with the foot at every width, like the foot itself', () => {
    // Both sit on the sheet's right edge (right: 0) since the layout pass
    // moved the side margins from the sheet to the page, so neither needs a
    // narrow-window override any more. An override on one alone would pull
    // the two apart.
    const css = read('style.css');
    expect(css.match(/\.engine-fault\s*\{[^}]*\}/)?.[0] ?? '').toMatch(/right:\s*0;/);
    expect(css.match(/\.rev-foot\s*\{[^}]*\}/)?.[0] ?? '').toMatch(/right:\s*0;/);
    expect(css).not.toMatch(/\.engine-fault\s*\{\s*right:\s*var\(--space-4\)/);
  });
```

- [ ] **Step 2: Run the tests to see them fail**

Run: `bun test tests/desktop-layout.test.ts tests/desktop-tokens.test.ts tests/desktop-ui.test.ts`
Expected: FAIL. `desktop-layout` fails on `--block-max: 1180px;`, the `.page` padding and the rest; `desktop-tokens` fails with "tokens.css is missing --block-max"; the rewritten `desktop-ui` test fails on `right: 0`.

- [ ] **Step 3: Change the tokens**

In `brand/tokens.css`, replace:

```css
  --page-max: 1000px;
  --binding-margin: 17.6%;
  --page-right: 11.8%;
  --hole-center: 5.9%;
```

with:

```css
  /* The frame, in pixels of the WINDOW (layout pass, 2026-09-29). They were
     percentages of a page capped at 1000px and centred, which pulled the
     brads toward the middle of a wide window. Now the brads sit 44px from
     the window's left edge, content starts at 100px, the right margin is
     48px, and the content between is one block capped at 1180px. */
  --block-max: 1180px;
  --binding-margin: 100px;
  --page-right: 48px;
  --hole-center: 44px;
```

Regenerate the window's copy:

Run: `bun tools/build-desktop-tokens.ts`
Expected: `wrote desktop/ui/tokens.css`

- [ ] **Step 4: Move the frame in `desktop/ui/style.css`**

Replace the body comment:

```css
  /* The paper, not the desk. The sheet's own width is still capped at
   * --page-max so the measure, the binding margin and the brads keep the
   * proportions they were drawn at — but the colour behind it runs to the
   * window edge, because a desk wide enough to swallow the page reads as a
   * background that failed to load rather than as furniture. */
```

with:

```css
  /* The paper, edge to edge. Since the layout pass (2026-09-29) nothing
   * caps the page's width: the content block inside it is capped instead
   * (--block-max), so a wide window gets thin margins rather than a narrow
   * page floating in the middle. */
```

Replace the `.page` rule and the `.sheet` rule (and the comment between them) with:

```css
.page {
  display: flex;
  flex-direction: column;
  /* The page's two side margins: the binding on the left, measured from the
   * window's edge where the brads are, and a thin margin on the right. */
  padding: 0 var(--page-right) 0 var(--binding-margin);
  /* 100vh, not 100%: #app is an auto-height block, so a percentage here
   * resolves against nothing and the paper stops where the text does. */
  min-height: 100vh;
  box-sizing: border-box;
}
/* One block between the margins, capped and centred, so the extra room on a
 * big display splits evenly on both sides instead of stretching every line.
 * flex: 1, not min-height: 100vh: the sheet runs to the bottom of the window
 * and no further, so the stamp at its foot is on screen. */
.sheet {
  position: relative;
  flex: 1;
  width: 100%;
  max-width: var(--block-max);
  margin: 0 auto;
  background: var(--paper);
  box-sizing: border-box;
  padding: var(--space-7) 0 var(--space-10);
}
```

Replace the `.rail` rule:

```css
.rail {
  position: fixed; top: 0; bottom: 0; left: 50%;
  width: 100%; max-width: var(--page-max);
  transform: translateX(-50%); pointer-events: none;
}
```

with:

```css
.rail {
  position: fixed; top: 0; bottom: 0; left: 0; right: 0;
  pointer-events: none;
}
```

In the `.rev-foot` rule, change `right: var(--page-right);` to `right: 0;`. In the `.engine-fault` rule, change `right: var(--page-right);` to `right: 0;`.

Replace the 720px block:

```css
@media (max-width: 720px) {
  .sheet { padding-left: 11%; padding-right: var(--space-4); }
  .rail svg { width: 20px; height: 20px; }
  .tabs { gap: var(--space-3); }
  .rev-foot { right: var(--space-4); }
  .engine-fault { right: var(--space-4); }
}
```

with:

```css
@media (max-width: 720px) {
  .page { padding-left: 11%; padding-right: var(--space-4); }
  .rail svg { width: 20px; height: 20px; }
  .tabs { gap: var(--space-3); }
}
```

- [ ] **Step 5: Run the tests to see them pass**

Run: `bun test tests/desktop-layout.test.ts tests/desktop-tokens.test.ts tests/desktop-ui.test.ts tests/desktop-shell.test.ts tests/brand-tokens.test.ts`
Expected: PASS, 0 fail.

- [ ] **Step 6: Commit**

```bash
git add brand/tokens.css desktop/ui/tokens.css desktop/ui/style.css tests/desktop-layout.test.ts tests/desktop-tokens.test.ts tests/desktop-ui.test.ts
```

```bash
git commit -m "The page fills the window: brads 44px from its edge, content one block up to 1180 wide" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: The brand draws the same frame

**Files:**
- Modify: `brand/components/page-frame.html` (the `<style>` block's `.rail` rule and its comment, the caption)
- Modify: `brand/components/_preview.css` (the `.page` rule and its comment)
- Test: `tests/desktop-layout.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `tests/desktop-layout.test.ts`:

```ts
describe('the brand draws the same frame the window uses', () => {
  const frame = readFileSync(join(REPO, 'brand', 'components', 'page-frame.html'), 'utf8');
  const preview = css(join(REPO, 'brand', 'components', '_preview.css'));

  test('the frame card’s rail spans the window and is not centred on a capped page', () => {
    expect(frame).not.toContain('--page-max');
    expect(frame).not.toContain('translateX(-50%)');
    expect(frame).toMatch(/\.rail \{\s*position: fixed; top: 0; bottom: 0; left: 0; right: 0;/);
  });

  test('the component previews keep a page-sized card made of the new tokens', () => {
    expect(preview).not.toContain('--page-max');
    expect(ruleBlock(preview, '.page'))
      .toContain('max-width: calc(var(--block-max) + var(--binding-margin) + var(--page-right))');
  });
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `bun test tests/desktop-layout.test.ts`
Expected: FAIL on `--page-max` still present in both files.

- [ ] **Step 3: Update the frame card**

In `brand/components/page-frame.html`, replace the comment and rule:

```css
  /* .rail matches .page's own centering: left 50% + translateX(-50%) of
     the rail's OWN (post-max-width) box centers it exactly the way
     .page's margin: 0 auto does, so both columns share one x-axis. The
     -50%/-50% transform on .rail svg below still resolves against the
     svg's own box, not the rail's, so nesting a transform on the parent
     does not change how the child's percentage transform resolves. */
  .rail {
    position: fixed; top: 0; bottom: 0; left: 50%;
    width: 100%; max-width: var(--page-max);
    transform: translateX(-50%); pointer-events: none;
  }
```

with:

```css
  /* The rail spans the window, so the brads are placed from the window's
     own left edge (--hole-center), the way the window places them since
     the layout pass (2026-09-29). */
  .rail {
    position: fixed; top: 0; bottom: 0; left: 0; right: 0;
    pointer-events: none;
  }
```

In the same file, replace the caption paragraph's first sentence:

```html
    Holes sit at 30.7%, 50% and 69.3% of viewport height: the true proportions
    of a three-hole punch on an 11 inch page. Brads fill the first and third.
```

with:

```html
    Holes sit at 30.7%, 50% and 69.3% of viewport height: the true proportions
    of a three-hole punch on an 11 inch page. Brads fill the first and third,
    44px in from the window's left edge at every width, the way the holes sit
    about half an inch in on a letter page.
```

- [ ] **Step 4: Update the preview card**

In `brand/components/_preview.css`, replace the comment and rule:

```css
/* .page owns the width cap. .sheet's own padding is a PERCENTAGE, and
   percentage padding resolves against the containing block's width, not
   the padded element's own width. When .sheet capped its own max-width,
   that percentage still resolved against .sheet's containing block (body,
   i.e. the viewport), not against the capped 1000px, so binding-margin
   over-computed above 1000px of viewport width. Wrapping .sheet in .page
   makes .page's capped width the containing block .sheet's padding
   resolves against. */
.page { max-width: var(--page-max); margin: 0 auto; }
```

with:

```css
/* The component cards show a sheet of paper on the desk, so they keep a
   page-sized card: the window's content block plus its two margins. The
   margins are pixels since the layout pass (2026-09-29), so the
   percentage-padding problem this wrapper was first written for is gone;
   .page stays so every card keeps the same markup. */
.page { max-width: calc(var(--block-max) + var(--binding-margin) + var(--page-right)); margin: 0 auto; }
```

- [ ] **Step 5: Run the tests to see them pass**

Run: `bun test tests/desktop-layout.test.ts tests/brand-components.test.ts tests/brand-tokens.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add brand/components/page-frame.html brand/components/_preview.css tests/desktop-layout.test.ts
```

```bash
git commit -m "Brand: the frame card and the previews draw the window's new frame" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Convert keeps its own column

**Files:**
- Modify: `desktop/ui/surfaces.css` (after the comment that opens the Convert section, near line 151)
- Test: `tests/desktop-layout.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `tests/desktop-layout.test.ts`:

```ts
describe('Convert keeps a column of its own inside the wide block', () => {
  test('the drop area, the progress, the result and a refusal stop at 820 wide, centred', () => {
    const rule = ruleBlock(windowCss('surfaces.css'), '#surface-convert');
    expect(rule).toContain('max-width: 820px');
    expect(rule).toContain('margin-left: auto');
    expect(rule).toContain('margin-right: auto');
  });
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `bun test tests/desktop-layout.test.ts`
Expected: FAIL with "#surface-convert is missing".

- [ ] **Step 3: Add the rule**

In `desktop/ui/surfaces.css`, directly after the comment that reads `/* Convert — brand/components/drop-well.html, progress.html,` ... `result-card.html, failure-notice.html. */`, add:

```css
/* The page's block is up to 1180 wide since the layout pass (2026-09-29).
 * A drop area that wide is a very long dashed box, so everything Convert
 * shows (waiting, converting, the result, a refusal) keeps its own column. */
#surface-convert { max-width: 820px; margin-left: auto; margin-right: auto; }
```

- [ ] **Step 4: Run it to see it pass**

Run: `bun test tests/desktop-layout.test.ts tests/desktop-ui.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add desktop/ui/surfaces.css tests/desktop-layout.test.ts
```

```bash
git commit -m "Convert keeps an 820-wide column inside the wide block" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Read gives the scene index a slot

**Files:**
- Modify: `desktop/ui/surfaces.css` (the `.reader` rule and its comment near line 350, `.script-stage` near line 385, `.scene-rail` and `.reader.index-open .scene-rail` near lines 389-443, the 720px block near line 478)
- Modify: `desktop/ui/read.js` (the comment above `setIndexOpen(true)`)
- Modify: `tests/desktop-ui.test.ts` (the `describe('the scene index is a drawer in the binding margin'` block near line 7640)
- Test: `tests/desktop-layout.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to `tests/desktop-layout.test.ts`:

```ts
describe('Read gives the scene index a slot of its own', () => {
  const surfaces = windowCss('surfaces.css');

  test('the reader is two columns: the index slot, then the script at today’s width', () => {
    const reader = ruleBlock(surfaces, '.reader');
    expect(reader).toContain('display: grid');
    expect(reader).toContain('grid-template-columns: 218px minmax(0, 706px)');
  });

  test('the index keeps its slot open or shut, so the script never moves', () => {
    const rail = ruleBlock(surfaces, '.scene-rail');
    expect(rail).toContain('grid-column: 1');
    expect(rail).not.toContain('position: absolute');
    expect(rail).not.toContain('width: min(');
    expect(ruleBlock(surfaces, '.script-stage')).toContain('grid-column: 2');
  });

  test('open, it is simply shown: no slide out of the margin, no shadow over the page', () => {
    const open = ruleBlock(surfaces, '.reader.index-open .scene-rail');
    expect(open).toContain('opacity: 1');
    expect(open).toContain('visibility: visible');
    expect(open).not.toContain('translateX(-100%)');
    expect(open).not.toContain('box-shadow');
  });

  test('under 900 wide the index goes above the script, and a shut one takes no room', () => {
    const narrow = mediaBlocks(surfaces, '(max-width: 900px)');
    expect(narrow).toContain('.reader { grid-template-columns: minmax(0, 1fr); }');
    expect(narrow).toContain('.reader:not(.index-open) .scene-rail { display: none; }');
    expect(narrow).toContain('.script-stage { grid-column: 1; grid-row: 2; }');
  });
});
```

In `tests/desktop-ui.test.ts`, rename the describe `'the scene index is a drawer in the binding margin'` to `'the scene index'` and replace its opening comment (the eight comment lines under the describe line) with:

```ts
  // It sat to the RIGHT of the script, then became a drawer over the
  // binding margin (interface-pass design, decision 16). Since the layout
  // pass (2026-09-29) the margin is 100px and the index 218, so it has a
  // slot of its own beside the script instead: see
  // tests/desktop-layout.test.ts for the slot. What these keep is what the
  // index needs in any layout.
```

and delete the whole test `test('the panel is capped so it cannot hang off the window', () => { ... });` (its `width: min(` cap existed only for the drawer).

- [ ] **Step 2: Run the tests to see them fail**

Run: `bun test tests/desktop-layout.test.ts tests/desktop-ui.test.ts`
Expected: FAIL in `desktop-layout` on `grid-template-columns: 218px minmax(0, 706px)` and the rest of the new describe; `desktop-ui` passes.

- [ ] **Step 3: Rewrite the reader rules**

In `desktop/ui/surfaces.css`, replace the comment and rule that start `/* One column, not two. The index used to take a grid column from the script,` and end with the `.reader { ... }` rule's closing brace, with:

```css
/* Two columns: a slot for the scene index, then the script. The script keeps
 * the width its frame had at the old 1000px page cap (706px), so its lines
 * wrap where they always have, and the index opens into its own slot, so
 * the script never moves and is never covered. Until the layout pass
 * (2026-09-29) the index was a drawer over the binding margin; the margin
 * is 100px now and the index is 218, so it has a column instead. Extra room
 * in the block falls to the script's right. Positioned, because read.js
 * measures the index's buttons against it. */
.reader {
  position: relative;
  display: grid;
  grid-template-columns: 218px minmax(0, 706px);
  column-gap: var(--space-7);
  align-items: start;
}
```

Replace `.script-stage { display: block; border-radius: var(--radius-well); }` with:

```css
.script-stage { display: block; border-radius: var(--radius-well); grid-column: 2; grid-row: 1; }
```

Replace the whole `.scene-rail { ... }` rule, the comment after it, and the `.reader.index-open .scene-rail { ... }` rule with:

```css
.scene-rail {
  /* Positioned so it is the offsetParent of its own buttons: read.js keeps
   * the marked scene inside this strip by its offsetTop, and an unpositioned
   * rail would hand it an offset measured from the page instead. */
  position: relative;
  grid-column: 1;
  grid-row: 1;
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  align-items: stretch;
  gap: 1px;
  max-height: 68vh;
  overflow-y: auto;
  background: var(--paper);
  /* The hairline reads as the edge of the slot the index sits in. */
  border-right: 1px solid var(--hole);
  /* The same room at the top as at the bottom: with none, the count sat
   * hard against the panel's top edge (QA, 0.7.3). The bottom's is kept
   * when scrolled to the end, in WebKit as in Chrome (measured 2026-09-28
   * in a WKWebView: 13px of padding left 13px below the last entry). */
  padding: var(--space-3) var(--space-4) var(--space-3) var(--space-3);
  /* Shut. Opacity is what hides it and visibility takes it out of the tab
   * order. It keeps its column, so the script beside it does not move; the
   * small translate is only the motion. */
  transform: translateX(calc(-1 * var(--space-3)));
  opacity: 0;
  visibility: hidden;
  transition: transform var(--motion-state) var(--ease),
              opacity var(--motion-state) var(--ease),
              visibility 0s linear var(--motion-state);
}
.reader.index-open .scene-rail {
  transform: none;
  opacity: 1;
  visibility: visible;
  transition: transform var(--motion-state) var(--ease),
              opacity var(--motion-state) var(--ease),
              visibility 0s;
}
```

Replace the narrow block:

```css
/* Narrow: the rail goes above the page rather than squeezing it. */
@media (max-width: 720px) {
  .reader { grid-template-columns: 1fr; }
  .scene-rail {
    max-height: 6.5rem; flex-direction: row; flex-wrap: wrap;
    gap: var(--space-3); border-left: none; padding-left: 0;
  }
  .scene-link { display: inline-block; }
  .script-frame { height: 58vh; }
}
```

with:

```css
/* Under 900 the slot and the script no longer both fit, so the index goes
 * above the script as a short strip and the script takes the block: the
 * same line Settings folds its two columns at. A shut index takes no room
 * here, because a strip above the script cannot move it sideways. */
@media (max-width: 900px) {
  .reader { grid-template-columns: minmax(0, 1fr); }
  .scene-rail {
    grid-column: 1; grid-row: 1;
    max-height: 6.5rem; flex-direction: row; flex-wrap: wrap;
    gap: var(--space-3); border-right: none; padding-left: 0;
    margin-bottom: var(--space-4);
  }
  .reader:not(.index-open) .scene-rail { display: none; }
  .script-stage { grid-column: 1; grid-row: 2; }
  .scene-link { display: inline-block; }
}
@media (max-width: 720px) {
  .script-frame { height: 58vh; }
}
```

- [ ] **Step 4: Update the comment in `desktop/ui/read.js`**

Replace:

```js
  // Open by default: the index is what the maintainer asked to see on the
  // left, and the drawer costs the script nothing either way — it parks in
  // the binding margin rather than taking a column from the page.
```

with:

```js
  // Open by default: the index is what the maintainer asked to see on the
  // left, and it costs the script nothing either way: it has its own slot
  // beside the script (surfaces.css, .reader), so opening it moves nothing.
```

- [ ] **Step 5: Run the tests to see them pass**

Run: `bun test tests/desktop-layout.test.ts tests/desktop-ui.test.ts`
Expected: PASS. The kept scene-index tests still hold: the rail is positioned (`relative`), its padding is `var(--space-3)` top and bottom, and shut it is `opacity: 0` and `visibility: hidden`.

- [ ] **Step 6: Commit**

```bash
git add desktop/ui/surfaces.css desktop/ui/read.js tests/desktop-layout.test.ts tests/desktop-ui.test.ts
```

```bash
git commit -m "Read: the scene index gets a slot beside the script, which keeps its width" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Settings gives the preview the room

**Files:**
- Modify: `desktop/ui/surfaces.css` (the comment above `.tune-split`, `.tune-split`, `.tune-preview-frame`, near lines 528-562)
- Test: `tests/desktop-layout.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to `tests/desktop-layout.test.ts`:

```ts
describe('Settings gives the preview the room', () => {
  const surfaces = windowCss('surfaces.css');

  test('the settings take a fixed 420 and the preview everything else', () => {
    expect(ruleBlock(surfaces, '.tune-split')).toContain('grid-template-columns: 420px minmax(0, 1fr)');
  });

  test('the preview stays pinned and runs the window’s height', () => {
    expect(ruleBlock(surfaces, '.tune-preview')).toContain('position: sticky');
    const frame = ruleBlock(surfaces, '.tune-preview-frame');
    expect(frame).toContain('height: calc(100vh - var(--space-5) - var(--space-7) - var(--space-9))');
    expect(frame).not.toContain('62vh');
  });

  test('under 900 wide it is still one column, with the preview unpinned', () => {
    const narrow = mediaBlocks(surfaces, '(max-width: 900px)');
    expect(narrow).toContain('.tune-split { grid-template-columns: 1fr; }');
    expect(narrow).toContain('.tune-preview { position: static; }');
  });
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `bun test tests/desktop-layout.test.ts`
Expected: FAIL on `420px minmax(0, 1fr)` and the `calc(100vh ...)` height. The narrow test already passes; it guards what must not change.

- [ ] **Step 3: Change the split and the preview**

In `desktop/ui/surfaces.css`, replace the last paragraph of the comment above `.tune-split`:

```css
 * One column below 900px. Two columns on a narrow window would give the
 * script a measure narrower than the thing it is previewing, which is worse
 * than no preview: it would misrepresent the book. */
```

with:

```css
 * The settings take a fixed 420 and the preview the rest of the block
 * (layout pass, 2026-09-29): about 670 wide in a 1280 window, twice what it
 * had, and it runs the window's height once the page scrolls to pin it.
 * The text stays the size it always was, so lines run longer than on a
 * 6-inch Kindle: the preview shows formatting, not the device's line
 * breaks, which a reader's own font size changes anyway.
 *
 * One column below 900px. Two columns on a narrow window would give the
 * script a measure narrower than the thing it is previewing, which is worse
 * than no preview: it would misrepresent the book. */
```

In the `.tune-split` rule, change `grid-template-columns: minmax(0, 1fr) minmax(0, 0.9fr);` to:

```css
  grid-template-columns: 420px minmax(0, 1fr);
```

In the `.tune-preview-frame` rule, replace `height: 62vh;` with:

```css
  /* The window's height, less the pinned top (space-5), the "Preview" label
   * above the frame (space-7 covers it) and a bottom margin (space-9), so
   * the whole frame is on screen once the page has scrolled to pin it. */
  height: calc(100vh - var(--space-5) - var(--space-7) - var(--space-9));
```

- [ ] **Step 4: Run the tests to see them pass**

Run: `bun test tests/desktop-layout.test.ts tests/desktop-ui.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add desktop/ui/surfaces.css tests/desktop-layout.test.ts
```

```bash
git commit -m "Settings: a fixed 420 for the settings, the rest and the window's height for the preview" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Each Settings section is a box

**Files:**
- Modify: `tests/desktop-ui.test.ts` (two foot-placement assertions, near lines 4285 and 4863)
- Modify: `brand/tokens.json` (new `panel` colour)
- Modify: `brand/tokens.css` (`--panel` in `:root` and in the dark block)
- Regenerate: `desktop/ui/tokens.css`
- Modify: `desktop/ui/tune.js` (the foot, in the `pane.append(...)` that builds `.tune-split`, near line 763)
- Modify: `desktop/ui/surfaces.css` (`.tune-defaults` near line 568, `.knob-group` near line 605)
- Test: `tests/desktop-layout.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to `tests/desktop-layout.test.ts`:

```ts
describe('each Settings section is a box', () => {
  const surfaces = windowCss('surfaces.css');
  const colors = JSON.parse(readFileSync(join(REPO, 'brand', 'tokens.json'), 'utf8')).colors;

  /** WCAG 2 relative luminance of a #RRGGBB colour. */
  function luminance(hex: string): number {
    const [r, g, b] = [1, 3, 5]
      .map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
      .map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  }
  function contrast(a: string, b: string): number {
    const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
    return (hi + 0.05) / (lo + 0.05);
  }

  test('each group and the foot share one box: a hairline, round corners, the panel fill', () => {
    const box = ruleBlock(surfaces, '.knob-group, .tune-foot');
    expect(box).toContain('border: 1px solid var(--hole)');
    expect(box).toContain('border-radius: var(--radius-well)');
    expect(box).toContain('background: var(--panel)');
  });

  test('the foot is one element, so it can be one box', () => {
    const tune = readFileSync(join(UI, 'tune.js'), 'utf8');
    expect(tune).toMatch(/el\('div', \{ class: 'tune-foot' \},\s*drawDefaultsFoot\(\),\s*drawKeepChoice\(\)\)/);
  });

  test('the panel is a colour token in both modes, and every text on it still reads', () => {
    expect(colors.panel?.light).toMatch(/^#[0-9A-F]{6}$/);
    expect(colors.panel?.dark).toMatch(/^#[0-9A-F]{6}$/);
    for (const mode of ['light', 'dark'] as const) {
      for (const ink of ['ink', 'ink-soft', 'ink-muted']) {
        expect(
          `${ink} on panel (${mode}): ${contrast(colors[ink][mode], colors.panel[mode]) >= 4.5}`,
        ).toBe(`${ink} on panel (${mode}): true`);
      }
    }
  });
});
```

Two tests in `tests/desktop-ui.test.ts` check where the foot sits by looking for it among the knobs column's direct children. It moves one level down, into its box, so they follow it.

Near line 4285, replace:

```ts
    // Placed at the foot: after the knob groups, inside the knobs column.
    const knobs = pane.find('tune-knobs')!;
    expect(knobs.kids.indexOf(foot!)).toBeGreaterThan(knobs.kids.findIndex((k) => k.tagName === 'DETAILS'));
```

with:

```ts
    // Placed at the foot: after the knob groups, inside the knobs column,
    // in the foot's own box (layout pass, 2026-09-29).
    const knobs = pane.find('tune-knobs')!;
    const box = pane.find('tune-foot')!;
    expect(box.kids.includes(foot!)).toBe(true);
    expect(knobs.kids.indexOf(box)).toBeGreaterThan(knobs.kids.findIndex((k) => k.tagName === 'DETAILS'));
```

Near line 4863, replace:

```ts
    // Beside the defaults foot, in the knobs column.
    const knobs = pane.find('tune-knobs')!;
    expect(knobs.kids.indexOf(box!)).toBeGreaterThan(knobs.kids.indexOf(pane.find('tune-defaults')!));
```

with:

```ts
    // After the defaults foot, in the same box (layout pass, 2026-09-29).
    const foot = pane.find('tune-foot')!;
    const defaults = pane.find('tune-defaults')!;
    expect(foot.kids.indexOf(defaults)).toBeGreaterThan(-1);
    expect(foot.kids.indexOf(box!)).toBeGreaterThan(foot.kids.indexOf(defaults));
```

- [ ] **Step 2: Run them to see them fail**

Run: `bun test tests/desktop-layout.test.ts tests/desktop-ui.test.ts`
Expected: FAIL: `.knob-group, .tune-foot is missing`, no `tune-foot` in tune.js, `colors.panel` undefined, and the two placement tests find no `tune-foot`.

- [ ] **Step 3: Add the colour**

In `brand/tokens.json`, directly after the `"paper": { ... },` line, add:

```json
    "panel":     { "light": "#FBF8F0", "dark": "#22201C", "from": "web", "role": "a Settings section's box, a shade off the paper" },
```

In `brand/tokens.css`, in the first `:root` block, directly after `--paper: #F7F2E6;`, add:

```css
  --panel: #FBF8F0;
```

and in the dark block (`@media (prefers-color-scheme: dark) { :root { ... } }`), directly after `--paper: #1E1C19;`, add:

```css
    --panel: #22201C;
```

Regenerate:

Run: `bun tools/build-desktop-tokens.ts`
Expected: `wrote desktop/ui/tokens.css`, which now declares `--panel` in both blocks.

- [ ] **Step 4: Wrap the foot in `desktop/ui/tune.js`**

In the `pane.append(...)` that builds `.tune-split`, replace:

```js
        statusLine,
        drawDefaultsFoot(),
        drawKeepChoice(),
```

with:

```js
        statusLine,
        el('div', { class: 'tune-foot' }, drawDefaultsFoot(), drawKeepChoice()),
```

- [ ] **Step 5: Draw the boxes in `desktop/ui/surfaces.css`**

Change `.tune-defaults { margin: var(--space-8) 0 0; }` to:

```css
.tune-defaults { margin: 0; }
```

Replace `.knob-group { margin: 0 0 var(--space-6); max-width: var(--measure); }` with:

```css
/* Each group is a box since the layout pass (2026-09-29): the owner found
 * the sections ran together. A hairline, the well's corners and a fill a
 * shade off the paper. The foot (which defaults new scripts start from, and
 * what a conversion keeps) is the same box. Folded, a box is its title. */
.knob-group, .tune-foot {
  margin: 0 0 var(--space-5);
  padding: var(--space-4) var(--space-5) var(--space-2);
  border: 1px solid var(--hole);
  border-radius: var(--radius-well);
  background: var(--panel);
}
.tune-foot { margin-top: var(--space-6); }
.knob-group > .knob:last-child { border-bottom: none; }
```

- [ ] **Step 6: Run the tests to see them pass**

Run: `bun test tests/desktop-layout.test.ts tests/desktop-ui.test.ts tests/desktop-tokens.test.ts tests/brand-tokens.test.ts tests/desktop-shell.test.ts`
Expected: PASS. `brand-tokens` checks `--panel` is in `brand/tokens.css` in both modes with the JSON's values; `desktop-tokens` checks the regenerated file matches the generator.

- [ ] **Step 7: Commit**

```bash
git add brand/tokens.json brand/tokens.css desktop/ui/tokens.css desktop/ui/tune.js desktop/ui/surfaces.css tests/desktop-layout.test.ts tests/desktop-ui.test.ts
```

```bash
git commit -m "Settings: each section, and the new-scripts foot, is a box" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Look at it live

The static tests prove the rules are there; only a real browser shows whether the page reads right. This harness is scratch, not committed: it serves `desktop/ui/` with a stand-in for the app shell that runs the real engine on scratch folders.

**Files:**
- Create (scratch, NOT in the repo): `<scratchpad>/harness/serve.ts`, where `<scratchpad>` is this session's scratchpad directory.

- [ ] **Step 1: Write the harness**

```ts
// Serves desktop/ui with a stand-in for window.__TAURI__ that runs the real
// engine on scratch folders. Local only; every engine call needs the token.
import { mkdirSync } from 'node:fs';
import { join, normalize } from 'node:path';

const REPO = process.argv[2];
if (!REPO) throw new Error('usage: bun serve.ts <worktree> [port]');
const PORT = Number(process.argv[3] ?? 4817);
const UI = join(REPO, 'desktop', 'ui');
const STATE = join(import.meta.dir, 'state');
for (const d of ['config', 'library', 'calibre']) mkdirSync(join(STATE, d), { recursive: true });
const env = {
  ...process.env,
  SCREEPUB_CONFIG_DIR: join(STATE, 'config'),
  SCREEPUB_LIBRARY: join(STATE, 'library'),
  CALIBRE_CONFIG_DIRECTORY: join(STATE, 'calibre'),
};
const DEMO = join(REPO, 'tests', 'fixtures', 'field-station.pdf');
const TOKEN = crypto.randomUUID();

const bridge = `<script>
window.__TAURI__ = {
  core: { async invoke(command, payload) {
    if (command === 'run_engine') {
      const r = await fetch('/engine', { method: 'POST', headers: { 'x-token': ${JSON.stringify(TOKEN)} },
        body: JSON.stringify(payload.args) });
      const text = await r.text();
      if (!r.ok) throw text;
      return text;
    }
    if (command === 'pick_file') return ${JSON.stringify(DEMO)};
    throw 'harness: no ' + command;
  } },
  event: { async listen() { return () => {}; } },
};
</script>`;

Bun.serve({
  hostname: '127.0.0.1',
  port: PORT,
  async fetch(req) {
    const url = new URL(req.url);
    if (url.pathname === '/engine') {
      if (req.method !== 'POST' || req.headers.get('x-token') !== TOKEN) return new Response('no', { status: 403 });
      const args = (await req.json()) as string[];
      const run = Bun.spawn(['bun', join(REPO, 'src', 'cli.ts'), ...args], { env, stdout: 'pipe', stderr: 'pipe' });
      const [out, err] = await Promise.all([new Response(run.stdout).text(), new Response(run.stderr).text()]);
      await run.exited;
      // The shell's contract: stdout is the answer whatever the exit code;
      // an engine that printed nothing is an error.
      return out.trim() === '' ? new Response(err, { status: 500 }) : new Response(out);
    }
    const rel = url.pathname === '/' ? 'index.html' : normalize(url.pathname).replace(/^\/+/, '');
    const path = join(UI, rel);
    if (!path.startsWith(UI + '/')) return new Response('no', { status: 403 });
    if (rel === 'index.html') {
      const html = await Bun.file(path).text();
      return new Response(html.replace('<head>', `<head>${bridge}`), { headers: { 'content-type': 'text/html' } });
    }
    const file = Bun.file(path);
    return (await file.exists()) ? new Response(file) : new Response('not found', { status: 404 });
  },
});
console.log(`harness on http://127.0.0.1:${PORT}/`);
```

- [ ] **Step 2: Start it in the background**

Run (background): `bun <scratchpad>/harness/serve.ts "$PWD" 4817`
Expected: `harness on http://127.0.0.1:4817/`

- [ ] **Step 3: Open it in the built-in browser and convert the demo script**

Open `http://127.0.0.1:4817/` with the browser pane (`preview_start` with that url). Press **Choose PDF…**; the harness answers with `field-station.pdf`. Wait for the result screen.

- [ ] **Step 4: Check each width, light then dark**

For each of 1280×800, 1800×1000 and 900×800 (`resize_window` with width and height), and each colour scheme (`resize_window` with `colorScheme`), take a screenshot of Convert (the result screen), Read (index open, then shut, then open and click a scene) and Settings (at the top, then scrolled halfway). Check, and fix in CSS (with its test first) anything that fails:

- The brads' centres sit about 44px from the window's left edge at every width.
- At 1280, content starts about 100px in and ends about 48px from the right; at 1800, the block is 1180 wide and centred between those margins.
- The tabs line up with the block's left edge; the version stamp sits at its bottom right.
- Convert's drop area and result stop at 820, centred.
- Read: the script frame is 706 wide at 1280 and 1800 and does not move when the index opens or shuts; clicking a scene jumps to it and marks it; at 900 the index sits above the script as a strip, and shutting it removes the strip.
- Settings: the settings column is 420; the preview fills the rest; scrolled, it stays pinned and its bottom edge sits above the window's bottom edge; each section and the foot is a box; folded sections are just their titles.
- Tab through the page once: the focus ring is visible on each control and nothing is covered by the drag strip.
- Dark mode: the boxes read as a shade off the paper, not as holes.

- [ ] **Step 5: Run the capture tool**

Run: `bun tools/capture-screens.ts`
Expected: it finishes without a refused engine call or a missing selector. The README and site pictures change; that is expected. Leave them out of this branch:

```bash
git checkout -- assets/screens site/img
```

- [ ] **Step 6: Stop the harness**

Stop the background harness. Nothing in the repo changed in this task unless a fix was needed; commit any fix with its test.

---

### Task 8: Whole suite, then a test app for the owner

- [ ] **Step 1: Run everything**

Run: `bun test`
Expected: 0 fail (about 2,830 pass, 11 skip).

Run: `bunx tsc --noEmit`
Expected: no output.

- [ ] **Step 2: Build the test app**

Run: `bun tools/build-sidecar.ts --host`
Expected: the engine compiled for this Mac (about 30 s).

Run: `cargo tauri build --bundles app` from `desktop/src-tauri`
Expected: `desktop/src-tauri/target/release/bundle/macos/Screepub Desktop.app`. It still says rev 0.7.3; the number changes at the release.

- [ ] **Step 3: Hand it over**

Tell the owner where the app is and what to look at: the brads near the left edge at every width, thin margins, Read's index beside the script, the Settings preview and boxes, light and dark. Nothing merges until the owner says so.
