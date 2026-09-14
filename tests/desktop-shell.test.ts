import { describe, test, expect } from 'bun:test';
import { readFileSync, readdirSync } from 'node:fs';
import { basename, join } from 'node:path';
import { SIDECAR_BASENAME } from '../tools/sidecar-targets';

const REPO = new URL('..', import.meta.url).pathname;
const RUST_DIR = join(REPO, 'desktop', 'src-tauri');
const CARGO = readFileSync(join(REPO, 'desktop', 'src-tauri', 'Cargo.toml'), 'utf8');
const CONFIG = JSON.parse(
  readFileSync(join(REPO, 'desktop', 'src-tauri', 'tauri.conf.json'), 'utf8'),
);

// Recursive, and rooted at the whole crate rather than only src/: a
// `build.rs` beside Cargo.toml, or a sibling crate someone drops in its own
// subdirectory (e.g. `mod brain;` pulled in from
// `desktop/src-tauri/brain/src/lib.rs`), is exactly the "one more small
// thing in Rust" shape a submodule under src/ already is — and a scan that
// stopped at src/ left both entirely ungoverned by every guard below.
// (Demonstrated: appending code to build.rs, and adding a brain/ crate,
// each passed every test here before this glob was widened to the crate
// root.)
//
// The three excluded directories are cargo/tauri build OUTPUT, never
// source a person wrote by hand: target/ (cargo's build dir, full of
// generated .rs files from build scripts), gen/ (tauri-cli's generated
// schemas) and binaries/ (the compiled sidecar). All three are gitignored
// for the same reason — see root .gitignore.
const EXCLUDED_DIRS = new Set(['target', 'gen', 'binaries']);
const rustFiles = (readdirSync(RUST_DIR, { recursive: true }) as string[]).filter((f) => {
  if (!f.endsWith('.rs')) return false;
  const segments = f.split(/[\\/]/);
  return !segments.some((seg) => EXCLUDED_DIRS.has(seg));
});
const rustSources = rustFiles.map((f) => ({
  name: f,
  text: readFileSync(join(RUST_DIR, f), 'utf8'),
}));

/** Source with comments and blank lines removed — what a reviewer must read. */
function code(text: string): string[] {
  return text
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && !l.startsWith('//'));
}

/**
 * Source with every comment's TEXT removed but its code kept, for guards
 * that must judge what the Rust *does* rather than what it says about
 * itself. A doc comment explaining "we deliberately don't depend on
 * serde_json" or spelling out what a scene is for the reader's benefit is
 * exactly the kind of sentence these guards would otherwise trip on —
 * words that describe the rule, not code that breaks it.
 *
 * This tracks string-literal state (not just a line-oriented scan), because
 * an ordinary future edit — a URL or path inside a format! string — can put
 * "//" or "/*" inside a string literal. A scan blind to quoting would treat
 * the rest of that string, or an arbitrary span after a stray "/*" inside a
 * string, as a comment and hide real code from every guard that reads
 * stripped text. Escaped quotes (`\"`) are honoured so a string is not
 * closed early.
 */
function stripComments(text: string): string {
  let out = '';
  let i = 0;
  let inString = false;
  let inBlockComment = false;
  while (i < text.length) {
    const ch = text[i];
    if (inBlockComment) {
      if (ch === '*' && text[i + 1] === '/') {
        inBlockComment = false;
        i += 2;
        continue;
      }
      out += ch === '\n' ? '\n' : ''; // keep line breaks; content is gone
      i += 1;
      continue;
    }
    if (inString) {
      out += ch;
      if (ch === '\\' && i + 1 < text.length) {
        out += text[i + 1];
        i += 2;
        continue;
      }
      if (ch === '"') inString = false;
      i += 1;
      continue;
    }
    if (ch === '"') {
      inString = true;
      out += ch;
      i += 1;
      continue;
    }
    if (ch === '/' && text[i + 1] === '/') {
      const nl = text.indexOf('\n', i);
      i = nl === -1 ? text.length : nl; // resume at the newline itself
      continue;
    }
    if (ch === '/' && text[i + 1] === '*') {
      inBlockComment = true;
      i += 2;
      continue;
    }
    out += ch;
    i += 1;
  }
  return out;
}

