// Headless Chrome, driven over the DevTools protocol with Bun's built-in
// WebSocket. No dependency.
//
// Why not `chrome --screenshot`: it photographs whatever is on screen when
// its time budget runs out, including a failed state. This waits for the
// page to say `ready` or `failed` first. Measured 2026-09-22; see the
// auto-memory note headless-chrome-capture.

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
