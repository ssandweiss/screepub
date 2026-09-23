# Capture tool Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** One command, `bun tools/capture-screens.ts`, takes every README and site picture from the real window running the real engine on an invented script, with the same pixels every run.

**Architecture:** A committed invented script, Field Station, is made by the existing fixture generator. The tool serves the repository over `Bun.serve`, with one extra endpoint that answers the window's engine calls by running the real CLI, after an allow-list gate. It serves the window's own `index.html` with two capture scripts inserted: a stand-in for `window.__TAURI__` and a step runner that drives the window into each state. Headless Chrome is driven over its remote-control protocol (CDP). The tool waits for the page to report `ready` or `failed`, captures the window at 2x, then places that image in a drawn frame and captures again. The hero is the site's own before-and-after, held at a fixed scroll position.

**Tech Stack:** Bun + TypeScript (`bun test`, `bunx tsc --noEmit`), Python 3 (the fixture generator), Chrome at `/Applications/Google Chrome.app`. No new dependencies.

**Spec:** Part 3 of [docs/superpowers/specs/2026-09-22-readme-site-screens-design.md](../specs/2026-09-22-readme-site-screens-design.md), including its "Amended while planning" section. The machinery facts behind this plan were measured on 2026-09-22 with Chrome 153: a Chrome started with a blocking spawn from the process that serves its pages waits forever, because the server cannot answer; `--force-prefers-color-scheme=dark` does nothing, while the protocol's `Emulation.setEmulatedMedia` works; `--screenshot` photographs whatever is on screen when its time budget runs out, a failed state included; and ES modules do not load from `file://`, so the pages are served.

---

## Files

| File | Responsibility |
| --- | --- |
| `tools/field-station-content.py` | The invented script, as data: title page and 18 pages of rows. |
| `tools/make-fixture.py` | Gains a `demo` kind that lays the content out page by page. |
| `tests/fixtures/field-station.pdf` | The generated, committed script. |
| `tests/fixture-stability.test.ts` | Adds `demo` to the byte-for-byte regeneration check. |
| `tests/field-station.test.ts` | The engine converts it as a real feature, and the site's scene appears in it word for word. |
| `tools/capture/gate.ts` | Pure: which engine calls the capture may make. |
| `tools/capture/page.ts` | Pure: the window's `index.html` with the capture scripts inserted. |
| `tools/capture/shots.ts` | Pure: the list of pictures, their sizes, themes and output paths, and write-if-changed. |
| `tools/capture/cdp.ts` | Launches headless Chrome and speaks its protocol. |
| `tools/capture/server.ts` | What the page server answers: `desktop/ui/`, `site/` and `tools/capture/` only, the window page, the first-pass pictures, and `/engine` through the gate. Added in review (Task 9). |
| `tools/capture/run.ts` | One capture run: the marked scratch library it owns, every shot, and the cleanup of everything it made. Added in review (Task 9). |
| `tools/capture/bridge.js` | Browser: the stand-in for `window.__TAURI__`. |
| `tools/capture/steps.js` | Browser: drives the window into a shot's state and reports `ready` or `failed`. |
| `tools/capture/frame.html` | Browser: pass two, the drawn window frame around a pass-one image. |
| `tools/capture/hero.html` | Browser: the site in a frame, held at the before-and-after. |
| `tools/capture-screens.ts` | The command: server, gate, library folder, Chrome, every shot, outputs. |
| `tests/capture.test.ts` | Tests for the three pure modules, and that nothing leaked into `desktop/ui`. Since the Task 9 review, also the page server and whole runs with a fake browser and engine. |
| `tests/capture-chrome.test.ts` | The real Chrome driver against a fake Chrome, and a run that fails at once on a server error. Added in review (Task 9). |
| `tests/fixtures/fake-chrome/chrome.sh` | The fake Chrome: writes the debugging port file, records its profile folder, and waits to be stopped. Added in review (Task 9). |

Nothing in `desktop/ui/` changes. The interface-pass session owns it.

---

### Task 1: Field Station, as data

**Files:**
- Create: `tools/field-station-content.py`

The site's scene must appear word for word on pages 14 to 18, where the site's own page markers put it. Pages 1 to 13 are new, written to lead into it. Every name is invented; the project rule is that no real title, author or character name reaches a picture.

- [ ] **Step 1: Write the file's frame and the site's pages**

Create `tools/field-station-content.py`:

```python
"""Field Station: the invented feature the README and site pictures show.

Data only, in its own file the way torture-content.py is, so the person
writing screenplay never has to read layout code. tools/make-fixture.py's
`demo` kind lays it out; tests/fixture-stability.test.ts pins the result;
tests/field-station.test.ts checks the site's scene survives into the book.

Every name here is invented. The project rule (CLAUDE.md) is that no real
title, author or character name ever reaches a picture, and this script
exists to be pictured.

PAGES is a list of pages, each a list of (kind, text) rows. A page is laid
out exactly as written and the generator refuses one that overflows, so the
printed page numbers stay where the site's markers say they are: pages 14
to 18 are site/index.html's window.SCENE, word for word.

Kinds: scene, action, character, paren, dialogue, trans.
"""

TITLE = [
    (4.0, "FIELD STATION"),
    (4.5, "Written by"),
    (5.0, "the Screepub project"),
]

# Pages 1-13: written in Task 1 Step 2, to the outline in the plan.
PAGES_BEFORE = []

# Pages 14-18: site/index.html window.SCENE, word for word. Split at the
# site's own ['pg', ...] markers. Curly apostrophes are fine here: the
# generator's ASCII_MAP straightens them, as it does for every fixture.
SITE_PAGES = [
    [  # 14.
        ("scene", "INT. FIELD STATION - NIGHT"),
        ("action", "The generator coughs once and dies. MARA works by the light of her phone, hands steady, and does not look up."),
        ("character", "MARA"), ("dialogue", "Give it a minute. It always comes back."),
        ("character", "DELACROIX"), ("dialogue", "And if it doesn't?"),
        ("action", "She finds the housing bolt by feel. Turns it a quarter turn."),
        ("character", "MARA"), ("dialogue", "Then we do this in the dark."),
        ("action", "The wind takes the tarp on the north wall and holds it open like a door nobody opened."),
        ("character", "DELACROIX"), ("dialogue", "That's not an answer."),
        ("character", "MARA"), ("dialogue", "It's the one I have."),
        ("action", "He crosses to the window. Outside, the ridge is a black line against a slightly less black sky."),
        ("character", "DELACROIX"), ("dialogue", "Nineteen hours until the relief team. I counted."),
        ("character", "MARA"), ("dialogue", "Then stop counting."),
    ],
    [  # 15.
        ("action", "The generator catches. Dies again. Catches."),
        ("action", "Light comes up amber and unsteady, and the room assembles itself around them: the cot, the radio, the map with its four pins."),
        ("character", "MARA (CONT'D)"), ("dialogue", "There. Told you."),
        ("character", "DELACROIX"), ("dialogue", "You told me a minute. That was six."),
        ("character", "MARA"), ("dialogue", "I rounded."),
        ("action", "She wipes her hands on her thigh and sits, finally, like the sitting costs her something."),
        ("character", "DELACROIX"), ("dialogue", "You should sleep."),
        ("character", "MARA"), ("dialogue", "You should stop saying that."),
        ("action", "A long moment. The radio hisses, says nothing, hisses."),
        ("character", "DELACROIX"), ("dialogue", "If the relief doesn't come."),
        ("character", "MARA"), ("dialogue", "They'll come."),
        ("character", "DELACROIX"), ("dialogue", "If."),
    ],
    [  # 16.
        ("character", "MARA"), ("dialogue", "Then we walk out the way we walked in, and it takes four days instead of one, and you complain the entire time."),
        ("character", "DELACROIX"), ("dialogue", "I don't complain."),
        ("character", "MARA"), ("dialogue", "You're complaining now."),
        ("action", "He almost laughs. It is the first honest sound either of them has made all night."),
        ("character", "DELACROIX"), ("dialogue", "Get some sleep. I'll take the radio."),
        ("action", "She doesn't argue, which frightens him more than the dark did."),
        ("trans", "CUT TO:"),
        ("scene", "INT. FIELD STATION - DAWN"),
        ("action", "Grey light. The tarp is down. The map is gone from the wall."),
    ],
    [  # 17.
        ("action", "DELACROIX sits exactly where he sat, the handset still in his fist, asleep with his eyes open the way soldiers learn."),
        ("action", "The radio speaks. One word, clipped, in a voice neither of them has heard."),
        ("action", "He is awake before he knows he is awake."),
        ("character", "DELACROIX"), ("dialogue", "Say again."),
        ("action", "Nothing. The hiss closes over the word like water."),
        ("character", "DELACROIX (CONT'D)"), ("dialogue", "Say again."),
        ("action", "He turns the dial one notch, then back, then one notch the other way, hunting the frequency the way you hunt a name you have almost remembered."),
        ("character", "MARA (O.S.)"), ("dialogue", "What was it?"),
    ],
    [  # 18.
        ("action", "She is in the doorway. She has not slept and does not pretend otherwise."),
        ("character", "DELACROIX"), ("dialogue", "A voice. One word. I couldn't hold it."),
        ("character", "MARA"), ("dialogue", "Which word?"),
        ("action", "He looks at the handset, then at her."),
        ("character", "DELACROIX"), ("dialogue", "Ours."),
        ("action", "Outside, very far off, something that is not the wind moves along the ridge."),
        ("trans", "FADE OUT."),
    ],
]

PAGES = PAGES_BEFORE + SITE_PAGES
```

