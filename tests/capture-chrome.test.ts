// The capture tool's Chrome driver, against a fake Chrome: a shell script
// that writes DevToolsActivePort (tests/fixtures/fake-chrome/chrome.sh) and
// a fake DevTools server here that answers, or misbehaves, on cue. The real
// tools/capture/cdp.ts runs unchanged, so its failure paths (a Chrome that
// dies at start, one that lists no page, a connection that drops) are
// exercised without a real Chrome or /Users/Shared. A few seconds.
import { afterEach, describe, test, expect } from 'bun:test';
import { chmodSync, copyFileSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { launch } from '../tools/capture/cdp';
import { runCapture } from '../tools/capture/run';
import { SHOTS } from '../tools/capture/shots';

const ROOT = join(import.meta.dir, '..');
const SCRIPT = join(ROOT, 'tests', 'fixtures', 'fake-chrome', 'chrome.sh');
const PNG = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);

const profiles = () => new Set(readdirSync(tmpdir()).filter((n) => n.startsWith('screepub-capture-chrome-')));

interface Fake {
  /** /json/list answers with the page (default) or, false, with none. */
  listed?: boolean;
  /** The DevTools method on which the fake drops the connection. */
  dropOn?: string;
  /** What the page says when asked whether it is ready. */
  state?: 'ready' | 'working';
  /** What "loading" a page does; a real Chrome fetches it. */
  navigate?: (url: string) => Promise<unknown>;
}

const cleanups: (() => void)[] = [];
afterEach(() => {
  for (const c of cleanups.splice(0)) c();
});

/** A fake Chrome and its DevTools server. Returns the path to launch. */
function fakeChrome(o: Fake = {}, { die = false } = {}) {
  const log: string[] = [];
  const server = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    fetch(req, srv) {
      const u = new URL(req.url);
      const page = { type: 'page', webSocketDebuggerUrl: `ws://127.0.0.1:${srv.port}/devtools/page/1` };
      if (u.pathname === '/json/list') {
        log.push('list');
        return Response.json(o.listed === false ? [] : [page]);
      }
      if (u.pathname === '/json/new') {
        log.push(`new ${req.method}`);
        return req.method === 'PUT' ? Response.json(page) : new Response('', { status: 405 });
      }
      if (u.pathname === '/devtools/page/1' && srv.upgrade(req)) return undefined;
      return new Response('', { status: 404 });
    },
    websocket: {
      async message(ws, raw) {
        const m = JSON.parse(String(raw)) as { id: number; method: string; params?: Record<string, any> };
        log.push(m.method);
        const reply = (result: unknown): void => {
          ws.send(JSON.stringify({ id: m.id, result }));
        };
        if (m.method === o.dropOn) {
          ws.close();
          return;
        }
        switch (m.method) {
          case 'Browser.getVersion':
            return reply({ product: 'Chrome/0.0.0.0-fake' });
          case 'Page.navigate':
            await o.navigate?.(m.params!.url);
            return reply({ frameId: 'fake' });
          case 'Runtime.evaluate':
            return String(m.params!.expression).startsWith('JSON.stringify')
              ? reply({ result: { type: 'string', value: JSON.stringify([o.state ?? 'ready']) } })
              : reply({ result: { type: 'boolean', value: true } });
          case 'Page.captureScreenshot':
            return reply({ data: Buffer.from(PNG).toString('base64') });
          default:
            return reply({});
        }
      },
    },
  });
  const dir = mkdtempSync(join(tmpdir(), 'screepub-fake-chrome-'));
  const chrome = join(dir, 'chrome.sh');
  copyFileSync(SCRIPT, chrome);
  chmodSync(chrome, 0o755);
  writeFileSync(join(dir, 'port'), String(server.port));
  if (die) writeFileSync(join(dir, 'die'), '');
  cleanups.push(() => {
    server.stop(true);
    rmSync(dir, { recursive: true, force: true });
  });
  return { chrome, log };
}

const SHOT = { url: 'http://127.0.0.1:1/page', width: 10, height: 10, theme: 'light' as const, transparent: false };

async function rejection(p: Promise<unknown>): Promise<Error> {
  try {
    await p;
  } catch (e) {
    return e as Error;
  }
  throw new Error('expected a rejection');
}

