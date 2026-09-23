import { afterAll, afterEach, beforeAll, describe, test, expect } from 'bun:test';
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const SCRATCH = mkdtempSync(join(tmpdir(), 'screepub-desktop-ui-'));
afterAll(() => rmSync(SCRATCH, { recursive: true, force: true }));

const UI = join(new URL('..', import.meta.url).pathname, 'desktop', 'ui');
const read = (name: string) => readFileSync(join(UI, name), 'utf8');
const cssFiles = () => readdirSync(UI).filter((f) => f.endsWith('.css'));
const jsFiles = () => readdirSync(UI).filter((f) => f.endsWith('.js'));

/** A storage that behaves like localStorage, including its habit of handing
 *  back strings for everything. Shared by every update.js describe block
 *  below rather than copied three times. */
const store = (seed: Record<string, string> = {}) => {
  const map = new Map(Object.entries(seed));
  return {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => { map.set(k, String(v)); },
    dump: () => Object.fromEntries(map),
  };
};

describe('the window uses the brand, not its own colours', () => {
  test('no stylesheet but the two token files carries a hex literal', () => {
    // The spec's acceptance criterion 5, as a test: "a review can grep for a
    // hard-coded hex and find none". style.css and tokens.css are the two
    // declared copies, each pinned to brand/tokens.json by its own test.
    for (const name of cssFiles()) {
      if (name === 'style.css' || name === 'tokens.css') continue;
      const offenders = [...read(name).matchAll(/#[0-9a-fA-F]{3,8}\b/g)]
        .map((m) => m[0])
        .filter((h) => !['#fff', '#ffffff', '#000', '#000000'].includes(h.toLowerCase()));
      expect(`${name}: ${offenders.join(', ')}`).toBe(`${name}: `);
    }
  });

  test('no stylesheet sets a font size or radius in raw px', () => {
    // The same rule tests/brand-components.test.ts already enforces on the
    // previews. The window is the same design system.
    for (const name of cssFiles()) {
      const offenders = [...read(name).matchAll(/(font-size|border-radius):\s*[\d.]+px/g)]
        .map((m) => m[0]);
      expect(`${name}: ${offenders.join(', ')}`).toBe(`${name}: `);
    }
  });

  test('one file declares each token, so there is no "which one wins"', () => {
    // Carried in from Task 6's review: --radius was declared by BOTH
    // style.css and the generated tokens.css. The generator's exclusion list
    // covers only the seven COLOURS style.css owns, so nothing caught it.
    // This is the general form of that check: no custom property may be
    // declared by two of the window's stylesheets.
    const declared = new Map<string, string[]>();
    for (const name of cssFiles()) {
      for (const [, token] of read(name).matchAll(/^\s*(--[\w-]+)\s*:/gm)) {
        const seen = declared.get(token) ?? [];
        if (!seen.includes(name)) seen.push(name);
        declared.set(token, seen);
      }
    }
    const doubled = [...declared]
      .filter(([, files]) => files.length > 1)
      .map(([token, files]) => `${token} in ${files.join(' + ')}`);
    expect(doubled.join('; ')).toBe('');
    // Guards the loop: a regex that matched nothing would pass vacuously.
    expect(declared.size).toBeGreaterThan(30);
  });

  test('every stylesheet the page loads is bundled and local', () => {
    const html = read('index.html');
    const hrefs = [...html.matchAll(/<link[^>]+href="([^"]+)"/g)].map((m) => m[1]);
    expect(hrefs.length).toBeGreaterThanOrEqual(3);
    for (const href of hrefs) {
      expect(href.startsWith('http')).toBe(false);
      expect(href.startsWith('/')).toBe(false);
      expect(readdirSync(UI)).toContain(href);
    }
  });

  test('the fonts are declared from the bundled files, not from a CDN', () => {
    const css = read('style.css');
    expect(css).toContain('@font-face');
    expect(css).toContain('Courier Prime');
    expect(css).toContain('Literata');
    expect(css).not.toContain('fonts.googleapis.com');
    expect(css).not.toContain('fonts.gstatic.com');
    const urls = [...css.matchAll(/url\(([^)]+)\)/g)].map(([, u]) => u.replace(/['"]/g, ''));
    // Every face the six bundled subsets provide is actually declared: a
    // stylesheet that shipped one @font-face would otherwise pass.
    expect(urls.length).toBe(readdirSync(join(UI, 'fonts')).length);
    for (const url of urls) {
      expect(url).toMatch(/^fonts\/[a-z0-9-]+\.woff2$/);
      expect(readdirSync(join(UI, 'fonts'))).toContain(url.slice('fonts/'.length));
    }
  });
});

describe('the window respects the quality floor', () => {
  test('every animated stylesheet has a reduced-motion escape', () => {
    for (const name of cssFiles()) {
      const css = read(name);
      if (!/transition:|animation:/.test(css)) continue;
      expect(
        css.includes('prefers-reduced-motion'),
        `${name} animates but never checks prefers-reduced-motion`,
      ).toBe(true);
    }
  });

  test('it declares a narrow-window and a short-window layout', () => {
    const css = cssFiles().map(read).join('\n');
    expect(css).toMatch(/@media\s*\(max-width:/);
    expect(css).toMatch(/@media\s*\(max-height:/);
  });

  test('keyboard focus is drawn, never removed', () => {
    // `outline: none` with nothing in its place is the single most common way
    // a keyboard user loses their place in a hand-rolled interface.
    for (const name of cssFiles()) {
      const css = read(name);
      expect(`${name}: ${/outline:\s*(none|0)\b/.test(css)}`).toBe(`${name}: false`);
    }
    const css = cssFiles().map(read).join('\n');
    expect(css).toContain(':focus-visible');
  });

  test('the surface switcher is a real tablist, reachable by keyboard', async () => {
    const frame = read('frame.js');
    const { SURFACES } = (await import(join(UI, 'frame.js'))) as {
      SURFACES: Array<{ id: string; label: string }>;
    };
    // Not a div with a click handler: a test that only looked for the five
    // names would pass against exactly that.
    expect(frame).toContain("'button'");
    expect(frame).toContain('aria-selected');
    expect(frame).toContain('ArrowRight');
    expect(frame).toContain('focus()');
    expect(frame).toContain("role: 'tab'");
    expect(frame).toContain("role: 'tablist'");
    // A dimmed surface is not a keyboard stop. Without this the arrow keys
    // land on a tab whose panel says nothing.
    expect(frame).toMatch(/disabled\)?\s*\)?\s*continue|if\s*\(.*disabled.*\)\s*continue/);
    // The bar's four. Notes is deliberately absent: it is reached from the
    // rev stamp, not from a tab. Asserted against the exported SURFACES
    // rather than the file text, because frame.js imports ./notes.js for the
    // version and a `toContain('notes')` would pass on the import alone.
    expect(SURFACES.map((s) => s.id)).toEqual(['convert', 'read', 'tune', 'send']);
  });
});

describe('the window uses the brand, not its own colours (scripts too)', () => {
  test('no script builds a colour of its own', () => {
    // The CSS is checked above; a script can smuggle one in just as easily by
    // assigning a literal. The two brand-verbatim gradient stops in frame.js
    // (#fff / #000, copied from brand/components/brad.html) are three-digit
    // and deliberately not matched by the six-digit form.
    // Widened after a mutation slipped through: the six-digit-hex-and-rgb()
    // form let `'#f00'` and `'hsl(0 100% 50%)'` past. A colour is a colour in
    // whatever notation it is written, so every notation is named here, and
    // the brand-verbatim #fff/#000 are the only exemption.
    const KEEP = new Set(['#fff', '#ffffff', '#000', '#000000']);
    for (const name of jsFiles()) {
      const hexes = [...read(name).matchAll(/#[0-9a-fA-F]{3,8}\b/g)]
        .map((m) => m[0])
        .filter((h) => !KEEP.has(h.toLowerCase()));
      const funcs = [...read(name).matchAll(/\b(?:rgba?|hsla?|hwb|la[bc]|lch|oklab|oklch|color)\(/g)]
        .map((m) => m[0]);
      expect(`${name}: ${[...hexes, ...funcs].join(', ')}`).toBe(`${name}: `);
    }
  });
});

describe('the engine contract lives in exactly one file', () => {
  test('only app.js talks to Rust', () => {
    for (const name of jsFiles()) {
      if (name === 'app.js') continue;
      expect(`${name} invokes: ${/\binvoke\s*\(/.test(read(name))}`).toBe(
        `${name} invokes: false`,
      );
      expect(`${name} reaches __TAURI__: ${/__TAURI__/.test(read(name))}`).toBe(
        `${name} reaches __TAURI__: false`,
      );
    }
  });

  test('only app.js reads the engine answer', () => {
    // The argv goes out through app.js and the JSON comes back through it.
    // Without this, a surface could parse the engine's stdout itself and the
    // one-place contract would be true of flags but not of answers.
    for (const name of jsFiles()) {
      if (name === 'app.js') continue;
      expect(`${name} parses JSON: ${/JSON\s*\.\s*parse/.test(read(name))}`).toBe(
        `${name} parses JSON: false`,
      );
    }
  });

  test('only app.js knows an engine flag', () => {
    for (const name of jsFiles()) {
      // notes.js is GENERATED from docs/releases/*.md and is prose, not code:
      // it names no flag today, and if a release note ever quotes one, the
      // fix is the note, not this window's boundary. Every other carve-out in
      // these suites says why; this one used to be the exception.
      if (name === 'app.js' || name === 'notes.js') continue;
      // Any quoting. Mutation-confirmed: single-quotes-only let both
      // `const M1 = "--force";` and a backtick `--options-json` through.
      const flags = [...read(name).matchAll(/['"`](--[a-z][a-z-]*)['"`]/g)].map((m) => m[1]);
      expect(`${name} names flags: ${flags.join(', ')}`).toBe(`${name} names flags: `);
    }
  });

  test('every argv builder passes --json, and every one of them is checked', async () => {
    // Run the builders rather than reading their source. The brief's version
    // of this test filtered app.js's LINES for `=>` and `[` on the same line;
    // against the builders as actually written that selected three of seven
    // (`convert`, `reconvert`, `send` and `export` all break the line between
    // the arrow and the bracket), so four builders could drop --json
    // unnoticed. Calling them cannot miss one.
    const { argv } = await import(join(UI, 'app.js'));
    const built: Record<string, string[]> = {
      version: argv.version(),
      convert: argv.convert('/s/script.pdf'),
      convertForced: argv.convert('/s/script.pdf', { force: true, optionsJson: '{"a":1}' }),
      reconvert: argv.reconvert('/s/script.fountain', '/s/script.epub', '{"a":1}'),
      devices: argv.devices(),
      send: argv.send('/s/script.epub'),
      sendTo: argv.send('/s/script.epub', 'kindle-1'),
      settings: argv.settings('/s/script.fountain'),
      settingsSet: argv.settings('/s/script.fountain', '{"a":1}'),
      export: argv.export('/s/script.epub', { forFormat: 'kfx' }),
      exportFull: argv.export('/s/script.epub', {
        forFormat: 'azw3', fountain: '/s/script.fountain', optionsJson: '{"a":1}',
      }),
    };
    // Every builder the interface promises is exercised above.
    expect(Object.keys(argv).sort()).toEqual(
      ['convert', 'devices', 'export', 'reconvert', 'send', 'settings', 'version'].sort(),
    );
    for (const [name, args] of Object.entries(built)) {
      expect(`${name} has --json: ${args.includes('--json')}`).toBe(`${name} has --json: true`);
      // A `null` left in by a dropped .filter() reaches the Rust as the
      // string "null" and the engine reads it as a positional argument.
      expect(`${name} args: ${args.filter((a) => typeof a !== 'string').join(',')}`).toBe(
        `${name} args: `,
      );
    }
  });

  test('an optional flag brings its value and an absent one brings nothing', async () => {
    const { argv } = await import(join(UI, 'app.js'));
    const after = (args: string[], flag: string) => args[args.indexOf(flag) + 1];

    const plain = argv.convert('/s/script.pdf');
    // Pinned WHOLE, not probed flag by flag: this argv is the entire contract
    // between the window and the engine, and an extra or missing element is
    // exactly what a wrong edit leaves behind.
    expect(plain).toEqual(
      ['/s/script.pdf', '--json', '--progress', '--preview-inline', '--library'],
    );
    expect(plain[0]).toBe('/s/script.pdf');
    // The reader cannot read files, so the document must ride in the answer,
    // and the progress lines must be asked for or the bar never moves.
    expect(plain).toContain('--preview-inline');
    expect(plain).toContain('--progress');
    expect(plain).not.toContain('--force');
    expect(plain).not.toContain('--options-json');

    const forced = argv.convert('/s/script.pdf', { force: true, optionsJson: '{"a":1}' });
    expect(forced).toContain('--force');
    expect(after(forced, '--options-json')).toBe('{"a":1}');

    expect(argv.send('/s/script.epub')).not.toContain('--device');
    expect(after(argv.send('/s/script.epub', 'kindle-1'), '--device')).toBe('kindle-1');

    expect(argv.settings('/s/x.fountain')).not.toContain('--set');
    expect(after(argv.settings('/s/x.fountain', '{"a":1}'), '--set')).toBe('{"a":1}');

    // A re-render writes the library EPUB back in place, so what gets sent
    // stays what was previewed. It names that path with -o, so it must NOT
    // also ask for --library: the engine refuses the pair rather than picking
    // a winner, and a re-render that did both would fail every time.
    const again = argv.reconvert('/s/x.fountain', '/s/x.epub', '{}');
    expect(after(again, '-o')).toBe('/s/x.epub');
    expect(again).not.toContain('--library');

    const exported = argv.export('/s/x.epub', {
      forFormat: 'azw3', fountain: '/s/x.fountain', optionsJson: '{}',
    });
    expect(after(exported, '--for')).toBe('azw3');
    expect(after(exported, '--fountain')).toBe('/s/x.fountain');
    expect(argv.export('/s/x.epub', { forFormat: 'kfx' })).not.toContain('--fountain');
  });

  test('progress is parsed defensively, not assumed to be one clean line', () => {
    const app = read('app.js');
    // The Rust forwards whatever the OS handed it. A parser that called
    // JSON.parse on the raw payload would throw on a two-line chunk and take
    // the conversion down with it.
    expect(app).toMatch(/split\(/);
    expect(app).toMatch(/catch\s*{/);
  });

  test('no surface sets innerHTML with anything but its own constant', () => {
    // Titles, device names and engine messages are all data from outside.
    // frame.js is the one exemption: it injects its own SVG symbol constant.
    for (const name of jsFiles()) {
      if (name === 'frame.js' || name === 'notes.js' || name === 'notes-surface.js') continue;
      expect(`${name} sets innerHTML: ${/innerHTML/.test(read(name))}`).toBe(
        `${name} sets innerHTML: false`,
      );
    }
  });
});

describe('the five surfaces are wired to the frame', () => {
  const SURFACES = ['convert', 'read', 'tune', 'send', 'notes-surface'];

  test('main.js mounts every surface module, and each one can be mounted', async () => {
    const main = read('main.js');
    for (const name of SURFACES) {
      expect(main).toContain(`./${name}.js`);
      const surface = await import(join(UI, `${name}.js`));
      expect(typeof surface.mount, `${name}.js exports no mount()`).toBe('function');
    }
  });

  test('the shortcut main.js fires actually exists on the convert surface', async () => {
    // main.js calls convert.choose() from its Ctrl/Cmd-O handler. If the
    // surface ever stops exporting it, the shortcut throws in a window where
    // nobody sees the console.
    const main = read('main.js');
    const called = [...main.matchAll(/\bconvert\.([a-zA-Z]+)\(/g)].map((m) => m[1]);
    expect(called.length).toBeGreaterThan(0);
    const surface = await import(join(UI, 'convert.js'));
    for (const name of called) {
      expect(typeof (surface as Record<string, unknown>)[name], `convert.js has no ${name}()`)
        .toBe('function');
    }
  });

  test('the surfaces that need a script start out of reach', () => {
    // Read, Tune and Send have nothing to show before a conversion. A window
    // that offered them anyway would answer a click with an empty page.
    const main = read('main.js');
    expect(main).toMatch(/\['read',\s*'tune',\s*'send'\]/);
    expect(main).toContain('scriptChanged');
    expect(main).toContain("frame.setSurface('convert')");
  });
});

describe('the Convert surface', () => {
  const convert = read('convert.js');

  test('it tells you what the engine cannot take, before you drop', () => {
    // brand/components/drop-well.html's own argument: a scanned PDF with no
    // text layer is a property a reader can check at a glance, so saying it
    // here moves it from after the wait to before the drop.
    //
    // It named a second guard, a password-locked file, until 2026-09-20. See
    // WELL in convert.js for why that half went and what it cost.
    expect(convert).toContain('Needs selectable text, not a scan.');
  });

  test('it offers "Convert anyway" only for the one guard a reader can overrule', () => {
    // not-screenplay is overridable by --force; scanned, password and
    // unreadable describe a file the engine genuinely cannot read, and
    // offering an override there would be a lie.
    expect(convert).toContain("'not-screenplay'");
    const forced = convert.slice(convert.indexOf("'not-screenplay'"));
    expect(forced).toContain('force');
    for (const code of ['scanned', 'password']) {
      expect(
        new RegExp(`'${code}'[^\\n]*force`).test(convert),
        `convert.js offers a force override for ${code}`,
      ).toBe(false);
    }
  });

  test('it renders the engine’s own message rather than a sentence of its own', () => {
    expect(convert).toContain('error.message');
    expect(convert).toContain('error.code');
    for (const invented of ['Something went wrong', 'An error occurred', 'Oops', 'Sorry']) {
      expect(`convert.js says "${invented}": ${convert.includes(invented)}`).toBe(
        `convert.js says "${invented}": false`,
      );
    }
  });

  test('the failure heading names the cause, for every code the engine can return', () => {
    // Every JsonError code the conversion path can produce must have a
    // heading, or a real failure renders with a blank title.
    for (const code of ['scanned', 'not-screenplay', 'password', 'unreadable',
      'unsupported-type', 'bad-options', 'internal']) {
      expect(convert.includes(`'${code}'`), `convert.js has no heading for ${code}`).toBe(true);
    }
  });

  test('the progress bar is determinate and never walks backwards', () => {
    // The engine emits a percent per stage; a bar that took each stage's
    // percent literally would jump 85 -> 0 at the parse/render boundary.
    expect(convert).toContain('Math.max');
    expect(convert).toContain('percent');
  });

  test('the shortcut label is the platform’s, not the Mac’s everywhere', () => {
    // brand/components/drop-well.html draws the Mac spelling. This window
    // runs on three platforms.
    expect(convert).toContain('navigator');
    expect(convert).toContain('Ctrl');
  });

  test('the surface does not place the focus after a dialog itself', () => {
    // It used to, and it got it wrong: it re-focused the drop well's button,
    // which exists on ONE of this surface's four states, so cancelling a
    // dialog over a result or a refusal left the page with NO focused
    // element and a keyboard that could not move. Where the focus goes is a
    // decision now (focus.js) and it is placed once, for every surface and
    // every dialog, by main.js. A surface asks; it does not choose.
    expect(`convert.js focuses the picker's button: ${/chooseButton\??\.focus\(\)/.test(convert)}`)
      .toBe("convert.js focuses the picker's button: false");
    expect(convert).toContain('ctx.restoreFocus()');
  });

  test('a refusal does not close the script that was already open', () => {
    // Dropping a file the engine will not read used to take Read, Tune and
    // Send away from a book still sitting in the library.
    expect(`convert.js clears the open script: ${/state\.script\s*=\s*null/.test(convert)}`)
      .toBe('convert.js clears the open script: false');
    expect(convert).toContain('stillOpenNote');
  });

  test('the error code is a labelled handle, not the last line of the sentence', () => {
    // It is genuinely useful in a bug report, so it stays; it just stops
    // being presented as prose under the buttons.
    expect(convert).toContain('code-chip');
    expect(convert).toContain('Error code');
    expect(convert).toContain('dataset.errorCode');
    const css = read('surfaces.css');
    expect(css).toContain('.code-chip');
    expect(css).toContain('.code-note-label');
  });

  test('NO surface sets an inline style, which this window’s CSP refuses', () => {
    // Measured in piece C: with `default-src 'self'` an appended <style>, a
    // style= attribute and a <style> inside srcdoc all fail silently. The
    // bar's width is the one computed value on this surface, so this is the
    // rule most easily broken here — but naming only convert.js left read.js,
    // tune.js, send.js and frame.js free to break it silently. The CSP is the
    // whole window's, so the guard is too.
    for (const name of jsFiles()) {
      expect(`${name} sets .style: ${/\.style\b/.test(read(name))}`).toBe(
        `${name} sets .style: false`,
      );
      // The key may be unquoted, and here it usually IS: every el() call in
      // this window writes `{ class: 'prose' }`, and dom.js falls through to
      // setAttribute for any key it does not special-case, so `{ style: '…' }`
      // is a real inline style written in the house spelling. The lookbehind
      // is what keeps `font-style:` in read.js's @font-face block from
      // reading as a violation.
      const styleKey = /(?<![\w-])['"`]?style['"`]?\s*:/;
      expect(`${name} sets a style attribute: ${styleKey.test(read(name))}`).toBe(
        `${name} sets a style attribute: false`,
      );
    }
    // ...and the route convert.js uses instead, which piece C measured as
    // working.
    expect(convert).toContain('adoptedStyleSheets');
  });

  test('only app.js listens for the drop, and it hands over every path', () => {
    // The drop is an IPC event like any other: tests above already forbid a
    // surface from touching Tauri, and this is the rule's other half — the
    // boundary must not decide WHICH file gets converted, or that decision
    // ends up somewhere no test can reach it.
    const app = read('app.js');
    expect(app).toContain("'tauri://drag-drop'");
    expect(app).toContain("'tauri://drag-enter'");
    expect(app).toContain("'tauri://drag-leave'");
    expect(app).toContain('paths');
    // The path is not picked here: app.js forwards the array.
    expect(`app.js picks a path: ${/paths\s*\[\s*0\s*\]/.test(app)}`).toBe(
      'app.js picks a path: false',
    );
    const main = read('main.js');
    expect(main).toContain('onFileDrag');
    expect(main).toContain('convert.dragOver');
    expect(main).toContain('convert.dropPaths');
  });
});

describe('what the Convert surface decides', () => {
  // The decisions, exercised directly. The drawing over them is thin by
  // design; these are the rules a wrong implementation would get wrong.
  // desktop/ui is plain .js with no declarations, so the module is imported
  // the same dynamic way the argv tests import app.js, and its decision
  // surface is spelled out here — which doubles as the list a later surface
  // may rely on.
  type Progress = { percent: number; stage: string | null; label: string };
  type ConvertModule = {
    HEADINGS: Record<string, string>;
    OVERRIDABLE: string;
    NO_MESSAGE: string;
    PROGRESS_START: Progress;
    shortcutLabel: (platform: unknown) => string;
    failureFor: (error: unknown) => {
      code: string; heading: string; message: string; canForce: boolean;
    };
    nextProgress: (previous: Progress, line: unknown) => Progress;
    withoutCliRemedy: (message: unknown, flag: unknown) => string;
    stillOpenNote: (script: unknown) => string | null;
    fileName: (path: unknown) => string;
    countLine: (answer: unknown) => string;
    scriptFrom: (path: string, answer: unknown) => Record<string, unknown>;
    droppedPath: (paths: unknown) => string | null;
  };
  let convert: ConvertModule;

  beforeAll(async () => {
    convert = (await import(join(UI, 'convert.js'))) as ConvertModule;
  });

  test('the shortcut is spelled the platform’s way', () => {
    expect(convert.shortcutLabel('MacIntel')).toBe('⌘O');
    expect(convert.shortcutLabel('macOS')).toBe('⌘O');
    expect(convert.shortcutLabel('Linux aarch64')).toBe('Ctrl+O');
    expect(convert.shortcutLabel('Win32')).toBe('Ctrl+O');
    // navigator.userAgentData is absent on WebKitGTK, and navigator.platform
    // is deprecated: both can be undefined in the same window.
    expect(convert.shortcutLabel(undefined)).toBe('Ctrl+O');
  });

  test('every code the engine can refuse with gets a heading that names a cause', () => {
    const codes = ['scanned', 'not-screenplay', 'password', 'unreadable',
      'unsupported-type', 'bad-options', 'usage', 'internal'];
    const headings = new Set<string>();
    for (const code of codes) {
      const { heading } = convert.failureFor({ code, message: 'x' });
      expect(`${code}: ${heading}`).not.toBe(`${code}: `);
      // A heading that is the same for every code names nothing.
      headings.add(heading);
    }
    expect(headings.size).toBeGreaterThanOrEqual(codes.length - 1);
    // The blank-heading failure this is here to prevent: a code no one
    // anticipated still renders a sentence, and is never overridable.
    const unknown = convert.failureFor({ code: 'moon-phase', message: 'x' });
    expect(unknown.heading).toBe(convert.HEADINGS.internal);
    expect(unknown.canForce).toBe(false);
    expect(unknown.code).toBe('moon-phase');
  });

  test('the engine’s sentence survives verbatim, whatever is in it', () => {
    // Not trimmed into a summary, not re-cased, not suffixed. The ONE edit
    // this window makes is the CLI remedy, and only where it has drawn the
    // button that remedy describes; every other refusal is word for word.
    for (const [code, said] of [
      ['unreadable', 'cannot read the input file (EACCES)'],
      ['scanned', 'This PDF has no selectable text — it looks like a scan.'],
      ['password', 'This PDF is password-protected.'],
      ['internal', 'the engine did not answer in JSON:\n<!DOCTYPE html>'],
    ] as const) {
      expect(`${code}: ${convert.failureFor({ code, message: said }).message}`)
        .toBe(`${code}: ${said}`);
    }
    // Including one that names the flag: the window draws no override for a
    // scan, so there is nothing here talking past the reader, and taking the
    // sentence out would delete the only instruction they have.
    const scanned = 'This PDF is a scan. Pass --force to convert it anyway.';
    expect(convert.failureFor({ code: 'scanned', message: scanned }).message).toBe(scanned);
  });

  test('the refusal stops telling a window user to type the flag it drew a button for',
    () => {
      // The engine's sentence is written for a terminal and is right there.
      // In the window it lands directly above a Convert anyway button that
      // does exactly what it asks for.
      const said = 'No scene headings and no dialogue found — this does not look like a '
        + 'screenplay. Pass --force to convert it anyway.';
      const shown = convert.failureFor({ code: 'not-screenplay', message: said });
      // Asserted against the value it CHANGED FROM, so a function that did
      // nothing at all cannot pass: the input carries the remedy, the output
      // does not, and what is left is the diagnosis, whole and unedited.
      expect(said).toContain('Pass --force');
      expect(shown.message).toBe(
        'No scene headings and no dialogue found — this does not look like a screenplay.',
      );
      expect(shown.canForce).toBe(true);
      // And the button is still there: the remedy did not go away, it moved.
      expect(convert.OVERRIDABLE).toBe('not-screenplay');
    });

  test('a failure with no sentence still says something, and says it once', () => {
    for (const broken of [{ code: 'scanned' }, { code: 'scanned', message: '   ' }, {}, undefined]) {
      const shown = convert.failureFor(broken as never);
      expect(shown.message).toBe(convert.NO_MESSAGE);
      expect(shown.heading.length).toBeGreaterThan(0);
    }
    // A missing code is the engine breaking its contract, not a file the
    // reader can overrule.
    expect(convert.failureFor({} as never).code).toBe('internal');
    expect(convert.failureFor({} as never).canForce).toBe(false);
  });

  test('only not-screenplay may be overruled', () => {
    expect(convert.failureFor({ code: 'not-screenplay', message: 'x' }).canForce).toBe(true);
    for (const code of ['scanned', 'password', 'unreadable', 'unsupported-type',
      'bad-options', 'usage', 'internal']) {
      expect(`${code} canForce: ${convert.failureFor({ code, message: 'x' }).canForce}`)
        .toBe(`${code} canForce: false`);
    }
  });

  test('the bar follows the engine\u2019s own percent, which is already the whole job', () => {
    // Measured against the engine, not assumed: a 3,601-page script emits
    // parse 6..85 and then render 85, render 100, because src/convert.ts
    // has already applied PARSE_SHARE. A window that re-weighted those
    // numbers would stall at 72% for the entire tail of the parse and then
    // leap to the end — which is exactly what the first draft of this
    // surface did, and what a live run caught.
    let at = convert.PROGRESS_START;
    const seen: number[] = [];
    for (const line of [
      { stage: 'parse', percent: 6 }, { stage: 'parse', percent: 44 },
      { stage: 'parse', percent: 85 }, { stage: 'render', percent: 85 },
      { stage: 'render', percent: 100 },
    ]) {
      at = convert.nextProgress(at, line);
      seen.push(at.percent);
    }
    expect(seen).toEqual([6, 44, 85, 85, 100]);
    // Every step forward or level, never back.
    for (let i = 1; i < seen.length; i += 1) expect(seen[i]).toBeGreaterThanOrEqual(seen[i - 1]);
  });

  test('the read-out names the stage the reader is waiting on', () => {
    expect(convert.PROGRESS_START.label).toBe('starting up');
    expect(convert.nextProgress(convert.PROGRESS_START, { stage: 'parse', percent: 40 }).label)
      .toBe('reading the pages (40%)');
    // Crossing into rendering is news even though the bar does not move: the
    // engine hands over at 85 on both sides of the boundary.
    const parsed = convert.nextProgress(convert.PROGRESS_START, { stage: 'parse', percent: 85 });
    expect(parsed.label).toBe('reading the pages (85%)');
    const rendering = convert.nextProgress(parsed, { stage: 'render', percent: 85 });
    expect(rendering.label).toBe('building the book (85%)');
    expect(rendering.percent).toBe(85);
  });

  test('a line that is late, unknown or malformed leaves the bar alone', () => {
    const half = convert.nextProgress(convert.PROGRESS_START, { stage: 'render', percent: 50 });
    for (const junk of [
      { stage: 'parse', percent: 20 },      // a parse line arriving after render began
      { stage: 'render', percent: 50 },     // the percent it is already showing
      { stage: 'polish', percent: 99 },     // a stage this window does not know
      { stage: 'render', percent: 'lots' }, // not a number
      { stage: 'render' }, {}, undefined, null,
    ]) {
      expect(convert.nextProgress(half, junk as never)).toBe(half);
    }
    // ...and a percent outside the contract is clamped, not drawn past the end.
    expect(convert.nextProgress(half, { stage: 'render', percent: 900 }).percent).toBe(100);
  });

  test('the percents the engine really emits drive the bar from end to end', async () => {
    // The other half of the pin above: the sequence is read off the engine
    // itself rather than typed out here, so a change to PARSE_SHARE or to
    // the throttle shows up as a failing test rather than as a stuck bar.
    const root = new URL('..', import.meta.url).pathname;
    const proc = Bun.spawn(
      ['bun', join(root, 'src', 'cli.ts'), join(root, 'tests', 'fixtures', 'screenplay.pdf'),
        '--json', '--progress', '-o', join(SCRATCH, 'convert-progress.epub')],
      { stdout: 'pipe', stderr: 'pipe' },
    );
    const [stderr] = await Promise.all([new Response(proc.stderr).text(), proc.exited]);
    const lines = stderr.split('\n').map((l) => l.trim()).filter((l) => l.startsWith('{'))
      .map((l) => JSON.parse(l).progress).filter((p) => p);
    expect(lines.length).toBeGreaterThan(2);

    let at = convert.PROGRESS_START;
    const seen = lines.map((line: { stage: string; percent: number }) => {
      at = convert.nextProgress(at, line);
      return at.percent;
    });
    for (let i = 1; i < seen.length; i += 1) expect(seen[i]).toBeGreaterThanOrEqual(seen[i - 1]);
    // It starts somewhere near the beginning and finishes AT the end: a bar
    // that stopped at 72% would satisfy monotonicity and still be wrong.
    expect(seen[0]).toBeLessThan(50);
    expect(at.percent).toBe(100);
    expect(at.label).toBe('building the book (100%)');
  }, 60000);

  test('the counts read as a sentence, singular included', () => {
    expect(convert.countLine({ pages: 5, scenes: 5, characters: 3 }))
      .toBe('5 pages. 5 scenes.\n3 speaking characters.');
    expect(convert.countLine({ pages: 1, scenes: 1, characters: 1 }))
      .toBe('1 page. 1 scene.\n1 speaking character.');
    expect(convert.countLine({ pages: 2, scenes: 0, characters: 0 }))
      .toBe('2 pages. 0 scenes.\n0 speaking characters.');
    // The engine omits the counts entirely for a .fountain input; "undefined
    // pages" is worse than no line at all.
    expect(convert.countLine({ title: 'x' })).toBe('');
    expect(convert.countLine({ pages: 4 })).toBe('4 pages.');
  });

  test('the script object tasks 9–11 read is complete whatever the engine sent', () => {
    const full = convert.scriptFrom('/s/The Script.pdf', {
      ok: true, title: 'The Last Video Store', author: 'A. N. Placeholder',
      pages: 5, scenes: 5, characters: 3, warnings: ['a dual-dialogue block was flattened'],
      epubPath: '/s/The Script.epub', fountainPath: '/s/The Script.fountain',
      previewHtml: '<p>x</p>', mobiPath: '/s/The Script.mobi',
    });
    expect(full).toEqual({
      path: '/s/The Script.pdf',
      title: 'The Last Video Store',
      author: 'A. N. Placeholder',
      pages: 5, scenes: 5, characters: 3,
      warnings: ['a dual-dialogue block was flattened'],
      epubPath: '/s/The Script.epub',
      fountainPath: '/s/The Script.fountain',
      previewHtml: '<p>x</p>',
      settings: null,
    });

    // A title-less script falls back to its filename rather than to nothing:
    // every later surface prints this.
    const bare = convert.scriptFrom('/s/untitled.pdf', { ok: true, epubPath: '/s/untitled.epub' });
    expect(bare.title).toBe('untitled.pdf');
    expect(bare.author).toBeNull();
    expect(bare.warnings).toEqual([]);
    expect(bare.previewHtml).toBe('');
    expect(bare.settings).toBeNull();
    // The same keys either way, so no surface has to test for a field.
    expect(Object.keys(bare).sort()).toEqual(Object.keys(full).sort());
  });

  test('one window converts one dropped script', () => {
    expect(convert.droppedPath(['/a/one.pdf', '/a/two.pdf'])).toBe('/a/one.pdf');
    expect(convert.droppedPath(['', '  ', '/a/real.pdf'])).toBe('/a/real.pdf');
    // Tauri sends drag-leave with no payload at all; the well must not try to
    // convert nothing.
    expect(convert.droppedPath([])).toBeNull();
    expect(convert.droppedPath(undefined as never)).toBeNull();
    expect(convert.droppedPath('/a/one.pdf' as never)).toBeNull();
  });

  test('the working line names the file, not its path', () => {
    expect(convert.fileName('/home/a/scripts/The Script.pdf')).toBe('The Script.pdf');
    expect(convert.fileName('C:\\Users\\a\\The Script.pdf')).toBe('The Script.pdf');
    expect(convert.fileName('The Script.pdf')).toBe('The Script.pdf');
  });

  test('the code it branches on is a code the engine really returns', async () => {
    // The one assertion here that a change to the engine could break: if
    // prose.pdf ever stopped reporting not-screenplay, this surface would go
    // on offering "Convert anyway" for a code nobody sends.
    const root = new URL('..', import.meta.url).pathname;
    const proc = Bun.spawn(
      ['bun', join(root, 'src', 'cli.ts'), join(root, 'tests', 'fixtures', 'prose.pdf'),
        '--json', '-o', join(SCRATCH, 'convert-surface.epub')],
      { stdout: 'pipe', stderr: 'pipe' },
    );
    const [stdout] = await Promise.all([new Response(proc.stdout).text(), proc.exited]);
    const answer = JSON.parse(stdout);
    expect(answer.ok).toBe(false);
    const shown = convert.failureFor(answer.error);
    expect(shown.canForce).toBe(true);
    expect(shown.heading).toBe(convert.HEADINGS['not-screenplay']);
    // And the trim is measured against what the ENGINE really writes rather
    // than against a sentence typed out in this file: the remedy the window
    // replaced with a button is in the engine's message and out of the
    // window's, and every other word of it survives.
    expect(answer.error.message).toContain('--force');
    expect(shown.message).not.toContain('--force');
    expect(shown.message.length).toBeGreaterThan(20);
    expect(answer.error.message.startsWith(shown.message)).toBe(true);
  }, 60000);
});

describe('what the Convert surface decides about a refusal', () => {
  type ConvertBits = {
    withoutCliRemedy: (message: unknown, flag: unknown) => string;
    stillOpenNote: (script: unknown) => string | null;
  };
  let convert: ConvertBits;
  beforeAll(async () => {
    convert = (await import(join(UI, 'convert.js'))) as ConvertBits;
  });

  test('only the sentence naming the flag comes out, and only if one does', () => {
    const flag = '--force';
    // The real shape: diagnosis, then remedy. The remedy goes; the diagnosis
    // is returned unedited, which is checked by equality rather than by
    // "does not contain" — a function that returned the empty string, or the
    // first word, would pass that weaker check.
    expect(convert.withoutCliRemedy(
      'No scene headings found. Pass --force to convert it anyway.', flag,
    )).toBe('No scene headings found.');
    // Three sentences, the flag in the MIDDLE: the tail is not collateral.
    expect(convert.withoutCliRemedy(
      'A is true. Pass --force to convert it anyway. B is still true.', flag,
    )).toBe('A is true. B is still true.');
    // Nothing to take out: byte for byte what came in, for a message with no
    // flag in it at all and for one whose text merely resembles a flag.
    for (const said of [
      'cannot read the input file (EACCES)',
      'This PDF is password-protected.',
      'the line is a run-on with no full stop at all',
      'A dash--dash is not a flag.',
    ]) {
      expect(`kept: ${convert.withoutCliRemedy(said, flag)}`).toBe(`kept: ${said}`);
    }
    // A message that is ONLY the remedy is left whole. A blank fault body
    // says less than a sentence a window user cannot act on, and this is the
    // failure mode of every "strip the last sentence" implementation.
    expect(convert.withoutCliRemedy('Pass --force to convert it anyway.', flag))
      .toBe('Pass --force to convert it anyway.');
    // No flag to look for is not a licence to cut.
    expect(convert.withoutCliRemedy('Pass --force to convert it anyway.', ''))
      .toBe('Pass --force to convert it anyway.');
    expect(convert.withoutCliRemedy(undefined, flag)).toBe('');
  });

  test('the refusal says the open script survived, and names it', () => {
    // The decision behind it: a file the engine would not read produced
    // nothing to replace the open book with, so it replaces nothing.
    const note = convert.stillOpenNote({ title: 'The Last Video Store' });
    expect(note).toContain('The Last Video Store');
    expect(note).toContain('still open');
    // Nothing open, nothing to reassure anyone about: a line reading
    // "null is still open" is exactly the stray `null` this plan caught once.
    for (const nothing of [null, undefined, {}, { title: '' }, { title: '   ' }]) {
      expect(`${JSON.stringify(nothing)}: ${convert.stillOpenNote(nothing)}`)
        .toBe(`${JSON.stringify(nothing)}: null`);
    }
  });
});

describe('where the keyboard stands when a dialog closes', () => {
  // The defect this is the fix for: Ctrl-O then Escape, with a result on
  // screen, could leave the page with NO focused element — Tab, Shift-Tab
  // and the tablist's arrows all dead, and no way back without a mouse.
  // Placing the focus is a decision, so it is a pure function and it is
  // tested here rather than in the handler that first needed it.
  type FakeNode = {
    id?: string; isConnected?: boolean; disabled?: boolean; hidden?: boolean;
    closest?: (selector: string) => unknown;
  };
  type FocusModule = {
    FOCUSABLE: string;
    ALWAYS: string;
    focusPlan: (surface: unknown) => string[];
    canFocus: (node: unknown) => boolean;
    firstStop: (candidates: unknown) => unknown;
    stopAfterDialog: (surface: string, queryAll: (s: string) => Iterable<unknown>) => unknown;
  };
  let focus: FocusModule;
  // The four the bar switches between. Notes left the bar on 2026-09-20: it
  // is a <dialog> opened from the rev stamp now, so the platform owns its
  // focus and there is no #tab-notes for a plan to point at.
  const SURFACES = ['convert', 'read', 'tune', 'send'];

  beforeAll(async () => {
    focus = (await import(join(UI, 'focus.js'))) as FocusModule;
  });

  test('every surface gets a plan, and it is that surface’s plan', () => {
    const plans = new Map(SURFACES.map((s) => [s, focus.focusPlan(s)]));
    for (const [surface, plan] of plans) {
      // The order IS the decision: the surface's own work first, then the
      // pane, then its tab, then the one tab that is never disabled.
      expect(`${surface} steps: ${plan.length}`).toBe(`${surface} steps: 4`);
      expect(plan[1]).toBe(`#surface-${surface}`);
      expect(plan[2]).toBe(`#tab-${surface}`);
      expect(plan[3]).toBe(focus.ALWAYS);
      // The first step must be SCOPED to the showing pane. Unscoped, its
      // first match in the document is the tablist's first tab, so every
      // dialog on every surface would dump the reader back on Convert —
      // and a test that only checked for 'button' would not notice.
      for (const part of plan[0].split(', ')) {
        expect(`${surface} step 1 part: ${part}`).toBe(
          `${surface} step 1 part: #surface-${surface} ${part.split(' ').slice(1).join(' ')}`,
        );
      }
      expect(plan[0]).toContain('button:not([disabled])');
    }
    // Five surfaces, five different plans: a plan that ignored its argument
    // would satisfy everything above for whichever surface it hard-coded.
    expect(new Set([...plans.values()].map((p) => p.join('|'))).size).toBe(SURFACES.length);
  });

  test('a disabled, detached or hidden control is not somewhere to stand', () => {
    const good: FakeNode = { id: 'good', isConnected: true, closest: () => null };
    expect(focus.canFocus(good)).toBe(true);
    // Each one asserted against that same node with ONE property changed, so
    // a canFocus() that always returned false could not pass the line above
    // and one that always returned true cannot pass these.
    expect(focus.canFocus({ ...good, disabled: true })).toBe(false);
    expect(focus.canFocus({ ...good, isConnected: false })).toBe(false);
    expect(focus.canFocus({ ...good, hidden: true })).toBe(false);
    // A control in a pane that is hidden is just as unreachable as a hidden
    // control: this is the case that matters, because four of the five panes
    // are hidden at any moment.
    expect(focus.canFocus({ ...good, closest: (sel: string) => (sel === '[hidden]' ? {} : null) }))
      .toBe(false);
    expect(focus.canFocus(null)).toBe(false);
    expect(focus.canFocus(undefined)).toBe(false);
  });

  test('the first candidate that can take the focus wins, and null means leave it', () => {
    const at = (id: string, extra: FakeNode = {}): FakeNode =>
      ({ id, isConnected: true, closest: () => null, ...extra });
    const dead = at('dead', { disabled: true });
    const first = at('first');
    const second = at('second');
    expect(focus.firstStop([dead, first, second])).toBe(first);
    // Not the last focusable one, which a fold written the wrong way round
    // would return, and not the first CANDIDATE, which no filter would.
    expect(focus.firstStop([dead, second, first])).toBe(second);
    expect(focus.firstStop([dead, at('gone', { isConnected: false })])).toBeNull();
    expect(focus.firstStop([])).toBeNull();
    expect(focus.firstStop(undefined)).toBeNull();
  });

  test('the plan and the page together land the keyboard on the showing surface', () => {
    // A fake document: selector in, nodes out, in the order a real
    // querySelectorAll would give them. No DOM, and the composition — which
    // is where the order can be lost — is still exercised end to end.
    const node = (id: string, extra: FakeNode = {}): FakeNode =>
      ({ id, isConnected: true, closest: () => null, ...extra });
    const page = (map: Record<string, FakeNode[]>) => (selector: string) => map[selector] ?? [];

    // A refusal on Convert: two buttons in the pane, the first of them is
    // where a reader carries on from.
    const convertButtons = [node('convert-anyway'), node('back-to-one')];
    const plan = focus.focusPlan('convert');
    expect(focus.stopAfterDialog('convert', page({
      [plan[0]]: convertButtons,
      [plan[1]]: [node('pane')],
      [focus.ALWAYS]: [node('tab-convert')],
    }))).toBe(convertButtons[0]);

    // A surface with no control at all — the progress bar while it works.
    // The pane carries tabindex="0", so Tab still moves from there.
    const pane = node('pane');
    expect(focus.stopAfterDialog('convert', page({
      [plan[1]]: [pane], [focus.ALWAYS]: [node('tab-convert')],
    }))).toBe(pane);

    // The pane's controls are all disabled — Tune's two indent sliders are
    // really like this — so the pane is still the answer, not the first
    // disabled slider.
    expect(focus.stopAfterDialog('convert', page({
      [plan[0]]: [node('slider', { disabled: true })],
      [plan[1]]: [pane],
    }))).toBe(pane);

    // Nothing left of the surface: the tab that exists in every state.
    const always = node('tab-convert');
    expect(focus.stopAfterDialog('read', page({ [focus.ALWAYS]: [always] }))).toBe(always);

    // A page with nothing focusable anywhere leaves the focus alone rather
    // than moving it somewhere worse.
    expect(focus.stopAfterDialog('read', page({}))).toBeNull();

    // And it really does use the surface it was given: the same page, asked
    // for a different surface, finds nothing.
    expect(focus.stopAfterDialog('send', page({ [plan[0]]: convertButtons }))).toBeNull();
  });

  test('main.js is the one place that places it, and it places it for every dialog', () => {
    const main = read('main.js');
    // The binding is thin on purpose, so what is checked here is that it is
    // WIRED: the decision is imported rather than reimplemented, the dialog
    // boundary calls it, and the surfaces are given it to call after a redraw.
    expect(main).toContain("from './focus.js'");
    expect(main).toContain('stopAfterDialog');
    expect(main).toContain('onDialogClosed(restoreFocus)');
    expect(main).toContain('restoreFocus,');
    // It follows the surface that is showing, not a remembered one.
    expect(main).toMatch(/showing = id/);
    // No other surface may place the focus after a dialog behind its back.
    for (const name of jsFiles()) {
      if (name === 'main.js' || name === 'focus.js') continue;
      expect(`${name} plans focus: ${/focusPlan|stopAfterDialog/.test(read(name))}`)
        .toBe(`${name} plans focus: false`);
    }
  });

  test('asking for a file does not move the reader off the surface they are on', () => {
    // The shortcut used to switch to Convert before it opened the picker, so
    // hitting it on Tune and then cancelling left someone on a surface they
    // had not asked for, with their work off screen — and it made the focus
    // rule above untestable as a general one, because the surface showing
    // when a dialog closed was always Convert. Converting still moves there;
    // asking does not.
    const main = read('main.js');
    const from = main.indexOf('metaKey');
    const shortcut = main.slice(from, main.indexOf('});', from));
    expect(shortcut).toContain('convert.choose()');
    expect(`the shortcut switches surface: ${/setSurface\('convert'\)/.test(shortcut)}`)
      .toBe('the shortcut switches surface: false');
    // The drop does not switch either — the surface does it, on the file.
    const drop = main.slice(main.indexOf('onFileDrag'), main.indexOf('metaKey'));
    expect(drop).toContain('convert.dropPaths');
    expect(`the drop handler switches surface: ${/setSurface\('convert'\)/.test(drop)}`)
      .toBe('the drop handler switches surface: false');
    expect(read('convert.js')).toContain("ctx.goTo('convert')");
  });

  test('the reader’s Tab stop is one that can show the focus', () => {
    // The frame swallowed the focus and showed nothing for it. Measured with
    // a probe on the live window, WebKitGTK gives a focused iframe no :focus
    // match, no painted outline and no box-shadow, and fires NO focus, blur
    // or focusin event for it either — so not even a class could be hung on
    // it from script. The stop is therefore the stage around the frame, and
    // the frame is taken out of the Tab order.
    const reader = read('read.js');
    expect(reader).toContain('script-stage');
    expect(reader).toMatch(/tabindex: '-1'/);
    expect(reader).toMatch(/tabindex: '0'/);
    const css = read('surfaces.css');
    const rings = [...css.matchAll(/\.script-stage:focus[^{]*\{([^}]*)\}/g)].map((m) => m[1]);
    expect(rings.length).toBeGreaterThan(0);
    expect(rings.every((body) => /outline:\s*\d/.test(body))).toBe(true);
    // ...and nothing tries to ring the frame itself any more, which would be
    // a rule that renders on no machine anyone has run this on.
    expect(`surfaces.css rings the frame: ${/\.script-frame:focus/.test(css)}`)
      .toBe('surfaces.css rings the frame: false');
    // The focus plan must not send anyone to the frame either.
    expect(`focus.js treats an iframe as a stop: ${/'iframe'/.test(read('focus.js'))}`)
      .toBe('focus.js treats an iframe as a stop: false');
  });

  test('the arrow keys still move the script, now that the frame is not the stop', async () => {
    // What the frame used to get free from the engine. Exercised as a
    // decision rather than read off the handler.
    const reader = (await import(join(UI, 'read.js'))) as {
      scrollStep: (key: string, height: unknown) => number | string | null;
      READER_LINE: number;
      PAGE_FLOOR: number;
    };
    const step = reader.scrollStep;
    expect(step('ArrowDown', 600)).toBe(reader.READER_LINE);
    expect(step('ArrowUp', 600)).toBe(-reader.READER_LINE);
    // A page is most of the frame, not all of it: reading loses its place if
    // the line you stopped on scrolls off the top.
    const page = step('PageDown', 600) as number;
    expect(page).toBeLessThan(600);
    expect(page).toBeGreaterThan(600 / 2);
    expect(step('PageUp', 600)).toBe(-page);
    expect(step(' ', 600)).toBe(page);
    // Absolute, not a big number: Home and End are the ends of the script.
    expect(step('Home', 600)).toBe('top');
    expect(step('End', 600)).toBe('bottom');
    // A page scales with the frame — a fixed number would be a page on one
    // window size and a line on another — and never shrinks to nothing when
    // the frame has no height yet to measure.
    expect(step('PageDown', 1200)).toBeGreaterThan(page);
    for (const nothing of [0, undefined, null, 'tall', NaN, -400]) {
      expect(`${nothing}: ${step('PageDown', nothing)}`)
        .toBe(`${nothing}: ${reader.PAGE_FLOOR}`);
    }
    // Every other key belongs to the window, not to the frame: a handler
    // that answered Tab or ArrowRight would eat the surface's own keyboard.
    for (const key of ['Tab', 'ArrowLeft', 'ArrowRight', 'Enter', 'Escape', 'a', '']) {
      expect(`${key}: ${step(key, 600)}`).toBe(`${key}: null`);
    }
  });
});

describe('one file dialog at a time', () => {
  // Ctrl-O twice used to open two native pickers, both modal, both waiting
  // on the same window. `busy` guarded a running CONVERSION and nothing else.
  type AppModule = {
    pickScreenplay: () => Promise<string | null>;
    isDialogOpen: () => boolean;
    onDialogClosed: (handler: () => void) => void;
  };

  function stubPicker() {
    let calls = 0;
    let settle: ((path: string | null) => void) | null = null;
    let fail: ((err: unknown) => void) | null = null;
    (globalThis as unknown as { window: unknown }).window = {
      __TAURI__: {
        core: {
          invoke: () => {
            calls += 1;
            return new Promise((resolve, reject) => { settle = resolve; fail = reject; });
          },
        },
      },
    };
    return {
      get calls() { return calls; },
      answer: (path: string | null) => settle!(path),
      reject: (err: unknown) => fail!(err),
    };
  }

  afterEach(() => { delete (globalThis as unknown as { window?: unknown }).window; });

  test('a second ask while one is open opens nothing, and the first still answers', async () => {
    const app = (await import(join(UI, 'app.js'))) as AppModule;
    const picker = stubPicker();

    const first = app.pickScreenplay();
    await Promise.resolve();
    expect(app.isDialogOpen()).toBe(true);
    // The assertion that matters: the count of dialogs actually OPENED.
    // A guard that returned the first promise again, or that let the second
    // through, both look the same from the caller.
    expect(await app.pickScreenplay()).toBeNull();
    expect(await app.pickScreenplay()).toBeNull();
    expect(`pickers opened: ${picker.calls}`).toBe('pickers opened: 1');

    picker.answer('/s/script.pdf');
    expect(await first).toBe('/s/script.pdf');

    // ...and the guard clears, or the window could never open a second file.
    // Asserted against the state it changed FROM, above.
    expect(app.isDialogOpen()).toBe(false);
    const again = app.pickScreenplay();
    await Promise.resolve();
    expect(`pickers opened after: ${picker.calls}`).toBe('pickers opened after: 2');
    picker.answer(null);
    expect(await again).toBeNull();
  });

  test('a dialog that fails still closes, and still hands the keyboard back', async () => {
    const app = (await import(join(UI, 'app.js'))) as AppModule;
    const picker = stubPicker();
    let closed = 0;
    app.onDialogClosed(() => { closed += 1; });

    const asked = app.pickScreenplay().then(() => 'resolved', () => 'rejected');
    await Promise.resolve();
    picker.reject(new Error('no portal'));
    expect(await asked).toBe('rejected');
    // A guard left standing by a throw would lock the window out of ever
    // opening a file again, and the keyboard would never be put back.
    expect(app.isDialogOpen()).toBe(false);
    expect(`closed: ${closed}`).toBe('closed: 1');

    const after = app.pickScreenplay();
    await Promise.resolve();
    expect(`pickers opened: ${picker.calls}`).toBe('pickers opened: 2');
    picker.answer(null);
    await after;
    expect(`closed: ${closed}`).toBe('closed: 2');
  });
});

describe('what runEngine does with the answer it is handed', () => {
  // Scope, stated plainly, because these used to claim more than they
  // covered: `invoke` is a stub here, so NOTHING below tests a transport.
  // Whether a large answer survives the trip out of the engine is settled
  // where it can be — tests/cli.test.ts drives the real binary through a
  // real pipe — and whether it survives Tauri's IPC was settled by measuring
  // the live window (desktop/README.md).
  //
  // What is left for this file is the one decision runEngine makes on its
  // own: it parses what it is given, and it truncates the RAW text only in
  // the message for an answer that did not parse. Getting that backwards —
  // capping the success path, or not capping the failure path — is the kind
  // of mistake a stub can catch, so it is caught here.
  async function answering(answer: unknown) {
    const { runEngine } = await import(join(UI, 'app.js'));
    (globalThis as unknown as { window: unknown }).window = {
      __TAURI__: { core: { invoke: async () => answer } },
    };
    try {
      return await runEngine(['--version', '--json']);
    } finally {
      delete (globalThis as unknown as { window?: unknown }).window;
    }
  }

  /** A JSON answer of roughly `bytes` bytes, shaped like the engine's. */
  function bigAnswer(bytes: number) {
    const answer = { ok: true, title: 'Generated Load Sample', previewHtml: '' };
    answer.previewHtml = 'x'.repeat(Math.max(0, bytes - JSON.stringify(answer).length));
    return JSON.stringify(answer);
  }

  test('the 300-character cap never touches an answer that parses', async () => {
    // The cap belongs to the failure message and nowhere else. Applied one
    // step too early — to the stdout, before the parse — every answer over
    // 300 characters would become a syntax error, which is to say every
    // real one. A 500 KB answer makes that unmissable.
    const json = bigAnswer(500_000);
    expect(json.length).toBeGreaterThan(400_000);
    const parsed = await answering(json);
    // Length, not just shape: a cap that cut on a brace could still parse.
    expect(JSON.stringify(parsed).length).toBe(json.length);
    expect(parsed).toEqual(JSON.parse(json));
  });

  test('the engine’s own words come back unedited', async () => {
    // The refusal a reader sees is the engine's sentence, em dash and all.
    // runEngine must hand it over exactly, not normalise or re-encode it.
    const message = 'No scene headings — this does not look like a screenplay. é 日本語';
    const json = JSON.stringify({ ok: false, error: { code: 'not-screenplay', message } });
    const parsed = await answering(json);
    expect((parsed as { error: { message: string } }).error.message).toBe(message);
  });

  test('an answer that is not JSON is reported in a readable length', async () => {
    // Before the cap, a truncated 400 KB answer put 400 KB of raw JSON in a
    // 52-character column, burying the two buttons under it.
    const noise = `<!DOCTYPE html>${'a'.repeat(500_000)}`;
    const err = await answering(noise).then(
      () => null,
      (e: Error) => e,
    );
    expect(err).not.toBeNull();
    expect(err!.message).toContain('the engine did not answer in JSON');
    // The sentence, a newline, 300 characters and an ellipsis — and the
    // whole thing well under a screenful, whatever the answer's size.
    expect(err!.message.length).toBeLessThan(400);
    expect(err!.message).toContain('<!DOCTYPE html>');
    expect(err!.message.endsWith('…')).toBe(true);
  });

  test('a short answer is quoted in full, not always truncated', async () => {
    // Guards the other half: a cap that fired unconditionally would hide the
    // whole of the short answers that are the common case.
    const err = await answering('engine: command not found').then(
      () => null,
      (e: Error) => e,
    );
    expect(err!.message).toBe('the engine did not answer in JSON:\nengine: command not found');
  });

  test('a rejection from Rust is passed through as its own message', async () => {
    const { runEngine } = await import(join(UI, 'app.js'));
    (globalThis as unknown as { window: unknown }).window = {
      __TAURI__: {
        core: {
          invoke: async () => {
            throw 'could not start the Screepub engine (sidecar "screepub-engine")';
          },
        },
      },
    };
    try {
      const err = await runEngine(['--version']).then(
        () => null,
        (e: Error) => e,
      );
      expect(err!.message).toBe('could not start the Screepub engine (sidecar "screepub-engine")');
    } finally {
      delete (globalThis as unknown as { window?: unknown }).window;
    }
  });
});

describe('the window knows when the engine is working, and can restart', () => {
  type Pending = { resolve: (v: string) => void; reject: (e: unknown) => void };
  const win = globalThis as unknown as { window?: unknown };

  test('whenIdle waits for every engine call, including one that fails', async () => {
    const app = await import(join(UI, 'app.js'));
    const pending: Pending[] = [];
    win.window = {
      __TAURI__: {
        core: { invoke: () => new Promise<string>((resolve, reject) => pending.push({ resolve, reject })) },
      },
    };
    try {
      expect(app.engineBusy()).toBe(false);
      const first = app.runEngine(['--version', '--json']);
      // NOT 'devices': that one is never counted (see below), and this test
      // is about two COUNTED calls overlapping.
      const second = app.runEngine(['send', 'x.epub', '--json']).catch(() => 'failed');
      expect(app.engineBusy()).toBe(true);
      let idle = false;
      const waiting = app.whenIdle().then(() => { idle = true; });
      pending[0].resolve('{"ok":true}');
      await first;
      await new Promise((r) => setTimeout(r, 0));
      expect(idle).toBe(false); // one call is still running
      pending[1].reject('the engine is not there');
      expect(await second).toBe('failed');
      await waiting;
      expect(idle).toBe(true);
      expect(app.engineBusy()).toBe(false);
    } finally {
      // A failing assertion above would otherwise leave a pending promise
      // unsettled and `inFlight` stuck above zero: app.js's counters are a
      // module-level singleton, shared with every OTHER test that imports
      // it, so a hang here would hang tests that run long after this one.
      // Resolving an already-settled promise a second time is a documented
      // no-op, so this is safe whether the try block finished cleanly or not.
      for (const p of pending) p.resolve('{}');
      await new Promise((r) => setTimeout(r, 0));
      delete win.window;
    }
  });

  test('an awaited chain (settings, then export, then send) keeps the engine busy start to finish', async () => {
    // The bug a reviewer reproduced: "done settings -> phase restarting ->
    // RESTART -> invoke export". A single macrotask of quiet was read as
    // "idle" between two calls of the SAME job. Real invoke() calls answer
    // on their own timer, not a manually-resolved Promise, so this drives
    // app.runEngine for real through three awaited calls that each answer
    // after setTimeout(10ms): the same shape send.js's sendTo() chain has
    // (settings via ensureSettings(), then export, then send), with
    // whenIdle() asked right after the chain starts, not after it finishes.
    const app = await import(join(UI, 'app.js'));
    await app.whenIdle(); // start from a genuinely idle baseline
    const log: string[] = [];
    win.window = {
      __TAURI__: {
        core: {
          invoke: (_cmd: string, payload: { args: string[] }) => new Promise<string>((resolve) => {
            setTimeout(() => { log.push(`finished ${payload.args[0]}`); resolve('{"ok":true}'); }, 10);
          }),
        },
      },
    };
    try {
      const chain = (async () => {
        await app.runEngine(['settings', 'x.fountain', '--json']);
        await app.runEngine(['export', 'x.epub', '--json', '--for', 'azw3']);
        await app.runEngine(['send', 'x.epub', '--json']);
      })();
      app.whenIdle().then(() => log.push('idle'));
      await chain;
      // The chain is over, but the quiet period has not: this is exactly the
      // window a single-macrotask idle check would have missed.
      expect(log).not.toContain('idle');
      await new Promise((r) => setTimeout(r, app.ENGINE_QUIET_MS + 50));
      expect(log).toEqual(['finished settings', 'finished export', 'finished send', 'idle']);
    } finally {
      delete win.window;
    }
  });

  test('a devices call is never counted: it does not make the engine busy or hold a restart', async () => {
    // send.js polls `devices` every 2 s while the Send tab is open, and each
    // poll takes about 1.5 s on its own (the reMarkable probe timeout).
    // Counting it would flash "Restarting after this finishes..." on that tab
    // on every poll and, with a quiet period, could hold a restart off for
    // as long as the tab stayed open.
    const app = await import(join(UI, 'app.js'));
    await app.whenIdle(); // start from a genuinely idle baseline
    win.window = {
      __TAURI__: {
        core: { invoke: () => new Promise((resolve) => setTimeout(() => resolve('{"ok":true}'), 10)) },
      },
    };
    try {
      const call = app.runEngine(['devices', '--json']);
      expect(app.engineBusy()).toBe(false);
      expect(Bun.peek.status(app.whenIdle())).toBe('fulfilled');
      await call;
      expect(app.engineBusy()).toBe(false);
      expect(Bun.peek.status(app.whenIdle())).toBe('fulfilled');
    } finally {
      delete win.window;
    }
  });

  test('whenIdle is actually fulfilled once the engine has been quiet long enough, not just eventually', async () => {
    // A test that only awaits whenIdle() and checks the flag it set passes
    // no matter how long that takes, which is not what "at once" means.
    // Bun.peek.status reads a promise's state without a microtask of its
    // own, so this proves the promise returned is ALREADY settled the
    // instant it is created, not merely one that resolves eventually.
    const app = await import(join(UI, 'app.js'));
    await app.whenIdle(); // let any residual quiet period from an earlier test lapse
    await new Promise((r) => setTimeout(r, app.ENGINE_QUIET_MS + 50));
    expect(Bun.peek.status(app.whenIdle())).toBe('fulfilled');
  });

  test('restart is offered only when the process plugin is in this build', async () => {
    const app = await import(join(UI, 'app.js'));
    let relaunched = 0;
    win.window = { __TAURI__: { core: {} } };
    try {
      expect(app.restartReady()).toBe(false);
      win.window = { __TAURI__: { process: { relaunch: async () => { relaunched += 1; } } } };
      expect(app.restartReady()).toBe(true);
      await app.restartApp();
      expect(relaunched).toBe(1);
    } finally {
      delete win.window;
    }
  });

  test('the window is never given the plugin\'s exit', () => {
    // process:allow-exit is not granted (capabilities/default.json). Rather
    // than banning one spelling of "call exit", check every property this
    // file actually reads off `process`, always through tauri(), the one
    // door onto Tauri this file uses for anything: the only two are
    // restartReady's guard and restartApp's call, and both name relaunch.
    const matches = read('app.js').match(/tauri\(\)\??\.process\??\.\w+/g) ?? [];
    expect(matches.length).toBeGreaterThan(0);
    for (const m of matches) expect(m).toMatch(/relaunch$/);
  });

  test('the quiet period is timed off a monotonic clock, not the wall clock', () => {
    // Date.now() jumps: a clock sync, DST, or someone changing the system
    // clock could make (Date.now() - lastEnded) go negative or huge, either
    // holding a restart off forever or releasing it early. performance.now()
    // cannot jump like that. Comments are stripped first (as the Tune
    // surface's `engine` helper does below) so an honest future comment
    // that merely mentions Date.now() cannot fail this: the claim is about
    // CODE.
    const code = read('app.js')
      .replace(/\/\*[\s\S]*?\*\//g, ' ')
      .replace(/\/\/.*$/gm, ' ');
    expect(code).not.toContain('Date.now()');
    expect(code).toContain('performance.now()');
  });
});

describe('the real flow and the real runEngine, driven together end to end', () => {
  // Every other update-flow.js test hands createUpdateFlow its own fakes.
  // This one drives the actual exported singleton (`flow`) against a
  // stubbed window.__TAURI__ and a stubbed localStorage, with a real
  // engine call held open through app.js's OWN runEngine/whenIdle, to prove
  // the two files actually agree once wired together rather than only in
  // each one's own fakes.
  //
  // Only offerFound() and start() are called on the singleton, never
  // boot(): boot() runs once ever (createUpdateFlow's own `booted` guard),
  // this module is imported once per test process and shared with every
  // other test that imports it, and a boot() here would both be silently
  // ignored by a later legitimate boot() and could plant a phase ahead of
  // whatever another test expects of the untouched singleton.
  test('relaunch waits for the held engine call to finish, plus the quiet period, not just for the call to end', async () => {
    const app = await import(join(UI, 'app.js'));
    const { flow } = await import(join(UI, 'update-flow.js'));
    await app.whenIdle(); // start from a genuinely idle baseline

    let relaunched = 0;
    let releaseHeld: () => void = () => {};
    const held = new Promise<string>((resolve) => { releaseHeld = () => resolve('{"ok":true}'); });
    const fakeUpdate = {
      version: '9.9.9',
      currentVersion: '0.0.0',
      body: 'test notes',
      downloadAndInstall: async (onEvent: (e: unknown) => void) => {
        onEvent({ event: 'Started', data: { contentLength: 1000 } });
        onEvent({ event: 'Progress', data: { chunkLength: 1000 } });
        onEvent({ event: 'Finished' });
      },
      close: async () => {},
    };
    const g = globalThis as unknown as { window?: unknown; localStorage?: unknown };
    g.window = {
      __TAURI__: {
        // Only the held call goes through this: the offer already carries a
        // live `update`, so installAndRestart never re-checks or re-reads
        // storage on this path.
        core: { invoke: () => held },
        updater: { check: async () => fakeUpdate },
        process: { relaunch: async () => { relaunched += 1; } },
      },
    };
    const stored = new Map<string, string>();
    g.localStorage = {
      getItem: (k: string) => stored.get(k) ?? null,
      setItem: (k: string, v: string) => { stored.set(k, String(v)); },
    };
    try {
      const heldCall = app.runEngine(['send', 'held.epub', '--json']);
      expect(app.engineBusy()).toBe(true);

      flow.offerFound({ outcome: 'offer', version: '9.9.9', body: 'test notes', update: fakeUpdate });
      const run = flow.start();
      await new Promise((r) => setTimeout(r, 0)); // let start() reach whenIdle()
      expect(relaunched).toBe(0);

      releaseHeld();
      await heldCall.catch(() => {});
      await new Promise((r) => setTimeout(r, 0)); // let runEngine's finally settle()
      // The held call has ENDED, but the quiet period has not: this is
      // exactly the gap a single-macrotask idle check would miss.
      expect(relaunched).toBe(0);

      await new Promise((r) => setTimeout(r, app.ENGINE_QUIET_MS + 50));
      await run;
      expect(relaunched).toBe(1);
    } finally {
      delete g.window;
      delete g.localStorage;
    }
  });
});

describe('the Read surface', () => {
  const reader = read('read.js');

  test('it renders the engine’s document, not a document of its own', () => {
    expect(reader).toContain('previewHtml');
    expect(reader).toContain('DOMParser');
    // A reader that built its own screenplay CSS would be a second opinion
    // about formatting, which is the one thing this surface must not be.
    for (const invented of ['scene-heading {', 'p.dialogue {', 'text-transform']) {
      expect(`read.js styles screenplays itself: ${reader.includes(invented)}`).toBe(
        'read.js styles screenplays itself: false',
      );
    }
  });

  test('it takes the stylesheet out of the markup and adopts it', () => {
    // Measured: a <style> inside srcdoc is blocked by the window's CSP, and
    // CSSOM is not. An implementation that left the <style> in place renders
    // an unstyled script and looks like it "nearly works".
    expect(reader).toContain("querySelector('style')");
    expect(reader).toContain('adoptedStyleSheets');
    expect(reader).toContain('replaceSync');
  });

  test('it builds the sheet in the frame’s own realm', () => {
    // `new CSSStyleSheet()` from the parent realm is rejected when adopted
    // into another document. This is the line that makes or breaks it.
    expect(reader).toMatch(/new\s+\w+\.CSSStyleSheet\(\)/);
  });

  test('the frame is sandboxed same-origin, with no script permission', () => {
    expect(reader).toContain('allow-same-origin');
    expect(reader).not.toContain('allow-scripts');
    expect(reader).toContain('sandbox');
  });

  test('it supplies the faces the engine’s CSS asks for by name', () => {
    // The engine's CSS says "Courier Prime"; nothing inside the frame
    // declares where that file is, so the reader must.
    expect(reader).toContain('@font-face');
    expect(reader).toContain('fonts/courier-prime-400-latin.woff2');
  });

  test('a re-render keeps the reader where they were', () => {
    // Tune re-renders on every knob. A reader thrown back to FADE IN on
    // each keystroke is unusable.
    expect(reader).toContain('scrollY');
    expect(reader).toContain('scrollTo');
  });

  test('the rail is built from the engine’s own scene sections', () => {
    // Not from a second parse of the fountain: two parsers is two answers.
    expect(reader).toContain('section.scene');
    expect(reader).toContain('scrollIntoView');
  });

  test('the rail follows the reader through the frame’s own observer', () => {
    // Measured in the live window, because the obvious wiring is the wrong
    // one: a sandboxed srcdoc frame delivers NO scroll event to the parent —
    // not on the frame's window, its document, its documentElement or its
    // body — while the parent reads `scrollY` off that same frame correctly
    // the whole time. A reader wired to 'scroll' therefore renders perfectly
    // and leaves its mark on scene one forever, which is exactly the kind of
    // defect nothing else here would catch. An IntersectionObserver built in
    // the FRAME's realm does fire (counted: 1 → 2 → 3 → 4 across two
    // scrolls, against 0 scroll events).
    expect(reader).toMatch(/new\s+\w+\.IntersectionObserver\(/);
    expect(`read.js listens for a scroll event: ${/addEventListener\('scroll'/.test(reader)}`)
      .toBe('read.js listens for a scroll event: false');
    // And the observer says WHEN to look, never WHERE the reader is: one
    // definition of the current scene, which is readerPlace()'s.
    const watcher = reader.slice(reader.indexOf('new win.IntersectionObserver'));
    expect(watcher.slice(0, 400)).toContain('markCurrent');
    expect(watcher.slice(0, 400)).not.toContain('entries');
  });

  test('coming back to the reader re-asserts the place, and really moves the frame', () => {
    // Measured in the live window, and not guessable: after a
    // display:none → display:block round trip this webview REPORTS the scroll
    // position the frame had and PAINTS the document somewhere else, and a
    // scrollTo() to the position the frame already claims is a no-op. So
    // show() restores rather than trusting the frame, and restore() goes to
    // the top first when the target is where the frame says it already is.
    // Both look like dead code to anyone who did not watch it fail.
    expect(reader).toMatch(/export function show\(\)[\s\S]{0,600}restore\(\)/);
    expect(reader).toMatch(/scrollY === target[\s\S]{0,200}scrollTo\(0, 0\)/);
    // And the place is taken on the way OUT, while the frame can still say
    // where it is — asking a hidden pane for layout answers zero.
    expect(reader).toMatch(/export function hide\(\)[\s\S]{0,120}keep\(\)/);
  });

  test('a second re-render in a row does not throw the reader back to the top', () => {
    // Found by driving Tune in the live window, and invisible from one
    // change: re-rendering happens while THIS pane is hidden, so the new
    // document cannot be measured (measure() needs layout) and the frame
    // holding it reports scrollY 0. render() calls keep() first, so the
    // SECOND re-render read that 0 against the previous document's marks and
    // overwrote a good place with "the top of scene one".
    //
    // Measured, both ways, with the reader parked 0.331 into sc-012:
    //   one knob   — document 14486px -> 16313px, scroll 7967 -> 9296, still
    //                sc-012 at 0.331 (a different pixel, the same place)
    //   two knobs  — scroll 77, sc-001, the rail marking nothing
    //
    // The guard is `measured`: true only while `marks` describe the document
    // the frame is holding. It looks like dead code to anyone who did not
    // watch the second knob lose the place.
    expect(reader).toMatch(/let measured = false/);
    // keep() refuses to take a place it cannot trust...
    const keeper = reader.slice(reader.indexOf('function keep()'));
    expect(keeper.slice(0, 200)).toContain('!measured');
    // ...render() is what makes it untrustworthy...
    const render = reader.slice(reader.indexOf('export function render('));
    expect(render.slice(0, 700)).toMatch(/srcdoc[\s\S]{0,300}measured = false/);
    // ...and measuring the new document is the only thing that restores it,
    // which is what makes coming back to Read land in the right place.
    const measure = reader.slice(reader.indexOf('function measure()'));
    expect(measure.slice(0, 400)).toContain('measured = true');
    // The order inside render() is load-bearing: keeping the place has to
    // happen BEFORE the document it describes is replaced.
    expect(render.slice(0, 700).indexOf('keep()'))
      .toBeLessThan(render.slice(0, 700).indexOf('measured = false'));
  });

  test('the rail can scroll its own mark into view', () => {
    // read.js keeps the marked scene inside the rail with
    // `rail.scrollTop = button.offsetTop`, which is only the offset WITHIN
    // the rail if the rail is the button's offsetParent. Unpositioned, the
    // offset is measured from the page and the rail scrolls to a number that
    // means nothing — visible at narrow widths, where the rail is a short
    // strip and the mark simply never comes into view.
    //
    // Any POSITIONED value satisfies that, not `relative` specifically. This
    // asserted the literal until 2026-09-21, when the rail became an absolute
    // drawer in the binding margin and the test failed for a change that
    // never threatened what it was protecting.
    expect(reader).toContain('rail.scrollTop = button.offsetTop');
    const css = read('surfaces.css');
    const rule = css.slice(css.indexOf('.scene-rail {'));
    expect(rule.slice(0, rule.indexOf('}')))
      .toMatch(/position:\s*(relative|absolute|fixed|sticky)/);
  });

  test('the parser the window uses is the real one', () => {
    // splitPreview() takes its parser as an argument so it can be exercised
    // below without a browser. That is only honest if the window itself
    // hands it a DOMParser — a reader that passed a regex of its own would
    // pass every test above.
    expect(reader).toMatch(/splitPreview\([^)]*new DOMParser\(\)\)/);
  });

  test('the frame’s theme follows the desktop’s, inside the frame too', () => {
    // The window's colour tokens are declared on THIS document; a custom
    // property does not cascade into another one, so a frame that only
    // named them would render black ink on a dark ground in dark mode.
    // What the VALUES do once read is checked below, against the CSS.
    expect(reader).toContain('getPropertyValue');
    expect(reader).toContain('prefers-color-scheme');
    // dressFrame() must hand the sheet the tokens it just read and nothing
    // else: this is the seam the value test below cannot see across.
    //
    // The css argument was named `sheetCss` until 2026-09-21, when these
    // eight lines were lifted out of adopt() so the Settings preview could
    // share them rather than own a second copy of the CSP dance. The seam is
    // the same; only the parameter's name moved, so the assertion no longer
    // pins that name.
    expect(reader).toMatch(/paperFrom\(\(name\) => root\.getPropertyValue\(name\)\)/);
    expect(reader).toMatch(/sheetText\(\w+, tokens\)/);
  });

  test('a resized window re-measures, because a reflow moves every scene', () => {
    // measure() ran only when the frame loaded and when the surface was
    // shown. After a resize the frame reflows and the marks describe a
    // layout that no longer exists, so readerPlace() can name the wrong
    // scene until the next surface round trip. Whether it does depends on
    // how proportional the reflow happened to be.
    expect(reader).toMatch(/addEventListener\('resize'[\s\S]{0,300}measure\(\)/);
    expect(reader).toMatch(/addEventListener\('resize'[\s\S]{0,300}markCurrent\(\)/);
  });
});

describe('what the Read surface decides', () => {
  // The decisions, exercised directly, the same way the Convert surface's
  // are. The drawing over them rides on the live run.
  type Place = { id: string; into: number };
  type Mark = { id: string; top: number; height: number };
  type ReadModule = {
    FONT_CSS: string;
    PAPER_TOKENS: string[];
    OPENING: string;
    NO_SCENES: string;
    NOTICES: Record<string, { slug: string; line: string; way: string }>;
    deviceCss: (tokens: unknown) => string;
    paperFrom: (read: (name: string) => string) => Record<string, string>;
    PAGE_MARGIN: { block: string; inline: string };
    sheetText: (engineCss: unknown, tokens: unknown) => string;
    splitPreview: (html: string, parser: unknown) => { css: string; html: string };
    readerState: (script: unknown) => string;
    sceneLabel: (heading: unknown) => { place: string; time: string | null };
    PAGE_MARKER_CLASS: string;
    headingText: (node: unknown) => string;
    railEntries: (scenes: unknown) => { id: string; place: string; time: string | null }[];
    railCount: (total: number) => string;
    readerPlace: (marks: Mark[], scrollTop: number) => Place | null;
    scrollTarget: (marks: Mark[], place: Place | null) => number;
  };
  let reader: ReadModule;
  /** The engine's own preview document, from the engine, once. */
  let preview: string;

  beforeAll(async () => {
    reader = (await import(join(UI, 'read.js'))) as ReadModule;
    const root = new URL('..', import.meta.url).pathname;
    const proc = Bun.spawn(
      ['bun', join(root, 'src', 'cli.ts'), join(root, 'tests', 'fixtures', 'screenplay.pdf'),
        '--json', '--preview-inline', '--no-fountain',
        '-o', join(SCRATCH, 'read-surface.epub')],
      { stdout: 'pipe', stderr: 'pipe' },
    );
    const [stdout] = await Promise.all([new Response(proc.stdout).text(), proc.exited]);
    const answer = JSON.parse(stdout);
    expect(answer.ok).toBe(true);
    preview = answer.previewHtml;
    // The input every test below leans on: the real thing, with a real
    // stylesheet inside it and real scene sections.
    expect(preview).toContain('<style>');
    expect(preview).toContain('<section class="scene"');
  }, 60000);

  /** A reference HTML document, built with regexes rather than a DOM, that
   *  answers the four things splitPreview() asks of a parser. It is not a
   *  browser and proves nothing about one — what it proves is that
   *  splitPreview TAKES the stylesheet OUT and hands it back, which is the
   *  step the CSP makes load-bearing and the one an implementation that
   *  "nearly works" gets wrong. The live window is where the rest is
   *  settled; see the report for task 9. */
  function referenceParser() {
    return {
      parseFromString(source: string) {
        let style: string | null =
          (source.match(/<style>([\s\S]*?)<\/style>/) ?? [])[1] ?? null;
        const node = style === null ? null : {
          get textContent() { return style; },
          remove() { style = null; },
        };
        return {
          querySelector: (selector: string) => (selector === 'style' ? node : null),
          get documentElement() {
            return {
              get outerHTML() {
                return source
                  .replace(/<\?xml[\s\S]*?\?>\s*/, '')
                  .replace(/<!DOCTYPE[^>]*>\s*/i, '')
                  .replace(
                    /<style>[\s\S]*?<\/style>/,
                    style === null ? '' : `<style>${style}</style>`,
                  );
              },
            };
          },
        };
      },
    };
  }

  test('the stylesheet comes OUT of the document and comes back whole', () => {
    const split = reader.splitPreview(preview, referenceParser());
    // Out: a <style> left in place is silently dropped by the CSP and the
    // script renders unstyled.
    expect(split.html).not.toContain('<style');
    // Whole: the engine's rules, not a summary of them. Byte-for-byte
    // against what the engine actually wrote.
    const engineCss = preview.slice(preview.indexOf('<style>') + '<style>'.length,
      preview.indexOf('</style>'));
    expect(engineCss.length).toBeGreaterThan(1000);
    expect(split.css).toBe(engineCss);
    // The body survived the trip.
    expect(split.html).toContain('<section class="scene"');
    expect(split.html).toContain('class="dialogue-block"');
  });

  test('the document the frame gets is a standards-mode document', () => {
    const split = reader.splitPreview(preview, referenceParser());
    // The engine writes XHTML with an XML prolog in front. Left there, a
    // text/html parse puts the frame in quirks mode and the engine's
    // vertical rhythm is not what renders.
    expect(split.html.startsWith('<!doctype html>')).toBe(true);
    expect(split.html).not.toContain('<?xml');
    expect(split.html.toLowerCase().indexOf('<html')).toBe('<!doctype html>'.length);
  });

  test('an empty preview yields no document and no stylesheet', () => {
    const split = reader.splitPreview('', referenceParser());
    expect(split.css).toBe('');
    expect(split.html).toBe('<!doctype html>');
  });

  test('the engine’s stylesheet is adopted verbatim, and last but for the device', () => {
    const engineCss = preview.slice(preview.indexOf('<style>') + '<style>'.length,
      preview.indexOf('</style>'));
    const sheet = reader.sheetText(engineCss, { ink: 'black', paper: 'white' });
    // Verbatim: not reindented, not filtered, not re-prefixed.
    expect(sheet).toContain(engineCss);
    // The faces have to be declared before anything asks for them, and the
    // device layer has to come after the book's own sheet or the engine's
    // `html, body { padding: 0 }` wins and the script touches the frame edge.
    expect(sheet.indexOf('@font-face')).toBeLessThan(sheet.indexOf(engineCss));
    expect(sheet.indexOf(engineCss)).toBeLessThan(sheet.lastIndexOf('body {'));
    expect(sheet.indexOf('color: black')).toBeGreaterThan(sheet.indexOf(engineCss));
  });

  test('the reader declares every face the engine’s CSS names, from bundled files', () => {
    const engineCss = preview.slice(preview.indexOf('<style>'), preview.indexOf('</style>'));
    // Every family the engine names that is not a generic or a system
    // fallback must be declared here, or the frame renders it in something
    // else and the preview stops being the book.
    const named = new Set(
      [...engineCss.matchAll(/font-family:\s*([^;]+);/g)]
        .flatMap(([, list]) => list.split(',').map((f) => f.trim().replace(/["']/g, ''))),
    );
    expect(named.has('Courier Prime')).toBe(true);
    const bundled = readdirSync(join(UI, 'fonts'));
    // The families the window actually ships a file for: the filenames are
    // <family>-<weight>-<subset>.woff2, so "courier" (the system face the
    // engine names as a FALLBACK) is not one of them and "courier-prime" is.
    const shipped = new Set(bundled.map((file) => file.replace(/-\d+-[a-z-]+\.woff2$/, '')));
    expect(shipped.has('courier-prime')).toBe(true);
    expect(shipped.has('courier')).toBe(false);
    let checked = 0;
    for (const family of named) {
      if (!shipped.has(family.toLowerCase().replace(/\s+/g, '-'))) continue; // a fallback
      checked += 1;
      expect(`${family} is declared: ${reader.FONT_CSS.includes(`"${family}"`)}`)
        .toBe(`${family} is declared: true`);
    }
    expect(checked).toBeGreaterThan(0);
    // Every file it points at exists, and the weights the engine's CSS uses
    // are both there: a cue set in a synthesized bold is not the book.
    const urls = [...reader.FONT_CSS.matchAll(/url\(([^)]+)\)/g)]
      .map(([, url]) => url.replace(/["']/g, ''));
    expect(urls.length).toBeGreaterThanOrEqual(2);
    for (const url of urls) {
      expect(url).toMatch(/^fonts\/[a-z0-9-]+\.woff2$/);
      expect(bundled).toContain(url.slice('fonts/'.length));
    }
    for (const weight of ['400', '700']) {
      expect(`weight ${weight}: ${reader.FONT_CSS.includes(`font-weight: ${weight}`)}`)
        .toBe(`weight ${weight}: true`);
    }
    // And they are the same files the window itself uses — two declarations
    // of one typeface drifting apart is how the frame ends up in a different
    // Courier from the page around it.
    const windowFaces = [...read('style.css').matchAll(/url\((fonts\/courier-prime[^)]+)\)/g)]
      .map(([, url]) => url.replace(/["']/g, ''));
    expect([...urls].sort()).toEqual([...new Set(windowFaces)].sort());
  });

  test('the values read off the window are the values the frame is painted in', () => {
    // The weak form of this test asserted only that getPropertyValue appears
    // in the file, which an implementation that read the tokens and then
    // wrote a colour of its OWN would pass. So: drive the whole path — which
    // properties are asked for, what comes back, what reaches the sheet —
    // with values nothing could plausibly invent.
    const asked: string[] = [];
    const answers: Record<string, string> = {
      '--ink': 'oklch(0.113 0.019 83.4)',
      '--paper': 'oklch(0.971 0.013 84.1)',
    };
    const tokens = reader.paperFrom((name) => {
      asked.push(name);
      return answers[name] ?? '';
    });
    // The two the frame cannot get any other way, asked for by their real
    // names — a reader that asked for something else would paint a theme
    // nobody chose.
    expect(asked).toEqual(['--ink', '--paper']);
    expect(tokens).toEqual({ ink: answers['--ink'], paper: answers['--paper'] });

    const sheet = reader.sheetText('section.scene { margin: 0; }', tokens);
    // Exact, and the whole rule: an invented colour cannot hide beside the
    // real one, and an extra declaration cannot hide inside it.
    expect(sheet).toContain(
      `html { color: ${answers['--ink']}; background: ${answers['--paper']}; }`,
    );
    // Nothing in the emitted sheet paints with anything but what was read.
    const painted = [...sheet.matchAll(/(?:^|[;{\s])(?:color|background)\s*:\s*([^;}]+)/g)]
      .map(([, value]) => value.trim());
    expect(painted).toEqual([answers['--ink'], answers['--paper']]);
  });

  test('the page margin is the device’s, in the units the EPUB rule demands', () => {
    // The one size in this surface that is not a brand token, because the
    // brand's are rem values for the window's furniture and do not cross
    // into the frame at all. What it owes instead is the rule the engine's
    // own stylesheet is held to: horizontal in %, vertical in em, so it
    // scales with the reader's type size and stays proportional to the
    // column. Pinned so it cannot drift into px or rem unnoticed.
    expect(reader.PAGE_MARGIN.block).toMatch(/^[\d.]+em$/);
    expect(reader.PAGE_MARGIN.inline).toMatch(/^[\d.]+%$/);
    const sheet = reader.deviceCss({ ink: 'black', paper: 'white' });
    expect(sheet).toContain(
      `body { padding: ${reader.PAGE_MARGIN.block} ${reader.PAGE_MARGIN.inline}; }`,
    );
    // And the emitted padding is that constant, not a second copy of it.
    const paddings = [...sheet.matchAll(/padding:\s*([^;}]+)/g)].map(([, v]) => v.trim());
    expect(paddings).toEqual([`${reader.PAGE_MARGIN.block} ${reader.PAGE_MARGIN.inline}`]);
  });

  test('a token that did not resolve is left out, not written as blank', () => {
    // getPropertyValue() returns '' for a property that is not declared.
    // `color: ;` is a dropped declaration at best and a dropped RULE in a
    // stricter parser, which would take the page margin down with it.
    const partial = reader.deviceCss({ ink: '', paper: 'white' });
    expect(partial).not.toContain('color:');
    expect(partial).toContain('background:');
    expect(partial).toContain('padding');
    const none = reader.deviceCss({});
    expect(none).not.toContain('color:');
    expect(none).not.toContain('background:');
    // The margin is not a theme and does not depend on one.
    expect(none).toContain('padding');
    expect(reader.PAPER_TOKENS).toEqual(['ink', 'paper']);
  });

  test('a slugline is split at its LAST separator, not its first', () => {
    // "INT./EXT. DELIVERY VAN - MOVING - LATER" is a van that is moving,
    // later. Splitting at the first separator calls the time "MOVING -
    // LATER" and loses the place entirely.
    expect(reader.sceneLabel('INT./EXT. DELIVERY VAN - MOVING - LATER')).toEqual({
      place: 'INT./EXT. DELIVERY VAN - MOVING', time: 'LATER',
    });
    expect(reader.sceneLabel('INT. THE LAST VIDEO STORE - NIGHT')).toEqual({
      place: 'INT. THE LAST VIDEO STORE', time: 'NIGHT',
    });
    // An em or en dash is the same separator to a reader.
    expect(reader.sceneLabel('EXT. ROOF — DAWN').time).toBe('DAWN');
    // A hyphenated word is not a separator: it has no spaces around it.
    expect(reader.sceneLabel('INT. DRIVE-THRU')).toEqual({
      place: 'INT. DRIVE-THRU', time: null,
    });
    expect(reader.sceneLabel('INT. KITCHEN')).toEqual({ place: 'INT. KITCHEN', time: null });
    // Nothing to split, and nothing to lose: a half-empty split would print
    // a rail entry with no place in it.
    expect(reader.sceneLabel('- DAY')).toEqual({ place: '- DAY', time: null });
    expect(reader.sceneLabel('INT. HALL -')).toEqual({ place: 'INT. HALL -', time: null });
    // A scene with no heading is the run of script before the first
    // slugline, which the engine's own table of contents calls "Opening".
    expect(reader.sceneLabel('')).toEqual({ place: 'Opening', time: null });
    expect(reader.sceneLabel(undefined)).toEqual({ place: 'Opening', time: null });
    expect(reader.OPENING).toBe('Opening');
    // The word is the engine's, not this file's invention.
    const engine = readFileSync(
      join(new URL('..', import.meta.url).pathname, 'src', 'epub', 'html.ts'), 'utf8');
    expect(engine).toContain(`'${reader.OPENING}'`);
  });

  /** Just enough of a DOM node for headingText(): the two node types it
   *  reads, a class list, and children. Not a browser, and it proves nothing
   *  about one; it proves the walk skips what it should and keeps the rest. */
  const textNode = (value: string) => ({ nodeType: 3, nodeValue: value, childNodes: [] });
  const element = (className: string, ...children: unknown[]) => ({
    nodeType: 1,
    classList: { contains: (c: string) => className.split(' ').includes(c) },
    childNodes: children,
  });

  test('a page number the engine carries inside a heading never reaches the rail', () => {
    // The bug: since 0.7.0 page numbers are on by default, and when a scene
    // starts a new page the engine puts that page's marker INSIDE the scene
    // heading, as a floated span (registry 13a). Reading the heading's whole
    // text listed the scene as "2.EXT. FIELD STATION - DAY".
    const heading = element('scene-heading',
      element(reader.PAGE_MARKER_CLASS, textNode('2.')),
      textNode('EXT. FIELD STATION - DAY'));
    expect(reader.headingText(heading)).toBe('EXT. FIELD STATION - DAY');
    expect(reader.sceneLabel(reader.headingText(heading))).toEqual({
      place: 'EXT. FIELD STATION', time: 'DAY',
    });
    // A heading with no marker is read as it always was.
    expect(reader.headingText(element('scene-heading', textNode('INT. KITCHEN - NIGHT'))))
      .toBe('INT. KITCHEN - NIGHT');
    // Only the marker goes: other markup inside a heading keeps its words.
    expect(reader.headingText(element('scene-heading',
      textNode('INT. '), element('bold', textNode('THE VAULT')), textNode(' - DAY'))))
      .toBe('INT. THE VAULT - DAY');
    // A marker nested deeper, or one carrying more classes, is still a marker.
    expect(reader.headingText(element('scene-heading',
      element('wrap', element(`x ${reader.PAGE_MARKER_CLASS}`, textNode('14.'))),
      textNode('INT. FIELD STATION - NIGHT'))))
      .toBe('INT. FIELD STATION - NIGHT');
    // No heading at all is the Opening, as before.
    expect(reader.headingText(null)).toBe('');
    expect(reader.sceneLabel(reader.headingText(undefined)).place).toBe('Opening');
  });

  test('the marker’s class is the one the engine actually writes', () => {
    // Two files, one string: the engine names the span, the window skips it.
    // If the engine renamed the class, headingText() would skip nothing and
    // every page number would be back in the rail, with no test failing.
    expect(reader.PAGE_MARKER_CLASS).toBe('page-marker');
    expect(preview).toContain(`class="${reader.PAGE_MARKER_CLASS}"`);
    const engine = readFileSync(
      join(new URL('..', import.meta.url).pathname, 'src', 'epub', 'html.ts'), 'utf8');
    expect(engine).toContain(`class="${reader.PAGE_MARKER_CLASS}"`);
  });

  test('the rail reads headings through headingText, not textContent', () => {
    // The drawing half of read.js has no DOM here to run in, so the call is
    // pinned by what the source says.
    const source = readFileSync(join(UI, 'read.js'), 'utf8');
    expect(source).toMatch(/heading:\s*headingText\(scene\.querySelector\('h2\.scene-heading'\)\)/);
    expect(source).not.toMatch(/querySelector\('h2\.scene-heading'\)\?\.textContent/);
  });

  test('the rail keeps the engine’s order and skips what it cannot link to', () => {
    const entries = reader.railEntries([
      { id: 'sc-001', heading: 'INT. ARCHIVE - NIGHT' },
      { id: '', heading: 'INT. NOWHERE - DAY' },
      { id: 'sc-002', heading: undefined },
      { id: 'sc-003', heading: 'EXT. DOCK - CONTINUOUS' },
    ]);
    // A section with no id cannot be scrolled to; a link to it would be a
    // dead one.
    expect(entries.map((e) => e.id)).toEqual(['sc-001', 'sc-002', 'sc-003']);
    expect(entries[1]).toEqual({ id: 'sc-002', place: 'Opening', time: null });
    expect(entries[2].time).toBe('CONTINUOUS');
    expect(reader.railEntries(null)).toEqual([]);
    expect(reader.railCount(1)).toBe('1 scene');
    expect(reader.railCount(12)).toBe('12 scenes');
    expect(reader.railCount(0)).toBe('0 scenes');
  });

  test('the reader’s place is a scene and a fraction, not a pixel offset', () => {
    // THE test this surface turns on. Tune re-renders on every knob, and a
    // knob that changes the type size changes every pixel in the document.
    // A remembered scrollY lands the reader somewhere else in the script.
    const before: Mark[] = [
      { id: 'sc-001', top: 0, height: 100 },
      { id: 'sc-002', top: 100, height: 200 },
      { id: 'sc-003', top: 300, height: 100 },
    ];
    // Halfway through the second scene.
    const place = reader.readerPlace(before, 200);
    expect(place).toEqual({ id: 'sc-002', into: 0.5 });

    // The same script, reflowed at a larger type size: every scene is twice
    // as tall. Halfway through scene two is now 400px down.
    const after: Mark[] = [
      { id: 'sc-001', top: 0, height: 200 },
      { id: 'sc-002', top: 200, height: 400 },
      { id: 'sc-003', top: 600, height: 200 },
    ];
    expect(reader.scrollTarget(after, place)).toBe(400);
    // What a remembered scrollY would have done: 200px, which is the TOP of
    // scene two — a scroll jump on every keystroke.
    expect(reader.scrollTarget(after, place)).not.toBe(200);
    // Unreflowed, it is exactly where it was.
    expect(reader.scrollTarget(before, place)).toBe(200);
  });

  test('every boundary of the place has an answer', () => {
    const marks: Mark[] = [
      { id: 'sc-001', top: 40, height: 100 },
      { id: 'sc-002', top: 140, height: 0 },
      { id: 'sc-003', top: 140, height: 60 },
    ];
    // Above the first section (the document can start with matter above it).
    expect(reader.readerPlace(marks, 0)).toEqual({ id: 'sc-001', into: 0 });
    // Exactly on a boundary belongs to the scene that starts there.
    expect(reader.readerPlace(marks, 140)!.id).toBe('sc-003');
    // Past the end clamps rather than running off.
    expect(reader.readerPlace(marks, 10_000)).toEqual({ id: 'sc-003', into: 1 });
    // A zero-height section cannot divide by itself.
    expect(Number.isFinite(reader.readerPlace([marks[1]], 140)!.into)).toBe(true);
    // Nothing measured yet, and a scroll position that is not a number.
    expect(reader.readerPlace([], 10)).toBe(null);
    expect(reader.readerPlace(marks, Number.NaN)).toEqual({ id: 'sc-001', into: 0 });
    // A place whose scene is gone — re-converted, and the heading with it —
    // is the top, which is the only honest answer.
    expect(reader.scrollTarget(marks, { id: 'sc-404', into: 0.5 })).toBe(0);
    expect(reader.scrollTarget(marks, null)).toBe(0);
    // A place is never a negative scroll.
    expect(reader.scrollTarget([{ id: 'a', top: 0, height: 10 }], { id: 'a', into: 0 }))
      .toBe(0);
  });

  test('there are three things the reader can be, and two of them are words', () => {
    expect(reader.readerState(null)).toBe('closed');
    expect(reader.readerState(undefined)).toBe('closed');
    // scriptFrom() normalises a missing preview to '', so a script that
    // converted without one must not land on an empty white frame.
    expect(reader.readerState({ previewHtml: '' })).toBe('blank');
    expect(reader.readerState({ previewHtml: '   \n ' })).toBe('blank');
    expect(reader.readerState({ previewHtml: undefined })).toBe('blank');
    expect(reader.readerState({ previewHtml: preview })).toBe('ready');

    // `blank` is reachable — the tab is live, the script converted, and the
    // pages did not come back — so it says what happened AND offers the way
    // on. `closed` is NOT reachable: main.js disables the Read tab whenever
    // no script is open and nothing closes one, so there is deliberately no
    // copy for it. Copy nobody can see reads as a considered empty state to
    // the next person who maintains it.
    const notice = reader.NOTICES.blank;
    expect(notice.slug.length).toBeGreaterThan(0);
    expect(notice.line.length).toBeGreaterThan(40);
    expect(notice.way.length).toBeGreaterThan(0);
    expect(Object.keys(reader.NOTICES)).toEqual(['blank']);
    // The tab really is out of reach in that state, which is the whole
    // argument for not writing the words. If this ever stops being true,
    // this test fails and the invitation has to come back.
    const main = read('main.js');
    expect(main).toMatch(/NEEDS_SCRIPT[\s\S]{0,80}'read'/);
    expect(main).toMatch(/frame\.enable\(id, open\)/);
    expect(reader.NO_SCENES.length).toBeGreaterThan(0);
  });
});

describe('the Tune surface', () => {
  const source = read('tune.js');
  const REPO = new URL('..', import.meta.url).pathname;

  /** An engine module with its prose taken out. Every claim below about
   *  "which knob does the engine read here" is a claim about CODE; a key
   *  named in a comment would otherwise answer for one that is not. */
  const engine = (...parts: string[]) =>
    readFileSync(join(REPO, ...parts), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, ' ')
      .replace(/\/\/.*$/gm, ' ');

  let tune: Record<string, any>;
  beforeAll(async () => { tune = await import(join(UI, 'tune.js')); });

  test('the eighteen are the engine’s eighteen, in both directions', async () => {
    // A surface with seventeen has silently dropped one and a reader would
    // never know which; a nineteenth invented here would be sent to the
    // engine and discarded by resolveFormatOptions without a word.
    const { DEFAULT_FORMAT_OPTIONS } = await import('../src/options');
    expect([...tune.OPTION_KEYS].sort()).toEqual(Object.keys(DEFAULT_FORMAT_OPTIONS).sort());
    // Drawn once each: the same key in two groups would be two controls
    // fighting over one value.
    expect(new Set(tune.OPTION_KEYS).size).toBe(tune.OPTION_KEYS.length);
    // And each one is actually a control with words on it. A knob with an
    // empty label is a row of blank space next to a switch.
    for (const knob of tune.KNOBS) {
      expect(['toggle', 'range', 'choice'], `${knob.key} has no kind`).toContain(knob.kind);
      expect(knob.label.length, `${knob.key} has no label`).toBeGreaterThan(2);
      // The label names the thing; the sentence beside it does the
      // explaining. A label that has become documentation is the tell.
      expect(knob.label.length, `${knob.key}'s label is a paragraph`).toBeLessThan(42);
      if (knob.help !== undefined) {
        expect(knob.help.length, `${knob.key}'s help says nothing`).toBeGreaterThan(40);
      }
    }
  });

  test('every slider stops exactly where src/options.ts clamps', () => {
    // A slider that goes to 60 on a knob clamped at 30 lets a reader drag
    // into a value the engine will quietly discard. The bounds are READ OUT
    // of the engine rather than copied here, so this fails if either side
    // moves — a hand-written table would only fail if the surface did.
    const clamps = new Map<string, [number, number]>();
    for (const [, key, lo, hi] of engine('src', 'options.ts')
      .matchAll(/num\('(\w+)',\s*([\d.]+),\s*([\d.]+)\)/g)) {
      clamps.set(key, [Number(lo), Number(hi)]);
    }
    const ranges = tune.KNOBS.filter((knob: any) => knob.kind === 'range');
    expect(ranges.map((knob: any) => knob.key).sort()).toEqual([...clamps.keys()].sort());
    expect(ranges.length).toBe(4);
    for (const knob of ranges) {
      expect([knob.min, knob.max], `${knob.key} is not clamped where the engine clamps`)
        .toEqual(clamps.get(knob.key)!);
      expect(knob.step, `${knob.key} has no step`).toBeGreaterThan(0);
    }
  });

  test('every choice offered is one the engine will actually keep', async () => {
    // resolveFormatOptions falls back to the default for a value it does not
    // recognise. An option list with a fourth typeface in it would render,
    // save, and change nothing.
    const { resolveFormatOptions, DEFAULT_FORMAT_OPTIONS } = await import('../src/options');
    const choices = tune.KNOBS.filter((knob: any) => knob.kind === 'choice');
    expect(choices.length).toBe(4);
    for (const knob of choices) {
      expect(knob.choices.length, `${knob.key} offers nothing`).toBeGreaterThan(1);
      for (const [value, label] of knob.choices) {
        expect(label.length, `${knob.key}'s ${value} has no words`).toBeGreaterThan(2);
        const resolved = resolveFormatOptions({ [knob.key]: value }) as unknown as Record<string, unknown>;
        expect(resolved[knob.key], `the engine discards ${knob.key}=${value}`).toBe(value);
      }
      // What the script already has must be selectable, or the control opens
      // showing a value it cannot return to.
      const current = (DEFAULT_FORMAT_OPTIONS as unknown as Record<string, unknown>)[knob.key];
      expect(knob.choices.map(([value]: [string, string]) => value),
        `${knob.key} cannot show its default`).toContain(current);
    }
  });

  test('which knobs can move the preview is the engine’s answer, not this file’s', () => {
    // The brief said two knobs are decided while the PDF is read. The engine
    // says four: src/fountain/serialize.ts consumes showPageMarkers and
    // dualDialogue as well, and re-rendering from the stored script with
    // either flipped was measured to produce a byte-identical document. Both
    // sat under "Content" and "Dialogue", where they would have looked live
    // and done nothing.
    //
    // So the grouping is derived from the engine and checked against it,
    // three ways and exhaustively:
    //   live      — read by the preview builder (src/epub/html.ts, css.ts)
    //   book      — read only where the BOOK is packaged (src/epub/build.ts)
    //   reconvert — read while the PDF becomes a script (fountain/serialize)
    const preview = engine('src', 'epub', 'html.ts') + engine('src', 'epub', 'css.ts');
    const packaging = engine('src', 'epub', 'build.ts');
    const serialize = engine('src', 'fountain', 'serialize.ts');

    for (const knob of tune.KNOBS) {
      expect(tune.EFFECTS, `${knob.key} claims an effect that does not exist`)
        .toContain(knob.effect);
      if (knob.effect === 'live') {
        expect(preview.includes(knob.key),
          `${knob.key} is called live but the preview never reads it`).toBe(true);
      } else {
        expect(preview.includes(knob.key),
          `${knob.key} DOES move the preview and is not called live`).toBe(false);
      }
      if (knob.effect === 'reconvert') {
        expect(serialize.includes(knob.key),
          `${knob.key} is not read while the PDF becomes a script`).toBe(true);
      } else {
        expect(serialize.includes(knob.key),
          `${knob.key} IS read while the PDF becomes a script`).toBe(false);
      }
      if (knob.effect === 'book') {
        expect(packaging.includes(knob.key), `${knob.key} changes nothing about the book`)
          .toBe(true);
      }
    }
    // The counts, so a classification that collapsed into one bucket cannot
    // pass the loop above by accident.
    const count = (effect: string) =>
      tune.KNOBS.filter((k: any) => k.effect === effect).length;
    expect([count('live'), count('book'), count('reconvert')]).toEqual([13, 1, 4]);
  });

  test('the knobs that cannot move the preview say so, in the reader’s words', () => {
    const group = tune.GROUPS.find((g: any) => g.effect === 'reconvert');
    expect(group?.knobs.map((k: any) => k.key).sort())
      .toEqual(['contdMode', 'dualDialogue', 'rejoinSplitDialogue', 'showPageMarkers']);
    // Not hidden, and not silently inert: the note is on the group, it says
    // both halves — saved, and not visible now — and it says them without
    // naming a file format at the reader.
    expect(group.note.length).toBeGreaterThan(80);
    expect(group.note).toContain('not change what you see now');
    expect(group.note.toLowerCase()).toContain('next time you convert');
    expect(group.note).not.toContain('.fountain');
    expect(group.note).not.toContain('serialize');
    // The one knob that changes the book without changing the preview owes
    // the same explanation, for the same reason.
    const title = tune.knobFor('includeTitlePage');
    expect(title.effect).toBe('book');
    expect(title.help).toContain('preview');
  });

  test('a knob that is doing nothing says why, rather than vanishing', () => {
    // The cue indents mean nothing while cues are centered. Hiding them
    // takes the explanation away with the control, and the reader is left
    // hunting for a knob that was there a moment ago.
    const indent = tune.knobFor('cueIndentPct');
    const centered = { cueAlignment: 'centered' };
    const indented = { cueAlignment: 'indented' };
    const reason = tune.idleReason(indent, centered);
    expect(reason).not.toBe(null);
    expect(reason.toLowerCase()).toContain('indented');
    expect(tune.idleReason(indent, indented)).toBe(null);
    expect(tune.idleReason(tune.knobFor('parentheticalIndentPct'), centered)).not.toBe(null);
    // Every other knob is always live: a reason that fired on a knob with no
    // condition would disable it forever.
    for (const knob of tune.KNOBS) {
      if (knob.needs !== undefined) continue;
      expect(tune.idleReason(knob, centered), `${knob.key} idles for no reason`).toBe(null);
    }
    // Nothing is removed from the surface by a setting: eighteen controls
    // are eighteen controls whatever the script is tuned to.
    expect(tune.GROUPS.flatMap((g: any) => g.knobs).length).toBe(18);
    expect(source).toContain('disabled');
  });

  test('a control’s value becomes something the engine will keep, or nothing', () => {
    // A range arrives from the DOM as a STRING, and a string is exactly what
    // resolveFormatOptions throws away: the knob would appear to move and
    // the book would not change.
    const margin = tune.knobFor('dialogueSideMarginPct');
    expect(tune.coerceValue(margin, '17')).toBe(17);
    expect(tune.coerceValue(margin, '99')).toBe(30);
    expect(tune.coerceValue(margin, '-4')).toBe(0);
    expect(tune.coerceValue(margin, 'twelve')).toBe(null);
    const spacing = tune.knobFor('elementSpacingEm');
    expect(tune.coerceValue(spacing, '1.4')).toBe(1.4);
    expect(tune.coerceValue(spacing, '0')).toBe(0.4);
    const toggle = tune.knobFor('scenePageBreaks');
    expect(tune.coerceValue(toggle, true)).toBe(true);
    expect(tune.coerceValue(toggle, false)).toBe(false);
    // Not coerced: 'false' from an attribute is not a decision to turn it on.
    expect(tune.coerceValue(toggle, 'false')).toBe(null);
    const face = tune.knobFor('fontFamily');
    expect(tune.coerceValue(face, 'serif')).toBe('serif');
    expect(tune.coerceValue(face, 'comic')).toBe(null);
    expect(tune.coerceValue(null, 'serif')).toBe(null);
  });

  test('two knobs moved in one breath are both saved', () => {
    // The debounce cancels the pending save, so a change that only carried
    // "the knob that moved last" would SAVE only that one — and the engine,
    // which overlays a partial on what is stored, would answer with the
    // first change missing and the surface would redraw it away.
    let owed = {};
    expect(tune.isPending(owed)).toBe(false);
    owed = tune.mergePending(owed, 'dialogueSideMarginPct', 12);
    owed = tune.mergePending(owed, 'fontFamily', 'serif');
    expect(owed).toEqual({ dialogueSideMarginPct: 12, fontFamily: 'serif' });
    // The same knob twice is the later value, not two of them.
    owed = tune.mergePending(owed, 'dialogueSideMarginPct', 14);
    expect(owed).toEqual({ dialogueSideMarginPct: 14, fontFamily: 'serif' });
    expect(tune.isPending(owed)).toBe(true);
    expect(tune.isPending({})).toBe(false);
    expect(tune.isPending(undefined)).toBe(false);
  });

  test('an answer that is not a settings answer is refused, not drawn', async () => {
    const { DEFAULT_FORMAT_OPTIONS } = await import('../src/options');
    const whole = tune.settingsFrom({ settings: { ...DEFAULT_FORMAT_OPTIONS } });
    expect(whole).toEqual({ ...DEFAULT_FORMAT_OPTIONS });
    // One key short: seventeen sliders and one at NaN.
    const short: Record<string, unknown> = { ...DEFAULT_FORMAT_OPTIONS };
    delete short.cueIndentPct;
    expect(tune.settingsFrom({ settings: short })).toBe(null);
    // Right keys, wrong kinds — each would draw a control that cannot show
    // its own value.
    expect(tune.settingsFrom({ settings: { ...DEFAULT_FORMAT_OPTIONS, cueIndentPct: '33' } }))
      .toBe(null);
    expect(tune.settingsFrom({ settings: { ...DEFAULT_FORMAT_OPTIONS, fontFamily: 'comic' } }))
      .toBe(null);
    expect(tune.settingsFrom({ settings: { ...DEFAULT_FORMAT_OPTIONS, justifyText: 'yes' } }))
      .toBe(null);
    expect(tune.settingsFrom({ settings: null })).toBe(null);
    expect(tune.settingsFrom({ settings: [] })).toBe(null);
    expect(tune.settingsFrom({})).toBe(null);
    expect(tune.settingsFrom(undefined)).toBe(null);
    // A nineteenth knob from a newer engine survives the round trip rather
    // than being quietly dropped out of the script's settings.
    const future = tune.settingsFrom({
      settings: { ...DEFAULT_FORMAT_OPTIONS, sceneNumberSide: 'left' },
    });
    expect(future.sceneNumberSide).toBe('left');
    // And it is a copy: the surface mutates its settings on every change.
    const original = { ...DEFAULT_FORMAT_OPTIONS };
    expect(tune.settingsFrom({ settings: original })).not.toBe(original);
  });

  test('a preset that would only half-apply is not offered', async () => {
    const { DEFAULT_FORMAT_OPTIONS } = await import('../src/options');
    const broken: Record<string, unknown> = { ...DEFAULT_FORMAT_OPTIONS };
    delete broken.fontFamily;
    const presets = tune.presetsFrom({
      presets: [
        { displayName: 'Kindle e-ink (6")', settings: { ...DEFAULT_FORMAT_OPTIONS } },
        { displayName: 'Half a preset', settings: broken },
        { displayName: '', settings: { ...DEFAULT_FORMAT_OPTIONS } },
      ],
    });
    expect(presets.map((p: any) => p.displayName)).toEqual(['Kindle e-ink (6")']);
    expect(presets[0].settings.fontFamily).toBe('courier');
    expect(tune.presetsFrom({})).toEqual([]);
    expect(tune.presetsFrom({ presets: 'kindle' })).toEqual([]);
  });

  test('the surface never says "saved" about something that was not', () => {
    expect(tune.statusFor('saved').line).toContain('Saved');
    expect(tune.statusFor('saved').bad).toBe(false);
    expect(tune.statusFor('pending').line).not.toContain('Saved');
    expect(tune.statusFor('saving').line).not.toContain('Saved.');
    expect(tune.statusFor('idle').line).toBe('');
    // A failure shows the engine's own sentence, and never the word.
    const failed = tune.statusFor('failed', 'cannot read the script: /gone.fountain');
    expect(failed.line).toBe('cannot read the script: /gone.fountain');
    expect(failed.bad).toBe(true);
    // An engine that broke its contract and failed without a sentence still
    // has to say something a person can act on.
    expect(tune.statusFor('failed', '   ').line).toBe(tune.NO_MESSAGE);
    expect(tune.statusFor('failed', undefined).line).toBe(tune.NO_MESSAGE);
    expect(tune.statusFor('failed').bad).toBe(true);
    // An unknown phase is silence, not a lie.
    expect(tune.statusFor('elsewhere').line).toBe('');
  });

  test('a read-out carries its unit, and never reads NaN', () => {
    const margin = tune.knobFor('dialogueSideMarginPct');
    expect(tune.displayValue(margin, 20)).toBe('20%');
    // Whole-numbered knobs do not grow a decimal point.
    expect(tune.displayValue(margin, '7')).toBe('7%');
    const spacing = tune.knobFor('elementSpacingEm');
    expect(tune.displayValue(spacing, 1)).toBe('1.0 em');
    expect(tune.displayValue(spacing, 1.25)).toBe('1.3 em');
    expect(tune.displayValue(spacing, undefined)).toBe('—');
    expect(tune.displayValue(spacing, null)).toBe('—');
  });

  test('two settings objects are compared by the eighteen, not by identity', () => {
    const a: Record<string, unknown> = { extra: 1 };
    for (const key of tune.OPTION_KEYS) a[key] = 1;
    a.fontFamily = 'serif';
    const b = { ...a, extra: 2 };
    expect(tune.sameSettings(a, b)).toBe(true);
    expect(tune.sameSettings(a, { ...a, fontFamily: 'sans' })).toBe(false);
    expect(tune.sameSettings(null, null)).toBe(true);
    expect(tune.sameSettings(a, null)).toBe(false);
  });

  test('it saves through the engine rather than inventing its own storage', () => {
    expect(source).toContain('argv.settings');
    expect(source).toContain('argv.reconvert');
    expect(source).not.toContain('localStorage');
    expect(source).not.toContain('sessionStorage');
    // The clamp above is the engine's; the file must not carry a second
    // opinion about what a setting means, or run the engine's resolver
    // itself.
    expect(source).not.toMatch(/resolveFormatOptions\s*\(/);
    expect(source).not.toContain('screepub.json');
  });

  test('re-renders are debounced and serialised', () => {
    // A knob dragged across its range fires a hundred times. Without a
    // debounce that is a hundred conversions; without serialisation a slow
    // early one can finish last and leave the file disagreeing with the
    // screen.
    expect(source).toContain('setTimeout');
    expect(source).toContain('clearTimeout');
    expect(source).toMatch(/running\s*=\s*running/);
  });


  test('the sentence beside a knob is the CURRENT one, in both directions', () => {
    // Found live, after idleReason() was tested hard and then bound wrongly:
    // the sentence was written at draw time and never corrected, so
    //   drawn centered, switched to Indented -> "Only when character cues
    //     are indented." stood beside a control that had just become live
    //   drawn indented, switched to Centered -> a greyed-out slider with no
    //     explanation at all, and nothing for aria-describedby to point at
    // Both are answers about (knob, settings), so both come from one
    // function and the test asks it directly.
    const indent = tune.knobFor('cueIndentPct');
    const centered = { cueAlignment: 'centered' };
    const indented = { cueAlignment: 'indented' };
    expect(tune.notesFor(indent, centered)).toEqual([
      'Only when character names are indented.',
    ]);
    // Live again: nothing to say, and nothing said.
    expect(tune.notesFor(indent, indented)).toEqual([]);

    // A knob with a help sentence keeps it either way, and the reason it is
    // idle comes FIRST when there is one — a reader wants to know why the
    // control is grey before they want to know what it is for.
    const speeches = tune.knobFor('keepSpeechesWhole');
    expect(tune.notesFor(speeches, centered)).toEqual([speeches.help]);
    const both = tune.notesFor(
      { ...indent, help: 'What it is for.' }, centered,
    );
    expect(both).toEqual(['Only when character names are indented.', 'What it is for.']);

    // A knob that can never explain itself draws no element to explain with;
    // one that can, draws one even while it is empty, or there is nothing to
    // rewrite when the setting it depends on moves.
    // A bare knob, constructed rather than named. This asserted against
    // scenePageBreaks until 2026-09-21, when the copy pass gave that knob a
    // help line and the test failed for a change that was purely an
    // improvement to it. The contract is about knobs with nothing to say, not
    // about which knob currently happens to be one.
    expect(tune.canExplain({ key: 'nothing-to-say', label: 'Bare', kind: 'toggle' })).toBe(false);
    expect(tune.canExplain(indent)).toBe(true);
    expect(tune.canExplain(speeches)).toBe(true);
    expect(tune.canExplain(null)).toBe(false);
    for (const knob of tune.KNOBS) {
      expect(tune.canExplain(knob), `${knob.key} can explain itself`)
        .toBe(tune.notesFor(knob, indented).length > 0 || knob.needs !== undefined);
    }
  });

  test('one function decides a control’s state, so the two cannot disagree', () => {
    // The defect above was not a wrong rule, it was a rule with two
    // bindings: drawKnob wrote the sentence and refreshIdle only toggled
    // `disabled`. A test that asserted the source merely CONTAINS
    // 'aria-describedby' passed throughout. So: both paths go through
    // state(), and state() is the only thing that touches either.
    const stateFn = source.slice(source.indexOf('function state('));
    expect(stateFn.slice(0, 800)).toContain('notesFor');
    expect(stateFn.slice(0, 800)).toContain('input.disabled');
    expect(stateFn.slice(0, 800)).toContain('aria-describedby');
    const drawKnob = source.slice(
      source.indexOf('function drawKnob('), source.indexOf('function state('));
    expect(drawKnob).toMatch(/state\(controls\.get/);
    const refresh = source.slice(source.indexOf('function refreshIdle('));
    expect(refresh.slice(0, 400)).toMatch(/state\(control\)/);
    // Nothing enables, disables or describes a control behind its back.
    expect([...source.matchAll(/\.disabled\s*=/g)].length).toBe(1);
    // Attribute(...) rather than the bare word, so the comment that
    // explains the defect does not count as a second binding.
    expect([...source.matchAll(/Attribute\('aria-describedby'/g)].length).toBe(2);
    // And an empty sentence is hidden rather than pointed at — via `hidden`,
    // because the CSP refuses an inline style.
    expect(stateFn.slice(0, 800)).toContain('why.hidden');
    expect(source).not.toContain('.style.');
  });

  test('a save that failed is still owed, and is not claimed as done', () => {
    // flush() clears `pending` before it asks the engine — that is what makes
    // a knob moved DURING a save land in the next one. A failure therefore
    // has to put back what the attempt carried, or the knobs on screen keep
    // values the engine never stored and nothing is left to store them.
    const owed = { dialogueSideMarginPct: 12, fontFamily: 'serif' };
    expect(tune.restorePending(owed, {})).toEqual(owed);
    // Anything moved since the attempt began is the newer answer and wins.
    expect(tune.restorePending(owed, { fontFamily: 'sans' }))
      .toEqual({ dialogueSideMarginPct: 12, fontFamily: 'sans' });
    expect(tune.isPending(tune.restorePending(owed, {}))).toBe(true);
    // Every way out of a failed save goes through it: a non-settings answer,
    // a refused rebuild, and a throw.
    const flush = source.slice(source.indexOf('async function flush('));
    const failures = [...flush.matchAll(/statusFor\('failed'/g)];
    expect(failures.length).toBe(3);
    for (const [, before] of flush.matchAll(/(.{0,120})say\(statusFor\('failed'/gs)) {
      expect(before, 'a failure that does not put back what it owed').toContain('giveBack()');
    }
    // And a failure never says "saved".
    expect(tune.statusFor('failed', 'the engine fell over').line).not.toContain('Saved');
  });

  test('a settings read that failed can be tried again', () => {
    // show() marks the surface loaded BEFORE awaiting, so a transient engine
    // failure — a disk not mounted yet, a sidecar being written — would
    // otherwise strand Tune on its fault screen for the life of the script.
    const load = source.slice(source.indexOf('async function load('));
    // The catch block ITSELF, not "somewhere after it" — the branch below it
    // resets `loaded` too, and a loose slice would let that one answer for
    // this one. (It did, until a deliberate mutation went unnoticed.)
    const caught = /\} catch \(err\) \{([\s\S]*?)\n  \}/.exec(load);
    expect(caught, 'load() has no catch').not.toBe(null);
    expect(caught![1]).toContain('loaded = false');
  });

  test('a save in flight cannot paint the previous script into the reader', () => {
    // scriptChanged() clears what is owed and the timer, but a flush already
    // chained onto `running` cannot be cancelled: it would finish and hand
    // renderReader() the OLD script's pages.
    expect(source).toMatch(/era \+= 1/);
    const changed = source.slice(source.indexOf('export function scriptChanged()'));
    expect(changed.slice(0, 200)).toContain('era += 1');
    const flush = source.slice(source.indexOf('async function flush('));
    expect(flush.slice(0, 900)).toMatch(/const mine = era/);
    // Checked after every await, and before anything is painted.
    const awaits = [...flush.matchAll(/await runEngine/g)].length;
    expect(awaits).toBe(2);
    expect([...flush.matchAll(/stale\(\)/g)].length).toBeGreaterThanOrEqual(awaits + 1);
    expect(flush.indexOf('stale()')).toBeLessThan(flush.indexOf('renderReader'));
  });

  test('every control is tied to its label and its explanation', () => {
    // One id per key, a <label for> pointing at it, and the sentence beside
    // it named by aria-describedby — otherwise the help is invisible to the
    // reader most likely to need it.
    expect(source).toMatch(/const id = `knob-\$\{knob\.key\}`/);
    expect(source).toMatch(/el\('label', \{ for: id/);
    expect(source).toContain('aria-describedby');
    expect(source).toContain("role: 'status'");
  });
});

describe('the Send surface', () => {
  const send = read('send.js');

  test('a send in flight cannot report into a script that replaced it', () => {
    // The same rule tune.js carries, and for a worse failure: a sendTo()
    // whose script is swapped mid-flight would say "Sent to Kindle." beside
    // a script that was never sent. Pinned by shape, because deleting the
    // counter or stubbing stale() to false leaves the suite green otherwise.
    expect(send).toMatch(/era \+= 1/);
    const changed = send.slice(send.indexOf('export function scriptChanged()'));
    expect(changed.slice(0, 200)).toContain('era += 1');
    const sendTo = send.slice(send.indexOf('async function sendTo('));
    expect(sendTo.slice(0, 400)).toMatch(/const mine = era/);
    expect(sendTo.slice(0, 400)).toMatch(/era !== mine/);
    // One check per await boundary, so no continuation can paint blind.
    // Counted over every `await`, not just the two direct engine calls:
    // ensureSettings() awaits inside itself, and that boundary is exactly
    // where a script can be replaced.
    const body = sendTo.slice(0, sendTo.indexOf('\n}'));
    const awaits = [...body.matchAll(/\bawait\s/g)].length;
    expect(`sendTo has await boundaries: ${awaits}`).toBe('sendTo has await boundaries: 3');
    const checks = [...body.matchAll(/if \(stale\(\)\)/g)].length;
    expect(`sendTo checks staleness: ${checks}`).toBe('sendTo checks staleness: 3');
  });

  test('it asks the engine what is connected rather than guessing', () => {
    expect(send).toContain('argv.devices');
    // A window that knew what a Kindle volume looks like would be the exact
    // duplication the ADR forbids.
    for (const knowledge of ['/Volumes', 'documents', 'system/version.txt', '.kobo']) {
      expect(`send.js knows ${knowledge}: ${send.includes(knowledge)}`).toBe(
        `send.js knows ${knowledge}: false`,
      );
    }
  });

  test('a Kindle gets the ladder, not the raw EPUB', () => {
    // A Kindle never indexes a sideloaded EPUB. Sending one would be a
    // known-broken path dressed up as success.
    expect(send).toContain('argv.export');
    expect(send).toContain("'kindle'");
    expect(send).toContain('forFormat');
  });

  test('the export carries this script’s own settings', () => {
    // Passing the defaults instead would silently rebuild the book in
    // formatting the reader never chose.
    expect(send).toContain('optionsJson');
    expect(send).toContain('state.script.settings');
  });

  test('nothing connected is an answer, not an error', () => {
    expect(send).toContain('no reader');
    expect(send).not.toContain('devices.length === 0 ? throw');
  });

  test('the verb stays constant through the flow', () => {
    // "Send" produces "Sent". The one copy rule the spec names twice.
    expect(send).toContain('Send to');
    expect(send).toContain('Sent to');
  });

  test('it tells the truth about what has met hardware', () => {
    // The project's own stated limit. A row that looks as confident as the
    // Kindle row would be the interface overstating what is known.
    expect(send).toContain('never been tested on real hardware');
  });

  test('it stops polling when the surface is hidden', () => {
    // hide()'s OWN body, not "the file mentions clearInterval somewhere":
    // show() also clears before it re-arms, so a hide() gutted to
    // `{ poll = null; }` would satisfy a file-wide check while the poll ran
    // on forever behind every other surface, asking the engine what is
    // plugged in every two seconds for the life of the window.
    const hide = /export function hide\(\) \{([\s\S]*?)\n\}/.exec(send);
    expect(hide, 'send.js exports no hide()').not.toBe(null);
    expect(hide![1]).toContain('clearInterval(poll)');
  });

  test('nothing is copied when nothing was built', () => {
    // outcomeFor refuses either way, so this is not the safety check — it is
    // the difference between showing the export's own sentence and asking
    // `send` to move a file that was never written, which answers with a
    // worse one about a path the reader never chose.
    const body = send.slice(send.indexOf('async function sendTo('));
    const exported = body.indexOf('argv.export');
    const copied = body.indexOf('argv.send');
    const refused = body.indexOf('built.ok !== true');
    expect(copied).toBeGreaterThan(exported);
    expect(`the export refusal is checked before the copy: ${refused > exported && refused < copied}`)
      .toBe('the export refusal is checked before the copy: true');
  });

  test('the settings are fetched before the argv that carries them is built', () => {
    // The mitigation for the first-conversion gap: a script whose sidecar
    // this window has never read would otherwise export with the engine's
    // DEFAULTS. Deleting the await leaves optionsJsonFor with nothing to
    // serialise and says nothing on screen, so the order is pinned here.
    const body = send.slice(send.indexOf('async function sendTo('));
    const fetched = body.indexOf('await ensureSettings()');
    const built = body.indexOf('argv.export');
    expect(fetched, 'sendTo() does not await ensureSettings()').toBeGreaterThan(-1);
    expect(built).toBeGreaterThan(fetched);
  });

  test('an optional child is never handed straight to a live node', () => {
    // el() drops a null child; Node.append() renders it as the word "null".
    // The empty state did exactly that — a stray "null" under the list of
    // readers, on every platform but Windows — and it was only found by
    // looking at the screen. An optional child goes through el().
    // The argument list of each .append(...), taken by matching parentheses
    // so the window is the call itself and not everything up to the next
    // semicolon.
    const args = (from: number) => {
      let depth = 0;
      for (let i = from; i < send.length; i += 1) {
        if (send[i] === '(') depth += 1;
        else if (send[i] === ')') {
          depth -= 1;
          if (depth === 0) return send.slice(from + 1, i);
        }
      }
      return '';
    };
    const calls = [...send.matchAll(/\.append\(/g)]
      .map((m) => args(m.index! + '.append'.length));
    expect(calls.length).toBeGreaterThan(2);
    for (const call of calls) {
      // A conditional at the TOP level of the argument list is a child this
      // node receives directly; one nested inside el(...) is el()'s to drop.
      let depth = 0;
      let conditional = false;
      for (const char of call) {
        if (char === '(' || char === '[' || char === '{') depth += 1;
        else if (char === ')' || char === ']' || char === '}') depth -= 1;
        else if (char === '?' && depth === 0) conditional = true;
      }
      expect(`a conditional child appended directly: ${conditional}`)
        .toBe('a conditional child appended directly: false');
    }
  });

  test('a send takes the whole list out of reach, and the poll leaves it alone', () => {
    // Not cosmetic: the MOBI rung of src/export/artifact.ts REWRITES the
    // library EPUB in place before it writes the .mobi beside it, so two
    // sends at once is a race over one file. Disabling only the row that was
    // pressed — and letting the two-second poll rebuild fresh, enabled
    // buttons underneath it — would let a second one start.
    expect(send).toMatch(/for \(const button of buttons\(\)\) button\.disabled = true/);
    const refresh = send.slice(send.indexOf('async function refresh('));
    const body = refresh.slice(0, refresh.indexOf('\n}'));
    expect(body, 'refresh() redraws rows during a send').toContain('if (sending) return');
    // And after the await too, not only before it: the answer arrives later
    // than the question, and a send can begin in between.
    const awaits = [...body.matchAll(/await runEngine/g)].length;
    expect(awaits).toBe(1);
    expect([...body.matchAll(/sending/g)].length).toBeGreaterThanOrEqual(awaits + 1);
  });
});

describe('what the Send surface decides', () => {
  type Device = { id: string; kind: string; name: string; volume: string | null };
  type SendModule = {
    UNPROVEN: string;
    PROVEN: { kind: string; platform: string };
    KINDS: string[];
    READERS: { kind: string; name: string; route: string }[];
    NO_MESSAGE: string;
    platformOf: (hint: unknown) => string;
    readerStatus: (kind: string, platform: unknown) => { proven: boolean; text: string };
    undetectable: (platform: unknown) => string | null;
    provenNote: (platform: unknown) => string;
    caveatFor: (device: unknown, platform: unknown) => string | null;
    deviceFrom: (entry: unknown) => Device | null;
    devicesFrom: (answer: unknown) => Device[];
    sameDevices: (a: unknown, b: unknown) => boolean;
    forFormat: (device: unknown) => string;
    whereLine: (device: unknown) => string;
    blockedReason: (script: unknown) => string | null;
    optionsJsonFor: (script: unknown) => string | null;
    sendLabel: (device: Device) => string;
    sentLine: (device: Device, answer: unknown) => string;
    artifactLine: (built: unknown) => string;
    statusFor: (phase: string, opts?: { device?: unknown; detail?: string })
      => { line: string; bad: boolean };
    preparingPhase: (device: unknown) => string;
    failureMessage: (answer: unknown) => string;
    outcomeFor: (built: unknown, sent: unknown, device: unknown)
      => [string, { device: unknown; detail: string }];
    needsSettings: (script: unknown) => boolean;
  };
  let send: SendModule;

  const kindle: Device = { id: '/m/Kindle', kind: 'kindle', name: 'Kindle', volume: '/m/Kindle' };
  const kobo: Device = { id: '/m/KOBOe', kind: 'kobo', name: 'Kobo', volume: '/m/KOBOe' };
  const rm: Device = { id: 'remarkable', kind: 'remarkable', name: 'reMarkable', volume: null };

  beforeAll(async () => { send = (await import(join(UI, 'send.js'))) as SendModule; });

  test('only the one combination anyone has actually plugged in reads as proven', () => {
    // The limit is a KIND and a PLATFORM together. A surface that keyed off
    // the kind alone — the obvious implementation — would put "Verified on
    // hardware" beside a Kindle on this very Linux machine, where no device
    // transfer has ever been run. That is the value this asserts a change
    // FROM: kindle+linux and kindle+windows must be unproven.
    expect(send.readerStatus('kindle', 'MacIntel').proven).toBe(true);
    for (const platform of ['Linux aarch64', 'Win32', undefined]) {
      expect(`kindle on ${platform}: ${send.readerStatus('kindle', platform).proven}`)
        .toBe(`kindle on ${platform}: false`);
    }
    for (const kind of send.KINDS.filter((k) => k !== 'kindle')) {
      expect(`${kind} on a Mac: ${send.readerStatus(kind, 'MacIntel').proven}`)
        .toBe(`${kind} on a Mac: false`);
    }
    // And the two statuses are not the same words, or the column says nothing.
    expect(send.readerStatus('kindle', 'MacIntel').text)
      .not.toBe(send.readerStatus('kobo', 'MacIntel').text);
  });

  test('the unproven sentence names the reader and never appears on the proven one', () => {
    expect(send.caveatFor(kindle, 'MacIntel')).toBe(null);
    for (const [device, platform] of [
      [kindle, 'Linux aarch64'], [kindle, 'Win32'],
      [kobo, 'MacIntel'], [rm, 'MacIntel'],
      [{ id: 'x', kind: 'pocketbook', name: 'PocketBook', volume: '/m/x' }, 'MacIntel'],
    ] as [Device, string][]) {
      const said = send.caveatFor(device, platform);
      expect(`${device.kind}/${platform}: ${said === null}`)
        .toBe(`${device.kind}/${platform}: false`);
      expect(said).toContain(send.UNPROVEN);
    }
    // A vendor's own name, not "this device": a reader has to know which row
    // the warning is about when three are connected.
    expect(send.caveatFor(kobo, 'MacIntel')).toContain('Kobo');
    expect(send.caveatFor(kobo, 'MacIntel')).not.toContain('Kindle');
  });

  test('the line under the standing list says where the one proven route was proven', () => {
    // Four identical red statuses in a column read as a warning wall unless
    // something says what they mean. It also carries the fact no status cell
    // can: a Mac is where the Kindle was plugged in, so on Linux and Windows
    // NOTHING has met hardware — including the Kindle whose row, keyed off
    // kind alone, would otherwise look like the safe one.
    const mac = send.provenNote('MacIntel');
    expect(mac).toContain('Mac');
    const linux = send.provenNote('Linux aarch64');
    expect(linux).toContain(send.UNPROVEN);
    expect(linux).toContain('Linux');
    expect(send.provenNote('Win32')).toContain('Windows');
    expect(send.provenNote('Win32')).not.toContain('Linux');
    // navigator.platform is deprecated and navigator.userAgentData is absent
    // on WebKitGTK, so this window can genuinely not know. Under-claiming
    // hardware support is right; naming the wrong operating system is not —
    // "never tested from Linux" on a Mac is a false statement about the
    // machine, which is the one thing this surface exists to avoid.
    for (const unknown of [undefined, null, '', 'CrOS', {}]) {
      const said = send.provenNote(unknown);
      expect(`${String(unknown)} names Linux: ${said.includes('Linux')}`)
        .toBe(`${String(unknown)} names Linux: false`);
      expect(`${String(unknown)} names Windows: ${said.includes('Windows')}`)
        .toBe(`${String(unknown)} names Windows: false`);
      // It still says the thing that is true everywhere.
      expect(said).toContain(send.UNPROVEN);
      expect(send.platformOf(unknown)).toBe('unknown');
    }
    expect(send.platformOf('Linux aarch64')).toBe('linux');
    expect(send.platformOf('MacIntel')).toBe('mac');
    expect(send.platformOf('Win32')).toBe('windows');
    // The Mac line is a different sentence from the other two, or the note is
    // saying the same thing everywhere and telling nobody anything.
    expect(new Set([mac, linux, send.provenNote('Win32')]).size).toBe(3);
  });

  test('a tolino on Windows is called undetectable, not merely absent', () => {
    // It is identified by the name of its volume and a Windows drive root
    // carries none. Left unsaid, a missing row reads as a bad cable.
    const said = send.undetectable('Win32');
    expect(said).toContain('tolino');
    expect(said).toContain('Windows');
    for (const platform of ['MacIntel', 'Linux aarch64', undefined]) {
      expect(`${platform}: ${send.undetectable(platform)}`).toBe(`${platform}: null`);
    }
  });

  test('a device that cannot be addressed is not offered, and an unknown one still is', () => {
    const answer = {
      ok: true,
      devices: [
        kindle,
        { kind: 'kobo', name: 'Kobo', volume: null },                 // no id to send to
        { id: '/m/x', kind: 'tolino', name: '   ', volume: '/m/x' },  // nothing for the button
        { id: '/m/y', name: 'Mystery', volume: '/m/y' },              // no kind
        { id: '/m/z', kind: 'pocketbook', name: 'PocketBook', volume: '/m/z' },
        'not a device',
      ],
    };
    const devices = send.devicesFrom(answer);
    // Named, so a filter that dropped everything and one that dropped nothing
    // both fail.
    expect(devices.map((d) => d.id)).toEqual(['/m/Kindle', '/m/z']);
    expect(send.devicesFrom({ ok: true, devices: 'nope' })).toEqual([]);
    expect(send.devicesFrom(null)).toEqual([]);
    expect(send.deviceFrom(kindle)).toEqual(kindle);
    // A volume that is not a string is null, never the string "undefined".
    expect(send.deviceFrom({ id: 'r', kind: 'remarkable', name: 'reMarkable' })!.volume).toBe(null);
  });

  test('the list is rebuilt only when it really changed', () => {
    // The poll ticks every two seconds; rebuilding on every tick steals the
    // focus from anyone tabbing to a Send button. So this has to say "same"
    // for a repeated answer — and it must not say "same" by agreeing on
    // length alone, which is what the cheap implementation does.
    expect(send.sameDevices([kindle, kobo], [{ ...kindle }, { ...kobo }])).toBe(true);
    expect(send.sameDevices([kindle], [{ ...kindle, name: 'Kindle Oasis' }])).toBe(false);
    expect(send.sameDevices([kindle], [{ ...kindle, kind: 'kobo' }])).toBe(false);
    expect(send.sameDevices([kindle], [{ ...kindle, id: '/m/Kindle2' }])).toBe(false);
    // Same two devices, opposite order: the rows would be drawn in the other
    // order, so the screen is out of date either way.
    expect(send.sameDevices([kindle, kobo], [kobo, kindle])).toBe(false);
    expect(send.sameDevices([kindle], [])).toBe(false);
    expect(send.sameDevices([kindle], 'nope')).toBe(false);
  });

  test('only a Kindle is sent up the ladder, and every other kind takes the EPUB', () => {
    expect(send.forFormat(kindle)).toBe('kindle');
    for (const kind of [...send.KINDS.filter((k) => k !== 'kindle'), 'pocketbook', '']) {
      expect(`${kind}: ${send.forFormat({ kind })}`).toBe(`${kind}: epub`);
    }
    expect(send.forFormat(null)).toBe('epub');
    // The long wait is the Kindle rung's alone; saying "building" for a rung
    // that builds nothing would be theatre.
    expect(send.preparingPhase(kindle)).toBe('building');
    expect(send.preparingPhase(kobo)).toBe('preparing');
  });

  test('a reMarkable is not described as if it had a volume', () => {
    expect(send.whereLine(kindle)).toBe('/m/Kindle');
    const said = send.whereLine(rm);
    expect(said).not.toBe('remarkable');
    expect(said).toContain('USB');
  });

  test('a script with no book on disk is refused before a device is offered', () => {
    expect(send.blockedReason({ epubPath: '/lib/s/s.epub' })).toBe(null);
    for (const script of [null, undefined, {}, { epubPath: null }, { epubPath: '  ' }]) {
      const said = send.blockedReason(script);
      expect(`${JSON.stringify(script) ?? 'undefined'}: ${said === null}`)
        .toBe(`${JSON.stringify(script) ?? 'undefined'}: false`);
    }
  });

  test('the settings that go with the export are the script’s own', async () => {
    const { DEFAULT_FORMAT_OPTIONS } = await import('../src/options');
    expect(send.optionsJsonFor({ settings: null })).toBe(null);
    expect(send.optionsJsonFor({ settings: {} })).toBe(null);
    expect(send.optionsJsonFor({})).toBe(null);
    const tuned = { ...DEFAULT_FORMAT_OPTIONS, dialogueSideMarginPct: 27, fontFamily: 'serif' };
    // Asserted against the value it was changed FROM: a function that quietly
    // handed back the defaults would round-trip to something that is NOT this.
    expect(tuned.dialogueSideMarginPct).not.toBe(DEFAULT_FORMAT_OPTIONS.dialogueSideMarginPct);
    expect(JSON.parse(send.optionsJsonFor({ settings: tuned })!)).toEqual(tuned);
  });

  test('"Sent" is claimed in the shape the engine reported, and never invents a path', () => {
    expect(send.sendLabel(kindle)).toBe('Send to Kindle');
    const copied = send.sentLine(kindle, { ok: true, destination: '/m/Kindle/x.azw3' });
    expect(copied.startsWith('Sent to Kindle')).toBe(true);
    expect(copied).toContain('/m/Kindle/x.azw3');
    expect(copied).toContain('Eject');
    // A reMarkable never mounts, so there is nothing to eject and no path.
    const uploaded = send.sentLine(rm, { ok: true, uploaded: true });
    expect(uploaded).toBe('Sent to reMarkable.');
    expect(uploaded).not.toContain('Eject');
    // Neither field: still sent — the engine said ok — but no invented path.
    expect(send.sentLine(kobo, { ok: true })).toBe('Sent to Kobo.');
    expect(send.sentLine(kobo, { ok: true })).not.toContain('—');
  });

  test('the status line alarms on failure and on nothing else', () => {
    for (const phase of ['idle', 'building', 'preparing', 'copying', 'sent']) {
      const { bad } = send.statusFor(phase, { device: kindle, detail: 'Sent to Kindle.' });
      expect(`${phase} is bad: ${bad}`).toBe(`${phase} is bad: false`);
    }
    // A second attempt after a failure must clear the alarm, not inherit it.
    expect(send.statusFor('failed', { detail: 'no reader is connected' }).bad).toBe(true);
    expect(send.statusFor('copying', { device: kindle }).bad).toBe(false);
    // The engine's own sentence, verbatim.
    expect(send.statusFor('failed', { detail: 'reMarkable accepts PDF and EPUB, not .mobi.' }).line)
      .toBe('reMarkable accepts PDF and EPUB, not .mobi.');
    // A contract-breaking failure still says something a person can read.
    expect(send.statusFor('failed', { detail: '   ' }).line).toBe(send.NO_MESSAGE);
    expect(send.statusFor('failed', {}).line).toBe(send.NO_MESSAGE);
    // And a failure never says "Sent".
    expect(send.statusFor('failed', { device: kindle, detail: 'it broke' }).line)
      .not.toContain('Sent');
    // Each working phase names the reader it is working on.
    for (const phase of ['building', 'preparing', 'copying']) {
      expect(send.statusFor(phase, { device: kindle }).line).toContain('Kindle');
    }
  });

  test('a refusal is never dressed up as a transfer', () => {
    // The decision the whole surface turns on. sentLine CANNOT tell a refusal
    // from a success on its own: a refused answer carries no destination, and
    // "no destination" is also the shape a reMarkable upload takes — so it
    // would render a refusal as "Sent to Kindle." with no alarm. Both answers
    // are checked here, and both are checked in the failing direction.
    const good = { ok: true, label: 'AZW3 — for USB sideload to Kindle', path: '/x.azw3' };
    const refusedExport = {
      ok: false,
      error: { code: 'export-failed', message: "Can't rebuild the Kindle file." },
    };
    const refusedSend = {
      ok: false,
      error: { code: 'send-failed', message: 'no reader is connected' },
    };

    const [sentPhase, sentDetail] = send.outcomeFor(good, { ok: true, destination: '/m/K/x.azw3' }, kindle);
    expect(sentPhase).toBe('sent');
    expect(send.statusFor(sentPhase, sentDetail)).toEqual({
      line: sentDetail.detail, bad: false,
    });
    expect(sentDetail.detail).toContain('Sent to Kindle');

    for (const [built, sent, why] of [
      [refusedExport, null, 'the export was refused'],
      [refusedExport, { ok: true, destination: '/m/K/x.azw3' }, 'the export was refused'],
      [good, refusedSend, 'the copy was refused'],
      [good, { ok: false }, 'the copy was refused with no sentence'],
      [good, null, 'no answer came back at all'],
      [null, null, 'nothing came back at all'],
    ] as [unknown, unknown, string][]) {
      const [phase, detail] = send.outcomeFor(built, sent, kindle);
      expect(`${why}: ${phase}`).toBe(`${why}: failed`);
      const status = send.statusFor(phase, detail);
      // The two claims a refusal must never make.
      expect(`${why} says Sent: ${status.line.includes('Sent')}`)
        .toBe(`${why} says Sent: false`);
      expect(`${why} is calm: ${status.bad === false}`).toBe(`${why} is calm: false`);
      expect(status.line.trim()).not.toBe('');
    }
    // The engine's own sentence survives, verbatim, in both positions.
    expect(send.outcomeFor(refusedExport, null, kindle)[1].detail)
      .toBe("Can't rebuild the Kindle file.");
    expect(send.outcomeFor(good, refusedSend, kindle)[1].detail)
      .toBe('no reader is connected');
    expect(send.failureMessage({ ok: false })).toBe(send.NO_MESSAGE);
  });

  test('a script whose settings this window has not read yet gets them fetched', () => {
    // Without the fetch, optionsJsonFor has nothing to serialise and the
    // export silently rebuilds with the engine's DEFAULTS — the recorded
    // first-conversion gap, landing on Send.
    const fresh = { epubPath: '/lib/s.epub', fountainPath: '/lib/s.fountain', settings: null };
    expect(send.needsSettings(fresh)).toBe(true);
    // And the fetch is what changes the answer: asserted against the value it
    // changes FROM, so a no-op cannot pass.
    expect(send.optionsJsonFor(fresh)).toBe(null);
    const loaded = { ...fresh, settings: { dialogueSideMarginPct: 27 } };
    expect(send.needsSettings(loaded)).toBe(false);
    expect(send.optionsJsonFor(loaded)).not.toBe(null);
    // Nothing to fetch from, or nothing to fetch for.
    expect(send.needsSettings({ ...fresh, fountainPath: null })).toBe(false);
    expect(send.needsSettings({ ...fresh, fountainPath: '  ' })).toBe(false);
    expect(send.needsSettings(null)).toBe(false);
    expect(send.needsSettings(undefined)).toBe(false);
  });

  test('what went across is named in the engine’s words, not guessed at', () => {
    expect(send.artifactLine({ label: 'AZW3 — for USB sideload to Kindle', path: '/x.azw3' }))
      .toBe('AZW3 — for USB sideload to Kindle');
    expect(send.artifactLine({ path: '/x.azw3' })).toBe('/x.azw3');
    expect(send.artifactLine({})).toBe('');
    expect(send.artifactLine(null)).toBe('');
  });

  test('the standing list covers every kind the engine can report', () => {
    // With nothing plugged in this list IS the surface, so a kind missing
    // from it is a reader with no way to find out whether Screepub reaches it.
    expect(send.READERS.map((r) => r.kind).sort()).toEqual([...send.KINDS].sort());
    for (const reader of send.READERS) {
      expect(`${reader.kind} route: ${reader.route.length > 40}`)
        .toBe(`${reader.kind} route: true`);
    }
    // The Kindle row says WHY it is not the EPUB, because that is the one
    // surprising thing on the surface.
    const kindleRow = send.READERS.find((r) => r.kind === 'kindle')!;
    expect(kindleRow.route).toContain('EPUB');
    expect(kindleRow.route).toContain('MOBI');
  });

  test('every kind the engine can report is also in the standing list', async () => {
    const { DEVICE_DISPLAY_NAMES } = await import('../src/device/types');
    // The engine's own list, so a fifth vendor added to src/device/types.ts
    // fails here rather than turning up on the surface with no row.
    expect([...send.KINDS].sort()).toEqual(Object.keys(DEVICE_DISPLAY_NAMES).sort());
  });
});

describe('the ladder the Send surface asks for, without a toolchain', () => {
  // CI has no Calibre and no Kindle Previewer, and neither does most of this
  // project's audience. So the argv the window builds is fed through the same
  // injection seam src/cli-export.ts already provides, and the three rungs are
  // driven by hand. What is under test is the WINDOW's half: that the argv it
  // builds for a Kindle reaches the Kindle rung carrying this script's own
  // settings, and that what it then prints is the rung that was actually hit.
  let dir: string;
  let epub: string;

  beforeAll(() => {
    dir = mkdtempSync(join(SCRATCH, 'send-'));
    epub = join(dir, 'script.epub');
    writeFileSync(epub, 'not really an epub, but it is a file');
  });

  afterAll(() => { rmSync(dir, { recursive: true, force: true }); });

  /** cli.ts's own argv reading, in miniature: the window's array in, the
   *  exportCommand options out. */
  const asOptions = (args: string[]) => {
    const after = (flag: string) => {
      const i = args.indexOf(flag);
      return i === -1 ? undefined : args[i + 1];
    };
    return {
      epub: args[1],
      for: after('--for'),
      fountain: after('--fountain'),
      optionsJson: after('--options-json'),
    };
  };

  test('a Kindle’s argv reaches the Kindle rung with this script’s settings', async () => {
    const { argv } = await import(join(UI, 'app.js'));
    const sendUi = await import(join(UI, 'send.js'));
    const { exportCommand } = await import('../src/cli-export');
    const { DEFAULT_FORMAT_OPTIONS } = await import('../src/options');

    const script = {
      epubPath: epub,
      fountainPath: join(dir, 'script.fountain'),
      settings: { ...DEFAULT_FORMAT_OPTIONS, dialogueSideMarginPct: 27, justifyText: true },
    };
    const kindle = { id: '/m/Kindle', kind: 'kindle', name: 'Kindle', volume: '/m/Kindle' };
    const args = argv.export(script.epubPath, {
      forFormat: sendUi.forFormat(kindle),
      fountain: script.fountainPath,
      optionsJson: sendUi.optionsJsonFor(script),
    });
    // The argv really is the one the window would build, not one this test
    // wrote for itself.
    expect(args[0]).toBe('export');
    expect(asOptions(args).epub).toBe(epub);
    expect(asOptions(args).for).toBe('kindle');

    let seen: Record<string, unknown> | null = null;
    const result = await exportCommand(asOptions(args), {
      calibreAvailable: () => true,
      kfxStatus: async () => ({ ready: false }) as never,
      freshKindleArtifact: async (opts) => {
        seen = opts.format as unknown as Record<string, unknown>;
        expect(opts.fountainPath).toBe(script.fountainPath);
        return join(dir, 'script.azw3');
      },
    });

    // The whole point: the engine rebuilt with 27%, not with the default.
    expect(seen).not.toBe(null);
    expect(seen!.dialogueSideMarginPct).toBe(27);
    expect(seen!.dialogueSideMarginPct).not.toBe(DEFAULT_FORMAT_OPTIONS.dialogueSideMarginPct);
    expect(seen!.justifyText).toBe(true);
    // And the sentence the surface prints names the rung that was hit.
    expect(sendUi.artifactLine(result)).toContain('AZW3');
  });

  test('each rung of the ladder produces a different sentence on the surface', async () => {
    const sendUi = await import(join(UI, 'send.js'));
    const { exportCommand } = await import('../src/cli-export');

    const rung = async (calibre: boolean, kfx: boolean) => {
      const result = await exportCommand(
        { epub, for: 'kindle' },
        {
          calibreAvailable: () => calibre,
          kfxStatus: async () => ({ ready: kfx }) as never,
          freshKindleArtifact: async () => join(dir, 'script.out'),
        },
      );
      return sendUi.artifactLine(result);
    };

    const best = await rung(true, true);
    const middle = await rung(true, false);
    const worst = await rung(false, false);
    expect(best).toContain('KFX');
    expect(middle).toContain('AZW3');
    expect(worst).toContain('MOBI');
    // Three rungs, three sentences: a surface that printed one constant
    // would pass every "contains" check above on its own.
    expect(new Set([best, middle, worst]).size).toBe(3);

    // And the non-Kindle route does not walk the ladder at all: it hands over
    // the EPUB the library already holds.
    const plain = await exportCommand(
      { epub, for: 'epub' },
      { calibreAvailable: () => false, kfxStatus: async () => ({ ready: false }) as never },
    );
    expect(plain.path).toBe(epub);
    expect(sendUi.artifactLine(plain)).toContain('EPUB');
  });
});

describe('the window does not title its own screens as script furniture', () => {
  // Cut 2026-09-20; see docs/superpowers/specs/2026-09-20-desktop-ui-pass-design.md.
  //
  // This needs a guard rather than a one-off edit because the conceit was not
  // one string, it was NINETEEN across four files, and it spread the way a
  // house style does: each new surface copied the last one. A heading like
  // "Int. the tuning bench - day" tells a reader nothing about the tuning
  // bench, and nine of the nineteen were ERROR headings, where the cost is
  // real: a person whose file was refused was reading set dressing instead of
  // the reason.
  //
  // Deliberately a source scan and not a DOM check. The strings are what
  // spread, and a surface can print one without ever mounting in a test.

  /** Every single- or double-quoted literal in a source file. Good enough for
   *  this window, which has no bundler, no template literals carrying headings
   *  and no quotes inside these strings. */
  function stringLiterals(source: string): string[] {
    return [...source.matchAll(/'([^'\\\n]*)'|"([^"\\\n]*)"/g)]
      .map((m) => m[1] ?? m[2])
      .filter((s) => s !== undefined);
  }

  /** A slugline shape: INT./EXT., something, a dash, a time of day. */
  const SLUGLINE = /^(int|ext)\.\s.+\s-\s.+$/i;
  /** The transitions the window used the same way. */
  const TRANSITION = /^(fade in:|fade out\.|cut to:|dissolve to:)$/i;

  test('no surface is headed with a slugline or a transition', () => {
    const offenders: string[] = [];
    for (const name of jsFiles()) {
      for (const literal of stringLiterals(read(name))) {
        if (SLUGLINE.test(literal) || TRANSITION.test(literal)) {
          offenders.push(`${name}: "${literal}"`);
        }
      }
    }
    expect(offenders.join('\n')).toBe('');
  });

  test('the scan can actually see a slugline, so a pass means something', () => {
    // Guards the test above: a literal-extractor that silently matched
    // nothing would let every heading back in while staying green.
    const seen = stringLiterals(`const a = 'Int. the tuning bench - day';`);
    expect(seen).toContain('Int. the tuning bench - day');
    expect(SLUGLINE.test('Int. the tuning bench - day')).toBe(true);
    expect(TRANSITION.test('Fade in:')).toBe(true);
    // And it does not fire on the window's ordinary prose.
    expect(SLUGLINE.test('Needs selectable text, not a scan.')).toBe(false);
    expect(SLUGLINE.test('Send to a reader')).toBe(false);
  });
});

describe('the update check asks once, stamps first, and never guesses', () => {
  // Contract read off tauri-plugin-updater 2.12.0 by the engine session. The
  // three rules that are easy to get wrong, and are therefore the tests:
  //
  //   1. check() REJECTS on any failure — a 404 manifest, no network, an
  //      unlisted platform. A rejection is a message to show. It is NEVER
  //      "you are up to date", and conflating them would tell someone they
  //      are current when nobody could reach the server.
  //   2. The day-stamp is written BEFORE the request, not after. The README
  //      promises at most one request a day; stamping after would turn a
  //      persistent failure into a request on every single launch.
  //   3. The window never compares versions. pickUpdate does, in code
  //      transpiled from the engine, so the CLI and the window cannot
  //      disagree about what "newer" means.
  let update: any;
  beforeAll(async () => { update = await import(join(UI, 'update.js')); });

  test('it is offered only where the manifest actually covers', () => {
    // The manifest lists darwin only. On Linux and Windows check() throws
    // TargetNotFound every time, so showing the control there would offer a
    // button whose only outcome is an error.
    expect(update.updatesPossible('MacIntel')).toBe(true);
    expect(update.updatesPossible('Win32')).toBe(false);
    expect(update.updatesPossible('Linux x86_64')).toBe(false);
    expect(update.updatesPossible(undefined)).toBe(false);
  });

  test('a fresh install has not opted in and has not been asked', () => {
    const s = update.readState(store());
    expect(s.optedIn).toBe(false);
    expect(s.asked).toBe(false);
    expect(s.lastChecked).toBe(null);
  });

  test('a corrupt stamp does not wedge the check', () => {
    // localStorage is a string bucket anyone can edit. A junk timestamp must
    // read as "never checked" rather than NaN, which would make every
    // comparison false and silently disable the daily check forever.
    const s = update.readState(store({ updateLastChecked: 'yesterday-ish' }));
    expect(s.lastChecked).toBe(null);
  });

  test('a launch check does not run before the reader has opted in', async () => {
    let asked = false;
    const result = await update.runCheck({
      manual: false,
      storage: store({ updateAsked: 'true', updateOptIn: 'false' }),
      now: 1_000_000,
      check: async () => { asked = true; return null; },
    });
    expect(result.outcome).toBe('skipped');
    expect(asked).toBe(false);
  });

  test('a manual check runs even when the launch check would not', async () => {
    // Pressing the button IS the consent for that one request, so it ignores
    // both the opt-in and the once-a-day throttle.
    let asked = false;
    const result = await update.runCheck({
      manual: true,
      storage: store({ updateOptIn: 'false', updateLastChecked: String(1_000_000 - 5) }),
      now: 1_000_000,
      check: async () => { asked = true; return null; },
    });
    expect(asked).toBe(true);
    expect(result.outcome).toBe('current');
  });

  test('the day is stamped before the request, not after', async () => {
    // Captured into an array rather than a variable: assigning inside the
    // closure lets TypeScript narrow a `let` to its initialiser and then
    // reject the comparison.
    const stampedWhenAsked: Array<string | null> = [];
    const s = store({ updateOptIn: 'true' });
    await update.runCheck({
      manual: false,
      storage: s,
      now: 4_242_424,
      check: async () => {
        stampedWhenAsked.push(s.getItem('updateLastChecked'));
        throw 'the network is not there';
      },
    });
    // Written before the call, and still written after it failed.
    expect(stampedWhenAsked[0]).toBe('4242424');
    expect(s.dump().updateLastChecked).toBe('4242424');
  });

  test('a failed check is an error, never "you are up to date"', async () => {
    const result = await update.runCheck({
      manual: true,
      storage: store(),
      now: 1,
      check: async () => { throw 'Could not fetch a valid release JSON from the remote'; },
    });
    expect(result.outcome).toBe('error');
    expect(result.message).toContain('Could not fetch');
  });

  test('null means current, and says so with the engine\'s reason', async () => {
    const result = await update.runCheck({
      manual: true, storage: store(), now: 1, check: async () => null,
    });
    expect(result.outcome).toBe('current');
  });

  test('an offer carries the version and the notes the server sent', async () => {
    const result = await update.runCheck({
      manual: true,
      storage: store(),
      now: 1,
      check: async () => ({ version: '0.7.0', currentVersion: '0.6.0', body: 'Two fixes.' }),
    });
    expect(result.outcome).toBe('offer');
    expect(result.version).toBe('0.7.0');
    expect(result.body).toBe('Two fixes.');
  });

  test('an older or equal version offered by the server is refused here', async () => {
    // The judgement is pickUpdate's, not this module's, and this proves the
    // wiring reaches it: a server that offers a downgrade gets no prompt.
    const result = await update.runCheck({
      manual: true,
      storage: store(),
      now: 1,
      check: async () => ({ version: '0.5.0', currentVersion: '0.6.0', body: '' }),
    });
    expect(result.outcome).toBe('current');
    expect(result.reason).toBeTruthy();
  });

  test('the once-a-day check is actually wired to something', () => {
    // The toggle stores updateOptIn, shouldCheck reads it, runCheck honours
    // it — and for a while NOTHING called runCheck with manual:false, so the
    // preference was a switch connected to no wire. The README promised "one
    // request a day" for behaviour that never ran. A feature that exists in
    // three modules and no caller is indistinguishable from an absent one.
    const flow = read('update-flow.js');
    expect(flow).toContain('runCheck');
    expect(flow).toMatch(/manual:\s*false/);
    expect(read('main.js')).toContain('flow.boot()');
  });

  test('the label and the release notes follow one flow', () => {
    // The ordering bug the old seam existed for (the notes sheet is built at
    // boot and the launch check answers later) is now the flow's job: both
    // subscribe, and a late answer reaches both the same way.
    const main = read('main.js');
    expect(main).toContain('flow.subscribe');
    expect(main).toContain('frame.setUpdateLabel');
    expect(main).toContain('frame.onUpdateClick');
    const notes = read('notes-surface.js');
    expect(notes).toContain('flow.subscribe');
    expect(notes).toContain('flow.start()');
    // Nobody but the flow installs anything.
    for (const name of ['main.js', 'notes-surface.js']) {
      expect(`${name} installs directly: ${read(name).includes('updateInstall')}`)
        .toBe(`${name} installs directly: false`);
    }
  });

  test('without a restart, it asks for a quit and reopen', () => {
    // Only reached by a build without tauri-plugin-process. Every build that
    // carries this line also carries the plugin, so in practice the window
    // restarts instead (installAndRestart); this is the honest fallback.
    const line = update.installedLine('0.7.0');
    expect(line).toContain('0.7.0');
    expect(line.toLowerCase()).toContain('quit');
  });
});

describe('what the update label says, and what it remembers', () => {
  let update: any;
  beforeAll(async () => { update = await import(join(UI, 'update.js')); });

  test('the Convert page asks only where updates work, and only until answered', () => {
    expect(update.shouldAsk(true, store())).toBe(true);
    expect(update.shouldAsk(false, store())).toBe(false);
    // "Said no" is an answer. Only "never asked" is asked.
    expect(update.shouldAsk(true, store({ updateAsked: 'true', updateOptIn: 'false' }))).toBe(false);
    expect(update.shouldAsk(true, store({ updateAsked: 'true', updateOptIn: 'true' }))).toBe(false);
  });

  test('an offer is remembered across launches, and forgotten once this build catches up', async () => {
    const s = store();
    const result = await update.runCheck({
      manual: true, storage: s, now: 1,
      check: async () => ({ version: '0.8.0', currentVersion: '0.7.2', body: '' }),
    });
    expect(result.outcome).toBe('offer');
    // Tomorrow's launch, same build: still behind, so the label comes back.
    expect(update.rememberedOffer(s, '0.7.2')).toBe('0.8.0');
    // After the update: this build IS the remembered version.
    expect(update.rememberedOffer(s, '0.8.0')).toBe(null);
    expect(update.rememberedOffer(store(), '0.7.2')).toBe(null);
  });

  test('a check that finds nothing newer forgets a remembered offer', async () => {
    // A release that was pulled must not leave a label pointing at it.
    const s = store({ updateFound: '0.8.0' });
    await update.runCheck({ manual: true, storage: s, now: 1, check: async () => null });
    expect(update.rememberedOffer(s, '0.7.2')).toBe(null);
  });

  test('a failed check forgets nothing', async () => {
    // No network is not news. The label stays until a check actually answers.
    const s = store({ updateFound: '0.8.0' });
    await update.runCheck({
      manual: true, storage: s, now: 1, check: async () => { throw 'offline'; },
    });
    expect(update.rememberedOffer(s, '0.7.2')).toBe('0.8.0');
  });

  test('a skipped check (the once-a-day throttle) leaves a remembered offer alone', async () => {
    // shouldCheck says no because lastChecked is already `now`: this is what
    // a launch check sees later the same day. No request was made, so there
    // is nothing to have learned, and nothing to forget.
    let asked = false;
    const now = 1_000_000;
    const s = store({ updateFound: '0.8.0', updateOptIn: 'true', updateLastChecked: String(now) });
    const result = await update.runCheck({
      manual: false, storage: s, now, check: async () => { asked = true; return null; },
    });
    expect(result.outcome).toBe('skipped');
    expect(asked).toBe(false);
    expect(update.rememberedOffer(s, '0.7.2')).toBe('0.8.0');
  });

  test('forgetFound empties the remembered version', () => {
    const s = store({ updateFound: '0.8.0' });
    update.forgetFound(s);
    expect(update.rememberedOffer(s, '0.7.2')).toBe(null);
  });

  test('a download reads as a whole percent, and never past 100', () => {
    expect(update.downloadPercent(0, 1000)).toBe(0);
    expect(update.downloadPercent(405, 1000)).toBe(40);
    expect(update.downloadPercent(1000, 1000)).toBe(100);
    // A server that under-reports its length must not produce "140%".
    expect(update.downloadPercent(1400, 1000)).toBe(100);
    // No length from the server: no number at all, rather than a made-up one.
    expect(update.downloadPercent(400, null)).toBe(null);
    expect(update.downloadPercent(400, 0)).toBe(null);
  });

  test('every moment of an update has its own words', () => {
    expect(update.updateLabel(null)).toBe(null);
    expect(update.updateLabel({ kind: 'offer', version: '0.8.0' })).toBe('Update to 0.8.0');
    expect(update.updateLabel({ kind: 'downloading', version: '0.8.0', received: 400, total: 1000 }))
      .toBe('Downloading 0.8.0… 40%');
    expect(update.updateLabel({ kind: 'downloading', version: '0.8.0', received: 400, total: null }))
      .toBe('Downloading 0.8.0…');
    expect(update.updateLabel({ kind: 'installing', version: '0.8.0' })).toBe('Installing…');
    expect(update.updateLabel({ kind: 'waiting', version: '0.8.0' })).toBe('Restarting after this finishes…');
    expect(update.updateLabel({ kind: 'restarting', version: '0.8.0' })).toBe('Restarting…');
    expect(update.updateLabel({ kind: 'failed', version: '0.8.0', message: 'x' })).toBe('Update failed. Try again');
    expect(update.updateLabel({ kind: 'installed', version: '0.8.0' })).toBe(update.installedLine('0.8.0'));
  });

  test('none of it uses an em dash', () => {
    // The owner's rule for text a person reads.
    for (const phase of [
      { kind: 'offer', version: '1' }, { kind: 'downloading', version: '1', received: 1, total: 2 },
      { kind: 'installing' }, { kind: 'waiting' }, { kind: 'restarting' },
      { kind: 'failed', message: '' }, { kind: 'installed', version: '1' },
    ]) {
      expect(update.updateLabel(phase)).not.toContain('—');
    }
  });

  test('the label looks clickable only where a click would do something', () => {
    // 'offer' starts the run; 'failed' retries it. Every other moment is
    // already under way, so clicking it (or the label just looking like
    // it could be clicked) would be a lie.
    expect(update.labelActionable(null)).toBe(false);
    expect(update.labelActionable({ kind: 'offer', version: '1' })).toBe(true);
    expect(update.labelActionable({ kind: 'downloading', version: '1' })).toBe(false);
    expect(update.labelActionable({ kind: 'installing' })).toBe(false);
    expect(update.labelActionable({ kind: 'waiting' })).toBe(false);
    expect(update.labelActionable({ kind: 'restarting' })).toBe(false);
    expect(update.labelActionable({ kind: 'failed', message: 'x' })).toBe(true);
    expect(update.labelActionable({ kind: 'installed', version: '1' })).toBe(false);
    // A retry's re-emitted offer (update-flow.js, start()): the fresh check
    // it triggers is still running, nothing is confirmed, so a click would
    // do nothing yet either.
    expect(update.labelActionable({ kind: 'offer', version: '1', retrying: true })).toBe(false);
  });
});

describe('an update downloads, installs, waits for the engine, then restarts', () => {
  let update: any;
  beforeAll(async () => { update = await import(join(UI, 'update.js')); });

  /** A plugin Update object whose download sends the events tauri-plugin-updater
   *  2.12.0 sends (src/commands.rs: tag "event", content "data", camelCase). */
  const liveOffer = (version = '0.8.0') => ({
    outcome: 'offer', version, body: '',
    update: { version, currentVersion: '0.7.2' },
  });
  const installer = (events: unknown[]) => async (_update: unknown, onProgress: (e: unknown) => void) => {
    for (const event of events) onProgress(event);
  };

  function deps(over: Record<string, unknown> = {}) {
    const phases: unknown[] = [];
    const calls = { check: 0, install: 0, restart: 0 };
    const base = {
      offer: liveOffer(),
      storage: store({ updateOptIn: 'true' }),
      now: 1,
      check: async () => { calls.check += 1; return { version: '0.8.0', currentVersion: '0.7.2', body: '' }; },
      install: async (u: unknown, p: (e: unknown) => void) => {
        calls.install += 1;
        await installer([
          { event: 'Started', data: { contentLength: 1000 } },
          { event: 'Progress', data: { chunkLength: 400 } },
          { event: 'Progress', data: { chunkLength: 600 } },
          { event: 'Finished' },
        ])(u, p);
      },
      busy: () => false,
      whenIdle: async () => {},
      restartReady: () => true,
      restart: async () => { calls.restart += 1; },
      onPhase: (phase: unknown) => { phases.push(phase); },
    };
    return { args: { ...base, ...over }, phases, calls };
  }

  test('each moment is reported in order, and it ends in a restart', async () => {
    // A real download reports progress in network chunks, thousands of them
    // for a bundle this size, but the reader only cares when the WORDS
    // beside the stamp change. Two chunks here (100, then 5) land on the
    // same whole percent (10%) to prove the second one produces no extra
    // phase: the assertion is the de-duplicated sequence of LABELS the
    // reader sees, not a raw count of 'downloading' phases.
    const { args, phases, calls } = deps({
      install: async (u: unknown, p: (e: unknown) => void) => {
        await installer([
          { event: 'Started', data: { contentLength: 1000 } },
          { event: 'Progress', data: { chunkLength: 100 } }, // 10%
          { event: 'Progress', data: { chunkLength: 5 } },   // still 10%: deduped
          { event: 'Progress', data: { chunkLength: 295 } }, // 40%
          { event: 'Progress', data: { chunkLength: 600 } }, // 100%
          { event: 'Finished' },
        ])(u, p);
      },
    });
    const outcome = await update.installAndRestart(args);
    expect(outcome.outcome).toBe('restarting');
    expect(outcome.offer).toBe(args.offer); // the offer actually used, not just a version
    expect(calls.restart).toBe(1);
    expect(phases.map((p: any) => update.updateLabel(p))).toEqual([
      'Downloading 0.8.0…',
      'Downloading 0.8.0… 0%',
      'Downloading 0.8.0… 10%',
      'Downloading 0.8.0… 40%',
      'Downloading 0.8.0… 100%',
      'Installing…',
      'Restarting…',
    ]);
  });

  test('downloading names its own body, not whatever was offered before', async () => {
    // A retry's own fresh check (triggered when a failed attempt clears
    // `update`) can find a NEWER version with different release notes than
    // what was last offered. The release notes block needs the new body
    // the moment downloading starts, not only after Finished.
    const { args, phases } = deps({
      offer: {
        outcome: 'offer', version: '0.8.0', body: 'fresh notes',
        update: { version: '0.8.0', currentVersion: '0.7.2' },
      },
    });
    await update.installAndRestart(args);
    const downloading = phases.filter((p: any) => p.kind === 'downloading');
    expect(downloading.length).toBeGreaterThan(0);
    for (const phase of downloading) expect((phase as any).body).toBe('fresh notes');
  });

  test('it waits while the engine is working, and says so', async () => {
    let release: () => void = () => {};
    const idle = new Promise<void>((r) => { release = r; });
    const { args, phases, calls } = deps({ busy: () => true, whenIdle: () => idle });
    const run = update.installAndRestart(args);
    await new Promise((r) => setTimeout(r, 0));
    expect(phases.map((p: any) => p?.kind)).toContain('waiting');
    expect(calls.restart).toBe(0);
    release();
    await run;
    expect(calls.restart).toBe(1);
    expect((phases.at(-1) as any).kind).toBe('restarting');
  });

  test('a label drawn from memory fetches a fresh update first, and installs exactly what that check returned', async () => {
    // The plugin's Update object lives only as long as the session that
    // fetched it, so a remembered version has none. The click is the consent
    // for one request, even with the daily check switched off. And what
    // reaches install() is that request's own answer object, by reference,
    // not a stand-in built somewhere else.
    const sentinel = { version: '0.8.0', currentVersion: '0.7.2', body: '' };
    let checkCalls = 0;
    let installedWith: unknown = null;
    const { args } = deps({
      offer: { outcome: 'offer', version: '0.8.0', body: '', update: null },
      storage: store({ updateOptIn: 'false' }),
      check: async () => { checkCalls += 1; return sentinel; },
      install: async (u: unknown, p: (e: unknown) => void) => {
        installedWith = u;
        await installer([{ event: 'Finished' }])(u, p);
      },
    });
    const outcome = await update.installAndRestart(args);
    expect(checkCalls).toBe(1);
    expect(installedWith).toBe(sentinel);
    expect(outcome.outcome).toBe('restarting');
  });

  test('every outcome that has an offer reports the one actually used, not the one passed in', async () => {
    // The offer passed in can be a remembered stub with no live Update
    // object and an empty body. Once the fresh check inside replaces it,
    // the caller (update-flow.js) has no other way to learn the real
    // version and body a failed attempt was actually for.
    const live = { version: '0.8.1', currentVersion: '0.7.2', body: 'release notes' };
    const { args, phases } = deps({
      offer: { outcome: 'offer', version: '0.8.0', body: '', update: null },
      check: async () => live,
      install: async () => { throw new Error('interrupted'); },
    });
    const outcome = await update.installAndRestart(args);
    expect(outcome.outcome).toBe('error');
    expect(outcome.offer?.version).toBe('0.8.1');
    expect(outcome.offer?.body).toBe('release notes');
    expect((phases.at(-1) as any).version).toBe('0.8.1');
  });

  test('an offline retry of a remembered label keeps the remembered offer, not the error that overwrote it', async () => {
    // Offline is this app's NORMAL case (built for a Kindle that is often
    // disconnected). A label drawn from memory has no live Update object,
    // so this function runs its own fresh check on the click's behalf --
    // and when THAT check fails, `result` must still be the offer this
    // call started with, not the error result that would otherwise
    // overwrite it before the throw.
    const { args, phases } = deps({
      offer: { outcome: 'offer', version: '0.8.0', body: 'notes', update: null },
      check: async () => { throw new Error('no network'); },
    });
    const outcome = await update.installAndRestart(args);
    expect(outcome.outcome).toBe('error');
    expect(outcome.offer).toBe(args.offer);
    expect((phases.at(-1) as any).version).toBe('0.8.0');
  });

  test('if the fresh check finds nothing newer, nothing is installed', async () => {
    const s = store({ updateFound: '0.8.0' });
    const { args, phases, calls } = deps({
      offer: { outcome: 'offer', version: '0.8.0', body: '', update: null },
      storage: s,
      check: async () => null,
    });
    const outcome = await update.installAndRestart(args);
    expect(outcome.outcome).toBe('current');
    expect(calls.install).toBe(0);
    expect(phases.at(-1)).toBe(null);
    expect(update.rememberedOffer(s, '0.7.2')).toBe(null);
  });

  test('a failed download is reported with its reason, and nothing restarts', async () => {
    const { args, phases, calls } = deps({
      install: async () => { throw new Error('signature did not verify'); },
    });
    const outcome = await update.installAndRestart(args);
    expect(outcome.outcome).toBe('error');
    expect(outcome.message).toContain('signature');
    expect(calls.restart).toBe(0);
    const failed = phases.at(-1) as any;
    expect(failed.kind).toBe('failed');
    expect(failed.message).toContain('signature');
    expect(update.updateLabel(failed)).toBe('Update failed. Try again');
  });

  test('a failed fresh check is a failure, not "nothing newer"', async () => {
    const { args, phases } = deps({
      offer: { outcome: 'offer', version: '0.8.0', body: '', update: null },
      check: async () => { throw 'offline'; },
    });
    const outcome = await update.installAndRestart(args);
    expect(outcome.outcome).toBe('error');
    expect((phases.at(-1) as any).kind).toBe('failed');
  });

  test('without the restart plugin it installs and asks for a quit and reopen', async () => {
    const { args, phases, calls } = deps({ restartReady: () => false });
    const outcome = await update.installAndRestart(args);
    expect(outcome.outcome).toBe('installed');
    expect(outcome.offer).toBe(args.offer);
    expect(calls.restart).toBe(0);
    expect(update.updateLabel(phases.at(-1))).toBe(update.installedLine('0.8.0'));
  });

  test('a rejected restart is not reported as a failed update: the bundle is already swapped', async () => {
    // The realistic cause is a build missing process:allow-restart, not a
    // broken install. "Update failed. Try again" would draw a button that
    // reinstalls a bundle already on disk, in a loop, so this falls back to
    // the same honest line a build without the plugin at all shows.
    const { args, phases } = deps({
      restart: async () => { throw new Error('process:allow-restart is not granted'); },
    });
    const outcome = await update.installAndRestart(args);
    expect(outcome.outcome).toBe('installed');
    expect(outcome.offer).toBe(args.offer);
    expect(update.updateLabel(phases.at(-1))).toBe(update.installedLine('0.8.0'));
  });
});

describe('one update run, one moment, heard by the label and the notes alike', () => {
  let flowMod: any;
  beforeAll(async () => { flowMod = await import(join(UI, 'update-flow.js')); });

  function make(over: Record<string, unknown> = {}) {
    // `s` already resolves over.storage (a STORE, not a function) if given.
    // `...over` must come before the explicit `storage: () => s` below, or a
    // caller's raw store object would overwrite that wrapper directly and
    // every deps.storage() call downstream would throw "not a function".
    const s = (over.storage as ReturnType<typeof store>) ?? store({ updateOptIn: 'true', updateAsked: 'true' });
    const calls = { check: 0, install: 0, restart: 0 };
    const flow = flowMod.createUpdateFlow({
      usable: () => true,
      now: () => 1,
      check: async () => { calls.check += 1; return null; },
      install: async () => { calls.install += 1; },
      busy: () => false,
      whenIdle: async () => {},
      restartReady: () => true,
      restart: async () => { calls.restart += 1; },
      currentVersion: '0.7.2',
      ...over,
      storage: () => s,
    });
    const seen: unknown[] = [];
    flow.subscribe((phase: unknown) => seen.push(phase));
    return { flow, s, calls, seen };
  }

  test('a remembered version is drawn at launch, before today\'s check answers', async () => {
    let answer: (v: unknown) => void = () => {};
    const { flow, seen } = make({
      storage: store({ updateOptIn: 'true', updateAsked: 'true', updateFound: '0.8.0' }),
      check: () => new Promise((r) => { answer = r; }),
    });
    const booting = flow.boot();
    expect((seen.at(-1) as any)?.kind).toBe('offer');
    expect((seen.at(-1) as any)?.version).toBe('0.8.0');
    answer({ version: '0.8.0', currentVersion: '0.7.2', body: '' });
    await booting;
    expect(flow.currentOffer()?.update).toBeTruthy(); // the live object replaced the remembered one
  });

  test('a live check\'s body reaches subscribers even when the version repeats a remembered offer', async () => {
    // Boot draws the remembered stub first (empty body), then the live
    // check answers. When the version is UNCHANGED, a subscriber that
    // skips a redraw on the same version must still see the live body, or
    // it is stuck showing empty notes for an offer that has real ones.
    let answer: (v: unknown) => void = () => {};
    const { flow, seen } = make({
      storage: store({ updateOptIn: 'true', updateAsked: 'true', updateFound: '0.8.0' }),
      check: () => new Promise((r) => { answer = r; }),
    });
    const booting = flow.boot();
    expect((seen.at(-1) as any)?.body).toBe('');
    answer({ version: '0.8.0', currentVersion: '0.7.2', body: 'what is new' });
    await booting;
    expect((seen.at(-1) as any)?.kind).toBe('offer');
    expect((seen.at(-1) as any)?.version).toBe('0.8.0');
    expect((seen.at(-1) as any)?.body).toBe('what is new');
  });

  test('a build that has caught up forgets the remembered version and draws nothing', async () => {
    const s = store({ updateOptIn: 'false', updateAsked: 'true', updateFound: '0.7.2' });
    const { flow, seen } = make({ storage: s });
    await flow.boot();
    expect(seen.every((p) => p === null)).toBe(true);
    expect(s.dump().updateFound).toBe('');
  });

  test('where updates cannot happen, boot touches nothing', async () => {
    const s = store({ updateFound: '0.8.0' });
    const { flow, calls, seen } = make({ usable: () => false, storage: s });
    await flow.boot();
    expect(calls.check).toBe(0);
    expect(seen.every((p) => p === null)).toBe(true);
    expect(s.dump().updateFound).toBe('0.8.0');
  });

  test('boot only ever runs once: a second call cannot replace a live offer with a remembered stub', async () => {
    // A fixed clock would make the daily throttle the thing stopping a
    // second check, not the run-once guard this test is actually about:
    // `now` moves a day forward before the second boot, so WITHOUT the
    // guard the throttle would allow another check and calls.check would
    // become 2.
    let now = 1;
    const s = store({ updateOptIn: 'true', updateAsked: 'true', updateFound: '0.8.0' });
    const { flow, calls } = make({
      storage: s,
      now: () => now,
      check: async () => { calls.check += 1; return { version: '0.8.0', currentVersion: '0.7.2', body: 'notes' }; },
    });
    await flow.boot();
    expect(calls.check).toBe(1);
    expect(flow.currentOffer()?.update).toBeTruthy();
    now += 24 * 60 * 60 * 1000;
    await flow.boot();
    // A second boot must not redraw the remembered stub over the live
    // offer the first boot already fetched.
    expect(calls.check).toBe(1);
    expect(flow.currentOffer()?.update).toBeTruthy();
  });

  test('a check that answers "nothing newer" takes a remembered label down', async () => {
    const { flow, seen } = make({
      storage: store({ updateOptIn: 'true', updateAsked: 'true', updateFound: '0.8.0' }),
      check: async () => null,
    });
    await flow.boot();
    expect(seen.at(-1)).toBe(null);
    expect(flow.currentOffer()).toBe(null);
  });

  test('currentOffer() matches what was actually attempted: remembered 0.8.0, live check finds 0.8.1, install fails', async () => {
    // The probe from review: a label drawn from memory has no live Update
    // object, so start() triggers installAndRestart's own fresh check.
    // Before the fix, that live result never reached this flow's `offer`:
    // the phase said "failed 0.8.1" while currentOffer() still pointed at
    // the stale, empty-body 0.8.0 stub, even though storage (runCheck's own
    // doing) already said 0.8.1.
    const s = store({ updateOptIn: 'true', updateAsked: 'true' });
    const { flow, seen } = make({
      storage: s,
      check: async () => ({ version: '0.8.1', currentVersion: '0.7.2', body: 'release notes' }),
      install: async () => { throw new Error('interrupted'); },
    });
    flow.offerFound({ outcome: 'offer', version: '0.8.0', body: '', update: null });
    await flow.start();
    expect((seen.at(-1) as any).kind).toBe('failed');
    expect((seen.at(-1) as any).version).toBe('0.8.1');
    expect(flow.currentOffer()?.version).toBe('0.8.1');
    expect(flow.currentOffer()?.body).toBe('release notes');
    expect(s.dump().updateFound).toBe('0.8.1');
  });

  test('an offline retry of a remembered label keeps currentOffer() and the failed phase at the remembered version', async () => {
    // Offline is this app's normal case. Before the fix, a failed fresh
    // check overwrote `result` with the error object itself, so the failed
    // phase named version null and currentOffer() lost its version and
    // body entirely.
    const s = store({ updateOptIn: 'true', updateAsked: 'true' });
    const { flow, seen } = make({
      storage: s,
      check: async () => { throw new Error('no network'); },
    });
    flow.offerFound({ outcome: 'offer', version: '0.8.0', body: 'notes', update: null });
    await flow.start();
    expect((seen.at(-1) as any).kind).toBe('failed');
    expect((seen.at(-1) as any).version).toBe('0.8.0');
    expect(flow.currentOffer()?.version).toBe('0.8.0');
    expect(flow.currentOffer()?.body).toBe('notes');
  });

  test('saying yes checks at once; saying no sends nothing', async () => {
    const yes = make({ storage: store() });
    await yes.flow.answer(true);
    expect(yes.calls.check).toBe(1);
    expect(yes.s.dump().updateOptIn).toBe('true');
    expect(yes.s.dump().updateAsked).toBe('true');

    const no = make({ storage: store() });
    await no.flow.answer(false);
    expect(no.calls.check).toBe(0);
    expect(no.s.dump().updateOptIn).toBe('false');
    expect(no.s.dump().updateAsked).toBe('true');
  });

  test('checkAnswered does exactly what launchCheck does with a result: offer or "nothing newer"', async () => {
    // The bug: the notes' manual "Check for updates" used to handle an
    // offer/current result itself, bypassing the flow entirely. On
    // "nothing newer" it cleared the remembered version and said "newest
    // there is" in the notes, but the flow's OWN `offer` and `phase` were
    // untouched — so the label still said "Update to X" and the notes'
    // Install button stayed enabled with the launch check's live handle: a
    // click would install a release the server had just withdrawn.
    // checkAnswered is the one place a result becomes a phase, used by
    // both launchCheck and the manual button now.
    const s = store({ updateOptIn: 'true', updateAsked: 'true' });
    const { flow, seen } = make({ storage: s });
    flow.checkAnswered({ version: '0.8.0', currentVersion: '0.7.2', body: 'notes', outcome: 'offer' });
    expect((seen.at(-1) as any).kind).toBe('offer');
    expect((seen.at(-1) as any).version).toBe('0.8.0');
    expect(flow.currentOffer()?.version).toBe('0.8.0');
  });

  test('checkAnswered("current") clears an offer the LABEL is showing, not just the notes\' own message', async () => {
    const { flow, seen } = make();
    flow.offerFound({ outcome: 'offer', version: '0.8.0', body: 'notes', update: { version: '0.8.0' } });
    expect((seen.at(-1) as any).kind).toBe('offer');
    flow.checkAnswered({ outcome: 'current' });
    // The phase every subscriber hears (the label AND the notes) goes null
    // together: there is no way for one to still say "Update to 0.8.0"
    // while the other says "is the newest there is".
    expect(seen.at(-1)).toBe(null);
    expect(flow.currentOffer()).toBe(null);
  });

  test('checkAnswered("current") while a run is under way does not erase what is actually installing', async () => {
    // Mirrors launchCheck's own `&& !running` guard: a manual click's
    // result answering for a DIFFERENT, now-stale check must not clear the
    // offer a run already in flight (started from the label, say) is
    // actually using.
    let release: () => void = () => {};
    const idle = new Promise<void>((r) => { release = r; });
    const { flow, seen } = make({ busy: () => true, whenIdle: () => idle });
    flow.offerFound({ outcome: 'offer', version: '0.8.0', body: '', update: { version: '0.8.0' } });
    const run = flow.start();
    await new Promise((r) => setTimeout(r, 0));
    flow.checkAnswered({ outcome: 'current' });
    expect((seen.at(-1) as any).kind).toBe('waiting');
    expect(flow.currentOffer()).not.toBe(null);
    release();
    await run;
  });

  test('checkAnswered is what launchCheck itself now calls, so boot and answer(true) go through the same door', () => {
    expect(flowMod.flow.checkAnswered).toBeInstanceOf(Function);
    const src = read('update-flow.js');
    expect(src).toMatch(/async function launchCheck\(\)\s*\{[\s\S]*?checkAnswered\(result\)/);
  });

  test('in notesView terms: the withdrawn-release bug stays fixed end to end', async () => {
    // Reproduces the exact report: an offer is on screen (Install enabled,
    // holding a live Update handle), a manual check answers "current".
    // checkAnswered clears the flow's own offer and phase; notesView, fed
    // the resulting null phase with drewOffer already true, is what turns
    // that into "is the newest there is" with Install hidden and disabled
    // — the same object the label beside the stamp reads too.
    const notesMod = await import(join(UI, 'notes-surface.js'));
    const { RELEASE } = await import(join(UI, 'notes.js'));
    const { flow, seen } = make();
    flow.offerFound({ outcome: 'offer', version: '0.8.0', body: 'notes', update: { version: '0.8.0' } });
    flow.checkAnswered({ outcome: 'current' });
    expect(seen.at(-1)).toBe(null);
    const view = notesMod.notesView(null, { drewOffer: true });
    expect(view.say).toBe(`Screepub ${RELEASE.version} is the newest there is.`);
    expect(view.install).toEqual({ text: '', hidden: true, disabled: true });
  });

  test('two clicks run one update', async () => {
    const { flow, calls } = make();
    flow.offerFound({ outcome: 'offer', version: '0.8.0', body: '', update: { version: '0.8.0' } });
    await Promise.all([flow.start(), flow.start()]);
    expect(calls.install).toBe(1);
    expect(calls.restart).toBe(1);
  });

  test('after a failed install, trying again fetches a fresh update', async () => {
    let installs = 0;
    const { flow, calls, seen } = make({
      install: async () => { installs += 1; if (installs === 1) throw new Error('interrupted'); },
      // Counted so this test can prove a retry asked the server again,
      // matching every other `check` fake in this file.
      check: async () => { calls.check += 1; return { version: '0.8.0', currentVersion: '0.7.2', body: '' }; },
    });
    flow.offerFound({ outcome: 'offer', version: '0.8.0', body: '', update: { version: '0.8.0' } });
    await flow.start();
    expect((seen.at(-1) as any).kind).toBe('failed');
    expect(calls.check).toBe(0);
    await flow.start();
    // The first Update object was closed by the failed attempt, so the retry
    // asked the server for a new one.
    expect(calls.check).toBe(1);
    expect(installs).toBe(2);
    expect((seen.at(-1) as any).kind).toBe('restarting');
  });

  test('a retry visibly leaves the failed phase before its own fresh check answers', async () => {
    // A retry's fresh check (installAndRestart's own, since the failed
    // attempt cleared `update`) can take a while. Until it answers, the
    // phase must not still read "failed": that is the PREVIOUS attempt,
    // and a re-emit mid-check (offerFound, from a background check landing
    // at the same moment) would otherwise repeat that stale failure.
    let answer: (v: unknown) => void = () => {};
    const { flow, seen } = make({
      install: async () => { throw new Error('interrupted'); }, // every attempt fails at install
      check: () => new Promise((r) => { answer = r; }),
    });
    flow.offerFound({ outcome: 'offer', version: '0.8.0', body: 'notes', update: { version: '0.8.0' } });
    await flow.start(); // first attempt: offer.update is live, no check(), fails at install
    expect((seen.at(-1) as any).kind).toBe('failed');
    const retry = flow.start(); // second attempt: offer.update is now null, triggers check()
    await new Promise((r) => setTimeout(r, 0)); // let start() reach the pending check
    expect((seen.at(-1) as any).kind).toBe('offer');
    expect((seen.at(-1) as any).version).toBe('0.8.0');
    expect((seen.at(-1) as any).body).toBe('notes');
    // Marked, so a subscriber (notes-surface.js) can keep Install disabled
    // for this specific moment: the fresh check is running and nothing
    // yet to click has actually been confirmed.
    expect((seen.at(-1) as any).retrying).toBe(true);
    answer({ version: '0.8.0', currentVersion: '0.7.2', body: 'notes' });
    await retry;
  });

  test('a new offer does not interrupt a run already under way', async () => {
    let release: () => void = () => {};
    const idle = new Promise<void>((r) => { release = r; });
    const { flow, seen } = make({ busy: () => true, whenIdle: () => idle });
    flow.offerFound({ outcome: 'offer', version: '0.8.0', body: '', update: { version: '0.8.0' } });
    const run = flow.start();
    await new Promise((r) => setTimeout(r, 0));
    flow.offerFound({ outcome: 'offer', version: '0.8.1', body: '', update: { version: '0.8.1' } });
    expect((seen.at(-1) as any).kind).toBe('waiting');
    release();
    await run;
  });

  test('offerFound re-emits the current phase while a run is under way, so a "Looking…" caption does not stick', async () => {
    let release: () => void = () => {};
    const idle = new Promise<void>((r) => { release = r; });
    const { flow, seen } = make({ busy: () => true, whenIdle: () => idle });
    flow.offerFound({ outcome: 'offer', version: '0.8.0', body: '', update: { version: '0.8.0' } });
    const run = flow.start();
    await new Promise((r) => setTimeout(r, 0));
    const before = seen.length;
    flow.offerFound({ outcome: 'offer', version: '0.8.1', body: '', update: { version: '0.8.1' } });
    // Nothing about the visible phase changed (still 'waiting'), but a
    // subscriber driven by "did I hear anything new" rather than "did the
    // value change" must still hear it, or it sticks on its own last words
    // forever.
    expect(seen.length).toBeGreaterThan(before);
    expect((seen.at(-1) as any).kind).toBe('waiting');
    release();
    await run;
  });

  test('a newer offer that arrived mid-run keeps its own live handle: the finished run does not touch it, and shows it instead of its own stale failure', async () => {
    let failInstall: (e: unknown) => void = () => {};
    const pending = new Promise((_resolve, reject) => { failInstall = reject; });
    const { flow, calls, seen } = make({
      install: async () => { await pending; },
    });
    flow.offerFound({ outcome: 'offer', version: '0.8.0', body: '', update: { version: '0.8.0' } });
    const run = flow.start();
    await new Promise((r) => setTimeout(r, 0)); // let start() reach the pending install
    const newer = { outcome: 'offer', version: '0.8.1', body: 'what is new', update: { version: '0.8.1' } };
    flow.offerFound(newer);
    failInstall(new Error('interrupted'));
    await run;
    // The run that just failed was attempting 0.8.0, not this one: clearing
    // ITS `update` must not reach the 0.8.1 offer that replaced it, or the
    // next start() throws away a live handle nobody used and re-checks for
    // nothing. And the visible phase must say what a click would actually
    // install NOW (0.8.1, with its own body), not the stale failure that
    // was really about 0.8.0.
    expect(flow.currentOffer()).toBe(newer);
    expect(flow.currentOffer()?.update).toBeTruthy();
    expect((seen.at(-1) as any).kind).toBe('offer');
    expect((seen.at(-1) as any).version).toBe('0.8.1');
    expect((seen.at(-1) as any).body).toBe('what is new');
    await flow.start();
    expect(calls.check).toBe(0);
  });

  test('a same-version offer landing mid-run does not erase the failure it just caused', async () => {
    // A reviewer's last finding: a launch check can answer with the very
    // version a click is installing right now (the launch check answered
    // the same 0.8.0 while a click's install of 0.8.0 was running, and the
    // install failed). Before the fix, offerFound's newer object reached the
    // newer-offer branch below on version alone, and replaced the failed
    // phase with "Update to 0.8.0" the instant the install's catch block
    // set it, so the reader never saw why it failed.
    let failInstall: (e: unknown) => void = () => {};
    const pending = new Promise((_resolve, reject) => { failInstall = reject; });
    const { flow, seen } = make({
      install: async () => { await pending; },
    });
    flow.offerFound({ outcome: 'offer', version: '0.8.0', body: '', update: { version: '0.8.0' } });
    const run = flow.start();
    await new Promise((r) => setTimeout(r, 0)); // let start() reach the pending install
    const sameVersion = { outcome: 'offer', version: '0.8.0', body: '', update: { version: '0.8.0' } };
    flow.offerFound(sameVersion);
    failInstall(new Error('interrupted'));
    await run;
    expect((seen.at(-1) as any).kind).toBe('failed');
    // `offer` still moved to the newer object, so a "Try again" uses its
    // live handle rather than triggering a fresh check.
    expect(flow.currentOffer()).toBe(sameVersion);
  });

  test('a newer offer mid-run survives a fresh check that answers "nothing newer" for the run it interrupted', async () => {
    let answer: (v: unknown) => void = () => {};
    const s = store({ updateOptIn: 'true', updateAsked: 'true' });
    const { flow, seen } = make({
      storage: s,
      check: () => new Promise((r) => { answer = r; }),
    });
    flow.offerFound({ outcome: 'offer', version: '0.8.0', body: '', update: null });
    const run = flow.start();
    await new Promise((r) => setTimeout(r, 0)); // let start() reach the pending check
    const newer = { outcome: 'offer', version: '0.8.1', body: 'what is new', update: { version: '0.8.1' } };
    flow.offerFound(newer);
    answer(null); // this run's OWN check finds nothing newer than 0.8.0
    await run;
    // The phase must not go null just because 0.8.0's own check found
    // nothing: 0.8.1 is still held, and a click now would install THAT.
    expect((seen.at(-1) as any).kind).toBe('offer');
    expect((seen.at(-1) as any).version).toBe('0.8.1');
    expect((seen.at(-1) as any).body).toBe('what is new');
    expect(flow.currentOffer()).toBe(newer);
    // runCheck's own forgetFound (0.8.0's check found nothing) must not be
    // the last word: storage has to agree with what is actually on screen.
    expect(s.dump().updateFound).toBe('0.8.1');
  });

  test('start(), a fresh check says "nothing newer", and nothing newer arrived meanwhile: the phase and the offer both clear', async () => {
    const s = store({ updateOptIn: 'true', updateAsked: 'true', updateFound: '0.8.0' });
    const { flow, seen } = make({
      storage: s,
      check: async () => null,
    });
    flow.offerFound({ outcome: 'offer', version: '0.8.0', body: '', update: null });
    await flow.start();
    expect(seen.at(-1)).toBe(null);
    expect(flow.currentOffer()).toBe(null);
    expect(s.dump().updateFound).toBe('');
  });

  test('a broken subscriber does not stop the others from hearing it, or stop the run', async () => {
    // A reviewer's concern: one subscriber's bug (a typo in frame.js, say)
    // must not silence the OTHER subscriber, and must not turn a restart
    // that would otherwise succeed into a reported failure. setPhase logs a
    // broken listener with console.error rather than swallowing it outright
    // (so there is still something to debug from), which this test captures
    // instead of letting it print noise — and checks it actually fired.
    const { flow, calls } = make();
    flow.offerFound({ outcome: 'offer', version: '0.8.0', body: '', update: { version: '0.8.0' } });
    let heard = 0;
    flow.subscribe(() => {
      heard += 1;
      // Not on the very first call: that one fires synchronously inside
      // subscribe() itself, before the run even starts.
      if (heard > 1) throw new Error('broken subscriber');
    });
    const seenGood: unknown[] = [];
    flow.subscribe((phase: unknown) => seenGood.push(phase));
    const logged: unknown[][] = [];
    const originalError = console.error;
    console.error = (...args: unknown[]) => { logged.push(args); };
    try {
      await flow.start();
    } finally {
      console.error = originalError;
    }
    expect(calls.restart).toBe(1);
    expect(seenGood.some((p: any) => p?.kind === 'restarting')).toBe(true);
    expect(logged.length).toBeGreaterThan(0);
    expect(String(logged[0]?.[0])).toContain('a subscriber threw');
  });

  test('subscribe does not throw when the new listener itself does, on the very first call', () => {
    // subscribe() calls the new listener at once with the current phase.
    // That call must go through the same guard as every later one, or a
    // broken listener crashes the SUBSCRIBE, not just a later notification.
    // The guard logs via console.error, captured here rather than left to
    // print noise for an expected throw.
    const { flow } = make();
    const originalError = console.error;
    console.error = () => {};
    try {
      expect(() => flow.subscribe(() => { throw new Error('boom'); })).not.toThrow();
    } finally {
      console.error = originalError;
    }
  });

  test('an exception starting the run resolves as a failed phase, not a rejection, and does not leave `running` stuck true', async () => {
    // Wired straight to click handlers with no catch of their own, so
    // start() must resolve, not reject, and say something rather than
    // leave the label wherever it was. A storage accessor that throws once
    // stands in for anything that could fail on the way in — real
    // localStorage can throw in a private window — and is independent of
    // the subscriber guard above: it never reaches onPhase at all. make()'s
    // `storage` override always wraps a STORE, not a function, so this flow
    // is built directly rather than through make().
    let storageCalls = 0;
    const goodStorage = store({ updateOptIn: 'true' });
    const calls = { check: 0, install: 0, restart: 0 };
    const seen: unknown[] = [];
    const flow = flowMod.createUpdateFlow({
      usable: () => true,
      storage: () => {
        storageCalls += 1;
        if (storageCalls === 1) throw new Error('storage unavailable');
        return goodStorage;
      },
      now: () => 1,
      check: async () => { calls.check += 1; return null; },
      install: async () => { calls.install += 1; },
      busy: () => false,
      whenIdle: async () => {},
      restartReady: () => true,
      restart: async () => { calls.restart += 1; },
      currentVersion: '0.7.2',
    });
    flow.subscribe((phase: unknown) => seen.push(phase));
    flow.offerFound({ outcome: 'offer', version: '0.8.0', body: '', update: { version: '0.8.0' } });
    await flow.start(); // must not throw
    const failed = seen.at(-1) as any;
    expect(failed?.kind).toBe('failed');
    expect(failed?.version).toBe('0.8.0');
    expect(failed?.message).toContain('storage unavailable');
    // If `running` were stuck true, this would silently do nothing and
    // `calls.restart` would stay 0.
    await flow.start();
    expect(calls.restart).toBe(1);
  });

  test('importing update-flow.js touches no window: storage, navigator and the clock are read lazily', () => {
    // The flow object itself, and RELEASE.version (notes.js is pure data),
    // ARE built and read at import. What must NOT be read at import is
    // anything that only exists inside a window: localStorage, navigator
    // and the clock (Date.now, the only one this file uses — app.js is the
    // one with performance.now), same as every Tauri call. Each is a
    // closure here, called only when a method runs — otherwise this module
    // could not be imported by bun test at all.
    expect(typeof flowMod.flow.boot).toBe('function');
    const src = read('update-flow.js');
    expect(src).toContain('storage: () => localStorage');
    expect(src).toContain('now: () => Date.now()');
    // navigator is read only inside the `usable` closure, not at import.
    expect(src).toMatch(/usable:\s*\(\)\s*=>[\s\S]*?navigator/);
    expect(src).not.toMatch(/__TAURI__/); // app.js is the only file that touches Tauri
  });
});

describe('what the Updates block in the release notes shows for one moment', () => {
  // Pulled out of the subscriber as a pure function so every moment can be
  // checked directly, without mounting a surface. `state` is what the block
  // has already drawn: has an offer ever been shown this session, and the
  // version/body an offer or a download most recently named (installing,
  // waiting, restarting, failed and installed carry no body of their own).
  let notes: any;
  let RELEASE: any;
  beforeAll(async () => {
    notes = await import(join(UI, 'notes-surface.js'));
    ({ RELEASE } = await import(join(UI, 'notes.js')));
  });

  test('null before any offer leaves say alone: this is the surface\'s own idle state', () => {
    const view = notes.notesView(null, { drewOffer: false });
    expect(view.say).toBeUndefined();
    expect(view.body).toEqual({ text: '', hidden: true });
    expect(view.install).toEqual({ text: '', hidden: true, disabled: true });
    expect(view.checkDisabled).toBe(false);
  });

  test('offer: names the version, shows the body it carries, and Install is ready', () => {
    const view = notes.notesView(
      { kind: 'offer', version: '0.8.0', body: 'notes' },
      { drewOffer: false },
    );
    expect(view.say).toBe('Screepub 0.8.0 is available.');
    expect(view.body).toEqual({ text: 'notes', hidden: false });
    expect(view.install).toEqual({ text: 'Install 0.8.0', hidden: false, disabled: false });
    expect(view.checkDisabled).toBe(false);
  });

  test('offer with no body: the paragraph stays hidden rather than show empty prose', () => {
    const view = notes.notesView({ kind: 'offer', version: '0.8.0', body: '' }, { drewOffer: false });
    expect(view.body).toEqual({ text: '', hidden: true });
  });

  test('a retry\'s offer moment (retrying: true) keeps Install disabled: nothing is confirmed yet', () => {
    const view = notes.notesView(
      { kind: 'offer', version: '0.8.0', body: 'notes', retrying: true },
      { drewOffer: true, version: '0.8.0', body: 'notes' },
    );
    expect(view.say).toBe('Screepub 0.8.0 is available.');
    expect(view.install).toEqual({ text: 'Install 0.8.0', hidden: false, disabled: true });
  });

  test('downloading: names its own body (a retry can find a newer version), disables Check', () => {
    // The version and body here are NEWER than what state remembers: a
    // retry's own fresh check found 0.8.1, with different notes than the
    // 0.8.0 that was last offered.
    const view = notes.notesView(
      { kind: 'downloading', version: '0.8.1', received: 400, total: 1000, body: 'new notes' },
      { drewOffer: true, version: '0.8.0', body: 'old notes' },
    );
    expect(view.say).toBe('Downloading 0.8.1… 40%');
    expect(view.body).toEqual({ text: 'new notes', hidden: false });
    expect(view.install).toEqual({ text: 'Install 0.8.1', hidden: false, disabled: true });
    expect(view.checkDisabled).toBe(true);
  });

  test('installing: keeps naming whatever version and body were last drawn', () => {
    const view = notes.notesView(
      { kind: 'installing', version: '0.8.0' },
      { drewOffer: true, version: '0.8.0', body: 'notes' },
    );
    expect(view.say).toBe('Installing…');
    expect(view.body).toEqual({ text: 'notes', hidden: false });
    expect(view.install).toEqual({ text: 'Install 0.8.0', hidden: false, disabled: true });
    expect(view.checkDisabled).toBe(true);
  });

  test('waiting: says why the restart is waiting, and disables Check', () => {
    const view = notes.notesView(
      { kind: 'waiting', version: '0.8.0' },
      { drewOffer: true, version: '0.8.0', body: 'notes' },
    );
    expect(view.say).toBe('Restarting after this finishes…');
    expect(view.checkDisabled).toBe(true);
  });

  test('restarting: disables Check (a manual "current" now would contradict the label)', () => {
    const view = notes.notesView(
      { kind: 'restarting', version: '0.8.0' },
      { drewOffer: true, version: '0.8.0', body: 'notes' },
    );
    expect(view.say).toBe('Restarting…');
    expect(view.checkDisabled).toBe(true);
  });

  test('failed: the full reason, Install re-enabled to retry, Check left alone', () => {
    const view = notes.notesView(
      { kind: 'failed', version: '0.8.0', message: 'no network' },
      { drewOffer: true, version: '0.8.0', body: 'notes' },
    );
    expect(view.say).toBe('no network');
    expect(view.body).toEqual({ text: 'notes', hidden: false });
    expect(view.install).toEqual({ text: 'Install 0.8.0', hidden: false, disabled: false });
    // NOT in the disabling list: a manual check is exactly how a reader
    // stuck on a failure finds out whether a newer fix has since shipped.
    expect(view.checkDisabled).toBe(false);
  });

  test('installed: the fallback line, Check stays disabled (the bundle is already swapped)', () => {
    const view = notes.notesView(
      { kind: 'installed', version: '0.8.0' },
      { drewOffer: true, version: '0.8.0', body: 'notes' },
    );
    expect(view.say).toBe('Update installed. Quit and reopen Screepub to use 0.8.0.');
    expect(view.checkDisabled).toBe(true);
  });

  test('null after an offer: a check found nothing newer, so say so', () => {
    const view = notes.notesView(null, { drewOffer: true });
    expect(view.say).toBe(`Screepub ${RELEASE.version} is the newest there is.`);
    expect(view.body).toEqual({ text: '', hidden: true });
    expect(view.install).toEqual({ text: '', hidden: true, disabled: true });
  });
});

describe('the release notes switch actually shows what it is set to', () => {
  test('checked is the boolean itself, not \'\' (which el() sets as false)', () => {
    // el()'s checked branch does `node.checked = value` directly: passing
    // the ternary's '' set node.checked to the STRING's truthiness in the
    // JSX-ish reading a reviewer expects, but assigning a DOM boolean
    // property coerces '' to false regardless of intent, so the switch
    // always rendered off.
    const notes = read('notes-surface.js');
    expect(notes).toContain('checked: state.optedIn,');
    expect(notes).not.toMatch(/checked:\s*state\.optedIn\s*\?\s*''\s*:\s*null/);
  });

  test('a "Turn on" given on the Convert page reaches the switch before the sheet opens', () => {
    // The sheet is built once at boot; readState(localStorage) was read
    // once then too. A later answer on the Convert page never reached this
    // checkbox until relaunch.
    const notes = read('notes-surface.js');
    expect(notes).toContain('export function show()');
    expect(notes).toMatch(/show\(\)\s*\{[\s\S]*?readState\(localStorage\)/);
    const main = read('main.js');
    expect(main).toMatch(/notes\.show\(\);\s*\n\s*notesSheet\.showModal\(\);/);
  });

  test('flipping it on checks at once, the same way the Convert question does', () => {
    // rememberAnswer alone stamped the answer but never ran a check: someone
    // who turns it on from the release notes on a release day had to wait
    // for tomorrow's throttle to lift rather than hear about it this
    // session, unlike the identical question under the drop well
    // (convert.js's askLine, main.js's ctx.updates.answer), which already
    // goes through flow.answer for exactly this reason.
    const notes = read('notes-surface.js');
    const onchange = notes.slice(notes.indexOf('id: \'update-auto\''), notes.indexOf('});\n  autoCheckbox'));
    expect(onchange).toContain('flow.answer(event.target.checked)');
    expect(onchange).not.toContain('rememberAnswer(');
    // The status line's own words are unchanged.
    expect(notes).toContain('Screepub will look once a day, and only for this file.');
    expect(notes).toContain('Screepub will not look on its own.');
  });
});

describe('"Check for updates" does not race the flow\'s own run', () => {
  test('it is disabled for every moment notesView disables it, not just while its own request is in flight', () => {
    // The manual click handler used to unconditionally set
    // `button.disabled = false` when ITS OWN request finished, which could
    // re-enable the button while an unrelated flow run (started from the
    // label, say) was still busy downloading or installing — a manual
    // check answering "current" then would contradict the label on screen
    // and clear the remembered offer out from under it.
    const notes = read('notes-surface.js');
    expect(notes).toMatch(/button\.disabled\s*=\s*checkDisabled/);
  });
});

describe('"Check for updates" hands an offer or "nothing newer" to the flow, not just to itself', () => {
  test('the manual handler calls flow.checkAnswered for offer and current, and still reports its own errors', () => {
    const notes = read('notes-surface.js');
    const handler = notes.slice(
      notes.indexOf("button.addEventListener('click'"),
      notes.indexOf('// One body and one Install button'),
    );
    expect(handler).toContain('flow.checkAnswered(result)');
    // Errors are still this handler's own: checkAnswered has no branch for
    // them (launchCheck does not report them either — see update-flow.js),
    // and a manual press is exactly where a person asked and is owed one.
    expect(handler).toMatch(/result\.outcome === 'error'.*\{\s*text\(say, result\.message\); return; \}/);
    // Neither offer nor "nothing newer" is handled directly any more: that
    // was the bug (the label and the flow's own `offer` never heard about
    // it, so a click on a withdrawn release's stale Update-to label, or its
    // enabled Install button in the notes, still installed it).
    expect(handler).not.toContain('flow.offerFound(result)');
    expect(handler).not.toMatch(/is the newest there is/);
  });

  test('a "current" answer to the very first check this session still says so', () => {
    // notesView's null-after-offer wording is gated on drewOffer (its own
    // doc comment): a null phase before any offer is the block's own IDLE
    // state, and leaves `say` alone. A manual press that has never drawn an
    // offer would otherwise leave `say` stuck on "Looking…" forever once
    // checkAnswered(result) turns a "current" answer into that same null
    // phase. The press itself is reason enough to speak, so the handler
    // marks drewOffer true before the request even goes out.
    const notes = read('notes-surface.js');
    const handler = notes.slice(
      notes.indexOf("button.addEventListener('click'"),
      notes.indexOf('// One body and one Install button'),
    );
    expect(handler).toContain('drewOffer = true;');
  });
});

describe('a refused file is no longer a dead end', () => {
  // The Swift app could report a bug from the failure screen, and the report
  // carried the refusal's code with it. The Tauri window could not report
  // anything, so a file the engine rejected ended the conversation: the one
  // moment someone most wants to tell you what happened was the moment the
  // app gave them nowhere to say it.
  //
  // Ported from app/Sources/ScreepubKit/Feedback.swift rather than reinvented.
  let feedback: any;
  beforeAll(async () => { feedback = await import(join(UI, 'feedback.js')); });

  const parse = (url: string) => new URL(url);

  test('it opens a new issue on this project, not a generic page', () => {
    const url = parse(feedback.newIssueUrl({ appVersion: '0.6.0', osVersion: 'macOS 15.0' }));
    expect(`${url.origin}${url.pathname}`)
      .toBe('https://github.com/ssandweiss/screepub/issues/new');
  });

  test('the report arrives stamped with both versions', () => {
    // So a report never begins with two rounds of "which version?".
    const body = parse(feedback.newIssueUrl({
      appVersion: '0.6.0', osVersion: 'macOS 15.0',
    })).searchParams.get('body') ?? '';
    expect(body).toContain('0.6.0');
    expect(body).toContain('macOS 15.0');
  });

  test('a refusal seeds the "what happened" block; nothing else does', () => {
    const withContext = parse(feedback.newIssueUrl({
      appVersion: '0.6.0', osVersion: 'x', context: 'password: this PDF is locked',
    })).searchParams.get('body') ?? '';
    expect(withContext).toContain('What happened');
    expect(withContext).toContain('password: this PDF is locked');

    const without = parse(feedback.newIssueUrl({
      appVersion: '0.6.0', osVersion: 'x',
    })).searchParams.get('body') ?? '';
    expect(without).not.toContain('What happened');
  });

  test('a plus in the context survives the round trip', () => {
    // Feedback.swift's hard-won detail, carried over: a query parser reads a
    // literal "+" as a space, so a context containing one arrives corrupted
    // unless it is percent-encoded. URLSearchParams gets this right where
    // hand-built query strings do not, which is why this is built with it.
    const body = parse(feedback.newIssueUrl({
      appVersion: '0.6.0', osVersion: 'x', context: 'C++ crashed on page 3+4',
    })).searchParams.get('body') ?? '';
    expect(body).toContain('C++ crashed on page 3+4');
  });

  test('the file manager is called what it is called, per platform', async () => {
    // The Swift app said "SHOW IN FINDER" because it only ran on a Mac. This
    // one runs on three, and "Finder" on Windows names a thing that is not
    // there. An unknown platform gets the generic phrasing rather than a
    // guess, on the same rule send.js's platformOf already follows:
    // under-claiming beats naming the wrong system.
    const convert: any = await import(join(UI, 'convert.js'));
    expect(convert.revealLabel('MacIntel')).toBe('Show in Finder');
    expect(convert.revealLabel('Win32')).toBe('Show in File Explorer');
    expect(convert.revealLabel('Linux x86_64')).toBe('Show in folder');
    expect(convert.revealLabel(undefined)).toBe('Show in folder');
  });

  test('no surface appends a bare null to a node', () => {
    // el() drops a null child; Node.append() renders it as the literal word
    // "null". send.js's drawEmpty records shipping that once. drawFailure was
    // doing it too, and on the COMMON path: the "still open" line is absent
    // whenever no script is loaded, which on a refusal is most of the time.
    //
    // The shape is the test, because the mistake is a shape: a conditional
    // yielding null, sitting directly in a `.append(` argument list.
    // Depth-aware on purpose. A null nested inside an el() call is CORRECT —
    // that is the fix — so a flat regex over the argument text flags the very
    // pattern it should be recommending. Only arguments at depth 0 of the
    // .append( list are the dangerous ones.
    // Keeps ONLY the characters sitting directly inside the .append( parens.
    // Everything a nested call contains is dropped, so `el('p', …, null)` —
    // the correct pattern — contributes nothing, while a ternary resolving to
    // null in the argument list itself survives into the skeleton.
    function topLevelArgs(source: string, at: number): string[] {
      let depth = 0;
      let current = '';
      const args: string[] = [];
      for (let i = at; i < source.length; i += 1) {
        const ch = source[i];
        if (ch === '(') { depth += 1; if (depth === 1) continue; }
        else if (ch === ')') { depth -= 1; if (depth === 0) { args.push(current); break; } }
        else if (ch === ',' && depth === 1) { args.push(current); current = ''; continue; }
        if (depth === 1) current += ch;
      }
      return args;
    }

    const offenders: string[] = [];
    for (const name of jsFiles()) {
      const source = read(name);
      for (const match of source.matchAll(/\.append\(/g)) {
        const at = (match.index ?? 0) + '.append'.length;
        for (const arg of topLevelArgs(source, at)) {
          if (/\bnull\b/.test(arg.replace(/\/\/[^\n]*/g, ''))) {
            offenders.push(`${name}: ${arg.trim().slice(0, 70).replace(/\s+/g, ' ')}`);
          }
        }
      }
    }
    expect(offenders.join('\n')).toBe('');
  });

  test('the failure screen offers it, carrying the code', () => {
    const convert = read('convert.js');
    expect(convert).toContain('Report a bug');
    // The code is the point. A report that says only "it did not work" costs
    // a round trip to learn what the engine already knew.
    expect(convert).toMatch(/newIssueUrl|reportBug/);
  });
});

describe('the settings preview is the reader, not a second copy of it', () => {
  // Settings gets a live script beside the knobs. The tempting way to build
  // it is a second iframe with its own styling code, and that is the one
  // thing this window cannot afford twice: the engine ships its stylesheet
  // INSIDE the preview document, the CSP forbids inline <style> there, and
  // the fix is to lift it out and adopt it as a constructed stylesheet.
  // read.js's own header records what happens when that goes wrong — an
  // unstyled script renders with NO error anywhere. Two copies of that dance
  // would drift, and the drift would be invisible until someone looked.
  const reader = read('read.js');
  const settings = read('tune.js');

  test('the reader exports the dresser rather than keeping it private', () => {
    expect(reader).toContain('export function dressFrame');
  });

  test('settings imports it instead of writing its own', () => {
    expect(settings).toMatch(/import\s*\{[^}]*dressFrame[^}]*\}\s*from\s*'\.\/read\.js'/);
  });

  test('settings builds no constructed stylesheet of its own', () => {
    // The specific shape of the duplication this is here to prevent.
    expect(settings).not.toContain('CSSStyleSheet');
    expect(settings).not.toContain('adoptedStyleSheets');
  });
});

describe('eighteen settings stop arriving as one wall', () => {
  // All eighteen were open at once, under five headings, which is a long
  // scroll of controls most of which nobody is looking for. Each group folds
  // now, and the first is open so the surface never opens as a list of five
  // shut boxes with nothing to read.
  let tune: any;
  beforeAll(async () => { tune = await import(join(UI, 'tune.js')); });

  test('the first group is open and the rest are folded', () => {
    expect(tune.groupStartsOpen(0)).toBe(true);
    expect(tune.groupStartsOpen(1)).toBe(false);
    expect(tune.groupStartsOpen(4)).toBe(false);
  });

  test('every group is still reachable, none is dropped', () => {
    // Folding is not hiding: all five headings remain, and all eighteen knobs
    // remain under them. A "compact" that quietly retired a setting would
    // leave it applying to every conversion with no way to find it.
    expect(tune.GROUPS.length).toBe(5);
    expect(tune.GROUPS.flatMap((g: any) => g.knobs).length).toBe(18);
  });
});

describe('the settings explain themselves in the reader\'s words', () => {
  // The copy was carried over from the SwiftUI reader rail rather than
  // written fresh, and it explained MECHANISM to a screenwriter in a
  // compressed register, using KFX, tolino, chyrons and ragged-right as
  // though they were common words. Rewritten 2026-09-21 to a single brief:
  // lead with what the reader will see in their book, one plain sentence, no
  // jargon that is not glossed on the spot.
  //
  // Screenplay vocabulary is NOT jargon here and is deliberately not banned.
  // (MORE), (CONT'D), parenthetical and cue are words this audience uses
  // daily; KFX is not.
  const ENGINE_WORDS = ['KFX', 'tolino', 'chyron', 'ragged-right', 'ragged right', 'e-ink ('];

  test('no label or explanation leans on a word only the engine knows', async () => {
    const tune: any = await import(join(UI, 'tune.js'));
    const offenders: string[] = [];
    for (const group of tune.GROUPS) {
      const texts = [group.title, group.note ?? '', ...group.knobs.flatMap(
        (k: any) => [k.label, k.help ?? ''],
      )];
      for (const text of texts) {
        for (const word of ENGINE_WORDS) {
          if (String(text).toLowerCase().includes(word.toLowerCase())) {
            offenders.push(`"${word}" in: ${text}`);
          }
        }
      }
    }
    expect(offenders.join('\n')).toBe('');
  });

  test('the scan can actually see the jargon it bans', async () => {
    // Guards the loop above: a GROUPS shape it could not walk would pass by
    // finding nothing, which is the failure mode of every sweep like this.
    const tune: any = await import(join(UI, 'tune.js'));
    const all = tune.GROUPS.flatMap((g: any) => g.knobs.map((k: any) => k.label));
    expect(all.length).toBe(18);
    expect(ENGINE_WORDS.some((w) => 'Applies on new-format Kindle (KFX)'.includes(w))).toBe(true);
  });
});

describe('"Start from" stops reading as a row of arbitrary buttons', () => {
  // It was three faults wearing one coat, and only the third is invisible:
  //   1. it offers exactly two presets, and one of them, "Kindle e-ink (6\")",
  //      is IDENTICAL to the defaults, so on a fresh script that button
  //      visibly does nothing;
  //   2. the label never said it OVERWRITES every setting below it, which the
  //      SwiftUI version stated out loud;
  //   3. the engine already answers "which preset am I on" in `answer.preset`
  //      and the window never read it, so it could not show you where you
  //      stood — which is exactly what makes a no-op button look arbitrary
  //      rather than reassuring.
  let tune: any;
  beforeAll(async () => { tune = await import(join(UI, 'tune.js')); });

  test('the window can say which preset the script is on', () => {
    expect(tune.currentPreset({ preset: 'phone' })).toBe('phone');
    expect(tune.currentPreset({ preset: 'kindleEink' })).toBe('kindleEink');
  });

  test('a script tuned away from every preset is on none of them', () => {
    // The engine answers null rather than keeping a remembered name, because
    // equality is the only honest answer: a stored name would go on claiming
    // "Kindle e-ink" after the first knob moved.
    expect(tune.currentPreset({ preset: null })).toBe(null);
    expect(tune.currentPreset({})).toBe(null);
    expect(tune.currentPreset(undefined)).toBe(null);
  });

  test('presets carry their id, so the current one can be marked', async () => {
    const { DEFAULT_FORMAT_OPTIONS } = await import('../src/options');
    const presets = tune.presetsFrom({
      presets: [{ id: 'kindleEink', displayName: 'Kindle e-ink (6")', settings: { ...DEFAULT_FORMAT_OPTIONS } }],
    });
    expect(presets[0].id).toBe('kindleEink');
  });

  test('the control warns that it overwrites', () => {
    expect(tune.PRESET_NOTE.toLowerCase()).toContain('overwrite');
  });
});

describe('the reach table is available, not announced', () => {
  // "What Screepub can reach" is four readers, four honesty labels and two
  // caveats, and it was the bulk of the empty Send page. It is good
  // information and it is not what someone with nothing plugged in came to
  // find out. Folded away, not deleted: hiding a capability is how a
  // capability stops existing.
  const send = read('send.js');

  test('it is a disclosure the reader opens, not a wall they scroll past', () => {
    const at = send.indexOf('EMPTY.heading');
    expect(at).toBeGreaterThan(-1);
    const around = send.slice(Math.max(0, at - 500), at + 200);
    expect(around).toContain("'details'");
    expect(around).toContain("'summary'");
  });

  test('it starts shut', () => {
    // <details> is open only if the attribute is present at all, so the test
    // is that nobody sets it. Written as a scan of the whole file because the
    // attribute could be set anywhere, including later by a well-meaning
    // "remember it was open" that would quietly undo this.
    expect(send).not.toMatch(/\bopen:\s*(true|''|"")/);
  });

  test('the honesty about untested routes is inside it, not lost with it', () => {
    // provenNote() carries the one fact the statuses cannot: WHERE the single
    // proven route was proven. It moves with the table rather than being cut.
    expect(send).toContain('provenNote');
  });
});

describe('Convert another goes home, not to a file dialog', () => {
  test('the result screen offers a way back to the drop well', () => {
    // It called choose() directly, so the button jumped straight to a native
    // picker. Cancelling that left you back on the previous result with no
    // obvious way to reach the empty state at all — the one screen that
    // explains what this window wants from you.
    const convert = read('convert.js');
    const at = convert.indexOf("'Convert another'");
    expect(at).toBeGreaterThan(-1);
    const wiring = convert.slice(convert.lastIndexOf('onclick', at), at);
    expect(wiring).not.toContain('choose');
    expect(wiring).toContain('reset');
  });

  test('going home does not close the script that is open', () => {
    // Deliberate: the book stays open behind the drop well, so Read, Settings
    // and Send stay reachable. "Convert another" is an invitation, not a
    // discard — and a reader who changes their mind has lost nothing.
    const convert = read('convert.js');
    const reset = convert.slice(convert.indexOf('export function reset'));
    expect(reset.slice(0, reset.indexOf('\n}'))).not.toContain('scriptChanged');
  });
});

describe('the scene index is a drawer in the binding margin', () => {
  // It sat to the RIGHT of the script and took a grid column from it. Moved
  // left, per the maintainer, and the constraint turned out to be arithmetic:
  // the binding margin is 17.6% of the sheet and the brads sit at 5.9%, which
  // leaves about 96px clear, while the rail wants 150-218px. It cannot sit
  // BESIDE the fasteners, so it parks over them — and over the margin, never
  // over the page, which is what a plain overlay got wrong. See the
  // interface-pass design, decision 16.

  /** The first declaration block for a selector, so a test can read one rule
   *  instead of the whole stylesheet. */
  function ruleBlock(css: string, selector: string): string {
    const at = css.indexOf(`${selector} {`);
    expect(`${selector} found`).toBe(at === -1 ? `${selector} missing` : `${selector} found`);
    return css.slice(at, css.indexOf('}', at) + 1);
  }

  test('the control says what it will do, not what is showing', async () => {
    const reader = (await import(join(UI, 'read.js'))) as {
      indexToggle?: (open: boolean) => { label: string; expanded: string };
    };
    expect(reader.indexToggle?.(true)).toEqual({ label: 'Hide scenes', expanded: 'true' });
    expect(reader.indexToggle?.(false)).toEqual({ label: 'Show scenes', expanded: 'false' });
  });

  test('the panel is capped so it cannot hang off the window', () => {
    // Its own 218px is wider than the margin it parks in on a narrow window,
    // and the margin is a PERCENTAGE, so a fixed width is wrong at some size
    // no matter which size you pick. Measured against the content box: the
    // sheet gives the margin 17.6% and the content 70.6%, so the margin is
    // 17.6/70.6 = 24.9% of the box this element is positioned inside.
    const block = ruleBlock(read('surfaces.css'), '.scene-rail');
    expect(block).toMatch(/width:\s*min\(/);
  });

  test('the panel stays positioned, because read.js measures against it', () => {
    // A regression guard on an existing coupling rather than new behaviour:
    // read.js keeps the marked scene in view by its button's offsetTop, and
    // an unpositioned rail would hand it an offset measured from the page
    // instead. The drawer changes `position` from relative to absolute, which
    // is still positioned — this is here so the NEXT change cannot quietly
    // make it static.
    const block = ruleBlock(read('surfaces.css'), '.scene-rail');
    expect(block).toMatch(/position:\s*(relative|absolute|fixed|sticky)/);
  });

  test('hiding it does not rely on moving it', () => {
    // A translate alone cannot be trusted to clear the window: the margin
    // GROWS with the window, so on a wide display a panel shifted by its own
    // width is still sitting on the paper in plain sight.
    const block = ruleBlock(read('surfaces.css'), '.scene-rail');
    expect(block).toMatch(/opacity:\s*0\b/);
    expect(block).toMatch(/visibility:\s*hidden/);
  });
});

describe('the foot of the page names the release', () => {
  // It used to print the ENGINE's self-reported version, labelled "engine".
  // Two things were wrong with that. The number was the engine's while the
  // app's own version is different, so it misnamed the build in the one place
  // people paste into bug reports. And on a failed engine the error REPLACED
  // it, so the app could be running with no version on screen at all.
  const frameMod = async () =>
    (await import(join(UI, 'frame.js'))) as {
      revLabel?: (version: string) => string;
      SURFACES?: Array<{ id: string; label: string }>;
    };

  test('it reads "rev" and the version it was built from', async () => {
    const { revLabel } = await frameMod();
    expect(revLabel?.('0.6.0')).toBe('rev 0.6.0');
  });

  test('the version comes from the notes module, so the stamp and the sheet agree', () => {
    // desktop/ui/notes.js is generated from docs/releases/<version>.md. Taking
    // the number from there makes the stamp and the notes it opens agree by
    // construction rather than by two people remembering to change both.
    const frame = read('frame.js');
    expect(frame).toContain('RELEASE');
    expect(frame).toContain('revLabel');
  });

  test('the notes sheet is not on the page while it is shut', () => {
    // A closed <dialog> is hidden by the browser's own
    // `dialog:not([open]) { display: none }`, and ANY class selector outranks
    // that. Giving .sheet-over a display unqualified therefore does not style
    // the sheet, it un-hides it: the release notes sat permanently at the
    // foot of every surface, invisible in a short window and obvious the
    // moment anyone scrolled. Shipped and unnoticed for six commits.
    const css = read('style.css');
    const unqualified = css.match(/\.sheet-over\s*\{[^}]*\}/g) ?? [];
    for (const rule of unqualified) {
      expect(`unqualified .sheet-over: ${rule}`).not.toContain('display:');
    }
  });

  test('the bar holds four surfaces, and Notes is not one of them', async () => {
    // Notes is the release notes for the version you are running. It is a
    // thing you glance at, not a place you go, and it is reached from the
    // version it describes.
    const { SURFACES } = await frameMod();
    expect(SURFACES?.map((s) => s.id)).toEqual(['convert', 'read', 'tune', 'send']);
  });
});

describe('the window can be moved by its top, like any other window', () => {
  // titleBarStyle "Overlay" puts the page under the title bar, and until
  // 2026-09-23 the page marked nothing as a drag region, so the window could
  // not be moved at all. Tauri's drag script (2.11.5, drag.js): a bare
  // attribute drags only when the click lands on THAT element; anything
  // clickable without the attribute stays clickable.
  const frame = read('frame.js');
  const css = read('style.css');

  test('a transparent strip along the top is a drag region', () => {
    expect(frame).toMatch(/class:\s*'drag-strip',\s*'data-tauri-drag-region':\s*''/);
    const rule = css.match(/\.drag-strip\s*\{[^}]*\}/)?.[0] ?? '';
    // NOT fixed: a strip pinned to the viewport stayed over content that
    // scrolled underneath it — confirmed live, a click on a tab started a
    // window drag once Read had scrolled 21.5px, and the strip sat over a
    // slider on Settings (1495px tall) once it had scrolled to 400px.
    // Absolute, so it is part of the page and scrolls away with it.
    expect(rule).toContain('position: absolute');
    expect(rule).not.toContain('position: fixed');
    expect(rule).toContain('top: 0');
    expect(rule).toContain('height: var(--space-7)');
  });

  test('the gaps in the tab bar drag, and the tabs stay tabs', () => {
    expect(frame).toMatch(/el\('nav',\s*\{[^}]*'data-tauri-drag-region':\s*''/);
    // The attribute is never on a tab button: that would turn a click on
    // "Read" into a window move. Matched by shape (an el('button', ...)
    // call whose props carry class: 'tab'), not by exact whitespace, so a
    // reformat cannot make this pass on nothing.
    const tabButton = frame.match(/el\('button',\s*\{[\s\S]*?class:\s*'tab'[\s\S]*?\},\s*label\)/);
    expect(tabButton).not.toBeNull();
    expect(tabButton?.[0]).not.toContain('data-tauri-drag-region');
    // Counted as PROPS (quoted, with a colon), so a comment naming the
    // attribute does not change the count.
    expect(frame.match(/'data-tauri-drag-region':/g)?.length).toBe(2);
  });
});

describe('the dead-engine line does not crowd the update label', () => {
  test('it sits a full row below the foot, not 1.4px away', () => {
    const rule = read('style.css').match(/\.engine-fault\s*\{[^}]*\}/)?.[0] ?? '';
    expect(rule).toContain('bottom: var(--space-9)');
  });

  test('it stays aligned with the foot below 720px, like the foot itself', () => {
    const css = read('style.css');
    const start = css.indexOf('@media (max-width: 720px)');
    expect(start).toBeGreaterThan(-1);
    const nextMedia = css.indexOf('@media', start + 1);
    const block = css.slice(start, nextMedia === -1 ? undefined : nextMedia);
    expect(block).toContain('.engine-fault { right: var(--space-4); }');
  });
});

describe('a newer version is a label you can click, not a dot you can miss', () => {
  const frame = read('frame.js');
  const css = read('style.css');

  test('the brass dot is gone', () => {
    // The owner missed it, and the update with it (2026-09-23).
    expect(css).not.toContain('.rev-new');
    expect(frame).not.toContain('rev-new');
    expect(frame).not.toContain('updateWaiting');
  });

  test('the label sits beside the stamp, and the stamp still opens the notes', () => {
    expect(frame).toContain("class: 'rev-update'");
    expect(frame).toMatch(/el\('div',\s*\{\s*class:\s*'rev-foot'\s*\},\s*updateLabel,\s*stamp\)/);
    expect(frame).toContain('setUpdateLabel');
    expect(frame).toContain('onUpdateClick');
    // The stamp's own click handler is untouched: it still calls every
    // registered rev handler. `toContain('revHandlers')` alone would still
    // pass with the stamp's onclick deleted, since the array declaration
    // and push still mention the name.
    expect(frame).toMatch(/onclick:\s*\(\)\s*=>\s*\{\s*for\s*\(const handler of revHandlers\)\s*handler\(\);\s*\}/);
  });

  test('the label is ink with a brass rule, not brass text', () => {
    // Brass on the paper does not reach a readable contrast; the brass is the
    // rule under it, the same mark the open tab carries.
    const rule = css.match(/\.rev-update\s*\{[^}]*\}/)?.[0] ?? '';
    expect(rule).toContain('color: var(--ink)');
    expect(rule).toMatch(/border-bottom:\s*1\.5px solid var\(--brass\)/);
    expect(css).toMatch(/\.rev-update:focus-visible/);
  });

  test('the foot, not the stamp, is what is pinned to the corner', () => {
    const foot = css.match(/\.rev-foot\s*\{[^}]*\}/)?.[0] ?? '';
    expect(foot).toContain('position: absolute');
    const stamp = css.match(/\.rev-stamp\s*\{[^}]*\}/)?.[0] ?? '';
    expect(stamp).not.toContain('position: absolute');
  });

  test('the label stops looking clickable once a click would do nothing', () => {
    // "Update to 0.8.0" is a real button; "Downloading 0.8.0… 40%" only
    // looks like one unless the frame is told otherwise.
    expect(frame).toMatch(/setUpdateLabel:\s*\(words,\s*\{\s*actionable\s*\}/);
    expect(frame).toContain('aria-disabled');
    const rule = css.match(/\.rev-update-inert\s*\{[^}]*\}/)?.[0] ?? '';
    expect(rule).toContain('cursor: default');
    const main = read('main.js');
    expect(main).toContain('labelActionable(phase)');
  });

  test('the keyboard does not fall off the edge when the label hides under it', () => {
    // A fresh check that says "nothing newer" hides the label (words go
    // null). If the reader had just Tabbed to it, or clicked it and it
    // resolved before they moved on, the keyboard was standing on an
    // element that is now `hidden`, which drops focus to the body with no
    // way back in one Tab press. The label needs a stable handle so
    // main.js can tell whether it was the one holding focus.
    expect(frame).toMatch(/class:\s*'rev-update',[\s\S]*?id:\s*'rev-update'/);
    const main = read('main.js');
    const subscriber = main.slice(main.indexOf('flow.subscribe'), main.indexOf('frame.onUpdateClick'));
    expect(subscriber).toMatch(/document\.activeElement\?\.id === 'rev-update'/);
    expect(subscriber).toMatch(/document\.activeElement\?\.id === 'rev-update'\)\s*restoreFocus\(\)/);
  });
});

describe('the Convert page asks once whether to look for new versions', () => {
  test('the question is short, plain and has no em dash', async () => {
    const { ASK } = await import(join(UI, 'convert.js'));
    expect(ASK).toEqual({
      question: 'Check for new versions once a day?',
      yes: 'Turn on',
      no: 'No thanks',
    });
    for (const words of Object.values(ASK)) expect(String(words)).not.toContain('—');
  });

  test('it sits under the well, and only when update.js says to ask', () => {
    const convert = read('convert.js');
    expect(convert).toContain('ctx.updates?.shouldAsk()');
    expect(convert).toContain("class: 'well-ask'");
    // Answering hands the keyboard back: the line that had the buttons is
    // gone. Matched by shape (a removal followed by restoring focus), not
    // by a `line` variable name, since the removal goes through the
    // clicked button's own ancestor rather than a forward reference.
    expect(convert).toMatch(/\.closest\('\.well-ask'\)\?\.remove\(\);\s*ctx\.restoreFocus\(\);/);
    const main = read('main.js');
    expect(main).toContain('shouldAsk(flow.usable(), localStorage)');
    expect(main).toContain('flow.answer(on)');
  });

  test('the question sits after the well, so Choose PDF stays the first focus stop', () => {
    // askLine() is appended in a SECOND pane.append() call, after the one
    // that draws the wordmark and the well. Reversing that order would put
    // the question's own buttons ahead of Choose PDF in the DOM, and this
    // surface's first focus stop is the first control the DOM contains.
    const convert = read('convert.js');
    const wellDeclared = convert.indexOf("class: 'well'");
    const askAppended = convert.indexOf('if (ask) pane.append(ask);');
    expect(wellDeclared).toBeGreaterThan(-1);
    expect(askAppended).toBeGreaterThan(wellDeclared);
  });

  test('flipping the switch in the release notes while the question is still up wins', () => {
    // The reader could answer both ways at once: flip the switch in the
    // release notes, then click a stale "No thanks" that was already on
    // screen. The second answer re-checks shouldAsk() and, if it is
    // already false, only removes the line rather than overwriting the
    // newer answer.
    const convert = read('convert.js');
    expect(convert).toMatch(/if\s*\(ctx\.updates\.shouldAsk\(\)\)\s*ctx\.updates\.answer\(on\)/);
  });

  test('it is styled quietly, in the window\'s own tokens', () => {
    const rule = read('surfaces.css').match(/\.well-ask\s*\{[^}]*\}/)?.[0] ?? '';
    expect(rule).toContain('color: var(--ink-muted)');
  });
});

describe('the release notes redraw one Install button and one body, not a new one per offer', () => {
  // The plan's first draft of this block built a fresh <p> and a fresh
  // button on every offer() call, so a version that repeats (the remembered
  // stub, then the live check confirming it) appended a SECOND body and a
  // second Install button rather than redrawing the first. Both are built
  // once, up front, and hidden until there is something to say.
  test('exactly one Install button, and the body is redrawn with text()', () => {
    const notes = read('notes-surface.js');
    expect(notes.match(/btn-brad/g)?.length).toBe(1);
    expect(notes).toContain("el('button', { type: 'button', class: 'btn btn-brad btn-small', hidden: true }");
    expect(notes).toContain("el('p', { class: 'prose update-body', hidden: true }");
    // Redrawn from notesView's own return value (view.body.text), not
    // appended: the pure function decides the words, the subscriber only
    // paints them.
    expect(notes).toMatch(/text\(body,\s*view\.body\.text\)/);
    // Not appended per offer: say.after(...) built a new paragraph each time.
    expect(notes).not.toContain('say.after(');
  });
});

describe('a surface with nothing behind it is absent, not dimmed', () => {
  // Read, Tune and Send were DISABLED before a conversion, which drew three
  // greyed words in the bar advertising doors that do not open. Worse for a
  // screen reader, which reads a disabled control out and then refuses it.
  // The rule lives in a pure function so it can be tested without a DOM, the
  // same split convert.js, read.js and tune.js already use.
  const presence = async () =>
    (await import(join(UI, 'frame.js'))) as {
      tabPresence?: (available: boolean, selected: boolean) => { hidden: boolean; tabIndex: number };
    };

  test('an unreachable surface is off the bar and off the keyboard', async () => {
    const { tabPresence } = await presence();
    expect(tabPresence?.(false, false)).toEqual({ hidden: true, tabIndex: -1 });
  });

  test('an unreachable surface stays off the keyboard even if it was the one showing', async () => {
    // enable() moves away from a surface it is switching off, but the two
    // facts arrive separately, and a tab that kept tabIndex 0 while hidden is
    // a focus stop pointing at nothing.
    const { tabPresence } = await presence();
    expect(tabPresence?.(false, true)).toEqual({ hidden: true, tabIndex: -1 });
  });

  test('the open surface is the bar\'s single tab stop', async () => {
    const { tabPresence } = await presence();
    expect(tabPresence?.(true, true)).toEqual({ hidden: false, tabIndex: 0 });
  });

  test('a reachable surface that is not open is visible but not a tab stop', async () => {
    // Roving tabindex: one stop for Tab, then the arrows move inside. Five
    // stops would put every surface five presses further away than the last.
    const { tabPresence } = await presence();
    expect(tabPresence?.(true, false)).toEqual({ hidden: false, tabIndex: -1 });
  });
});

describe('the drop well states one guard, not two', () => {
  // The engine guards four failures and two were checkable at a glance, so
  // the well named both: a scan, and a password-locked file. The maintainer
  // cut the password half on 2026-09-20 — see the interface-pass design,
  // decision 10. That is a real trade and it is recorded there: a locked PDF
  // is now discovered AFTER the wait instead of before it. It is survivable
  // only because the refusal still names the cause, which the HEADINGS table
  // and its own tests already guarantee.
  const ROOT = new URL('..', import.meta.url).pathname;
  const wellCopy = async () =>
    (await import(join(UI, 'convert.js'))) as { WELL?: { limits?: string }; WORDMARK?: string };

  test('it still warns about a scan before the drop', async () => {
    const { WELL } = await wellCopy();
    expect(WELL?.limits ?? '').toContain('not a scan');
  });

  test('it no longer warns about a password', async () => {
    const { WELL } = await wellCopy();
    expect((WELL?.limits ?? '').toLowerCase()).not.toContain('password');
  });

  test('the brand component says the same thing the window says', async () => {
    // These two carried identical copy and NOTHING tied them together, so the
    // window could be changed and the design system left saying the old line.
    // The component is what the next surface gets built from, so that drift
    // does not stay theoretical: it re-adds the sentence by hand later.
    //
    // Compared as the rendered COPY rather than by scanning the file, because
    // the component's caption is documentation and has to stay free to
    // explain what the line used to say and why that half went. A file-wide
    // ban on the word forbids the component from recording its own history.
    const { WELL } = await wellCopy();
    const brand = readFileSync(join(ROOT, 'brand', 'components', 'drop-well.html'), 'utf8');
    const limits = [...brand.matchAll(/<span class="well-limits">([^<]*)<\/span>/g)]
      .map((m) => m[1] ?? '');
    const expected = WELL?.limits ?? '';
    expect(expected).not.toBe(''); // the window must actually have copy to compare
    expect(limits.length).toBeGreaterThan(0); // the scan must actually find them
    for (const line of limits) expect(line).toBe(expected);
  });

  test('the window names itself where the paragraph used to be', async () => {
    // With the title bar gone and the prose cut, this is the only place the
    // app says what it is.
    const { WORDMARK } = await wellCopy();
    expect(WORDMARK).toBe('Screepub');
  });
});