- [ ] **Step 2: Write pages 1 to 13 into `PAGES_BEFORE`**

Thirteen pages, each a list of rows, each short enough to fit one page. The generator refuses a page over 55 lines, so aim for about 40 laid-out lines a page: roughly four to six short action paragraphs and eight to twelve exchanges. Tone matches the site's scene: spare, dry, weather as a character. No real place names.

**Amended in review (2026-09-22).** The page-by-page outline and cast list
that stood here drifted from the pages as they were written and reviewed,
so they are gone rather than kept as a second, wrong copy of the script.
`tools/field-station-content.py` is the source of truth for the pages and
the cast. The radio voice was renamed IVERSEN in df2c8c8, because the name
it was first given was too close to a well-known film character.

Replace `PAGES_BEFORE = []` with the thirteen pages. Keep each speech to one to three short sentences.

- [ ] **Step 3: Check the file loads and has 18 pages**

Run:

```bash
python3 -c "import importlib.util,pathlib; p=pathlib.Path('tools/field-station-content.py'); s=importlib.util.spec_from_file_location('fs',p); m=importlib.util.module_from_spec(s); s.loader.exec_module(m); print(len(m.PAGES), sum(1 for pg in m.PAGES for k,_ in pg if k=='scene'))"
```

Expected: `18 11` (18 pages, 11 scene headings).

### Task 2: The `demo` kind

**Files:**
- Modify: `tools/make-fixture.py` (after `KINDS["torture"] = torture_streams`)
- Modify: `tests/fixture-stability.test.ts`
- Create: `tests/fixtures/field-station.pdf`

- [ ] **Step 1: Add `demo` to the stability test first**

In `tests/fixture-stability.test.ts`, replace:

```ts
  const COMMITTED = {
    screenplay: 'tests/fixtures/screenplay.pdf',
    prose: 'tests/fixtures/prose.pdf',
    blank: 'tests/fixtures/blank-pages.pdf',
  } as const;
```

with:

```ts
  const COMMITTED = {
    screenplay: 'tests/fixtures/screenplay.pdf',
    prose: 'tests/fixtures/prose.pdf',
    blank: 'tests/fixtures/blank-pages.pdf',
    // The invented feature the README and site pictures show. Regenerated
    // byte for byte like the others, so a generator refactor cannot quietly
    // change what the pictures are of.
    demo: 'tests/fixtures/field-station.pdf',
  } as const;
```

- [ ] **Step 2: Run it and watch it fail**

Run: `bun test tests/fixture-stability.test.ts`
Expected: the `demo` test FAILS, because `make-fixture.py` has no `demo` kind (non-zero exit, stderr names the kind).

- [ ] **Step 3: Add the kind to the generator**

In `tools/make-fixture.py`, directly after the line `KINDS["torture"] = torture_streams`, add:

```python
# --- demo: the invented feature the README and site pictures show ---------
# Laid out PAGE BY PAGE, not flowed: the site's scene has to land on printed
# pages 14 to 18, where the site's own page markers say it is. So each page
# is drawn exactly as tools/field-station-content.py writes it, and a page
# that does not fit is an error rather than a silent reflow that would move
# every page number after it.

def _demo_content():
    import importlib.util
    import pathlib
    path = pathlib.Path(__file__).with_name("field-station-content.py")
    spec = importlib.util.spec_from_file_location("field_station_content", path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


# A real script puts no blank line between a character name and what that
# character says, so neither does this. Everything else gets one above it.
_JOINED_TO_CUE = {"paren", "dialogue"}


def flow_page(rows):
    """One page of (kind, text) rows -> the (x, text) / None rows
    content_stream draws. Raises SystemExit if the page overflows."""
    out = []
    for kind, text in rows:
        if out and kind not in _JOINED_TO_CUE:
            out.append(None)
        for chunk in textwrap.wrap(text, WRAP[kind]) or [""]:
            out.append((X[kind], chunk))
    if len(out) > LINES_PER_PAGE:
        raise SystemExit(
            f"field-station page overflows: {len(out)} lines, the limit is "
            f"{LINES_PER_PAGE}. It starts: {rows[0]!r}")
    return out


def demo_streams():
    mod = _demo_content()
    return [title_stream(mod.TITLE)] + [
        content_stream(flow_page(p), i + 1 if i else None)
        for i, p in enumerate(mod.PAGES)
    ]


KINDS["demo"] = demo_streams
```

- [ ] **Step 4: Generate the PDF and rerun the stability test**

Run:

```bash
python3 tools/make-fixture.py demo tests/fixtures/field-station.pdf && mdls -raw -name kMDItemNumberOfPages tests/fixtures/field-station.pdf
```

Expected: `19` (the title page plus 18). If it raises "page overflows", shorten that page in Task 1 and rerun.

Run: `bun test tests/fixture-stability.test.ts`
Expected: PASS, all four kinds.

### Task 3: The engine reads it as a real feature, and the site's scene survives

**Files:**
- Create: `tests/field-station.test.ts`

- [ ] **Step 1: Write the test**

