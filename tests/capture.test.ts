// The capture tool's pure parts. The picture-taking itself needs Chrome and
// runs in /release; everything that DECIDES something is tested here.
import { describe, test, expect } from 'bun:test';
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gateEngineCall } from '../tools/capture/gate';
import { captureIndex } from '../tools/capture/page';
import { SHOTS, outputsFor, writeIfChanged } from '../tools/capture/shots';
// @ts-expect-error -- plain JS module, no types
import { argv } from '../desktop/ui/app.js';

// Every path below is built off the file's own location, not the working
// directory the suite happens to be launched from.
const ROOT = join(import.meta.dir, '..');

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

  const D = ctx.demoPdf;
  const F = inLib('field-station.fountain');
  const E = inLib('field-station.epub');

  // Each of these is CLOSE to a real call but not one the window's own argv
  // builders can produce: a smuggled flag, a repeated flag, a `--x=` form,
  // a missing constant flag, a relative path, a `..` escape, or a verb the
  // window never sends. A gate that only checks the first argument, or only
  // checks that -o lands in the library, allows every one of these.
  const REFUSALS: [string, string[]][] = [
    ['a flag smuggled onto a convert after --library',
      [...argv.convert(D), '--fountain', '/Users/me/real.fountain']],
    ['a second flag smuggled onto a convert after --library',
      [...argv.convert(D), '--preview-html', '/anywhere.html']],
    ['--output instead of -o', [...argv.convert(D), '--output', '/x.epub']],
    ['--output= form', [...argv.convert(D), '--output=/x.epub']],
    ['-o glued to its value', [...argv.convert(D), '-o/x.epub']],
    ['a repeated -o', [F, '--json', '--preview-inline', '-o', E, '-o', '/x.epub', '--options-json', '{}']],
    // The point of this one IS that it is missing --progress/--preview-inline/
    // --library, so it stays a hand-written short call rather than a full
    // argv.convert() plus an addition.
    ['a convert without --library, which would write into tests/fixtures', [D, '--json']],
    ['an unknown flag after --library', [...argv.convert(D), '--options', '/any/file']],
    ['a flag smuggled onto a reconvert after --options-json',
      [...argv.reconvert(F, E, '{}'), '--output=/x.epub']],
    ['a .. escape out of the library', argv.settings(`${ctx.library}/../../../Users/me/x.fountain`)],
    ['a relative demo path', argv.convert('tests/fixtures/field-station.pdf')],
    ['a relative settings path', argv.settings('field-station/x.fountain')],
    ['flag-first', ['--json', 'settings', F]],
    ['update-decision', ['update-decision', '--offered', '1', '--current', '0']],
    ['update-should-check', ['update-should-check', '--json']],
    ['extra args on version', ['--version', '--json', '--debug']],
  ];

  test('it refuses any call whose whole shape the window would not actually produce', () => {
    for (const [label, args] of REFUSALS) {
      const a = gateEngineCall(args, ctx);
      expect(`${label}: ${a.allow}`).toBe(`${label}: false`);
    }
  });

  test('it allows every shape the window really sends on the way to a picture', () => {
    const ALLOWS: string[][] = [
      argv.convert(D, { force: true }),
      argv.convert(D, { optionsJson: '{"a":1}' }),
      argv.convert(D, { force: true, optionsJson: '{}' }),
      argv.settings(F, '{"a":1}'),
    ];
    for (const args of ALLOWS) {
      expect(gateEngineCall(args, ctx)).toEqual({ allow: true });
    }
  });
});

describe('the window page the capture serves', () => {
  const real = readFileSync(join(ROOT, 'desktop', 'ui', 'index.html'), 'utf8');
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

  test('a value cannot close the <script> early, or be read as a replace() substitution pattern', () => {
    const evil = { shot: '</script><script>alert(1)</script>', demoPdf: '/Users/a$&b/demo.pdf' };
    const out = captureIndex(real, evil);
    expect(out).toContain('/Users/a$&b/demo.pdf');
    expect(out).not.toContain('</script><script>alert');
  });

  test('a <head> with attributes is not recognised, and fails loudly rather than skip the insert', () => {
    const html = '<html><head lang="en"></head><body>' +
      '<script type="module" src="main.js"></script></body></html>';
    expect(() => captureIndex(html, cfg)).toThrow(/no <head>/);
  });
});

describe('nothing from the capture ships in the window', () => {
  test('no file in desktop/ui knows the capture tool exists', () => {
    const ui = join(ROOT, 'desktop', 'ui');
    for (const f of readdirSync(ui)) {
      if (!/\.(js|html|css)$/.test(f)) continue;
      const text = readFileSync(join(ui, f), 'utf8');
      expect(`${f}: ${/__CAPTURE__|__captureState|tools\/capture/.test(text)}`).toBe(`${f}: false`);
    }
  });
});

describe('the shot list', () => {
  test('the four README pictures, with light and dark for the window ones', () => {
    expect(SHOTS.map((s) => s.name)).toEqual(['hero', 'drop', 'result', 'read']);
    for (const s of SHOTS) {
      expect(s.themes).toEqual(s.kind === 'window' ? ['light', 'dark'] : ['light']);
    }
  });

  test('the window pictures are the window’s own size', () => {
    // tauri.conf.json's window is 860 by 620.
    const conf = JSON.parse(readFileSync(join(ROOT, 'desktop', 'src-tauri', 'tauri.conf.json'), 'utf8'));
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
    const dir = mkdtempSync(join(tmpdir(), 'screepub-capture-'));
    try {
      const path = join(dir, 'x.png');
      expect(writeIfChanged(path, new Uint8Array([1, 2, 3]))).toBe('written');
      expect(writeIfChanged(path, new Uint8Array([1, 2, 3]))).toBe('unchanged');
      expect(writeIfChanged(path, new Uint8Array([1, 2, 4]))).toBe('written');
      expect([...readFileSync(path)]).toEqual([1, 2, 4]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
