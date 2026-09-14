import { describe, test, expect } from 'bun:test';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

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