```ts
// tests/fixtures/field-station.pdf is the invented feature every README and
// site picture shows. Two things must hold for the pictures to be honest:
// the engine reads it as a real screenplay (so the result screen's counts
// and the scene index look like a feature), and the scene the SITE draws
// really is in the book, word for word, on the pages the site says, so the
// site's before-and-after and the window's pictures show one story.
import { describe, test, expect } from 'bun:test';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname;
const PDF = join(ROOT, 'tests', 'fixtures', 'field-station.pdf');

async function convert() {
  const out = mkdtempSync(join(tmpdir(), 'screepub-field-station-'));
  const proc = Bun.spawn(
    ['bun', join(ROOT, 'src', 'cli.ts'), PDF, '--json', '-o', join(out, 'field-station.epub')],
    { stdout: 'pipe', stderr: 'pipe' },
  );
  const [stdout, code] = await Promise.all([new Response(proc.stdout).text(), proc.exited]);
  expect(code).toBe(0);
  return JSON.parse(stdout) as {
    ok: boolean; title: string; pages: number; scenes: number; characters: number;
    fountainPath: string;
  };
}

/** site/index.html's window.SCENE, read out of the page itself. */
function siteScene(): [string, string][] {
  const html = readFileSync(join(ROOT, 'site', 'index.html'), 'utf8');
  const m = /window\.SCENE = (\[[\s\S]*?\n\]);/.exec(html);
  if (!m) throw new Error('site/index.html no longer declares window.SCENE');
  // Our own file, and an array literal of string pairs.
  return new Function(`return ${m[1]}`)() as [string, string][];
}

const plain = (s: string) =>
  s.replace(/[’‘]/g, "'").replace(/[“”]/g, '"').replace(/\s+/g, ' ').trim();

describe('Field Station', () => {
  test('the engine reads it as a feature, with the invented title and cast', async () => {
    const a = await convert();
    expect(a.ok).toBe(true);
    expect(a.title.toUpperCase()).toBe('FIELD STATION');
    expect(a.scenes).toBe(11);
    expect(a.pages).toBeGreaterThanOrEqual(18);
    expect(a.characters).toBeGreaterThanOrEqual(3);
  });

  test('every line of the site’s scene is in the book, word for word', async () => {
    const a = await convert();
    const fountain = plain(readFileSync(a.fountainPath, 'utf8'));
    for (const [kind, text] of siteScene()) {
      if (kind === 'pg' || kind === 'c') continue; // markers, and cues the engine normalises
      expect(fountain).toContain(plain(text));
    }
  });

  test('the site’s scene starts on printed page 14, as the site says it does', async () => {
    const a = await convert();
    const fountain = readFileSync(a.fountainPath, 'utf8');
    // Page markers travel as synopsis lines, `= pg N` (registry 13a).
    const at14 = fountain.indexOf('= pg 14');
    const scene = fountain.indexOf('INT. FIELD STATION - NIGHT');
    expect(at14).toBeGreaterThanOrEqual(0);
    expect(scene).toBeGreaterThan(at14);
    expect(fountain.indexOf('= pg 15')).toBeGreaterThan(scene);
  });
});
```

- [ ] **Step 2: Run it**

Run: `bun test tests/field-station.test.ts`
Expected: PASS. If the scene count differs, the fix is in the content (a missing or extra scene heading), never in the test's number: the outline has 11.

If `= pg 14` is not found, open the generated fountain and check how page markers are written before changing anything; registry 13a in `docs/formatting-options-log.md` describes them.

- [ ] **Step 3: Commit**

```bash
git add tools/field-station-content.py tools/make-fixture.py tests/fixtures/field-station.pdf tests/fixture-stability.test.ts tests/field-station.test.ts
git commit -m "Field Station: an invented feature for the pictures to show

The site already drew one scene of it. This is the whole script, 18 pages
and 11 scenes, made by the fixture generator's new demo kind and pinned
byte for byte like the other fixtures. The site's scene sits on printed
pages 14 to 18, word for word, where the site's own page markers put it,
and a test checks both halves of that.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 4: The engine gate

**Superseded in review (2026-09-22, commit 4d5cd7f).** The gate code below
checked only a call's first argument and its first `-o`, and the code review
showed six shapes that still wrote or read any file (`--fountain`,
`--preview-html`, `--output` and its `=` and joined forms, a repeated `-o`, a
convert without `--library`, `--options`). The committed gate instead
rebuilds each call with the window's own `argv` builders and allows it only
on an exact match, failing closed on anything else, with a refusal test for
every one of those shapes. The code below is kept as the record of what was
planned.

**Files:**
- Create: `tools/capture/gate.ts`
- Create: `tests/capture.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `tests/capture.test.ts`:

```ts
// The capture tool's pure parts. The picture-taking itself needs Chrome and
// runs in /release; everything that DECIDES something is tested here.
import { describe, test, expect } from 'bun:test';
import { gateEngineCall } from '../tools/capture/gate';
import { argv } from '../desktop/ui/app.js';

const ctx = {
  demoPdf: '/repo/tests/fixtures/field-station.pdf',
  library: '/Users/Shared/Documents/Screepub',
};
const inLib = (p: string) => `${ctx.library}/field-station/${p}`;

describe('the engine gate', () => {
  test('it allows exactly what the window asks for on the way to the pictures', () => {
    // Built with the WINDOW'S OWN argv builders, so a flag the window adds
    // tomorrow is still recognised as the same call.
    expect(gateEngineCall(argv.version(), ctx)).toEqual({ allow: true });
    expect(gateEngineCall(argv.convert(ctx.demoPdf), ctx)).toEqual({ allow: true });
    expect(gateEngineCall(argv.settings(inLib('field-station.fountain')), ctx)).toEqual({ allow: true });
    expect(
      gateEngineCall(argv.reconvert(inLib('field-station.fountain'), inLib('field-station.epub'), '{}'), ctx),
    ).toEqual({ allow: true });
  });

  test('it refuses anything that reaches devices or writes outside the demo library, naming it', () => {
    for (const args of [
      argv.devices(),
      argv.send(inLib('field-station.epub')),
      argv.export(inLib('field-station.epub'), { forFormat: 'kindle' }),
    ]) {
      const a = gateEngineCall(args, ctx);
      expect(a.allow).toBe(false);
      if (!a.allow) expect(a.reason).toContain(args[0]!);
    }
  });

  test('it refuses a conversion of any file but the demo script', () => {
    const a = gateEngineCall(argv.convert('/Users/someone/real-script.pdf'), ctx);
    expect(a.allow).toBe(false);
    if (!a.allow) expect(a.reason).toContain('real-script.pdf');
  });

  test('it refuses a re-render that would write outside the library', () => {
    const a = gateEngineCall(argv.reconvert(inLib('field-station.fountain'), '/tmp/elsewhere.epub', '{}'), ctx);
    expect(a.allow).toBe(false);
    // A path that merely STARTS with the library's name is not inside it.
    const b = gateEngineCall(argv.settings(`${ctx.library}-evil/x.fountain`), ctx);
    expect(b.allow).toBe(false);
  });

  test('an empty call is refused, not allowed by default', () => {
    expect(gateEngineCall([], ctx).allow).toBe(false);
  });
});
```

- [ ] **Step 2: Run and watch it fail**

Run: `bun test tests/capture.test.ts`
Expected: FAIL, `Cannot find module '../tools/capture/gate'`.

If instead the import of `../desktop/ui/app.js` fails to type-check under `bunx tsc --noEmit`, add `// @ts-expect-error -- plain JS module, no types` above that import line. `tests/desktop-ui.test.ts` already imports window modules, so first copy exactly how it does.

