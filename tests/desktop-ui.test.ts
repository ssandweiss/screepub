import { beforeAll, describe, test, expect } from 'bun:test';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const UI = join(new URL('..', import.meta.url).pathname, 'desktop', 'ui');
const read = (name: string) => readFileSync(join(UI, name), 'utf8');
const cssFiles = () => readdirSync(UI).filter((f) => f.endsWith('.css'));
const jsFiles = () => readdirSync(UI).filter((f) => f.endsWith('.js'));

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

  test('the surface switcher is a real tablist, reachable by keyboard', () => {
    const frame = read('frame.js');
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
    for (const name of ['convert', 'read', 'tune', 'send', 'notes']) {
      expect(frame).toContain(name);
    }
  });
});

describe('the window uses the brand, not its own colours (scripts too)', () => {
  test('no script builds a colour of its own', () => {
    // The CSS is checked above; a script can smuggle one in just as easily by
    // assigning a literal. The two brand-verbatim gradient stops in frame.js
    // (#fff / #000, copied from brand/components/brad.html) are three-digit
    // and deliberately not matched by the six-digit form.
    for (const name of jsFiles()) {
      const hexes = [...read(name).matchAll(/#[0-9a-fA-F]{6}\b/g)].map((m) => m[0]);
      const rgba = [...read(name).matchAll(/\brgba?\(/g)].map((m) => m[0]);
      expect(`${name}: ${[...hexes, ...rgba].join(', ')}`).toBe(`${name}: `);
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
      if (name === 'app.js' || name === 'notes.js') continue;
      const flags = [...read(name).matchAll(/'(--[a-z-]+)'/g)].map((m) => m[1]);
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
    // stays what was previewed.
    expect(after(argv.reconvert('/s/x.fountain', '/s/x.epub', '{}'), '-o')).toBe('/s/x.epub');

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
    // brand/components/drop-well.html's own argument: two of the four guards
    // are properties a reader can check at a glance, so saying them here
    // moves both from after the wait to before the drop.
    expect(convert).toContain('Needs selectable text, not a scan. No password.');
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

  test('the surface takes focus back after the native dialog closes', () => {
    // desktop/README.md's disclosed observation: the webview did not regain
    // keyboard focus after the file dialog closed.
    expect(convert).toContain('.focus()');
  });

  test('it sets no inline style, which this window’s CSP refuses', () => {
    // Measured in piece C: with `default-src 'self'` an appended <style>, a
    // style= attribute and a <style> inside srcdoc all fail silently. The
    // bar's width is the one computed value on this surface, so this is the
    // rule most easily broken here.
    expect(`convert.js sets .style: ${/\.style\b/.test(convert)}`).toBe(
      'convert.js sets .style: false',
    );
    expect(`convert.js sets a style attribute: ${/['"]style['"]\s*:/.test(convert)}`).toBe(
      'convert.js sets a style attribute: false',
    );
    // ...and the route it uses instead, which piece C measured as working.
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
    const said = 'No scene headings and no dialogue found — this does not look like a '
      + 'screenplay. Pass --force to convert it anyway.';
    expect(convert.failureFor({ code: 'not-screenplay', message: said }).message).toBe(said);
    // Not trimmed into a summary, not re-cased, not suffixed.
    const odd = 'cannot read the input file (EACCES)';
    expect(convert.failureFor({ code: 'unreadable', message: odd }).message).toBe(odd);
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
        '--json', '--progress', '-o', join(tmpdir(), 'screepub-convert-progress.epub')],
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
        '--json', '-o', join(tmpdir(), 'screepub-convert-surface.epub')],
      { stdout: 'pipe', stderr: 'pipe' },
    );
    const [stdout] = await Promise.all([new Response(proc.stdout).text(), proc.exited]);
    const answer = JSON.parse(stdout);
    expect(answer.ok).toBe(false);
    const shown = convert.failureFor(answer.error);
    expect(shown.canForce).toBe(true);
    expect(shown.message).toBe(answer.error.message);
    expect(shown.heading).toBe(convert.HEADINGS['not-screenplay']);
  }, 60000);
});

describe('the engine’s answer survives the trip out of Rust', () => {
  // Measured, not supposed: before the engine was fixed, a 384 KB answer
  // came back whole twice and TRUNCATED twice in the same session, and a
  // 3.4 MB answer was short on every attempt. The cause was upstream of this
  // file — the engine exiting without waiting for its own buffered stdout,
  // fixed in src/cli.ts and pinned by tests/cli.test.ts — but the window is
  // where it showed, so the size this file can carry is asserted here too.
  //
  // The answer arrives as a string. Returning it from Rust as bytes was
  // tried (it takes the other route through Tauri's IPC) and timed in the
  // live window: slower at every size, so it was reverted and the decode
  // branch with it. desktop/README.md has the numbers.
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

  test('half a megabyte arrives whole', async () => {
    const json = bigAnswer(500_000);
    expect(json.length).toBeGreaterThan(400_000); // the old floor, exceeded
    const parsed = await answering(json);
    // Length first: a handler that dropped the tail would still produce an
    // object if it happened to cut on a brace, so assert the size.
    expect(JSON.stringify(parsed).length).toBe(json.length);
    expect(parsed).toEqual(JSON.parse(json));
  });

  test('multi-byte characters survive, whatever the transport does', async () => {
    // An em dash is in the engine's own refusal text, and a transport that
    // went byte-wise somewhere would mangle it first.
    const json = JSON.stringify({ ok: false, error: { code: 'x', message: 'é — 日本語' } });
    const parsed = await answering(new TextDecoder().decode(new TextEncoder().encode(json)));
    expect((parsed as { error: { message: string } }).error.message).toBe('é — 日本語');
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
