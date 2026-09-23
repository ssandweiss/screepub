// Headless Chrome, driven over the DevTools protocol with Bun's built-in
// WebSocket. No dependency.
//
// Why not `chrome --screenshot`: it photographs whatever is on screen when
// its time budget runs out, including a failed state. This waits for the
// page to say `ready` or `failed` first. Measured 2026-09-22; see the
// auto-memory note headless-chrome-capture.
//
// Every way this can go wrong ends with Chrome stopped and its profile
// folder removed: a launch that fails part-way cleans up before it throws,
// a request Chrome never answers times out, and a connection that drops
// fails every request waiting on it at once rather than leaving them hung.

import type { Subprocess } from 'bun';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

/** sRGB, so a picture's colours do not follow the display profile of the
 *  Mac that took it; no first-run, background networking or component
 *  updates, so nothing runs but the page. */
export const CHROME_FLAGS = [
  '--headless', '--disable-gpu', '--hide-scrollbars', '--force-color-profile=srgb',
  '--no-first-run', '--disable-background-networking', '--disable-component-update',
  '--remote-debugging-port=0',
];

/** How long Chrome has to answer one protocol request. */
export const REQUEST_TIMEOUT_MS = 15_000;

/** How long a page has to say `ready` or `failed`. Longer than the step
 *  runner's own budget (the read shot waits on four steps of up to 30 s
 *  each), so a page that gives up says why before this gives up on it. */
export const CAPTURE_TIMEOUT_MS = 150_000;

export interface CaptureOptions {
  url: string;
  width: number;
  height: number;
  theme: 'light' | 'dark';
  transparent: boolean;
}

export interface Browser {
  /** What Chrome calls itself, e.g. HeadlessChrome/153.0.0.0. */
  version: string;
  capture(opts: CaptureOptions): Promise<Uint8Array>;
  close(): Promise<void>;
}

/** Resolves true if `p` settles within `ms`, false if it does not. */
async function settles(p: Promise<unknown>, ms: number): Promise<boolean> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<false>((r) => { timer = setTimeout(() => r(false), ms); });
  try {
    return await Promise.race([p.then(() => true, () => true), late]);
  } finally {
    clearTimeout(timer);
  }
}

async function debuggingPort(profile: string, proc: Subprocess, chrome: string): Promise<string> {
  for (let i = 0; i < 150; i++) {
    if (proc.exitCode !== null || proc.signalCode !== null) {
      throw new Error(`capture: Chrome at ${chrome} exited (${proc.exitCode ?? proc.signalCode}) ` +
        'before it opened its debugging port');
    }
    try {
      const port = readFileSync(join(profile, 'DevToolsActivePort'), 'utf8').split('\n')[0]?.trim();
      if (port) return port;
    } catch {
      // not written yet
    }
    await Bun.sleep(100);
  }
  throw new Error(`capture: Chrome at ${chrome} did not open its debugging port within 15 s`);
}

interface Target {
  type: string;
  webSocketDebuggerUrl?: string;
}

/** The page to drive: the one Chrome opened, or a new one if it lists none
 *  (the list can be empty for a moment after the port opens). */