- [ ] **Step 3: Write the gate**

Create `tools/capture/gate.ts`:

```ts
// Which engine calls the capture tool may make on the window's behalf.
//
// The capture server answers each engine call the window makes by running
// the REAL CLI with exactly those arguments, so every answer in a picture
// is real by construction. What it must never do is let a picture reach
// anything real besides the demo: a connected Kindle, a send, an export,
// or a file that is not the invented script. So every call passes this
// gate first, and a refusal fails the whole capture, naming the call.
//
// Pure. tests/capture.test.ts builds its cases with the window's own argv
// builders from desktop/ui/app.js, so the gate recognises the window's
// calls rather than a copy of them.

import { resolve, sep } from 'node:path';

export interface GateContext {
  /** The one file the capture may convert. */
  demoPdf: string;
  /** The scratch library the engine writes into for the capture. */
  library: string;
}

export type GateAnswer = { allow: true } | { allow: false; reason: string };

/** Verbs that reach hardware or write a file somewhere a person chose. */
const REFUSED_VERBS = new Set(['devices', 'send', 'export', 'update-decision', 'update-should-check']);

const refuse = (reason: string): GateAnswer => ({ allow: false, reason });

function inside(path: string | undefined, dir: string): boolean {
  if (!path) return false;
  const p = resolve(path);
  const d = resolve(dir);
  return p.startsWith(d + sep);
}

export function gateEngineCall(args: readonly string[], ctx: GateContext): GateAnswer {
  if (args.length === 0) return refuse('an empty engine call');
  const [first] = args as [string, ...string[]];

  if (first === '--version') return { allow: true };

  if (REFUSED_VERBS.has(first)) {
    return refuse(`${first}: it reaches a device or writes outside the demo library`);
  }

  // Wherever the call names an output with -o, that output must be inside
  // the library, whatever else the call is.
  const o = args.indexOf('-o');
  if (o !== -1 && !inside(args[o + 1], ctx.library)) {
    return refuse(`${first} -o ${args[o + 1] ?? '<nothing>'}: writes outside the demo library`);
  }

  if (first === 'settings') {
    return inside(args[1], ctx.library)
      ? { allow: true }
      : refuse(`settings ${args[1] ?? '<nothing>'}: not a script in the demo library`);
  }

  // Otherwise the first argument is an input file: the demo script itself,
  // or the cached .fountain the window re-renders from.
  if (resolve(first) === resolve(ctx.demoPdf)) return { allow: true };
  if (inside(first, ctx.library)) return { allow: true };
  return refuse(`a conversion of ${first}: it is not the demo script`);
}
```

- [ ] **Step 4: Run the tests**

Run: `bun test tests/capture.test.ts`
Expected: PASS.

### Task 5: The window's page, with the capture scripts inserted

**Files:**
- Create: `tools/capture/page.ts`
- Modify: `tests/capture.test.ts` (append)

- [ ] **Step 1: Append the failing tests**

Append to `tests/capture.test.ts`:

```ts
import { readFileSync as readFile, readdirSync } from 'node:fs';
import { captureIndex } from '../tools/capture/page';

describe('the window page the capture serves', () => {
  const real = readFile('desktop/ui/index.html', 'utf8');
  const cfg = { shot: 'result', demoPdf: '/Users/Shared/demo.pdf' };

  test('it is the window’s own index.html, with the capture scripts inserted before main.js', () => {
    const out = captureIndex(real, cfg);
    // Every stylesheet the window loads, still loaded: the page is served,
    // not copied, so a stylesheet added to the window tomorrow comes along.
    for (const m of real.matchAll(/<link rel="stylesheet" href="([^"]+)"/g)) {
      expect(out).toContain(`href="${m[1]}"`);
    }
    const bridge = out.indexOf('/tools/capture/bridge.js');
    const main = out.indexOf('src="main.js"');
    const steps = out.indexOf('/tools/capture/steps.js');
    expect(bridge).toBeGreaterThan(0);
    expect(bridge).toBeLessThan(main);
    expect(steps).toBeGreaterThan(main);
    // Relative URLs resolve against the window's folder.
    expect(out).toContain('<base href="/desktop/ui/">');
    expect(out).toContain(JSON.stringify(cfg));
  });

  test('a window page it does not recognise fails loudly instead of capturing a blank', () => {
    expect(() => captureIndex('<html><body>nothing</body></html>', cfg)).toThrow(/main\.js/);
    const twice = real.replace('</body>', '<script type="module" src="main.js"></script></body>');
    expect(() => captureIndex(twice, cfg)).toThrow(/exactly once/);
  });
});

describe('nothing from the capture ships in the window', () => {
  test('no file in desktop/ui knows the capture tool exists', () => {
    for (const f of readdirSync('desktop/ui')) {
      if (!/\.(js|html|css)$/.test(f)) continue;
      const text = readFile(`desktop/ui/${f}`, 'utf8');
      expect(`${f}: ${/__CAPTURE__|__captureState|tools\/capture/.test(text)}`).toBe(`${f}: false`);
    }
  });
});
```

- [ ] **Step 2: Run and watch it fail**

Run: `bun test tests/capture.test.ts`
Expected: FAIL, `Cannot find module '../tools/capture/page'`.

- [ ] **Step 3: Write the transform**

Create `tools/capture/page.ts`:

```ts
// The window's own desktop/ui/index.html, with the capture scripts inserted.
//
// Served, never copied: a copy would be a second definition of the window's
// page, and the day the window added a stylesheet the pictures would quietly
// stop matching the app. So the server reads the real file on every request
// and inserts three things:
//
//   <base href="/desktop/ui/">       relative URLs resolve as in the app
//   window.__CAPTURE__ = {...}        which shot, and where the demo PDF is
//   bridge.js BEFORE main.js          window.__TAURI__ exists when main.js
//                                     makes its first engine call at boot
//   steps.js AFTER main.js            drives the window into the shot
//
// Module scripts run in document order, which is the whole mechanism.

export interface CaptureConfig {
  shot: string;
  demoPdf: string;
}

const MAIN = '<script type="module" src="main.js"></script>';

export function captureIndex(html: string, cfg: CaptureConfig): string {
  const count = html.split(MAIN).length - 1;
  if (count !== 1) {
    throw new Error(
      `capture: desktop/ui/index.html must load main.js exactly once as ${MAIN}; ` +
        `found ${count}. The window changed shape; update tools/capture/page.ts.`,
    );
  }
  if (!html.includes('<head>')) throw new Error('capture: desktop/ui/index.html has no <head>');
  const head =
    '<head>\n    <base href="/desktop/ui/">\n' +
    `    <script>window.__CAPTURE__ = ${JSON.stringify(cfg)};</script>`;
  const scripts =
    '<script type="module" src="/tools/capture/bridge.js"></script>\n    ' +
    MAIN +
    '\n    <script type="module" src="/tools/capture/steps.js"></script>';
  return html.replace('<head>', head).replace(MAIN, scripts);
}
```

- [ ] **Step 4: Run the tests**

Run: `bun test tests/capture.test.ts`
Expected: PASS.

### Task 6: The shot list, and writing only what changed

**Files:**
- Create: `tools/capture/shots.ts`
- Modify: `tests/capture.test.ts` (append)

- [ ] **Step 1: Append the failing tests**

