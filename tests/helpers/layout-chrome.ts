// A headless Chrome page a test can resize and ask questions of.
//
// tools/capture/cdp.ts launches Chrome the same way but only exports
// "navigate, wait for ready, take a picture": a layout test needs to run its
// own script on the page (Runtime.evaluate) and change the viewport without
// reloading. So this is the minimal protocol glue for that, built on the
// capture tool's own Chrome path and flags, so both drive the same browser.
//
// Bun.spawn only, never a blocking spawn: the page server runs in this same
// process, and Chrome waiting on a server that cannot answer hangs.

import type { Subprocess } from 'bun';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CHROME, CHROME_FLAGS, REQUEST_TIMEOUT_MS, settles } from '../../tools/capture/cdp';

export interface LayoutPage {
  /** One protocol call on the page. */
  send(method: string, params?: object): Promise<any>;
  /** Evaluate an expression in the page and return its JSON value. A
   *  promise is awaited. A thrown error rejects with its message. */
  evaluate<T = unknown>(expression: string): Promise<T>;
  /** Chrome stopped and its profile folder removed. Safe to call twice. */
  close(): Promise<void>;
}

async function debuggingPort(profile: string, proc: Subprocess): Promise<string> {
  for (let i = 0; i < 150; i++) {
    if (proc.exitCode !== null || proc.signalCode !== null) {
      throw new Error(`layout: Chrome exited (${proc.exitCode ?? proc.signalCode}) before opening its port`);
    }
    try {
      const port = readFileSync(join(profile, 'DevToolsActivePort'), 'utf8').split('\n')[0]?.trim();
      if (port) return port;
    } catch {
      // not written yet
    }
    await Bun.sleep(100);
  }
  throw new Error('layout: Chrome did not open its debugging port within 15 s');
}

async function pageSocket(port: string): Promise<string> {
  for (let i = 0; i < 50; i++) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/json/list`, { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
      const list = (await res.json()) as { type: string; webSocketDebuggerUrl?: string }[];
      const page = list.find((t) => t.type === 'page' && t.webSocketDebuggerUrl);
      if (page?.webSocketDebuggerUrl) return page.webSocketDebuggerUrl;
    } catch {
      // not answering yet
    }
    await Bun.sleep(100);
  }
  throw new Error('layout: Chrome listed no page to drive');
}

export async function launchLayoutPage(chrome: string = CHROME): Promise<LayoutPage> {
  const profile = mkdtempSync(join(tmpdir(), 'screepub-layout-chrome-'));
  const proc = Bun.spawn([chrome, ...CHROME_FLAGS, `--user-data-dir=${profile}`, 'about:blank'], {
    stdin: 'ignore', stdout: 'ignore', stderr: 'ignore',
  });
  let ws: WebSocket | null = null;
  let closing: Promise<void> | null = null;
  const close = () => (closing ??= (async () => {
    try {
      ws?.close();
    } catch {
      // already gone
    }
    if (proc.exitCode === null && proc.signalCode === null) proc.kill('SIGTERM');
    if (!(await settles(proc.exited, 5_000))) {
      proc.kill('SIGKILL');
      await proc.exited;
    }
    // Chrome's helpers can still be writing for a moment after it exits.
    for (let attempt = 1; ; attempt++) {
      try {
        rmSync(profile, { recursive: true, force: true });
        return;
      } catch (e) {
        if (attempt >= 5) throw e;
        await Bun.sleep(200);
      }
    }
  })());

  try {
    const url = await pageSocket(await debuggingPort(profile, proc));
    const socket = new WebSocket(url);
    ws = socket;
    const pending = new Map<number, { resolve: (v: any) => void; reject: (e: Error) => void }>();
    socket.addEventListener('message', (e) => {
      const m = JSON.parse(String(e.data)) as { id?: number; result?: unknown; error?: { message: string } };
      const p = m.id === undefined ? undefined : pending.get(m.id);
      if (!p || m.id === undefined) return;
      pending.delete(m.id);
      if (m.error) p.reject(new Error(`layout: ${m.error.message}`));
      else p.resolve(m.result);
    });
    socket.addEventListener('close', () => {
      for (const p of pending.values()) p.reject(new Error('layout: Chrome closed the connection'));
      pending.clear();
    });
    const opened = new Promise<void>((resolve, reject) => {
      socket.addEventListener('open', () => resolve(), { once: true });
      socket.addEventListener('error', () => reject(new Error('layout: could not connect to Chrome')), { once: true });
    });
    if (!(await settles(opened, REQUEST_TIMEOUT_MS))) throw new Error('layout: Chrome connection did not open');
    await opened;

    let id = 0;
    const send = (method: string, params: object = {}) => new Promise<any>((resolve, reject) => {
      const n = ++id;
      const timer = setTimeout(() => {
        pending.delete(n);
        reject(new Error(`layout: ${method}: no answer within ${REQUEST_TIMEOUT_MS / 1000} s`));
      }, REQUEST_TIMEOUT_MS);
      pending.set(n, {
        resolve: (v) => { clearTimeout(timer); resolve(v); },
        reject: (e) => { clearTimeout(timer); reject(e); },
      });
      socket.send(JSON.stringify({ id: n, method, params }));
    });
    const evaluate = async <T>(expression: string): Promise<T> => {
      const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
      if (r.exceptionDetails) {
        throw new Error(`layout: page script failed: ${r.exceptionDetails.exception?.description ?? r.exceptionDetails.text}`);
      }
      return r.result?.value as T;
    };
    return { send, evaluate, close };
  } catch (error) {
    await close().catch(() => {});
    throw error;
  }
}