async function pageTarget(port: string): Promise<string> {
  const at = (path: string, init: RequestInit = {}) =>
    fetch(`http://127.0.0.1:${port}${path}`, { ...init, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
  for (let i = 0; i < 20; i++) {
    try {
      const list = (await (await at('/json/list')).json()) as Target[];
      const page = list.find((t) => t.type === 'page' && t.webSocketDebuggerUrl);
      if (page?.webSocketDebuggerUrl) return page.webSocketDebuggerUrl;
    } catch {
      // not answering yet
    }
    await Bun.sleep(100);
  }
  const made = (await (await at('/json/new?about:blank', { method: 'PUT' })).json()) as Target;
  if (!made.webSocketDebuggerUrl) throw new Error('capture: Chrome has no page to drive and would not open one');
  return made.webSocketDebuggerUrl;
}

interface Session {
  send(method: string, params?: object): Promise<any>;
  closed(): boolean;
  close(): void;
}

async function connect(url: string): Promise<Session> {
  const ws = new WebSocket(url);
  const pending = new Map<number, {
    method: string;
    resolve: (v: any) => void;
    reject: (e: Error) => void;
    timer: ReturnType<typeof setTimeout>;
  }>();
  let gone: string | null = null;
  // A dropped connection fails everything waiting on it now, not after
  // each request's own timeout.
  const shut = (why: string) => {
    gone ??= why;
    for (const p of pending.values()) {
      clearTimeout(p.timer);
      p.reject(new Error(`capture: ${p.method}: ${gone}`));
    }
    pending.clear();
  };
  ws.addEventListener('message', (e) => {
    const m = JSON.parse(String(e.data)) as { id?: number; result?: unknown; error?: { message: string } };
    const p = m.id === undefined ? undefined : pending.get(m.id);
    if (!p || m.id === undefined) return;
    pending.delete(m.id);
    clearTimeout(p.timer);
    if (m.error) p.reject(new Error(`capture: ${p.method}: ${m.error.message}`));
    else p.resolve(m.result);
  });
  ws.addEventListener('close', () => shut("Chrome's debugging connection closed"));
  ws.addEventListener('error', () => shut("Chrome's debugging connection failed"));

  const opened = new Promise<void>((resolve, reject) => {
    ws.addEventListener('open', () => resolve(), { once: true });
    ws.addEventListener('error', () => reject(new Error("capture: could not open Chrome's debugging connection")), { once: true });
    ws.addEventListener('close', () => reject(new Error('capture: Chrome closed its debugging connection before it opened')), { once: true });
  });
  if (!(await settles(opened, REQUEST_TIMEOUT_MS))) {
    ws.close();
    throw new Error(`capture: Chrome's debugging connection did not open within ${REQUEST_TIMEOUT_MS / 1000} s`);
  }
  await opened;

  let id = 0;
  return {
    send(method, params = {}) {
      if (gone !== null) return Promise.reject(new Error(`capture: ${method}: ${gone}`));
      return new Promise((resolve, reject) => {
        const n = ++id;
        const timer = setTimeout(() => {
          pending.delete(n);
          reject(new Error(`capture: ${method}: no answer from Chrome within ${REQUEST_TIMEOUT_MS / 1000} s`));
        }, REQUEST_TIMEOUT_MS);
        pending.set(n, { method, resolve, reject, timer });
        ws.send(JSON.stringify({ id: n, method, params }));
      });
    },
    closed: () => gone !== null,
    close: () => ws.close(),
  };
}

/** SIGTERM, then SIGKILL if Chrome is still there after five seconds. */
async function stop(proc: Subprocess): Promise<void> {
  if (proc.exitCode === null && proc.signalCode === null) proc.kill('SIGTERM');
  if (await settles(proc.exited, 5_000)) return;
  proc.kill('SIGKILL');
  await proc.exited;
}

/** Chrome's helper processes can still be writing into the profile for a
 *  moment after the browser exits, so a failed removal is tried again. */
async function removeProfile(profile: string): Promise<void> {
  for (let attempt = 1; ; attempt++) {
    try {
      rmSync(profile, { recursive: true, force: true });
      return;
    } catch (e) {
      if (attempt >= 5) throw e;
      await Bun.sleep(200);
    }
  }
}

export async function launch(chrome: string = CHROME): Promise<Browser> {
  const profile = mkdtempSync(join(tmpdir(), 'screepub-capture-chrome-'));
  let proc: Subprocess;
  try {
    // Bun.spawn, never spawnSync: the process that serves the pages is this
    // one, and a blocking spawn leaves Chrome waiting on a server that
    // cannot answer. Measured; it hangs.
    proc = Bun.spawn([chrome, ...CHROME_FLAGS, `--user-data-dir=${profile}`, 'about:blank'], {
      stdin: 'ignore', stdout: 'ignore', stderr: 'ignore',
    });
  } catch (e) {
    rmSync(profile, { recursive: true, force: true });
    throw e;
  }

  let session: Session | null = null;
  let closing: Promise<void> | null = null;
  const close = () => (closing ??= (async () => {
    try {
      session?.close();
    } catch {
      // already gone
    }
    await stop(proc);
    await removeProfile(profile);
  })());

  try {
    const port = await debuggingPort(profile, proc, chrome);
    session = await connect(await pageTarget(port));
    const cdp = session;
    const { product } = (await cdp.send('Browser.getVersion')) as { product: string };

    return {
      version: product,
      async capture({ url, width, height, theme, transparent }) {
        await cdp.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 2, mobile: false });
        await cdp.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: theme }] });
        await cdp.send('Emulation.setDefaultBackgroundColorOverride',
          transparent ? { color: { r: 0, g: 0, b: 0, a: 0 } } : {});
        // The page being left may still say `ready`. Cleared first, so a
        // poll that lands before the new page takes over reads "not yet"
        // rather than photographing the old page.
        await cdp.send('Runtime.evaluate', {
          expression: 'delete window.__captureState; delete window.__captureError',
        });
        const nav = (await cdp.send('Page.navigate', { url })) as { errorText?: string };
        if (nav?.errorText) throw new Error(`capture: Chrome could not load ${url}: ${nav.errorText}`);

        const start = Date.now();
        let state = '';
        while (Date.now() - start < CAPTURE_TIMEOUT_MS) {
          let r: { result?: { value?: string } };
          try {
            r = await cdp.send('Runtime.evaluate', {
              expression: 'JSON.stringify([window.__captureState, window.__captureError])',
              returnByValue: true,
            });
          } catch (e) {
            // A page mid-navigation can refuse one evaluation; a dead
            // connection refuses them all.
            if (cdp.closed()) throw e;
            await Bun.sleep(100);
            continue;
          }
          const [s, err] = JSON.parse(r.result?.value ?? '[]') as [string?, string?];
          state = s ?? '';
          if (state === 'failed') throw new Error(`capture failed at ${url}: ${err}`);
          if (state === 'ready') break;
          await Bun.sleep(100);
        }
        if (state !== 'ready') {
          throw new Error(`capture timed out at ${url} after ${CAPTURE_TIMEOUT_MS / 1000} s ` +
            `(last state: ${state || 'none'})`);
        }
        const shot = (await cdp.send('Page.captureScreenshot', { format: 'png' })) as { data: string };
        return new Uint8Array(Buffer.from(shot.data, 'base64'));
      },
      close,
    };
  } catch (error) {
    await close().catch(() => {});
    throw error;
  }
}