```ts
import { mkdtempSync as tmp, readFileSync as readBytes } from 'node:fs';
import { tmpdir as osTmp } from 'node:os';
import { join as joinPath } from 'node:path';
import { SHOTS, outputsFor, writeIfChanged } from '../tools/capture/shots';

describe('the shot list', () => {
  test('the four README pictures, with light and dark for the window ones', () => {
    expect(SHOTS.map((s) => s.name)).toEqual(['hero', 'drop', 'result', 'read']);
    for (const s of SHOTS) {
      expect(s.themes).toEqual(s.kind === 'window' ? ['light', 'dark'] : ['light']);
    }
  });

  test('the window pictures are the window’s own size', () => {
    // tauri.conf.json's window is 860 by 620.
    const conf = JSON.parse(readFile('desktop/src-tauri/tauri.conf.json', 'utf8'));
    const w = conf.app.windows[0];
    for (const s of SHOTS.filter((x) => x.kind === 'window')) {
      expect([s.width, s.height]).toEqual([w.width, w.height]);
    }
  });

  test('the README gets every picture; the site gets the light drop and result', () => {
    const all = SHOTS.flatMap((s) => s.themes.flatMap((t) => outputsFor(s, t)));
    expect(all.filter((p) => p.startsWith('assets/screens/')).length).toBe(7);
    expect(all.filter((p) => p.startsWith('site/img/')).sort()).toEqual([
      'site/img/drop-light.png',
      'site/img/result-light.png',
    ]);
  });

  test('a file is written only when its bytes differ', () => {
    const dir = tmp(joinPath(osTmp(), 'screepub-capture-'));
    const path = joinPath(dir, 'x.png');
    expect(writeIfChanged(path, new Uint8Array([1, 2, 3]))).toBe('written');
    expect(writeIfChanged(path, new Uint8Array([1, 2, 3]))).toBe('unchanged');
    expect(writeIfChanged(path, new Uint8Array([1, 2, 4]))).toBe('written');
    expect([...readBytes(path)]).toEqual([1, 2, 4]);
  });
});
```

- [ ] **Step 2: Run and watch it fail**

Run: `bun test tests/capture.test.ts`
Expected: FAIL, `Cannot find module '../tools/capture/shots'`.

- [ ] **Step 3: Write the shot list**

Create `tools/capture/shots.ts`:

```ts
// Every picture the capture tool takes, and where each one goes.
//
// The README gets all of them (spec 2026-09-22, decision 7): the hero, the
// drop-and-result pair and reading, window pictures in light AND dark so
// GitHub shows the one matching the reader's theme. The site gets the light
// drop and result for its "Drag and drop" section; it has no dark mode.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

export type Theme = 'light' | 'dark';

export interface Shot {
  name: 'hero' | 'drop' | 'result' | 'read';
  /** window: the app, framed. site: a web page, captured as it is. */
  kind: 'window' | 'site';
  width: number;
  height: number;
  themes: Theme[];
  /** Copied into site/img/ as well, light only. */
  site: boolean;
}

export const SHOTS: Shot[] = [
  { name: 'hero', kind: 'site', width: 1200, height: 760, themes: ['light'], site: false },
  { name: 'drop', kind: 'window', width: 860, height: 620, themes: ['light', 'dark'], site: true },
  { name: 'result', kind: 'window', width: 860, height: 620, themes: ['light', 'dark'], site: true },
  { name: 'read', kind: 'window', width: 860, height: 620, themes: ['light', 'dark'], site: false },
];

export function outputsFor(shot: Shot, theme: Theme): string[] {
  const file = `${shot.name}-${theme}.png`;
  const out = [`assets/screens/${file}`];
  if (shot.site && theme === 'light') out.push(`site/img/${file}`);
  return out;
}

/** Same pixels in, same bytes out, so a release where the window did not
 *  change commits no new images and the repository does not grow. */
export function writeIfChanged(path: string, bytes: Uint8Array): 'written' | 'unchanged' {
  if (existsSync(path)) {
    const old = readFileSync(path);
    if (old.length === bytes.length && old.equals(Buffer.from(bytes))) return 'unchanged';
  }
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, bytes);
  return 'written';
}
```

- [ ] **Step 4: Run the tests and commit Tasks 4 to 6**

Run: `bun test tests/capture.test.ts && bunx tsc --noEmit`
Expected: PASS, and no type errors.

```bash
git add tools/capture/gate.ts tools/capture/page.ts tools/capture/shots.ts tests/capture.test.ts
git commit -m "The capture tool's decisions: the engine gate, the page, the shot list

Pure and tested. The gate lets the capture make the window's engine calls
on the invented script and nothing else: no devices, no send, no export,
no other file, nothing written outside the demo library. The page is the
window's own index.html with the capture scripts inserted, never a copy.
The shot list names every picture and where it goes, and a picture is
rewritten only when its bytes change.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 7: The browser side

**Files:**
- Create: `tools/capture/bridge.js`
- Create: `tools/capture/steps.js`
- Create: `tools/capture/frame.html`
- Create: `tools/capture/hero.html`

These run in Chrome and are exercised by the capture run itself (Task 9), not by `bun test`, the same way the window's own drawing code rides on its live run.

- [ ] **Step 1: The bridge**

Create `tools/capture/bridge.js`:

```js
// A stand-in for window.__TAURI__, for the capture tool only.
//
// Exactly what desktop/ui/app.js uses and nothing more: core.invoke for
// run_engine and pick_file, and event.listen. opener and updater are absent
// on purpose, so the window draws itself as a build without the updater
// would, and no picture shows an update prompt.
//
// run_engine does not fake anything. It posts the window's own argument list
// to the capture server, which runs the real CLI through an allow-list gate
// (tools/capture/gate.ts) and returns its stdout, exactly as the Rust does.
// A refused call fails the capture, naming the call.

const cfg = window.__CAPTURE__;
const listeners = new Map();

window.__captureState = 'working';

export function fail(message) {
  if (window.__captureState === 'failed') return;
  window.__captureState = 'failed';
  window.__captureError = String(message);
}

export function fire(name, payload) {
  for (const handler of listeners.get(name) ?? []) handler({ payload });
}

window.__TAURI__ = {
  core: {
    async invoke(command, payload) {
      if (command === 'run_engine') {
        // The per-run token the server requires on /engine, so no other
        // page open in a browser on this machine can post engine calls to
        // the capture server's port while it runs.
        const response = await fetch('/engine', {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'x-capture-token': cfg.token },
          body: JSON.stringify({ args: payload.args }),
        });
        const text = await response.text();
        if (!response.ok) {
          fail(`engine call refused: ${text}`);
          throw text;
        }
        return text;
      }
      if (command === 'pick_file') return cfg.demoPdf;
      fail(`the window invoked "${command}", which the capture bridge does not provide`);
      throw `unknown command ${command}`;
    },
  },
  event: {
    async listen(name, handler) {
      if (!listeners.has(name)) listeners.set(name, []);
      listeners.get(name).push(handler);
      return () => {};
    },
  },
};
```

- [ ] **Step 2: The step runner**

Create `tools/capture/steps.js`:

```js
// Drives the window into one shot's state, the way a person would, then
// reports window.__captureState = 'ready' or 'failed'. The capture tool
// waits on that before it takes the picture, so a failed state is never
// photographed.

import { fail, fire } from '/tools/capture/bridge.js';

const cfg = window.__CAPTURE__;
const q = (selector) => document.querySelector(selector);

