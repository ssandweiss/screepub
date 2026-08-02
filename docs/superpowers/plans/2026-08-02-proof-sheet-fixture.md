# The Proof Sheet Fixture Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build `tests/fixtures/torture.pdf`, a 14-sheet invented screenplay that exercises every content-driven registry behavior, plus the manifest, tests and checklist that keep it honest.

**Architecture:** Extend `tools/make-fixture.py` with a fourth kind, `torture`. Rich formatting rides on four base-14 Type1 fonts selected per styled run; underlines are drawn rectangles. A new offset-preserving wrapper keeps style spans intact across line breaks, used only by the torture kind so the three existing fixtures are bit-for-bit untouched. A byte-stability test enforces that. Coverage stays honest via a manifest that a test diffs against the registry's own `###` headings.

**Tech Stack:** Python 3 (stdlib only, no new dependencies), Bun + `bun:test`, pdf.js via the existing parser.

**Spec:** `docs/superpowers/specs/2026-08-02-test-screenplay-kit-design.md`

**Worktree:** `.claude/worktrees/proof-sheet`, branch `worktree-proof-sheet`.

---

## One addition beyond the spec, and why

The spec does not mention a layout-debug mode. This plan adds
`make-fixture.py --emit-layout <kind>`, which prints the laid-out pages as
JSON instead of writing a PDF.

Reason: without it, every generator behavior can only be tested by
generating a PDF, running pdf.js over it, and inspecting the fountain
output. That is slow, and worse, it cannot see the thing most likely to
break silently, which is **which line a row landed on**. The `(MORE)` test
depends on a speech starting at line 50 of page 5. If content edits push
it to line 48, the test still passes while proving nothing.

`--emit-layout` makes page placement directly assertable. It is about 15
lines and no new dependencies. If reviewing this plan you disagree, cut
Task 2 and the layout assertions in Tasks 4 and 5; everything else stands.

---

## File Structure

| File | Responsibility |
| --- | --- |
| `tools/make-fixture.py` (modify) | All PDF generation. Gains a `torture` kind, markup parsing, an offset-preserving wrapper, four font resources, drawn underlines, pagination directives, dual columns, and `--emit-layout`. |
| `tools/torture-content.py` (create) | The 14 sheets of screenplay content, as data only. Split from the generator because it is the file a human edits, and it should not require reading layout code. |
| `tools/torture-manifest.json` (create) | One row per registry entry: covered or not, which page, which side, how. |
| `tools/device-checklist.ts` (create) | Prints the device-side checklist from the manifest. |
| `tests/fixture-stability.test.ts` (create) | The three existing fixtures regenerate byte-identically. |
| `tests/torture-layout.test.ts` (create) | Layout assertions via `--emit-layout`: page placement, wrapping, style spans. |
| `tests/torture.test.ts` (create) | Source-side parser assertions against the committed PDF. |
| `tests/torture-coverage.test.ts` (create) | Every registry `###` entry has a manifest row. |
| `tests/fixtures/torture.pdf` (create) | The committed artifact. |

---

## Task 1: Byte-stability guard

This comes first. It must exist and be proven to work **before** the
generator is touched, or it proves nothing about the changes that follow.

**Files:**
- Create: `tests/fixture-stability.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, test, expect } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { readFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// The three committed fixtures are generated, not hand-made, and
// tools/make-fixture.py is about to grow a fourth kind that shares its
// layout and PDF-emission code. Without this, a refactor could silently
// change screenplay.pdf and every integration test would quietly start
// asserting against different input.
//
// python3 is a REAL dependency of this suite, deliberately. No skip-if-
// missing guard: this repo already fixed the case where integration tests
// self-skipped and therefore never ran in CI. A test that quietly skips
// reads as coverage while providing none.
describe('committed fixtures regenerate byte-identically', () => {
  const KINDS = ['screenplay', 'prose', 'blank'] as const;
  const COMMITTED: Record<(typeof KINDS)[number], string> = {
    screenplay: 'tests/fixtures/screenplay.pdf',
    prose: 'tests/fixtures/prose.pdf',
    blank: 'tests/fixtures/blank-pages.pdf',
  };

  for (const kind of KINDS) {
    test(`${kind}`, () => {
      const dir = mkdtempSync(join(tmpdir(), 'screepub-fixture-'));
      const out = join(dir, `${kind}.pdf`);
      const run = spawnSync('python3', ['tools/make-fixture.py', kind, out], {
        encoding: 'utf8',
      });
      expect(run.status).toBe(0);
      expect(readFileSync(out)).toEqual(readFileSync(COMMITTED[kind]));
    });
  }
});
```

- [ ] **Step 2: Run it and verify it PASSES**

Run: `bun test tests/fixture-stability.test.ts`
Expected: 3 pass, 0 fail. The generator is unchanged, so it must pass now.

- [ ] **Step 3: Prove the guard actually goes red**

A guard that has never failed is a guard nobody has tested. Temporarily
change one character of output in `tools/make-fixture.py`: in `TITLE`,
change `"A. N. Placeholder"` to `"A. N. Placeholderx"`.

Run: `bun test tests/fixture-stability.test.ts`
Expected: the `screenplay` test FAILS on the buffer comparison.

Then **revert that edit** (`git checkout tools/make-fixture.py`) and re-run.
Expected: 3 pass again.

- [ ] **Step 4: Commit**

```bash
git add tests/fixture-stability.test.ts
git commit -m "The three committed fixtures get a byte-stability guard

Proven non-vacuous by changing one character of the title-page author and
watching the screenplay case fail, then reverting."
```

---

## Task 2: `--emit-layout`, on the existing kinds only

No behavior change. This builds the testable seam before anything depends
on it.

