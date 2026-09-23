// The capture tool's pure parts. The picture-taking itself needs Chrome and
// runs in /release; everything that DECIDES something is tested here.
import { describe, test, expect } from 'bun:test';
import { gateEngineCall } from '../tools/capture/gate';
// @ts-expect-error -- plain JS module, no types
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