async function until(test, what, ms = 30000) {
  const start = performance.now();
  while (!test()) {
    if (window.__captureState === 'failed') throw new Error(window.__captureError);
    if (performance.now() - start > ms) throw new Error(`timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 50));
  }
}

const frames = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));

// The version stamp changes every release. Left in, every picture would
// change every release and the repository would grow by megabytes each
// time. Hidden, a picture changes only when the window's look does.
function hideStamp() {
  const style = document.createElement('style');
  style.textContent = '.rev-stamp { visibility: hidden !important; }';
  document.head.append(style);
}

async function dropped() {
  await until(() => q('#surface-convert[data-state="idle"]'), 'the drop well');
  // Exactly the event Tauri fires when a file lands on the window.
  fire('tauri://drag-drop', { paths: [cfg.demoPdf], position: { x: 400, y: 300 } });
  await until(() => q('#surface-convert[data-state="done"]'), 'the finished book');
}

const SHOTS = {
  async drop() {
    await until(() => q('#surface-convert[data-state="idle"]'), 'the drop well');
  },
  async result() {
    await dropped();
  },
  async read() {
    await dropped();
    q('#tab-read').click();
    await until(() => document.querySelectorAll('#surface-read .scene-rail button').length > 0,
      'the scene index');
    const frame = q('#surface-read .script-frame');
    await until(() => frame?.contentDocument?.querySelector('section.scene'), 'the script');
  },
};

try {
  const run = SHOTS[cfg.shot];
  if (!run) throw new Error(`no capture steps for shot "${cfg.shot}"`);
  hideStamp();
  await run();
  await document.fonts.ready;
  await frames();
  await new Promise((r) => setTimeout(r, 250));
  if (window.__captureState !== 'failed') window.__captureState = 'ready';
} catch (error) {
  fail(error?.message ?? error);
}
```

- [ ] **Step 3: Pass two, the frame**

Create `tools/capture/frame.html`:

```html
<!doctype html>
<!-- Pass two of a window picture. Pass one captured the window at its own
     860 by 620 size (it pins its binding with fixed positioning, so it
     cannot be drawn inside a smaller box). This page places that image in
     a macOS-style frame: rounded corners, a hairline edge, a soft shadow,
     and the three traffic lights sitting ON the paper, where the window's
     Overlay title bar puts them. The tool captures it on a transparent
     background. ?img= is the pass-one image; ?w= and ?h= its CSS size. -->
<html>
<head>
<meta charset="utf-8">
<style>
  html, body { margin: 0; background: transparent; }
  .pad { padding: 44px 56px 68px; }
  .win {
    position: relative; border-radius: 10px; overflow: hidden;
    box-shadow: 0 0 0 0.5px rgba(0,0,0,.28), 0 22px 60px rgba(0,0,0,.30), 0 6px 16px rgba(0,0,0,.14);
  }
  .win img { display: block; }
  .lights { position: absolute; top: 14px; left: 14px; display: flex; gap: 8px; }
  .lights i { width: 12px; height: 12px; border-radius: 50%; box-shadow: inset 0 0 0 0.5px rgba(0,0,0,.22); }
  .lights i:nth-child(1) { background: #ff5f57; }
  .lights i:nth-child(2) { background: #febc2e; }
  .lights i:nth-child(3) { background: #28c840; }
</style>
</head>
<body>
<div class="pad"><div class="win"><img id="shot" alt=""><div class="lights"><i></i><i></i><i></i></div></div></div>
<script>
  window.__captureState = 'working';
  const p = new URLSearchParams(location.search);
  const img = document.getElementById('shot');
  img.width = Number(p.get('w'));
  img.height = Number(p.get('h'));
  img.onload = () => { window.__captureState = 'ready'; };
  img.onerror = () => { window.__captureState = 'failed'; window.__captureError = 'pass-one image did not load'; };
  img.src = p.get('img');
</script>
</body>
</html>
```

- [ ] **Step 4: The hero**

Create `tools/capture/hero.html`:

```html
<!doctype html>
<!-- The README's hero: the site's own before-and-after, as a still. The
     site drives that section from scroll position (layout(t) in
     site/index.html): both devices are fully in and level between t=0.42
     and t=0.56, so this holds it at 0.49. Same origin through the capture
     server, so this page can scroll the frame and hide the fixed top bar,
     which would otherwise sit across the top of the picture. -->
<html>
<head>
<meta charset="utf-8">
<style>html, body, iframe { margin: 0; border: 0; width: 100%; height: 100%; display: block; }</style>
</head>
<body>
<iframe id="site" src="/site/index.html"></iframe>
<script>
  window.__captureState = 'working';
  const HOLD = 0.49;
  const frame = document.getElementById('site');
  const fail = (m) => { window.__captureState = 'failed'; window.__captureError = m; };
  frame.addEventListener('load', async () => {
    try {
      const w = frame.contentWindow;
      const d = frame.contentDocument;
      const act = d.getElementById('act2');
      if (!act) return fail('site/index.html has no #act2 section any more');
      const style = d.createElement('style');
      style.textContent = '#topbar { display: none !important; }';
      d.head.append(style);
      const span = act.offsetHeight - w.innerHeight;
      w.scrollTo(0, act.offsetTop + HOLD * span);
      await d.fonts.ready;
      await new Promise((r) => w.requestAnimationFrame(() => w.requestAnimationFrame(r)));
      await new Promise((r) => setTimeout(r, 400));
      window.__captureState = 'ready';
    } catch (e) { fail(String(e && e.message || e)); }
  });
</script>
</body>
</html>
```

- [ ] **Step 5: Commit**

```bash
git add tools/capture/bridge.js tools/capture/steps.js tools/capture/frame.html tools/capture/hero.html
git commit -m "The capture tool's browser side

A stand-in for window.__TAURI__ that passes the window's engine calls to
the real CLI through the gate, a step runner that drops the demo script
on the window the way Tauri does and reports ready or failed, the drawn
window frame for pass two, and the site held at its before-and-after for
the hero.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 8: Chrome over its remote-control protocol

**Files:**
- Create: `tools/capture/cdp.ts`

Measured on 2026-09-22 before this plan was written: launch, wait for `ready`, light and dark, a transparent background and a clean exit all work, about 1.7 seconds a picture.

- [ ] **Step 1: Write the driver**

Create `tools/capture/cdp.ts`:

```ts
// Headless Chrome, driven over the DevTools protocol with Bun's built-in
// WebSocket. No dependency.
//
// Why not `chrome --screenshot`: it photographs whatever is on screen when
// its time budget runs out, including a failed state. This waits for the
// page to say `ready` or `failed` first. Measured 2026-09-22, Chrome 153.

import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

export interface Browser {
  capture(opts: {
    url: string;
    width: number;
    height: number;
    theme: 'light' | 'dark';
    transparent: boolean;
  }): Promise<Uint8Array>;
  close(): Promise<void>;
}

export async function launch(chrome: string = CHROME): Promise<Browser> {
  const profile = mkdtempSync(join(tmpdir(), 'screepub-capture-chrome-'));
  // Bun.spawn, never spawnSync: the process that serves the pages is this
  // one, and a blocking spawn leaves Chrome waiting on a server that cannot
  // answer. Measured; it hangs.
  const proc = Bun.spawn(
    [chrome, '--headless', '--disable-gpu', '--hide-scrollbars', '--remote-debugging-port=0',
      `--user-data-dir=${profile}`, 'about:blank'],
    { stdout: 'ignore', stderr: 'ignore' },
  );

  let port = '';
  for (let i = 0; i < 150 && !port; i++) {
    await Bun.sleep(100);
    try {
      port = readFileSync(join(profile, 'DevToolsActivePort'), 'utf8').split('\n')[0] ?? '';
    } catch {
      // not written yet
    }
  }
  if (!port) {
    proc.kill();
    throw new Error(`capture: Chrome at ${chrome} did not open its debugging port`);
  }

  const targets = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()) as {
    type: string;
    webSocketDebuggerUrl: string;
  }[];
  const page = targets.find((t) => t.type === 'page');
  if (!page) throw new Error('capture: Chrome has no page to drive');
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((r) => ws.addEventListener('open', r, { once: true }));

  let id = 0;
  const pending = new Map<number, (m: { result?: any; error?: { message: string } }) => void>();
  ws.addEventListener('message', (e) => {
    const m = JSON.parse(String(e.data));
    if (m.id && pending.has(m.id)) {
      pending.get(m.id)!(m);
      pending.delete(m.id);
    }
  });
  const send = (method: string, params: object = {}) =>
    new Promise<any>((resolve, reject) => {
      const n = ++id;
      pending.set(n, (m) => (m.error ? reject(new Error(`${method}: ${m.error.message}`)) : resolve(m.result)));
      ws.send(JSON.stringify({ id: n, method, params }));
    });

  return {
    async capture({ url, width, height, theme, transparent }) {
      await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 2, mobile: false });
      await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: theme }] });
      await send('Emulation.setDefaultBackgroundColorOverride',
        transparent ? { color: { r: 0, g: 0, b: 0, a: 0 } } : {});
      await send('Page.navigate', { url });
      const start = Date.now();
      let state = '';
      while (Date.now() - start < 60000) {
        const r = await send('Runtime.evaluate', {
          expression: 'JSON.stringify([window.__captureState, window.__captureError])',
          returnByValue: true,
        });
        const [s, err] = JSON.parse(r.result.value ?? '[]') as [string?, string?];
        state = s ?? '';
        if (state === 'failed') throw new Error(`capture failed at ${url}: ${err}`);
        if (state === 'ready') break;
        await Bun.sleep(100);
      }
      if (state !== 'ready') throw new Error(`capture timed out at ${url} (last state: ${state || 'none'})`);
      const shot = await send('Page.captureScreenshot', { format: 'png' });
      return new Uint8Array(Buffer.from(shot.data, 'base64'));
    },
    async close() {
      ws.close();
      proc.kill();
      await proc.exited;
      rmSync(profile, { recursive: true, force: true });
    },
  };
}
```

- [ ] **Step 2: Typecheck**

Run: `bunx tsc --noEmit`
Expected: no output.

### Task 9: The command

**Superseded in review (2026-09-22, commits c90ffcb and 685f5f9).** The
command below served the whole repository folder, so run from the main
checkout it would have served the real scripts in the gitignored root
`fixtures/` folder, and `.git` with them. At the end it also deleted
`/Users/Shared/Documents` without knowing whether the run had made it. In
c90ffcb the server moved to `tools/capture/server.ts`, which serves
`desktop/ui/`, `site/` and `tools/capture/` and nothing else, and answers
only requests that name its own host; and the run moved to
`tools/capture/run.ts`, which marks the scratch library as its own with a
`.screepub-capture` file, refuses a library it did not mark, removes only
the folders it made, cleans up on success, failure and interrupt, and
writes no picture unless every one was taken. In 685f5f9 the marker gained
the run's pid, so a second run at the same time is refused instead of
deleting a live run's library, and only a marker whose process is gone is
cleared as a leftover; and `tests/capture-chrome.test.ts` began running
the real Chrome driver against a fake Chrome
(`tests/fixtures/fake-chrome/chrome.sh`), so its failure paths are tested
without a real Chrome. The code below is kept as the record of what was
planned.

**Files:**
- Create: `tools/capture-screens.ts`
- Modify: `tools/capture/page.ts` (the config gains `token`)
- Modify: `tests/capture.test.ts` (the config in its page tests gains `token`; one new test)

**Amended after the Tasks 4-6 code review (2026-09-22).** Three things the
review found about this task's server, all built in below:
- `/engine` requires a per-run random token, passed to the page in
  `window.__CAPTURE__` and sent back by the bridge as `x-capture-token`.
  Without it, any page in a browser on this machine that guessed the port
  could post engine calls, and the gate would be the only thing in the way.
- `?shot=` is checked against the shot list; an unknown name is a 400.
- `tsconfig.json` includes only `src` and `tests`, so a tool file is
  typechecked only if a test imports it. `tools/capture-screens.ts` therefore
  exports `main` behind `import.meta.main`, and a test imports it and
  `tools/capture/cdp.ts`.

- [ ] **Step 0: Carry the token through the page config**

In `tools/capture/page.ts`, add `token: string;` to `CaptureConfig`, with a
one-line comment saying it is the per-run secret `/engine` requires. In
`tests/capture.test.ts`, add `token: 't'` to every `CaptureConfig` object
literal the page tests build. Then append:

```ts
describe('the capture command and Chrome driver typecheck', () => {
  test('they import without running, so tsc covers them', async () => {
    // tsconfig.json includes only src/ and tests/; importing these here is
    // what puts them under `bunx tsc --noEmit`.
    const cmd = await import('../tools/capture-screens');
    const cdp = await import('../tools/capture/cdp');
    expect(typeof cmd.main).toBe('function');
    expect(cdp.CHROME).toBe('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome');
  });
});
```

Run `bun test tests/capture.test.ts` and see this new test fail
(`Cannot find module '../tools/capture-screens'`) before Step 1.

- [ ] **Step 1: Write it**

Create `tools/capture-screens.ts`:

```ts
// bun tools/capture-screens.ts [--only <shot>]
//
// Takes every README and site picture from the real window running the
// real engine on tests/fixtures/field-station.pdf. Spec:
// docs/superpowers/specs/2026-09-22-readme-site-screens-design.md, part 3.
//
// Writes assets/screens/<shot>-<theme>.png, and copies the light drop and
// result into site/img/. A file is rewritten only when its bytes change.
// Prints one line per file: written or unchanged.
//
// Needs Chrome at the path in tools/capture/cdp.ts, and macOS: the demo
// library is /Users/Shared/Documents/Screepub, because the result screen
// prints the book's full path and that folder reads naturally with no
// username in it. The tool refuses to run if that folder already exists,
// and removes it when done.