describe('the Chrome driver, against a fake Chrome', () => {
  test('a Chrome that lists no page gets one opened, and a ready page is photographed', async () => {
    const before = profiles();
    const fake = fakeChrome({ listed: false });
    const browser = await launch(fake.chrome);
    try {
      expect(browser.version).toBe('Chrome/0.0.0.0-fake');
      expect(fake.log).toContain('new PUT');
      expect([...(await browser.capture(SHOT))]).toEqual([...PNG]);
    } finally {
      await browser.close();
    }
    expect([...profiles()].filter((p) => !before.has(p))).toEqual([]);
  });

  test('a connection dropped on navigate fails the capture at once, and close still cleans up', async () => {
    const before = profiles();
    const fake = fakeChrome({ dropOn: 'Page.navigate' });
    const browser = await launch(fake.chrome);
    const start = Date.now();
    const err = await rejection(browser.capture(SHOT));
    // Well inside the 15 s a single request may take.
    expect(Date.now() - start).toBeLessThan(3000);
    expect(err.message).toContain('Page.navigate');
    expect(err.message).toContain('connection closed');
    await browser.close();
    expect([...profiles()].filter((p) => !before.has(p))).toEqual([]);
  });

  test('a Chrome that exits at start fails the launch at once, naming it, and leaves no profile', async () => {
    const before = profiles();
    const fake = fakeChrome({}, { die: true });
    const start = Date.now();
    const err = await rejection(launch(fake.chrome));
    expect(Date.now() - start).toBeLessThan(3000);
    expect(err.message).toContain('exited (3) before it opened its debugging port');
    expect([...profiles()].filter((p) => !before.has(p))).toEqual([]);
  });

  test('a failure the caller reports ends the wait at once; a timeout names what the server lacked', async () => {
    const before = profiles();
    const fake = fakeChrome({ state: 'working' });
    const browser = await launch(fake.chrome);
    try {
      const start = Date.now();
      const failed = await rejection(browser.capture({
        ...SHOT, failure: () => 'the page server failed: boom',
      }));
      expect(Date.now() - start).toBeLessThan(3000);
      expect(failed.message).toContain('the page server failed: boom');

      const late = await rejection(browser.capture({
        ...SHOT, timeoutMs: 300, explain: () => 'not found: /tools/capture/bridge.js',
      }));
      expect(late.message).toContain('timed out');
      expect(late.message).toContain('not found: /tools/capture/bridge.js');
    } finally {
      await browser.close();
    }
    expect([...profiles()].filter((p) => !before.has(p))).toEqual([]);
  });
});

describe('a capture run, against a fake Chrome', () => {
  test('a page server that throws fails the run at once, naming the error, not as a timeout', async () => {
    // A window whose index.html no longer loads main.js exactly once: the
    // server's handler throws on it. Without the catch, Bun answers with a
    // 67 KB HTML error page, the page never says ready, and all the run
    // could report after 150 s is "timed out".
    const dir = mkdtempSync(join(tmpdir(), 'screepub-capture-test-'));
    cleanups.push(() => rmSync(dir, { recursive: true, force: true }));
    const repo = join(dir, 'repo');
    mkdirSync(join(repo, 'desktop', 'ui'), { recursive: true });
    writeFileSync(join(repo, 'desktop', 'ui', 'index.html'), '<html><head></head><body>no script</body></html>');
    const tmp = join(dir, 'tmp');
    mkdirSync(tmp);

    const before = profiles();
    // A real Chrome loads the page it is sent to; so does this fake.
    const fake = fakeChrome({ state: 'working', navigate: (url) => fetch(url).then((r) => r.text()) });
    const start = Date.now();
    const err = await rejection(runCapture({
      shots: SHOTS.filter((s) => s.name === 'drop'),
      repoDir: repo,
      demoPdf: join(repo, 'demo.pdf'),
      library: join(dir, 'Documents', 'Screepub'),
      launch: () => launch(fake.chrome),
      engine: ['false'],
      outDir: join(dir, 'out'),
      tmp,
      log: () => {},
    }));
    expect(Date.now() - start).toBeLessThan(5000);
    expect(err.message).toContain('main.js exactly once');
    expect(err.message).not.toContain('timed out');
    expect(readdirSync(tmp)).toEqual([]);
    expect(readdirSync(dir).sort()).toEqual(['repo', 'tmp']);
    expect([...profiles()].filter((p) => !before.has(p))).toEqual([]);
  });
});