**Files:**
- Modify: `tools/make-fixture.py`
- Create: `tests/torture-layout.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, test, expect } from 'bun:test';
import { spawnSync } from 'node:child_process';

export function emitLayout(kind: string): LayoutPage[] {
  const run = spawnSync('python3', ['tools/make-fixture.py', '--emit-layout', kind], {
    encoding: 'utf8',
  });
  if (run.status !== 0) throw new Error(`make-fixture.py failed: ${run.stderr}`);
  return JSON.parse(run.stdout);
}

export interface LayoutRun { styles: string[]; text: string }
export interface LayoutRow { line: number; x: number; runs: LayoutRun[]; underline: boolean }
export interface LayoutPage { page: number; rows: LayoutRow[] }

describe('--emit-layout', () => {
  test('screenplay lays out onto the pages the PDF actually has', () => {
    const pages = emitLayout('screenplay');
    // The screenplay kind emits a title page plus content pages; the PDF
    // itself is the ground truth for how many.
    expect(pages.length).toBeGreaterThan(1);
    expect(pages[0].page).toBe(1);
  });

  test('every row carries a line number and an x position', () => {
    for (const page of emitLayout('screenplay')) {
      for (const row of page.rows) {
        expect(typeof row.line).toBe('number');
        expect(typeof row.x).toBe('number');
        expect(row.runs.length).toBeGreaterThan(0);
      }
    }
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `bun test tests/torture-layout.test.ts`
Expected: FAIL, because `--emit-layout` is not a recognized argument and
`make-fixture.py` exits with its usage message.

- [ ] **Step 3: Implement `--emit-layout`**

In `tools/make-fixture.py`, replace the `__main__` block with:

```python
if __name__ == "__main__":
    import sys
    argv = sys.argv[1:]
    if argv and argv[0] == "--emit-layout":
        if len(argv) != 2 or argv[1] not in KINDS:
            sys.exit(f"usage: make-fixture.py --emit-layout <{'|'.join(KINDS)}>")
        import json
        print(json.dumps(layout_json(argv[1])))
        sys.exit(0)
    if len(argv) != 2 or argv[0] not in KINDS:
        sys.exit(f"usage: make-fixture.py <{'|'.join(KINDS)}> <out.pdf>")
    kind, p = argv
    print(f"{build(p, KINDS[kind]())} pages -> {p}")
```

And add, above it:

```python
def layout_json(kind):
    """The laid-out pages as plain data, for tests. Mirrors what the
    content streams draw, so an assertion about line 50 of page 5 is an
    assertion about the actual PDF."""
    if kind != "screenplay":
        # prose and blank have no line-addressable structure worth emitting.
        return []
    pages = [{"page": 1, "rows": _title_rows()}]
    for i, rows in enumerate(layout()):
        pages.append({"page": i + 2, "rows": _content_rows(rows)})
    return pages


def _title_rows():
    out = []
    for n, (inches_down, text) in enumerate(TITLE):
        x = (8.5 - len(text) / 10.0) / 2.0
        out.append({"line": int(inches_down * 6), "x": round(x, 3),
                    "runs": [{"styles": [], "text": text}], "underline": False})
    return out


def _content_rows(rows):
    out = []
    for n, row in enumerate(rows):
        if row is None:
            continue
        x, text = row
        out.append({"line": n, "x": round(x, 3),
                    "runs": [{"styles": [], "text": text}], "underline": False})
    return out
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test tests/torture-layout.test.ts tests/fixture-stability.test.ts`
Expected: all pass. The stability guard passing is the important half: it
proves `--emit-layout` changed no PDF bytes.

- [ ] **Step 5: Commit**

```bash
git add tools/make-fixture.py tests/torture-layout.test.ts
git commit -m "make-fixture.py can print its layout instead of a PDF

Page placement is the thing most likely to rot silently: a speech that
must start at line 50 still 'passes' every output test at line 48."
```

---

## Task 3: Markup parsing

**Files:**
- Modify: `tools/make-fixture.py`
- Create: `tests/torture-markup.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, test, expect } from 'bun:test';
import { spawnSync } from 'node:child_process';

function parseMarkup(s: string): { plain: string; spans: [number, number, string][] } {
  const run = spawnSync('python3', ['tools/make-fixture.py', '--parse-markup', s], {
    encoding: 'utf8',
  });
  if (run.status !== 0) throw new Error(run.stderr.trim());
  return JSON.parse(run.stdout);
}