import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { REPO_DIR } from './build-cli';
import { CHROME, launch } from './capture/cdp';
import { gateEngineCall } from './capture/gate';
import { captureIndex } from './capture/page';
import { SHOTS, outputsFor, writeIfChanged } from './capture/shots';

const LIBRARY = '/Users/Shared/Documents/Screepub';
const DEMO_PDF = join(REPO_DIR, 'tests', 'fixtures', 'field-station.pdf');

const TYPES: Record<string, string> = {
  '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json',
  '.png': 'image/png', '.svg': 'image/svg+xml', '.woff2': 'font/woff2',
};
const typeOf = (p: string) => TYPES[p.slice(p.lastIndexOf('.'))] ?? 'application/octet-stream';

export async function main() {
  const { values } = parseArgs({ args: Bun.argv.slice(2), options: { only: { type: 'string' } } });
  const token = crypto.randomUUID();
  const shots = values.only ? SHOTS.filter((s) => s.name === values.only) : SHOTS;
  if (shots.length === 0) throw new Error(`capture: no shot named ${values.only}`);
  if (!existsSync(CHROME)) {
    console.error(`capture: no Chrome at ${CHROME}. Pictures NOT retaken.`);
    process.exit(2);
  }
  if (existsSync(LIBRARY)) {
    throw new Error(`capture: ${LIBRARY} already exists. It is not the tool's to touch; move it and rerun.`);
  }

  const passOne = mkdtempSync(join(tmpdir(), 'screepub-capture-'));
  mkdirSync(LIBRARY, { recursive: true });
  const refused: string[] = [];

  const server = Bun.serve({
    port: 0,
    async fetch(req) {
      const url = new URL(req.url);
      if (url.pathname === '/engine' && req.method === 'POST') {
        if (req.headers.get('x-capture-token') !== token) {
          return new Response('capture: missing or wrong token', { status: 403 });
        }
        const { args } = (await req.json()) as { args: string[] };
        const gate = gateEngineCall(args, { demoPdf: DEMO_PDF, library: LIBRARY });
        if (!gate.allow) {
          refused.push(gate.reason);
          return new Response(gate.reason, { status: 403 });
        }
        const proc = Bun.spawn(['bun', join(REPO_DIR, 'src', 'cli.ts'), ...args], {
          stdout: 'pipe', stderr: 'pipe', env: { ...process.env, SCREEPUB_LIBRARY: LIBRARY },
        });
        const out = await new Response(proc.stdout).text();
        await proc.exited;
        return new Response(out);
      }
      if (url.pathname === '/capture/window.html') {
        const shot = url.searchParams.get('shot') ?? '';
        if (!SHOTS.some((s) => s.kind === 'window' && s.name === shot)) {
          return new Response(`capture: no window shot named ${shot}`, { status: 400 });
        }
        const html = readFileSync(join(REPO_DIR, 'desktop', 'ui', 'index.html'), 'utf8');
        return new Response(captureIndex(html, { shot, demoPdf: DEMO_PDF, token }), {
          headers: { 'content-type': 'text/html; charset=utf-8' },
        });
      }
      if (url.pathname.startsWith('/pass-one/')) {
        const file = join(passOne, url.pathname.slice('/pass-one/'.length));
        return existsSync(file) ? new Response(Bun.file(file), { headers: { 'content-type': 'image/png' } }) : new Response('', { status: 404 });
      }
      const file = join(REPO_DIR, decodeURIComponent(url.pathname));
      if (!file.startsWith(REPO_DIR) || !existsSync(file)) return new Response('', { status: 404 });
      return new Response(Bun.file(file), { headers: { 'content-type': typeOf(file) } });
    },
  });
  const base = `http://localhost:${server.port}`;
  const browser = await launch();

  try {
    for (const shot of shots) {
      for (const theme of shot.themes) {
        let png: Uint8Array;
        if (shot.kind === 'site') {
          png = await browser.capture({ url: `${base}/tools/capture/hero.html`, width: shot.width, height: shot.height, theme, transparent: false });
        } else {
          const one = await browser.capture({ url: `${base}/capture/window.html?shot=${shot.name}`, width: shot.width, height: shot.height, theme, transparent: false });
          const name = `${shot.name}-${theme}.png`;
          writeFileSync(join(passOne, name), one);
          // Pass two: the frame. Its padding is 44 + 68 vertically and 56 + 56 across.
          png = await browser.capture({
            url: `${base}/tools/capture/frame.html?img=/pass-one/${name}&w=${shot.width}&h=${shot.height}`,
            width: shot.width + 112, height: shot.height + 112, theme, transparent: true,
          });
        }
        for (const out of outputsFor(shot, theme)) {
          console.log(`${writeIfChanged(join(REPO_DIR, out), png)}  ${out}`);
        }
      }
    }
    if (refused.length) throw new Error(`capture: the window made engine calls the gate refused:\n  ${refused.join('\n  ')}`);
  } finally {
    await browser.close();
    server.stop(true);
    rmSync(passOne, { recursive: true, force: true });
    rmSync(LIBRARY, { recursive: true, force: true });
    // Remove the Documents folder too, but only if the tool's run left it empty.
    try { rmSync('/Users/Shared/Documents', { recursive: false }); } catch { /* not empty, or not ours */ }
  }
}

