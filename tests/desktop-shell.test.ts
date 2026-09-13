import { describe, test, expect } from 'bun:test';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { SIDECAR_BASENAME } from '../tools/sidecar-targets';

const REPO = new URL('..', import.meta.url).pathname;
const RUST_DIR = join(REPO, 'desktop', 'src-tauri', 'src');
const CARGO = readFileSync(join(REPO, 'desktop', 'src-tauri', 'Cargo.toml'), 'utf8');
const CONFIG = JSON.parse(
  readFileSync(join(REPO, 'desktop', 'src-tauri', 'tauri.conf.json'), 'utf8'),
);

const rustFiles = readdirSync(RUST_DIR).filter((f) => f.endsWith('.rs'));
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
 * words that describe the rule, not code that breaks it. None of these
 * files puts "//" or "/*" inside a string literal, so a plain scan is safe.
 */
function stripComments(text: string): string {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .map((line) => {
      const idx = line.indexOf('//');
      return idx === -1 ? line : line.slice(0, idx);
    })
    .join('\n');
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
      const lines = stripped
        .split('\n')
        .filter((line) => !line.includes('add_filter'));
      const lower = lines.join('\n').toLowerCase();
      for (const word of banned) {
        // Word-boundary, not substring: "epub" is a real banned word, but
        // it is also the tail of "Screepub"/"screepub-engine" — the
        // product name and the SIDECAR constant the cross-pin test below
        // requires verbatim. A whole-word match lets the product name
        // through without a special-case exemption.
        const found = new RegExp(`\\b${word}\\b`).test(lower);
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
    const main = rustSources.find((f) => f.name === 'main.rs')!.text;
    const handler = main.match(/generate_handler!\[([^\]]*)\]/);
    expect(handler).not.toBeNull();
    const registered = handler![1].split(',').map((s) => s.trim()).filter(Boolean);
    expect(registered.sort()).toEqual(['pick_file', 'run_engine']);
  });

  test('the Rust ignores the exit code and reads stdout', () => {
    // `--json` errors exit 1 while printing a valid error object. A shell
    // that failed on a non-zero status would turn every not-a-screenplay
    // into "the engine crashed", which is acceptance criterion 3 broken.
    const sidecar = rustSources.find((f) => f.name === 'sidecar.rs')!.text;
    expect(sidecar).toContain('output.stdout');
    expect(sidecar).not.toMatch(/status\s*\.\s*success\s*\(\)/);
  });
});

describe('the sidecar name is agreed on both sides', () => {
  test('the Rust asks for the basename the build tool writes', () => {
    // Two languages, one string. They cannot be checked by the compiler,
    // so they are checked here. A mismatch is a runtime "not found" in a
    // window — the exact failure Task 1 was arranged to prevent.
    const sidecar = rustSources.find((f) => f.name === 'sidecar.rs')!.text;
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
  // and overrides a subset inside `@media (prefers-color-scheme: dark)`.
  // Splitting the file at the @media marker is enough to tell the two
  // apart: nothing above it is a dark-mode override, and everything below
  // it is.
  const mediaIdx = CSS.indexOf('@media');
  expect(mediaIdx, 'style.css is missing its dark-mode @media block').toBeGreaterThan(-1);
  const lightSection = CSS.slice(0, mediaIdx);
  const darkSection = CSS.slice(mediaIdx);

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