describe('inline markup', () => {
  test('strips markers and records offsets into the PLAIN text', () => {
    const r = parseMarkup('a {b}bold{/b} c');
    expect(r.plain).toBe('a bold c');
    expect(r.spans).toEqual([[2, 6, 'b']]);
  });

  test('handles two styles over the same run', () => {
    const r = parseMarkup('{b}{i}both{/i}{/b}');
    expect(r.plain).toBe('both');
    expect(r.spans.map((s) => s[2]).sort()).toEqual(['b', 'i']);
  });

  test('text with no markup is returned unchanged', () => {
    const r = parseMarkup('plain text');
    expect(r.plain).toBe('plain text');
    expect(r.spans).toEqual([]);
  });

  test('an unclosed marker is an error, not silently dropped', () => {
    expect(() => parseMarkup('a {b}bold')).toThrow();
  });

  test('an unmatched closer is an error', () => {
    expect(() => parseMarkup('a bold{/b}')).toThrow();
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `bun test tests/torture-markup.test.ts`
Expected: FAIL, `--parse-markup` is not recognized.

- [ ] **Step 3: Implement**

Add to `tools/make-fixture.py`, near the top after the constants:

```python
import re

MARKUP = re.compile(r"\{(/?)([biu])\}")


def parse_markup(s):
    """'a {b}bold{/b} c' -> ('a bold c', [(2, 6, 'b')]).

    Offsets index the PLAIN text, so wrapping can slice by character and
    re-derive styles without ever seeing a marker.
    """
    plain, spans, open_at, pos, out_len = [], [], {}, 0, 0
    for m in MARKUP.finditer(s):
        plain.append(s[pos:m.start()])
        out_len += m.start() - pos
        closing, style = m.group(1), m.group(2)
        if closing:
            if style not in open_at:
                raise ValueError(f"unmatched {{/{style}}} in {s!r}")
            spans.append((open_at.pop(style), out_len, style))
        else:
            if style in open_at:
                raise ValueError(f"nested {{{style}}} in {s!r}")
            open_at[style] = out_len
        pos = m.end()
    plain.append(s[pos:])
    if open_at:
        raise ValueError(f"unclosed {sorted(open_at)} in {s!r}")
    return "".join(plain), spans
```

And in the `__main__` block, before the `--emit-layout` branch:

```python
    if argv and argv[0] == "--parse-markup":
        import json
        plain, spans = parse_markup(argv[1])
        print(json.dumps({"plain": plain, "spans": spans}))
        sys.exit(0)
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test tests/torture-markup.test.ts tests/fixture-stability.test.ts`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add tools/make-fixture.py tests/torture-markup.test.ts
git commit -m "Inline {b}/{i}/{u} markup parses to plain text plus offset spans

Unbalanced markers raise rather than silently dropping, so a typo in 13
pages of content fails loudly at generation instead of producing a fixture
that quietly tests nothing."
```

---

## Task 4: Offset-preserving wrapper

**Files:**
- Modify: `tools/make-fixture.py`
- Modify: `tests/torture-markup.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `tests/torture-markup.test.ts`:

```typescript
function wrapSpans(s: string, width: number): { styles: string[]; text: string }[][] {
  const run = spawnSync(
    'python3',
    ['tools/make-fixture.py', '--wrap', String(width), s],
    { encoding: 'utf8' },
  );
  if (run.status !== 0) throw new Error(run.stderr.trim());
  return JSON.parse(run.stdout);
}

describe('offset-preserving wrap', () => {
  test('a styled span survives a line break, styled on BOTH lines', () => {
    // "{b}" opens before the break and closes after it. This is the case
    // that a naive wrap-the-marked-up-string approach gets wrong: it would
    // either split "{b}" itself or count its 3 characters as text width.
    const lines = wrapSpans('aaa {b}bbb ccc{/b} ddd', 7);
    const bolded = lines
      .flat()
      .filter((r) => r.styles.includes('b'))
      .map((r) => r.text.trim())
      .filter(Boolean);
    expect(bolded).toEqual(['bbb', 'ccc']);
  });

  test('wrapping ignores marker characters when measuring width', () => {
    // Plain text is 11 chars: "aaa bbb ccc". At width 11 it is ONE line,
    // even though the marked-up string is 18 characters long.
    const lines = wrapSpans('aaa {b}bbb{/b} ccc', 11);
    expect(lines.length).toBe(1);
  });

  test('unstyled text wraps on word boundaries', () => {
    const lines = wrapSpans('one two three four', 8);
    const texts = lines.map((l) => l.map((r) => r.text).join(''));
    expect(texts).toEqual(['one two', 'three', 'four']);
  });

  test('adjacent characters with equal styles merge into one run', () => {
    const lines = wrapSpans('{b}bold{/b}', 20);
    expect(lines[0].length).toBe(1);
    expect(lines[0][0]).toEqual({ styles: ['b'], text: 'bold' });
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `bun test tests/torture-markup.test.ts`
Expected: the four new tests FAIL, `--wrap` is not recognized.

- [ ] **Step 3: Implement**

Add to `tools/make-fixture.py`:

```python
def _words(plain):
    """[(start, end)] for each space-delimited word, as offsets into plain."""
    out, i, n = [], 0, len(plain)
    while i < n:
        while i < n and plain[i] == " ":
            i += 1
        if i >= n:
            break
        j = i
        while j < n and plain[j] != " ":
            j += 1
        out.append((i, j))
        i = j
    return out


def _runs(plain, spans, start, end):
    """Slice [start, end) into styled runs, merging equal-styled neighbours."""
    runs = []
    for i in range(start, end):
        st = sorted(s for (a, b, s) in spans if a <= i < b)
        if runs and runs[-1][0] == st:
            runs[-1][1] += plain[i]
        else:
            runs.append([st, plain[i]])
    return [{"styles": st, "text": txt} for st, txt in runs]


def wrap_spans(plain, spans, width):
    """Greedy word wrap that keeps style spans intact. -> list of lines,
    each a list of {styles, text} runs.

    Deliberately NOT textwrap: textwrap takes a plain string, so markup
    would have to be either stripped (losing styles) or left in (counting
    marker characters as width, and splitting markers across lines). The
    three original fixture kinds keep using textwrap, untouched.
    """
    words = _words(plain)
    if not words:
        return [[{"styles": [], "text": ""}]]
    lines = []
    line_start, line_end = words[0]
    for ws, we in words[1:]:
        if we - line_start <= width:
            line_end = we
        else:
            lines.append(_runs(plain, spans, line_start, line_end))
            line_start, line_end = ws, we
    lines.append(_runs(plain, spans, line_start, line_end))
    return lines
```

And in `__main__`:

```python
    if argv and argv[0] == "--wrap":
        import json
        plain, spans = parse_markup(argv[2])
        print(json.dumps(wrap_spans(plain, spans, int(argv[1]))))
        sys.exit(0)
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test tests/torture-markup.test.ts tests/fixture-stability.test.ts`
Expected: all pass. The stability guard is the proof that `textwrap` use in
the original three kinds was not disturbed.

- [ ] **Step 5: Commit**

```bash
git add tools/make-fixture.py tests/torture-markup.test.ts
git commit -m "A wrapper that keeps style spans across line breaks

textwrap cannot do this: it takes a plain string, so markup either loses
its styles or gets measured as text. The original three kinds keep calling
textwrap, and the stability guard proves it."
```

---

## Task 5: Four fonts, styled emission, and drawn underlines

**Files:**
- Modify: `tools/make-fixture.py`

- [ ] **Step 1: Write the failing test**

Create `tests/torture-render.test.ts`:

```typescript
import { describe, test, expect, beforeAll } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Generates the torture PDF into a temp dir and converts it, so these
// assertions run against the real pdf.js path, not a mock.
let fountain = '';

beforeAll(() => {
  const dir = mkdtempSync(join(tmpdir(), 'screepub-torture-'));
  const pdf = join(dir, 'torture.pdf');
  const fnt = join(dir, 'torture.fountain');
  const gen = spawnSync('python3', ['tools/make-fixture.py', 'torture', pdf], {
    encoding: 'utf8',
  });
  if (gen.status !== 0) throw new Error(gen.stderr);
  const conv = spawnSync(
    'bun',
    ['src/cli.ts', pdf, '-o', join(dir, 'torture.epub'), '--fountain', fnt],
    { encoding: 'utf8' },
  );
  if (conv.status !== 0) throw new Error(conv.stderr);
  fountain = readFileSync(fnt, 'utf8');
});

describe('rich formatting reaches the fountain', () => {
  test('bold becomes **', () => {
    expect(fountain).toContain('**');
  });
  test('italic becomes *', () => {
    expect(fountain).toMatch(/(?<!\*)\*(?!\*)/);
  });
  test('bold italic becomes ***', () => {
    expect(fountain).toContain('***');
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `bun test tests/torture-render.test.ts`
Expected: FAIL, `torture` is not a valid kind.

- [ ] **Step 3: Implement fonts, styled rows and underlines**

Replace the single-font constant in `tools/make-fixture.py`. Find:

```python
    objs.append("<< /Type /Font /Subtype /Type1 /BaseFont /Courier >>")
```

The `build()` function currently hardcodes one font at object 3 and
`/Font << /F1 3 0 R >>`. Generalize it:

```python
FONTS = {"F1": "Courier", "F2": "Courier-Bold",
         "F3": "Courier-Oblique", "F4": "Courier-BoldOblique"}

CHAR_W = 7.2   # 12pt Courier advance: 0.1 inch at 10 characters per inch


def font_for(styles):
    """Style set -> font resource key. Underline is orthogonal: it is drawn,
    not selected, so it never changes which font a run uses."""
    s = set(styles) - {"u"}
    if s == {"b", "i"}:
        return "F4"
    if s == {"b"}:
        return "F2"
    if s == {"i"}:
        return "F3"
    return "F1"


def styled_row_ops(x_in, y, runs):
    """-> (text operators, underline rectangles) for one laid-out line."""
    ops, rects = [], []
    x = x_in * PT
    for run in runs:
        text, styles = run["text"], run["styles"]
        if text:
            ops += [f"/{font_for(styles)} 12 Tf",
                    f"1 0 0 1 {x:.2f} {y:.2f} Tm", f"({esc(text)}) Tj"]
            if "u" in styles:
                # A filled rectangle, not a stroked line: the rich-formatting
                # spec's detector keys on a flat bbox (<= 2.5pt tall) sitting
                # in a band just under the baseline.
                rects.append(f"0 g {x:.2f} {y - 2.0:.2f} "
                             f"{len(text) * CHAR_W:.2f} 0.6 re f")
        x += len(text) * CHAR_W
    return ops, rects
```

Then change `build()` to emit all four fonts. Replace the font object line
and the `/Resources` line:

```python
    objs.append("<< /Type /Catalog /Pages 2 0 R >>")
    objs.append(f"<< /Type /Pages /Kids [{kids}] /Count {n_pages} >>")
    for key in FONTS:
        objs.append(f"<< /Type /Font /Subtype /Type1 /BaseFont /{FONTS[key]} >>")
```

and

```python
    res = " ".join(f"/{k} {3+i} 0 R" for i, k in enumerate(FONTS))
    for s in streams:
        objs.append(
            f"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 {PAGE_W:.0f} "
            f"{PAGE_H:.0f}] /Resources << /Font << {res} >> >> "
            f"/Contents {len(objs)+2} 0 R >>")
```

`kids` must account for the extra font objects:

```python
    first_page_obj = 3 + len(FONTS)
    kids = " ".join(f"{first_page_obj + 2*i} 0 R" for i in range(n_pages))
```

**This changes the three existing fixtures' bytes.** That is expected and
correct: they now carry four font resources instead of one. Regenerate
them and update the guard's baseline in the same commit, so the diff shows
the intent:

```bash
python3 tools/make-fixture.py screenplay tests/fixtures/screenplay.pdf
python3 tools/make-fixture.py prose      tests/fixtures/prose.pdf
python3 tools/make-fixture.py blank      tests/fixtures/blank-pages.pdf
```

- [ ] **Step 4: Verify the regenerated fixtures still parse identically**

The bytes changed; the *meaning* must not. Run the full suite:

Run: `bun test`
Expected: all pass, including every integration test that reads
`screenplay.pdf`. If any assertion about scenes, characters or elements
changes, stop: the font-resource change was supposed to be inert and is not.

- [ ] **Step 5: Commit**

```bash
git add tools/make-fixture.py tests/fixtures/*.pdf tests/torture-render.test.ts
git commit -m "Four fonts, styled runs, and underlines drawn as rectangles

Regenerates the three committed fixtures: they now carry four font
resources instead of one. Bytes change, meaning does not, and the full
suite passing against the regenerated files is the proof."
```

---

## Task 6: Pagination directives

**Files:**
- Modify: `tools/make-fixture.py`

- [ ] **Step 1: Write the failing test**

Append to `tests/torture-layout.test.ts`:

```typescript
describe('pagination directives', () => {
  test('atline pads so a row lands on exactly the requested line', () => {
    const pages = emitLayout('torture');
    // The (MORE)/(CONT'D) speech is engineered to start at line 50 of its
    // page. Task 8's content places it; this asserts the mechanism.
    const anchored = pages
      .flatMap((p) => p.rows.map((r) => ({ page: p.page, ...r })))
      .filter((r) => r.runs.some((run) => run.text.includes('MORE-ANCHOR')));
    expect(anchored.length).toBe(1);
    expect(anchored[0].line).toBe(50);
  });

  test('atline raises when the page is already past the requested line', () => {
    const run = spawnSync('python3', ['tools/make-fixture.py', '--atline-overflow-check'], {
      encoding: 'utf8',
    });
    expect(run.status).not.toBe(0);
    expect(run.stderr).toContain('already at line');
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `bun test tests/torture-layout.test.ts`
Expected: the two new tests FAIL.

- [ ] **Step 3: Implement**

```python
def flow_torture(content):
    """Lay torture content out into pages, honouring directives.

    Directives:
      ("pagebreak", "")  start a new page
      ("atline", n)      pad with blanks until the current page is at line n
      ("dual", L, R)     two-column simultaneous dialogue (Task 7)
    """
    pages, cur, n = [], [], 0

    def flush():
        nonlocal cur, n
        if cur:
            pages.append(cur)
        cur, n = [], 0

    for kind, *rest in content:
        if kind == "pagebreak":
            flush()
            continue
        if kind == "atline":
            target = rest[0]
            if n > target:
                raise SystemExit(
                    f"atline: page {len(pages)+1} is already at line {n}, "
                    f"cannot pad back to {target}. Content above it grew; "
                    f"either shorten it or move the anchor.")
            while n < target:
                cur.append(None)
                n += 1
            continue
        if kind == "dual":
            rows, used = dual_rows(rest[0], rest[1])
            if n + used > LINES_PER_PAGE:
                flush()
            cur.extend(rows)
            n += used
            continue

        text = rest[0]
        plain, spans = parse_markup(text)
        for runs in wrap_spans(plain, spans, WRAP[kind]):
            if n >= LINES_PER_PAGE:
                flush()
            cur.append((X[kind], runs))
            n += 1
        if n < LINES_PER_PAGE:
            cur.append(None)
            n += 1
    flush()
    return pages
```

Add the overflow self-check to `__main__`, before the other branches:

```python
    if argv and argv[0] == "--atline-overflow-check":
        # Proves the guard fires. Asked to pad back to line 2 after
        # already emitting well past it.
        flow_torture([("action", "x " * 200), ("atline", 2)])
        sys.exit("expected atline to raise, it did not")
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test tests/torture-layout.test.ts`
Expected: the overflow test passes. The `atline` placement test still fails
until Task 8 supplies the content; that is expected and it will be
re-verified there.

- [ ] **Step 5: Commit**

```bash
git add tools/make-fixture.py tests/torture-layout.test.ts
git commit -m "Pagination directives, and atline raises rather than overflowing

Silently overflowing would turn the (MORE) test into a test of nothing the
first time content above it grew by one sentence."
```

---

## Task 7: Dual-column emission

**Files:**
- Modify: `tools/make-fixture.py`

- [ ] **Step 1: Write the failing test**

Append to `tests/torture-render.test.ts`:

```typescript
describe('dual dialogue', () => {
  test('the short exchange de-interleaves into two clean speeches', () => {
    // Registry 10a: columns emit as left speech then right speech. If
    // de-interleaving failed, the two columns would be joined by Y into
    // garbage lines mixing both characters.
    expect(fountain).toContain('@BUNNY');
    expect(fountain).toContain('@CASSIUS ^');
  });

  test('no line mixes text from both columns', () => {
    const bad = fountain
      .split('\n')
      .filter((l) => l.includes('LEFTMARK') && l.includes('RIGHTMARK'));
    expect(bad).toEqual([]);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `bun test tests/torture-render.test.ts`
Expected: FAIL, no dual content exists yet.

- [ ] **Step 3: Implement**

```python
# Dual dialogue column geometry. The parser anchors a dual region on a line
# holding TWO cue-shaped clusters, then partitions body lines by start-x
# (registry 10a). These indents put the right cue far enough right that the
# learned boundary (rightCueX - 13%) lands between the columns.
DUAL_X = {
    "left":  {"character": 2.2, "dialogue": 1.9, "paren": 2.4},
    "right": {"character": 5.4, "dialogue": 5.1, "paren": 5.6},
}
DUAL_WRAP = 26


def dual_rows(left, right):
    """Two (kind, text) lists -> interleaved rows sharing Y, plus line count.

    The cue lines of both columns MUST share one Y, or the parser sees two
    ordinary cues rather than a dual region.
    """
    def col(items, side):
        out = []
        for kind, text in items:
            plain, spans = parse_markup(text)
            for runs in wrap_spans(plain, spans, DUAL_WRAP):
                out.append((DUAL_X[side][kind], runs))
        return out

    L, R = col(left, "left"), col(right, "right")
    rows = []
    for i in range(max(len(L), len(R))):
        pair = []
        if i < len(L):
            pair.append(L[i])
        if i < len(R):
            pair.append(R[i])
        rows.append(("multi", pair))
    rows.append(None)
    return rows, len(rows)
```

`content_stream` must learn the `("multi", [...])` row shape and the
styled-run row shape. Replace its body:

```python
def torture_content_stream(rows, page_no):
    text_ops, rects = ["BT", "/F1 12 Tf"], []
    if page_no:
        text_ops += [f"1 0 0 1 {X['pgnum']*PT:.2f} {PAGE_H - 0.5*PT:.2f} Tm",
                     f"({page_no}.) Tj"]
    y = TOP
    for row in rows:
        if row is not None:
            if isinstance(row, tuple) and row[0] == "multi":
                for x, runs in row[1]:
                    ops, rs = styled_row_ops(x, y, runs)
                    text_ops += ops
                    rects += rs
            else:
                x, runs = row
                ops, rs = styled_row_ops(x, y, runs)
                text_ops += ops
                rects += rs
        y -= LINE
    text_ops.append("ET")
    return "\n".join(rects + text_ops)
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test tests/torture-render.test.ts`
Expected: still failing until Task 8 supplies content. Verify instead that
`python3 tools/make-fixture.py --emit-layout torture` runs without error.

- [ ] **Step 5: Commit**

```bash
git add tools/make-fixture.py
git commit -m "Two-column dual dialogue, both cues sharing one Y

Registry 10a anchors a dual region on a line holding two cue-shaped
clusters. Cues on separate Y lines read as two ordinary cues instead."
```

---

## Task 8: The content

**Files:**
- Create: `tools/torture-content.py`
- Modify: `tools/make-fixture.py`

- [ ] **Step 1: Write the content file**

Create `tools/torture-content.py`. This is the file a human edits, so it
carries no layout logic. Structure it page by page, following the spec's
coverage table. Every name is invented.

```python
"""Content for the torture fixture. Data only, no layout logic.

Every registry behavior this exercises is recorded in
tools/torture-manifest.json. Edit both together.

CONFIDENTIALITY: every title, author, character and location here is
invented. Nothing from the gitignored /fixtures/ may ever appear.
"""

TITLE = [
    (4.0, "THE PROOF SHEET"),
    (4.5, "Written by"),
    (5.0, "A. N. Placeholder"),
]

# Saturation cast, deliberately small so the roster stays realistic.
CAST = ["BUNNY", "CASSIUS", "ODILE", "WREN"]

NUMBERS = ["one", "two", "three", "four", "five", "six", "seven", "eight",
           "nine", "ten", "eleven", "twelve", "thirteen", "fourteen",
           "fifteen", "sixteen", "seventeen", "eighteen", "nineteen",
           "twenty", "twenty-one", "twenty-two", "twenty-three",
           "twenty-four", "twenty-five", "twenty-six", "twenty-seven",
           "twenty-eight", "twenty-nine", "thirty", "thirty-one",
           "thirty-two", "thirty-three", "thirty-four", "thirty-five",
           "thirty-six", "thirty-seven", "thirty-eight", "thirty-nine",
           "forty"]


def saturation():
    """Pages 8-13: numbered speeches, varied lengths.

    Lengths cycle 1/2/4/3 lines rather than repeating one shape. A uniform
    period could align with the device's page height and put every break in
    the same relative position, saturating nothing.
    """
    out = []
    shapes = [1, 2, 4, 3]
    for i, n in enumerate(NUMBERS):
        who = CAST[i % len(CAST)]
        lines = shapes[i % len(shapes)]
        body = f"Speech {n}. "
        if lines == 1:
            body += "Short."
        else:
            body += ("If this line sits alone at the top or the bottom of a "
                     "page, the keep failed. ") * (lines - 1)
        out.append(("character", who))
        out.append(("dialogue", body.strip()))
    return out


CONTENT = [
    # ---- page 1: sluglines of every shape -------------------------------
    ("scene", "INT. ARCHIVE BASEMENT - NIGHT"),
    ("action", "Steel shelving to the ceiling. A single bulb."),
    ("scene", "EXT. LOADING DOCK - CONTINUOUS"),
    ("action", "Rain on corrugated tin."),
    ("scene", "INT./EXT. DELIVERY VAN - MOVING - LATER"),
    ("action", "The wipers lose."),
    ("scene", "42 INT. ARCHIVE BASEMENT - RESHELVING - DAY 42"),
    ("action", "A dual-margin scene number, the shooting-script shape."),
    ("pagebreak", ""),

    # ---- page 2: transitions, mini-slugs, furniture ---------------------
    ("scene", "INT. READING ROOM - DAY"),
    ("action", "ODILE sets down a box that is heavier than it looks."),
    ("mini", "THE INDEX CARDS"),
    ("action", "Handwriting from four decades, none of it consistent."),
    ("mini", "THE LEDGER"),
    ("action", "One column, ruled in pencil, never once balanced."),
    ("trans", "CUT TO:"),
    ("scene", "INT. STAIRWELL - CONTINUOUS"),
    ("action", "Footsteps going down two at a time."),
    ("trans", "DISSOLVE TO:"),
    ("pagebreak", ""),

    # ---- page 3: cue extensions and hybrids -----------------------------
    ("scene", "INT. ARCHIVE BASEMENT - NIGHT"),
    ("character", "BUNNY"),
    ("paren", "(O.S.)"),
    ("dialogue", "The period-full spelling."),
    ("character", "CASSIUS"),
    ("paren", "(V.O)"),
    ("dialogue", "And the one writers actually type, missing its period."),
    ("character", "ODILE"),
    ("paren", "(O.C.)"),
    ("dialogue", "Off camera, spelled properly."),
    ("character", "WREN (CONT'D)"),
    ("dialogue", "A continued cue."),
    ("character", "DR. E. T. MARCHETTI"),
    ("dialogue", "Dotted abbreviations inside a name."),
    ("pagebreak", ""),

    # ---- page 4: parentheticals and roster rescue -----------------------
    ("scene", "INT. READING ROOM - DAY"),
    ("character", "BUNNY"),
    ("paren", "(quietly)"),
    ("dialogue", "A leading parenthetical."),
    ("character", "CASSIUS"),
    ("dialogue", "A line, then a beat."),
    ("paren", "(reconsidering)"),
    ("dialogue", "Then the rest of it."),
    ("character", "ODILE"),
    ("paren", "(standing)"),
    ("paren", "(then, to WREN)"),
    ("dialogue", "Two stacked parentheticals."),
    ("pagebreak", ""),

    # ---- page 5: dialogue extremes, and the (MORE) anchor ---------------
    ("scene", "INT. ARCHIVE BASEMENT - NIGHT"),
    ("character", "WREN"),
    ("dialogue", "No."),
    ("character", "BUNNY"),
    ("dialogue", "Yes."),
    ("atline", 50),
    ("character", "ODILE"),
    ("dialogue",
     "MORE-ANCHOR. This speech begins near the foot of the page on purpose, "
     "so that it runs over the break and the parser has to rejoin it across "
     "the (MORE) and (CONT'D) furniture that a real script would print. It "
     "keeps going well past the boundary so the rejoin has something "
     "substantial to put back together, and so the same speech doubles as "
     "the long-dialogue case the coverage table asks for."),
    ("pagebreak", ""),

    # ---- page 6: rich formatting ----------------------------------------
    ("scene", "INT. CONSERVATION BENCH - DAY"),
    ("action", "The label reads {b}DO NOT LAMINATE{/b}, twice."),
    ("action", "She says it {i}again{/i}, and this time somebody writes it down."),
    ("action", "The stamp is {b}{i}both bold and italic{/i}{/b} at once."),
    ("action", "A styled run that {b}crosses the wrap boundary because it "
               "keeps going for long enough to need a second line{/b}, then stops."),
    ("action", "Punctuation only{b},{/b} styled alone."),
    ("action", "This word is {u}underlined{/u} with drawn vector art."),
    ("character", "CASSIUS"),
    ("dialogue", "Dialogue can be {b}bold{/b} too."),
    ("character", "ODILE"),
    ("dialogue", "And {i}italic{/i}, which is the common one."),
    ("pagebreak", ""),

    # ---- page 7: dual dialogue, short then tall -------------------------
    ("scene", "INT. READING ROOM - DAY"),
    ("action", "They speak over each other."),
    ("dual",
     [("character", "BUNNY"), ("dialogue", "LEFTMARK. Short, left.")],
     [("character", "CASSIUS"), ("dialogue", "RIGHTMARK. Short, right.")]),
    ("action", "And again, at length."),
    ("dual",
     [("character", "ODILE"),
      ("dialogue", "This column runs long enough that the taller of the two "
                   "passes twelve estimated rendered lines, which is the "
                   "threshold where the table gives up and both speeches "
                   "become ordinary sequential dialogue instead.")],
     [("character", "WREN"),
      ("dialogue", "And this one answers at similar length so that neither "
                   "column is trivially short, because the fallback measures "
                   "the taller of the pair and a stub would not reach it.")]),
    ("pagebreak", ""),
] + saturation()
```

- [ ] **Step 2: Wire it into the generator**

In `tools/make-fixture.py`:

```python
def torture_streams():
    import importlib.util, pathlib
    spec_path = pathlib.Path(__file__).with_name("torture-content.py")
    spec = importlib.util.spec_from_file_location("torture_content", spec_path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    pages = flow_torture(mod.CONTENT)
    return [title_stream_for(mod.TITLE)] + [
        torture_content_stream(p, i + 1) for i, p in enumerate(pages)
    ]


KINDS["torture"] = torture_streams
```

`X` and `WRAP` need the `mini` kind (mini-slugs sit at the action margin):

```python
X["mini"] = 1.5
WRAP["mini"] = 60
```

`title_stream_for(TITLE)` is `title_stream()` parameterised on its table;
refactor `title_stream` to take the table and have the screenplay kind pass
its own, so the byte-stability guard still passes.

- [ ] **Step 3: Generate and eyeball the page count**

Run: `python3 tools/make-fixture.py torture tests/fixtures/torture.pdf`
Expected: `14 pages -> tests/fixtures/torture.pdf`

If it reports a different count, the content grew or shrank. Adjust content,
not `LINES_PER_PAGE`.

- [ ] **Step 4: Run all the tests that were waiting on content**

Run: `bun test tests/torture-render.test.ts tests/torture-layout.test.ts`
Expected: all pass, including the `atline` line-50 assertion from Task 6.

- [ ] **Step 5: Commit**

```bash
git add tools/torture-content.py tools/make-fixture.py tests/fixtures/torture.pdf
git commit -m "The proof sheet: 14 sheets, every name invented

Saturation speeches cycle 1/2/4/3 lines rather than repeating one shape,
because a uniform period could align with the device page height and put
every break in the same relative position."
```

---

## Task 9: Source-side assertions

**Files:**
- Create: `tests/torture.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, test, expect, beforeAll } from 'bun:test';
import { extractDocument } from '../src/parser/extract';
import { parseLines } from '../src/parser/index';
import type { ParsedScreenplay } from '../src/parser/types';

let doc: ParsedScreenplay;

beforeAll(async () => {
  const bytes = await Bun.file('tests/fixtures/torture.pdf').arrayBuffer();
  const lines = await extractDocument(new Uint8Array(bytes));
  doc = parseLines(lines);
});

describe('the proof sheet parses', () => {
  test('every element type the parser knows appears at least once', () => {
    const seen = new Set(doc.elements.map((e) => e.type));
    for (const t of ['scene', 'character', 'dialogue', 'action',
                     'parenthetical', 'transition', 'mini-slug']) {
      expect(seen).toContain(t);
    }
  });

  test('the saturation cast is the roster, and the title is not in it', () => {
    const names = doc.characters.map((c) => c.name);
    expect(names).toContain('BUNNY');
    expect(names).not.toContain('THE PROOF SHEET');
  });

  test('the dual exchange marks its right column', () => {
    expect(doc.elements.some((e) => e.dualRight)).toBe(true);
  });

  test('the shooting-script scene number is attached, not left in the text', () => {
    const numbered = doc.elements.find((e) => e.sceneNumber === '42');
    expect(numbered).toBeDefined();
    expect(numbered!.text).not.toContain('42');
  });
});

describe('rich formatting', () => {
  test('bold, italic and bold-italic all reach styledText', () => {
    const styled = doc.elements.map((e) => e.styledText ?? '').join('\n');
    expect(styled).toContain('**DO NOT LAMINATE**');
    expect(styled).toContain('*again*');
    expect(styled).toContain('***both bold and italic***');
  });

  test('a punctuation-only styled item never wraps alone', () => {
    // Registry 9d: a lone styled comma must not become "*,*".
    const styled = doc.elements.map((e) => e.styledText ?? '').join('\n');
    expect(styled).not.toContain('**,**');
  });

  // EXPECTED FAIL WHEN RICH-FORMATTING PHASE 1 LANDS.
  //
  // Registry 9d records underline as NOT detected: it is drawn as vector
  // art, not font data. The rich-formatting spec's phase 1 changes that.
  // When it lands, this assertion fails, and that failure is the SIGNAL to
  // flip it, not a bug to work around.
  //
  // The first assertion matters as much as the second: checking only for
  // the absence of "_" would also pass if the sentence vanished entirely,
  // so a regression that dropped the text would look like success.
  test('underline is NOT detected yet (registry 9d)', () => {
    const el = doc.elements.find((e) => e.text.includes('underlined'));
    expect(el).toBeDefined();
    expect(el!.text).toBe('This word is underlined with drawn vector art.');
    expect(el!.styledText ?? '').not.toContain('_');
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `bun test tests/torture.test.ts`
Expected: FAIL if any coverage claim is wrong. Fix the **content**, not the
assertion, unless the assertion is wrong about the registry.

- [ ] **Step 3: Reconcile content and assertions**

Iterate until green. Every failure here is information: it means the
fixture did not actually exercise what the coverage table claims.

- [ ] **Step 4: Verify**

Run: `bun test tests/torture.test.ts`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add tests/torture.test.ts
git commit -m "Source-side assertions, including the underline expected-fail

The underline test asserts the exact plain sentence as well as the absence
of markers, so a regression that dropped the text cannot read as success."
```

---

## Task 10: The manifest and the completeness check

**Files:**
- Create: `tools/torture-manifest.json`
- Create: `tests/torture-coverage.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, test, expect } from 'bun:test';
import { readFileSync } from 'node:fs';

interface Row {
  entry: string;
  title: string;
  covered: boolean;
  page?: number;
  side?: 'source' | 'device' | 'both';
  how?: string;
  why?: string;
}

const manifest: Row[] = JSON.parse(readFileSync('tools/torture-manifest.json', 'utf8'));

/** Registry entry numbers, read from the registry's own ### headings. */
function registryEntries(): string[] {
  const md = readFileSync('docs/formatting-options-log.md', 'utf8');
  return [...md.matchAll(/^### (\d+[a-z]?)\./gm)].map((m) => m[1]);
}

describe('coverage manifest', () => {
  test('every registry entry has a row, covered or explicitly not', () => {
    const rows = new Set(manifest.map((r) => r.entry));
    const missing = registryEntries().filter((e) => !rows.has(e));
    expect(missing).toEqual([]);
  });

  test('no row names an entry the registry does not have', () => {
    const entries = new Set(registryEntries());
    const orphans = manifest.map((r) => r.entry).filter((e) => !entries.has(e));
    expect(orphans).toEqual([]);
  });

  test('covered rows say where and how; uncovered rows say why', () => {
    for (const row of manifest) {
      if (row.covered) {
        expect(typeof row.page).toBe('number');
        expect(row.side).toBeDefined();
        expect(row.how?.length ?? 0).toBeGreaterThan(0);
      } else {
        expect(row.why?.length ?? 0).toBeGreaterThan(0);
      }
    }
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `bun test tests/torture-coverage.test.ts`
Expected: FAIL, the manifest does not exist.

- [ ] **Step 3: Write the manifest**

Create `tools/torture-manifest.json` with one row per registry entry. Get
the authoritative list with:

```bash
grep -E "^### " docs/formatting-options-log.md
```

There are 33. Cover the ones the spec's table places, and give the four
declared gaps `"covered": false` with the spec's reasons. Example rows:

```json
[
  { "entry": "9d", "title": "Inline bold/italic pass-through",
    "covered": true, "page": 6, "side": "source",
    "how": "bold, italic and bold-italic runs in action and dialogue, plus a punctuation-only styled item" },
  { "entry": "10b", "title": "Tall dual exchanges degrade to sequential",
    "covered": true, "page": 7, "side": "both",
    "how": "a second dual exchange whose taller column passes 12 estimated rendered lines" },
  { "entry": "17", "title": "Print split minimums",
    "covered": true, "page": 8, "side": "device",
    "how": "saturation speeches with varied line counts, so breaks land inside dialogue at any font size" },
  { "entry": "14", "title": "Scanned-PDF bail-out",
    "covered": false,
    "why": "a screenplay fixture cannot also be a scanned page; blank-pages.pdf owns this" },
  { "entry": "4", "title": "Relative-unit scaling",
    "covered": false,
    "why": "a principle, not a content behavior: no PDF content could exercise it, and the CSS tests own it" }
]
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test tests/torture-coverage.test.ts`
Expected: all pass.

- [ ] **Step 5: Prove the completeness check goes red**

Temporarily add a fake entry to the registry:

```bash
printf '\n### 99. A deliberately uncovered behavior\n' >> docs/formatting-options-log.md
bun test tests/torture-coverage.test.ts
```

Expected: FAIL with `missing` containing `99`.

Then revert: `git checkout docs/formatting-options-log.md` and re-run.
Expected: pass.

- [ ] **Step 6: Commit**

```bash
git add tools/torture-manifest.json tests/torture-coverage.test.ts
git commit -m "Coverage manifest, diffed against the registry's own headings

Proven non-vacuous by appending a fake entry 99 and watching it fail. A
new entry with no decision attached fails the suite; 'covered: false' with
a reason is a decision, silence is not."
```

---

## Task 11: The device checklist

**Files:**
- Create: `tools/device-checklist.ts`

- [ ] **Step 1: Write it**

```typescript
#!/usr/bin/env bun
/**
 * Prints the device-side checklist for tests/fixtures/torture.pdf.
 *
 * Generated from tools/torture-manifest.json rather than hand-maintained,
 * so it cannot drift from the coverage the fixture actually has.
 *
 *   bun tools/device-checklist.ts
 */
import { readFileSync } from 'node:fs';

interface Row {
  entry: string;
  title: string;
  covered: boolean;
  page?: number;
  side?: string;
  how?: string;
}

const manifest: Row[] = JSON.parse(readFileSync('tools/torture-manifest.json', 'utf8'));
const device = manifest
  .filter((r) => r.covered && (r.side === 'device' || r.side === 'both'))
  .sort((a, b) => (a.page ?? 0) - (b.page ?? 0));

console.log('# Device pass: THE PROOF SHEET\n');
console.log('Convert tests/fixtures/torture.pdf, copy it to the device, and');
console.log('walk this list. Record findings in the registry entry named on');
console.log('each line, in its `Device verdict:` slot.\n');
console.log('Read it at TWO font sizes at least. Page breaks move with font');
console.log('size, and a keep that holds at one size can fail at another.\n');

for (const row of device) {
  console.log(`- [ ] **#${row.entry}, ${row.title}** (page ${row.page})`);
  console.log(`      ${row.how}\n`);
}

console.log(`${device.length} device-side entries.`);
```

- [ ] **Step 2: Run it**

Run: `bun tools/device-checklist.ts`
Expected: a markdown checklist naming each device-side entry with its page.

- [ ] **Step 3: Commit**

```bash
git add tools/device-checklist.ts
git commit -m "The device checklist generates from the manifest

Hand-maintaining it would guarantee a second, stale copy of the coverage
list, which is the failure the manifest exists to prevent."
```

---

## Task 12: Full verification and CI

**Files:**
- Modify: `docs/formatting-options-log.md` (pointer only)
- Modify: `CLAUDE.md` (fixture inventory)

- [ ] **Step 1: Full local verification**

```bash
bun test
bunx tsc --noEmit
```

Expected: all green.

- [ ] **Step 2: Validate the generated EPUB**

```bash
bun src/cli.ts tests/fixtures/torture.pdf -o /tmp/torture.epub
epubcheck /tmp/torture.epub
```

Expected: 0 errors, 0 warnings. This fixture is more hostile than anything
in the suite, so a structural EPUB defect would surface here first.

- [ ] **Step 3: Confirm python3 exists on the CI runner**

The engine job runs on `ubuntu-latest`, which ships Python 3, so no setup
step should be needed. **Verify rather than assume:** push the branch and
read the `engine` job's log for `tests/fixture-stability.test.ts`.

If `python3` is missing, add to `.github/workflows/ci.yml` in the `engine`
job, before `bun test`:

```yaml
      - uses: actions/setup-python@v5
        with:
          python-version: '3.12'
```

Pin it to a SHA to match the file's existing convention (`pinact run`).

- [ ] **Step 4: Update the docs that inventory fixtures**

In `CLAUDE.md`, the working-style section names the two fixture sets. Add
`torture.pdf` to the committed set with one line on what it is for.

In `docs/formatting-options-log.md`, add a pointer near the top:

```markdown
Coverage of these entries by the committed torture fixture is tracked in
`tools/torture-manifest.json`; `tests/torture-coverage.test.ts` fails when
a new entry has no decision recorded there.
```

- [ ] **Step 5: Commit**

```bash
git add CLAUDE.md docs/formatting-options-log.md .github/workflows/ci.yml
git commit -m "Docs and CI know about the proof sheet

The registry now says where its coverage is tracked, so the next person to
add an entry finds the manifest before the test tells them about it."
```

---

## Self-Review

**Spec coverage.** Every spec section maps to a task: the two physics and
the coverage table to Task 8, the four generator changes to Tasks 3 through
7, the manifest and its three consumers to Tasks 9 through 11, the
byte-stability guard to Task 1, expected-fail assertions to Task 9,
`python3` on CI to Task 12.

**One spec item this plan changes.** The spec says the guard proves the
three fixtures regenerate byte-identically. Task 5 knowingly breaks that:
adding four font resources changes their bytes. The plan regenerates them
and re-baselines in the same commit, and substitutes a stronger check for
that step, which is that the full suite still passes against the
regenerated files. Bytes are the guard against *accidental* change; the
suite is the guard against *meaningful* change. Worth knowing before
executing, because a worker following Task 1 literally will be surprised
at Task 5.

**Placeholder scan.** No TBD or TODO. Every code step carries real code.
Task 8's content is complete rather than sketched, and Task 10's manifest
shows five real rows with instructions for deriving the remaining 28 from
the registry, since transcribing all 33 here would duplicate a file the
executor can read.

**Type consistency.** `parse_markup` returns `(plain, spans)` in Tasks 3,
4, 6 and 7. `wrap_spans(plain, spans, width)` returns a list of lines of
`{styles, text}` dicts, consumed identically by `styled_row_ops` and
`dual_rows`. `font_for(styles)` takes the same style list throughout.
`flow_torture` emits rows as `(x, runs)` or `("multi", [(x, runs)])`, and
`torture_content_stream` handles exactly those two shapes plus `None`.