if (import.meta.main) {
  main().catch((err) => {
    console.error((err as Error).message);
    process.exit(1);
  });
}
```

Before writing the last `rmSync` line, check whether `/Users/Shared/Documents` exists on this Mac before the tool runs. If it does, delete that line: the tool must only ever remove what it created. If it does not, keep it: `rmSync` without `recursive` refuses a non-empty folder, which is the property relied on.

- [ ] **Step 2: Typecheck and run it once for the window's drop picture**

Run: `bunx tsc --noEmit && bun tools/capture-screens.ts --only drop`
Expected: two lines, `written  assets/screens/drop-light.png` and `written  assets/screens/drop-dark.png`, and `written  site/img/drop-light.png`. Exit 0.

Open all three and look. The drop well is centred on the paper, the brads are down the binding, the three traffic lights sit on the paper's top-left, the version stamp is not visible, and the dark one is dark.

- [ ] **Step 3: Run it again and confirm nothing changed**

Run: `bun tools/capture-screens.ts --only drop`
Expected: every line says `unchanged`. If any says `written`, the capture is not deterministic yet. Compare the two images, find what moved (a caret, a timer, an animation), and fix that before going on. A tool that rewrites images every run defeats the write-if-changed rule.

- [ ] **Step 4: Capture everything**

Run: `bun tools/capture-screens.ts`
Expected: 9 files, all `written` on the first run. Look at every one:
- `hero-light.png`: the site's two devices level, the PDF on the left and the e-reader on the right, no top bar.
- `result-*.png`: "FIELD STATION", "(by the Screepub project)", the counts, the buttons, and the path `/Users/Shared/Documents/Screepub/field-station/field-station.epub`. No temp folder, no username.
- `read-*.png`: the script with the scene index open, Field Station's scene headings in it.

Then run it once more. Expected: all `unchanged`.

Confirm the library folder is gone: `ls /Users/Shared/Documents/Screepub` should fail with "No such file or directory".

- [ ] **Step 5: Run the whole suite and commit**

Run: `bun test && bunx tsc --noEmit`
Expected: all pass.

```bash
git add tools/capture/cdp.ts tools/capture-screens.ts assets/screens site/img
git commit -m "bun tools/capture-screens.ts: the pictures retake themselves

Headless Chrome over its debugging protocol, the window's own page with
the capture scripts inserted, and the real engine answering through the
gate. Each window picture is taken at the window's own size and then
framed; the hero is the site's before-and-after held still. First run
committed here: the hero, the drop well, the finished book and reading,
light and dark, all of Field Station.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 10: Document the command

**Files:**
- Modify: `CLAUDE.md` (the Commands block)

- [ ] **Step 1: Add the command**

In `CLAUDE.md`, in the block under `## Commands`, add after the `epubcheck` line:

```bash
bun tools/capture-screens.ts   # retake README + site pictures (needs Chrome; macOS)
```

- [ ] **Step 2: Commit**

```bash
git add CLAUDE.md
git commit -m "CLAUDE.md names the capture command

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## What this plan does not do

It does not put the pictures in the README or on the site (the site and README plans do), and it does not wire the command into `/release` (the release-skill plan does). It adds no dependency and changes nothing in `desktop/ui/`.