describe('Rust is a window, not a brain', () => {
  test('the crate cannot parse the engine’s answer', () => {
    // THE load-bearing assertion of this whole piece. Without serde_json,
    // the engine's stdout is an opaque string on its way to the frontend,
    // and no amount of well-meant Rust can start branching on what is
    // inside it. `serde` itself is allowed: it is how the ipc layer encodes
    // arguments, and it cannot read an arbitrary JSON document.
    //
    // This reads comment-stripped code: a doc comment that mentions
    // `serde_json` to EXPLAIN why it is absent (as sidecar.rs's does) must
    // not trip the same guard that catches actually depending on it.
    expect(CARGO).not.toMatch(/^\s*serde_json\s*=/m);
    for (const { name, text } of rustSources) {
      expect(`${name}: ${stripComments(text)}`).not.toContain('serde_json');
    }
  });

  test('Cargo.toml declares no local path dependency', () => {
    // The other door out of the file scan above: a sibling crate need not
    // live anywhere under desktop/src-tauri at all. `brain = { path =
    // "../../somewhere/else" }` pulls in code the recursive scan above will
    // never see, no matter how wide its glob gets — Cargo.toml is the one
    // place that dependency has to be named, so it is the one place left
    // to check for it.
    expect(CARGO).not.toMatch(/path\s*=/);
  });

  test('the Rust knows no engine flag', () => {
    // The frontend builds the whole argv, --json included. A literal
    // starting with "--" in here would be the first piece of contract
    // knowledge to leak across the boundary.
    for (const { name, text } of rustSources) {
      const literals = text.match(/"(--[^"]*)"/g) ?? [];
      expect(`${name} contains flag literals: ${literals.join(', ')}`).toBe(
        `${name} contains flag literals: `,
      );
    }
  });

  test('the Rust knows nothing about screenplays or e-readers', () => {
    const banned = [
      'kindle', 'kobo', 'tolino', 'remarkable', 'calibre',
      'epub', 'mobi', 'azw3', 'kfx', 'fountain',
      'scene', 'screenplay', 'slug', 'dialogue', 'character',
      // Piece D: the shell forwards a diagnostic line without knowing that
      // one of them is progress, or that progress has a percent, or that
      // any of it is rendered. Those are the window's words, not Rust's.
      'progress', 'percent', 'render',
    ];
    for (const { name, text } of rustSources) {
      // Comments explaining the rule (main.rs's ADR summary, sidecar.rs's
      // module doc) are allowed to use the very words they're warning
      // about; only code is judged.
      const stripped = stripComments(text);
      // The file dialog's extension list is the one place a domain word
      // legitimately appears in code — it's an OS file filter, not a
      // decision about what a screenplay is. Carved out the same way the
      // "pdf" test below carves it out, rather than let it fail the ban.
      // The exemption removes the CALL, not the line: dropping a whole
      // line would let anything co-located on it escape the ban too.
      const lines = stripped.replace(/add_filter\([^)]*\)/g, '').split('\n');
      // Plain substring, not word-boundary: a `\b` match treats `_` as a
      // word character, so it is blind to snake_case and inflections
      // (`is_kindle_volume`, `n_scenes`, `sluglines`, `.epub3`) — exactly
      // the shape device/format/screenplay knowledge takes in real Rust.
      // The one real collision this creates — "epub" is the tail of the
      // product name "Screepub" and of the `screepub-engine` SIDECAR
      // constant — is carved out explicitly, by name, rather than by
      // loosening the match for every word.
      const lower = lines.join('\n').toLowerCase().replaceAll('screepub', '');
      for (const word of banned) {
        const found = lower.includes(word);
        expect(`${name} mentions ${word}: ${found}`).toBe(`${name} mentions ${word}: false`);
      }
    }
  });

  test('"pdf" appears only in the file dialog’s filter', () => {
    // The one domain word the Rust legitimately holds, because the OS file
    // picker needs an extension list and that is a window’s job. Anywhere
    // else it would mean the Rust had started deciding what a file is.
    for (const { name, text } of rustSources) {
      for (const line of text.split('\n')) {
        if (!line.toLowerCase().includes('pdf')) continue;
        expect(`${name}: ${line.trim()}`).toContain('add_filter');
      }
    }
  });

  test('a reviewer can read the whole thing in one sitting', () => {
    // The spec's acceptance criterion, as a number so it can fail. If a
    // change needs more than this, it is almost certainly logic that
    // belongs in src/.
    const lines = rustSources.flatMap(({ text }) => code(text));
    expect(lines.length).toBeLessThanOrEqual(200);
  });

  test('exactly two commands are registered', () => {
    // A third command is the shape every "just one small thing in Rust"
    // takes. Adding one is allowed — but it must be a deliberate edit to
    // this list, in a diff someone reviews.
    const main = rustSources.find((f) => basename(f.name) === 'main.rs')!.text;
    const handler = main.match(/generate_handler!\[([^\]]*)\]/);
    expect(handler).not.toBeNull();
    const registered = handler![1].split(',').map((s) => s.trim()).filter(Boolean);
    expect(registered.sort()).toEqual(['pick_file', 'run_engine']);
  });

  test('the Rust ignores the exit code and answers with stdout', () => {
    // `--json` errors exit 1 while printing a valid error object. A shell
    // that failed on a non-zero status would turn every not-a-screenplay
    // into "the engine crashed", which is acceptance criterion 3 broken.
    //
    // Piece D replaced `.output()` with `.spawn()` so stderr could be
    // forwarded live, which is why this no longer looks for the literal
    // `output.stdout`. What it asserts instead is the RULE rather than the
    // spelling: there is exactly ONE way out with an error and it is the
    // empty-stdout case, the exit value is never compared to anything, and
    // the value handed to the window is the accumulated stdout.
    const sidecar = rustSources.find((f) => basename(f.name) === 'sidecar.rs')!.text;
    const body = stripComments(sidecar);

    // The literal the old assertion banned, still banned on RAW text so
    // this replacement is nowhere weaker than what it replaces.
    expect(sidecar).not.toMatch(/status\s*\.\s*success\s*\(\)/);
    // …and broadened: any `.success(` call at all, however it is spelled.
    expect(body).not.toMatch(/\.\s*success\s*\(/);

    // No equality or ordering test against the exit value, in either
    // operand order. Catches `status.code() != Some(0)`, `exit_code == 0`
    // and `Some(0) != exit` — each of which the narrower `\bcode\b`
    // spelling would sail straight past.
    expect(body).not.toMatch(/\b(status|code|exit)[\w.()]*\s*(==|!=|<=|>=)/i);
    expect(body).not.toMatch(/(==|!=|<=|>=)\s*[\w:.]*\b(status|code|exit)\b/i);
    // …and no branching on it by any other route.
    expect(body).not.toMatch(/\bmatch\s+[\w.()]*\b(status|code|exit)\b/i);

    // The structural half, which is what actually makes exit-code logic
    // impossible rather than merely awkward to spell: one `if` in the
    // file, testing stdout; one `Err(` construction, which is its body.
    const conditions = [...body.matchAll(/\bif\s+([^{]+)\{/g)].map((m) => m[1].trim());
    expect(conditions).toEqual(['stdout.is_empty()']);
    expect(body.match(/\bErr\(/g) ?? []).toHaveLength(1);

    // And the success path hands back the process's own stdout.
    expect(body).toMatch(/Stdout\(/);
    expect(body).toMatch(/Ok\(\s*stdout\s*\)/);

    // The assertions above are NOT airtight on their own, and it would be
    // worse than useless to pretend otherwise: a decision can be taken with
    // no `if` and no `Err(` at all —
    //
    //     exit.unwrap_or(0).eq(&0).then_some(()).ok_or_else(…)?;   // B
    //     assert_eq!(exit.unwrap_or(0), 0, "the engine failed");   // C
    //     let stdout = exit.filter(|c| *c == 0).map(…).unwrap_or_default();  // D
    //
    // — the last of which blanks stdout and lets the ONE legitimate `if`
    // report it, leaving both counts above untouched. Every such dodge was
    // written, compiled and run against this file; each passed everything
    // above.
    //
    // So the pin is a bare USE COUNT, because chasing method names
    // (`.eq`, `.filter`, `assert_eq!`, the next one nobody has thought of)
    // is a game the guard loses by construction. `exit` is allowed exactly
    // three appearances, and they are the only three it legitimately has:
    // it is BOUND, it is ASSIGNED from the terminated event, and it is
    // PRINTED inside the empty-stdout message. There is no fourth use of an
    // exit status that is not the Rust forming an opinion about it.
    //
    // If a refactor changes this number, that is the assertion doing its
    // job — work out which of the three moved, do not raise the count.
    expect(body.match(/\bexit\b/g) ?? []).toHaveLength(3);
    // A count reaches the binding it NAMES and not its source, so pin the
    // upstream one too: `status` can be inspected before it ever becomes
    // `exit`, leaving the count above untouched while the Rust decides a
    // non-zero exit means failure. Two uses: bound by the match arm, and
    // its code stored.
    expect(body.match(/\bstatus\b/g) ?? []).toHaveLength(2);
  });

  test('a forwarded line is forwarded, not read', () => {
    // The event carries a raw line. If the Rust ever learns what a line
    // MEANS — that it is progress, that it has a percent, that a stage is
    // named — the decision has moved out of TypeScript.
    const sidecar = rustSources.find((f) => basename(f.name) === 'sidecar.rs')!.text;
    const body = stripComments(sidecar);
    const lower = body.toLowerCase();
    for (const word of ['progress', 'percent', 'stage', 'ndjson', 'parse']) {
      expect(`sidecar.rs mentions ${word}: ${lower.includes(word)}`).toBe(
        `sidecar.rs mentions ${word}: false`,
      );
    }
    // Vocabulary alone is cheap to dodge: `line.starts_with("{\"p")` names
    // nothing on that list and is still the Rust deciding what a line is.
    // So ban every way of looking inside one. (`trim` stays allowed: it is
    // whitespace, and the stdout accumulator needs it.)
    for (const method of [
      'starts_with', 'ends_with', 'contains', 'split', 'strip_prefix',
      'strip_suffix', 'find(', 'char', 'bytes(', 'len()', 'replace',
    ]) {
      expect(`sidecar.rs calls ${method}: ${lower.includes(`.${method}`)}`).toBe(
        `sidecar.rs calls ${method}: false`,
      );
    }
    // The payload is the whole line binding — not a slice of it, not a
    // field picked out of it.
    expect(body).toMatch(/emit\(\s*LINE_EVENT\s*,\s*line(\s*\.\s*clone\(\))?\s*\)/);

    // …and, as above, the method-name list is a floor, not a fence:
    //
    //     let want = matches!(line.as_bytes().first(), Some(b'{'));  // F
    //     let want = line.get(0..1) == Some("{");                    // G
    //
    // dodge every name on it (`.as_bytes` is not `.bytes(`; `.get` and
    // index slicing are not named at all) and still decide what a line is.
    // Both were compiled and run; both passed the list.
    //
    // The count is therefore the real assertion. `line` may appear exactly
    // FOUR times, and all four are accounted for: once in the event-NAME
    // literal `"engine-line"`, then bound from the bytes, emitted, and
    // appended to the diagnostics buffer. A fifth is the Rust reading it.
    // Do not raise this number to make a refactor pass.
    expect(body.match(/(?<![A-Z_])\bline\b/g) ?? []).toHaveLength(4);
    // Same reasoning as `status` above: the raw `bytes` can be inspected
    // before they are ever decoded into `line`, which would filter WHICH
    // lines get forwarded while leaving the count above untouched. Four
    // uses: bound and decoded, once per stream.
    expect(body.match(/\bbytes\b/g) ?? []).toHaveLength(4);
  });
});

describe('the sidecar name is agreed on both sides', () => {
  test('the Rust asks for the basename the build tool writes', () => {
    // Two languages, one string. They cannot be checked by the compiler,
    // so they are checked here. A mismatch is a runtime "not found" in a
    // window — the exact failure Task 1 was arranged to prevent.
    const sidecar = rustSources.find((f) => basename(f.name) === 'sidecar.rs')!.text;
    expect(sidecar).toContain(`"${SIDECAR_BASENAME}"`);
  });

  test('tauri.conf.json points externalBin at the same basename', () => {
    expect(CONFIG.bundle.externalBin).toEqual([`binaries/${SIDECAR_BASENAME}`]);
  });
});

describe('the window is granted no more than it needs', () => {
  test('the frontend holds no plugin permission', () => {
    // The shell and dialog plugins are called only from Rust. If the
    // frontend ever gains `shell:allow-execute`, the window can spawn
    // arbitrary processes and the sidecar boundary stops meaning anything.
    const cap = JSON.parse(
      readFileSync(join(REPO, 'desktop', 'src-tauri', 'capabilities', 'default.json'), 'utf8'),
    );
    expect(cap.permissions).toEqual(['core:default']);
  });

  test('the identifier does not collide with the Swift app’s', () => {
    // app/Sources/KitCheck/main.swift pins com.darkwell.screepub to the
    // Swift app's code signature, and both apps exist at once until piece F.
    expect(CONFIG.identifier).toBe('com.darkwell.screepub.desktop');
    expect(CONFIG.identifier).not.toBe('com.darkwell.screepub');
  });

  test('the frontend is static files, not a dev server', () => {
    // A `devUrl` or a `beforeDevCommand` would reintroduce the npm
    // toolchain this piece deliberately does without.
    expect(CONFIG.build.frontendDist).toBe('../ui');
    expect(CONFIG.build.devUrl).toBeUndefined();
    expect(CONFIG.build.beforeDevCommand).toBeUndefined();
  });
});

describe('the frontend owns the contract', () => {
  const APP_JS = readFileSync(join(REPO, 'desktop', 'ui', 'app.js'), 'utf8');

  test('it passes --json itself, because the Rust will not', () => {
    expect(APP_JS).toContain("'--json'");
  });

  test('it parses the engine’s answer', () => {
    expect(APP_JS).toContain('JSON.parse');
  });

  test('it invokes only the two commands that exist', () => {
    const names = [...APP_JS.matchAll(/invoke\(\s*'([a-z_]+)'/g)].map((m) => m[1]);
    expect([...new Set(names)].sort()).toEqual(['pick_file', 'run_engine']);
  });
});

describe('nothing under app/ or src/ was drawn into this', () => {
  test('no Rust file references the Swift app or the engine sources', () => {
    for (const { name, text } of rustSources) {
      expect(`${name} reaches outside desktop/: ${/\.\.\/\.\.\/(app|src)\b/.test(text)}`).toBe(
        `${name} reaches outside desktop/: false`,
      );
    }
  });
});

describe('the desktop CSS copy of the brand tokens does not drift', () => {
  // desktop/ui has no build step (see desktop/README.md) and can't @import
  // or copy brand/tokens.css at build time — tauri.conf.json's
  // frontendDist only embeds files under desktop/ui/, so a path outside it
  // 404s even in `cargo run`. style.css therefore inlines the seven core
  // colours literally, copied by hand from brand/tokens.json. A hand copy
  // is exactly the kind of value this repo already refuses to trust to a
  // human (see tests/brand-tokens.test.ts pinning the web tokens to
  // Theme.swift, and format-defaults.json pinned by two suites) — so pin
  // this copy the same way, against the one JSON source of truth.
  const CSS = readFileSync(join(REPO, 'desktop', 'ui', 'style.css'), 'utf8');
  const TOKENS = JSON.parse(readFileSync(join(REPO, 'brand', 'tokens.json'), 'utf8')).colors;

  // style.css declares its base palette in a top-level `:root { … }` block
  // and overrides a subset inside a `:root { … }` nested in
  // `@media (prefers-color-scheme: dark)`. The split below is keyed off
  // those actual `:root` blocks — not off "everything before/after the
  // @media marker" — so a hex custom property declared elsewhere in the
  // file (outside either block) is simply not swept into the wrong side.
  //
  // Known limits, same shape as tests/brand-tokens.test.ts's own note on
  // its block-scanning: this assumes exactly one top-level `:root {…}`
  // block and one `@media (prefers-color-scheme: dark) { :root {…} }`
  // block, both flat (no nested braces) and each on its own — a `}` inside
  // a comment or quoted value ahead of the real close would truncate the
  // slice early and silently.
  function rootBlock(text: string, searchFrom: number): string {
    const rootIdx = text.indexOf(':root', searchFrom);
    expect(rootIdx, `no :root block found at/after index ${searchFrom}`).toBeGreaterThan(-1);
    const braceStart = text.indexOf('{', rootIdx);
    const braceEnd = text.indexOf('}', braceStart);
    return text.slice(braceStart, braceEnd + 1);
  }

  const lightSection = rootBlock(CSS, 0);
  const mediaIdx = CSS.indexOf('@media (prefers-color-scheme: dark)');
  expect(mediaIdx, 'style.css is missing its dark-mode @media block').toBeGreaterThan(-1);
  const darkSection = rootBlock(CSS, mediaIdx);

  function hexDeclarations(section: string): Record<string, string> {
    const out: Record<string, string> = {};
    for (const [, name, value] of section.matchAll(/--([\w-]+):\s*(#[0-9a-fA-F]{3,8})\s*;/g)) {
      out[name] = value;
    }
    return out;
  }

  const light = hexDeclarations(lightSection);
  const dark = hexDeclarations(darkSection);

  test('style.css declares at least the seven core tokens', () => {
    // Guards against the copy silently losing a value (e.g. a token
    // dropped during an edit) rather than only checking the ones present.
    expect(Object.keys(light).sort()).toEqual(
      ['alarm', 'brass', 'ground', 'ink', 'ink-muted', 'ink-on-brass', 'paper'].sort(),
    );
  });

  test('the dark override still declares its five tokens', () => {
    // Presence, not just value: deleting a dark override (e.g.
    // --ink-muted) would leave light-mode ink drawn on dark paper, and the
    // value-comparison test below can't catch an entry that's simply gone.
    expect(Object.keys(dark).sort()).toEqual(
      ['alarm', 'ground', 'ink', 'ink-muted', 'paper'].sort(),
    );
  });

  test('every light hex literal in style.css matches brand/tokens.json', () => {
    for (const [name, hex] of Object.entries(light)) {
      expect(TOKENS[name], `tokens.json has no color named ${name}`).toBeDefined();
      expect(hex.toLowerCase(), `style.css --${name} (light) drifted from tokens.json`).toBe(
        TOKENS[name].light.toLowerCase(),
      );
    }
  });

  test('every dark-mode hex literal in style.css matches brand/tokens.json', () => {
    for (const [name, hex] of Object.entries(dark)) {
      expect(TOKENS[name], `tokens.json has no color named ${name}`).toBeDefined();
      expect(hex.toLowerCase(), `style.css --${name} (dark) drifted from tokens.json`).toBe(
        TOKENS[name].dark.toLowerCase(),
      );
    }
  });
});

describe('the desktop workflow', () => {
  const WF = Bun.YAML.parse(
    readFileSync(join(REPO, '.github', 'workflows', 'desktop.yml'), 'utf8'),
  ) as {
    on: { push: { paths: string[] } };
    jobs: Record<string, { strategy?: { matrix?: { os?: string[] } }; steps: { run?: string }[] }>;
  };

  test('compiles on all three platforms', () => {
    // The spec's stated position is that macOS and Windows "ride on CI
    // building them". If this matrix quietly became ubuntu-only, that
    // sentence would be false and nothing else would notice.
    expect(WF.jobs.build.strategy?.matrix?.os).toEqual([
      'ubuntu-latest',
      'macos-15',
      'windows-latest',
    ]);
  });

  test('the sidecar is built before the shell is compiled', () => {
    // tauri-build needs it present. Reversed, every job fails with the
    // confusing not-found this piece exists to eliminate.
    const runs = WF.jobs.build.steps.map((s) => s.run ?? '');
    const sidecar = runs.findIndex((r) => r.includes('build-sidecar.ts'));
    const cargo = runs.findIndex((r) => r.includes('cargo build'));
    expect(sidecar).toBeGreaterThanOrEqual(0);
    expect(cargo).toBeGreaterThan(sidecar);
  });

  test('it does not bundle, sign or run anything', () => {
    // Scope guard. Bundling is piece E2; a `tauri build` appearing here
    // would mean C had grown an installer nobody reviewed.
    const all = JSON.stringify(WF);
    expect(all).not.toContain('tauri build');
    expect(all).not.toContain('codesign');
    expect(all).not.toContain('appimage');
  });

  test('it is path-filtered, so a parser change never waits on three cargo builds', () => {
    // Vacuous alternatives rejected: asserting the `on` key merely exists
    // would pass for a workflow that runs on every push, which is the thing
    // this test is for. Assert the filter itself.
    const triggers = (WF as unknown as { on: { push: { paths: string[] } } }).on;
    expect(triggers.push.paths).toContain('desktop/**');
    expect(triggers.push.paths).not.toContain('src/**');
  });
});
