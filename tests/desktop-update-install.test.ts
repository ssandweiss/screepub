// Once an update is installed, the old window must not drive the new engine.
//
// tauri-plugin-updater 2.12.0 moves the new bundle into the running app's
// own path, and the shell resolves the engine sidecar from that path on every
// spawn. So from the moment downloadAndInstall succeeds, every engine call
// this window starts runs the NEW engine with the OLD window's argv and JSON
// expectations. These tests drive the real app.js, update.js, update-flow.js
// and notes-surface.js with a stubbed window.__TAURI__ and injected fakes.
//
// app.js is a module singleton shared by every test file in the run, so
// every test here stubs its own window and removes it afterwards, and
// releases anything it holds.
import { describe, test, expect } from 'bun:test';
import { join } from 'node:path';

const UI = join(new URL('..', import.meta.url).pathname, 'desktop', 'ui');
const g = globalThis as unknown as { window?: unknown; localStorage?: unknown };

const store = (seed: Record<string, string> = {}) => {
  const map = new Map(Object.entries(seed));
  return {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => { map.set(k, String(v)); },
  };
};

const tick = () => new Promise((r) => setTimeout(r, 0));
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** This file's own copy of app.js. bun shares one module instance across
 *  test files, so the shared app.js carries whatever an earlier file left
 *  running or held; on Linux CI an earlier file left it busy and every
 *  whenIdle() here waited out its 5 s timeout (2026-10-01). The query makes
 *  a fresh instance, shared by the tests in this file only. */
const APP = `${join(UI, 'app.js')}?desktop-update-install`;

describe('after an install, the window starts no new engine call', () => {
  test('a counted call is refused with words for a reader and never reaches the shell', async () => {
    const app = await import(APP);
    await app.whenIdle();
    const asked: unknown[] = [];
    g.window = { __TAURI__: { core: { invoke: async (_c: string, a: unknown) => { asked.push(a); return '{"ok":true}'; } } } };
    try {
      app.retireEngine();
      let message = '';
      await app.runEngine(['send', 'x.epub', '--json']).catch((e: Error) => { message = e.message; });
      expect(message).toBe(app.UPDATED_MESSAGE);
      expect(message).toContain('updated');
      expect(message).toContain('Restart');
      expect(message).not.toContain('—');
      expect(asked).toEqual([]);
      expect(app.engineBusy()).toBe(false);
    } finally {
      delete g.window;
    }
  });

  test('the reads that do not count are refused too: their argv and JSON can change just the same', async () => {
    const app = await import(APP);
    const asked: unknown[] = [];
    g.window = { __TAURI__: { core: { invoke: async (_c: string, a: unknown) => { asked.push(a); return '{"ok":true}'; } } } };
    try {
      app.retireEngine();
      for (const args of [app.argv.routes('x.epub'), app.argv.devices(), app.argv.kfxStatus(), app.argv.appSettings()]) {
        let message = '';
        await app.runEngine(args).catch((e: Error) => { message = e.message; });
        expect(`${args[0]}: ${message}`).toBe(`${args[0]}: ${app.UPDATED_MESSAGE}`);
      }
      expect(asked).toEqual([]);
    } finally {
      delete g.window;
    }
  });

  test('a call already running when the install lands finishes, with its own answer', async () => {
    const app = await import(APP);
    await app.whenIdle();
    let answer: (v: string) => void = () => {};
    g.window = { __TAURI__: { core: { invoke: () => new Promise<string>((r) => { answer = r; }) } } };
    try {
      const running = app.runEngine(['send', 'x.epub', '--json']);
      expect(app.engineBusy()).toBe(true);
      app.retireEngine();
      answer('{"ok":true,"sent":1}');
      expect(await running).toEqual({ ok: true, sent: 1 });
      expect(app.engineBusy()).toBe(false);
    } finally {
      delete g.window;
    }
  });

  test('the retirement belongs to the shell whose bundle was swapped, not to every shell this module ever sees', async () => {
    // One window has one __TAURI__ for its whole life, so in the app this is
    // the same as a plain flag. It matters because this module is imported
    // once per test process: a retirement from one stubbed shell must not
    // refuse calls in the next.
    const app = await import(APP);
    g.window = { __TAURI__: { core: { invoke: async () => '{"ok":true}' } } };
    app.retireEngine();
    g.window = { __TAURI__: { core: { invoke: async () => '{"ok":true}' } } };
    try {
      expect(await app.runEngine(['--version', '--json'])).toEqual({ ok: true });
    } finally {
      delete g.window;
    }
  });
});

describe('installAndRestart retires the engine and does not wait forever', () => {
  const liveOffer = () => ({
    outcome: 'offer', version: '0.8.0', body: '',
    update: { version: '0.8.0', currentVersion: '0.7.2' },
  });

  function deps(over: Record<string, unknown> = {}) {
    const phases: any[] = [];
    const calls = { install: 0, restart: 0, retire: 0, order: [] as string[] };
    const base = {
      offer: liveOffer(),
      storage: store({ updateOptIn: 'true' }),
      now: 1,
      check: async () => null,
      install: async () => { calls.install += 1; calls.order.push('install'); },
      busy: () => false,
      whenIdle: async () => { calls.order.push('whenIdle'); },
      restartReady: () => true,
      restart: async () => { calls.restart += 1; },
      retire: () => { calls.retire += 1; calls.order.push('retire'); },
      onPhase: (phase: unknown) => { phases.push(phase); },
    };
    return { args: { ...base, ...over }, phases, calls };
  }

  test('the engine is retired the moment the install succeeds, before any waiting', async () => {
    const { args, calls } = deps();
    const update = await import(join(UI, 'update.js'));
    const outcome = await update.installAndRestart(args);
    expect(outcome.outcome).toBe('restarting');
    expect(calls.order).toEqual(['install', 'retire', 'whenIdle']);
  });

  test('a build that cannot restart is still retired: its bundle is swapped all the same', async () => {
    const { args, calls, phases } = deps({ restartReady: () => false });
    const update = await import(join(UI, 'update.js'));
    const outcome = await update.installAndRestart(args);
    expect(outcome.outcome).toBe('installed');
    expect(calls.retire).toBe(1);
    expect(phases.at(-1).kind).toBe('installed');
  });

  test('a failed install retires nothing: the old bundle is still the one on disk', async () => {
    const { args, calls } = deps({ install: async () => { throw new Error('no network'); } });
    const update = await import(join(UI, 'update.js'));
    const outcome = await update.installAndRestart(args);
    expect(outcome.outcome).toBe('error');
    expect(calls.retire).toBe(0);
  });

  test('a wait past the cap stops, offers "Restart now", and restarts nothing on its own', async () => {
    const { args, calls, phases } = deps({
      busy: () => true,
      whenIdle: () => new Promise(() => {}),
      waitCap: 20,
    });
    const update = await import(join(UI, 'update.js'));
    const outcome = await update.installAndRestart(args);
    expect(outcome.outcome).toBe('stalled');
    expect(outcome.offer).toBe(args.offer);
    expect(phases.map((p) => p.kind)).toEqual(['downloading', 'waiting', 'stalled']);
    expect(update.updateLabel(phases.at(-1))).toBe('Restart now');
    expect(calls.restart).toBe(0);
  });

  test('an engine that goes quiet inside the cap restarts as before, and the cap never fires afterwards', async () => {
    let quiet: () => void = () => {};
    const { args, calls, phases } = deps({
      busy: () => true,
      whenIdle: () => new Promise<void>((r) => { quiet = r; }),
      waitCap: 40,
    });
    const update = await import(join(UI, 'update.js'));
    const run = update.installAndRestart(args);
    await tick();
    quiet();
    const outcome = await run;
    expect(outcome.outcome).toBe('restarting');
    expect(calls.restart).toBe(1);
    await sleep(60);
    expect(phases.map((p) => p.kind)).toEqual(['downloading', 'waiting', 'restarting']);
  });

  test('the cap defaults to two minutes', async () => {
    const update = await import(join(UI, 'update.js'));
    expect(update.RESTART_WAIT_CAP_MS).toBe(120_000);
  });

  test('"Restart now" is its own moment: a click acts on it, and its words carry no em dash', async () => {
    const update = await import(join(UI, 'update.js'));
    const phase = { kind: 'stalled', version: '0.8.0' };
    expect(update.labelActionable(phase)).toBe(true);
    expect(update.updateLabel(phase)).not.toContain('—');
    // The moments around it are unchanged.
    expect(update.labelActionable({ kind: 'waiting' })).toBe(false);
    expect(update.labelActionable({ kind: 'installed', version: '0.8.0' })).toBe(false);
    expect(update.updateLabel({ kind: 'installed', version: '0.8.0' })).toBe(update.installedLine('0.8.0'));
  });
});

describe('the flow: a click on "Restart now" restarts, it does not reinstall', () => {
  async function make(over: Record<string, unknown> = {}) {
    const flowMod = await import(join(UI, 'update-flow.js'));
    const calls = { install: 0, restart: 0 };
    const s = store({ updateOptIn: 'true', updateAsked: 'true' });
    const flow = flowMod.createUpdateFlow({
      usable: () => true,
      now: () => 1,
      check: async () => null,
      install: async () => { calls.install += 1; },
      busy: () => true,
      whenIdle: () => new Promise(() => {}),
      restartReady: () => true,
      restart: async () => { calls.restart += 1; },
      retire: () => {},
      waitCap: 10,
      currentVersion: '0.7.2',
      ...over,
      storage: () => s,
    });
    const seen: any[] = [];
    flow.subscribe((phase: unknown) => seen.push(phase));
    flow.offerFound({ outcome: 'offer', version: '0.8.0', body: '', update: { version: '0.8.0' } });
    return { flow, calls, seen };
  }

  test('stalled, then a click: one restart, no second install', async () => {
    const { flow, calls, seen } = await make();
    await flow.start();
    expect(seen.at(-1).kind).toBe('stalled');
    await flow.start();
    expect(calls.install).toBe(1);
    expect(calls.restart).toBe(1);
    expect(seen.at(-1).kind).toBe('restarting');
  });

  test('a restart that is refused falls back to the quit-and-reopen words', async () => {
    const { flow, calls, seen } = await make({
      restart: async () => { throw new Error('process:allow-restart not granted'); },
    });
    await flow.start();
    await flow.start();
    expect(calls.install).toBe(1);
    expect(seen.at(-1)).toEqual({ kind: 'installed', version: '0.8.0' });
  });

  test('a second click while the restart is under way does nothing', async () => {
    let restarts = 0;
    const { flow, seen } = await make({
      restart: () => { restarts += 1; return new Promise(() => {}); },
    });
    await flow.start();
    flow.start();
    flow.start();
    await tick();
    expect(restarts).toBe(1);
    expect(seen.at(-1).kind).toBe('restarting');
  });
});

describe('the Updates block in the release notes, once the wait is given up', () => {
  test('Install becomes Restart now, ready to click, and a manual check stays off', async () => {
    const notes = await import(join(UI, 'notes-surface.js'));
    const view = notes.notesView({ kind: 'stalled', version: '0.8.0' }, { drewOffer: true, version: '0.8.0', body: 'b' });
    expect(view.install).toEqual({ text: 'Restart now', hidden: false, disabled: false });
    expect(view.checkDisabled).toBe(true);
    expect(view.say).toContain('0.8.0');
    expect(view.say).not.toContain('—');
  });
});

describe('the real app.js and a flow, driven together', () => {
  // The flow is built with createUpdateFlow and app.js's OWN runEngine,
  // whenIdle, engineBusy and retireEngine, against a stubbed shell.
  async function wired(waitCap: number) {
    const app = await import(APP);
    const flowMod = await import(join(UI, 'update-flow.js'));
    await app.whenIdle();
    const asked: string[][] = [];
    const held: Array<(v: string) => void> = [];
    let relaunched = 0;
    g.window = {
      __TAURI__: {
        core: {
          invoke: (_c: string, { args }: { args: string[] }) => {
            asked.push(args);
            return new Promise<string>((r) => held.push(r));
          },
        },
      },
    };
    const s = store({ updateOptIn: 'true', updateAsked: 'true' });
    const flow = flowMod.createUpdateFlow({
      usable: () => true,
      now: () => 1,
      check: async () => null,
      install: async () => {},
      busy: app.engineBusy,
      whenIdle: app.whenIdle,
      restartReady: () => true,
      restart: async () => { relaunched += 1; },
      retire: app.retireEngine,
      waitCap,
      currentVersion: '0.7.2',
      storage: () => s,
    });
    const seen: any[] = [];
    flow.subscribe((phase: unknown) => seen.push(phase));
    flow.offerFound({ outcome: 'offer', version: '0.8.0', body: '', update: { version: '0.8.0' } });
    return { app, flow, asked, held, seen, relaunched: () => relaunched };
  }

  test('during the wait, the running call finishes, a new one is refused, and the restart keeps its quiet period', async () => {
    const { app, flow, asked, held, seen, relaunched } = await wired(60_000);
    try {
      const running = app.runEngine(['send', 'held.epub', '--json']);
      const run = flow.start();
      await tick();
      expect(seen.at(-1).kind).toBe('waiting');

      let message = '';
      await app.runEngine(['export', 'x.epub', '--json', '--for', 'kindle'])
        .catch((e: Error) => { message = e.message; });
      expect(message).toBe(app.UPDATED_MESSAGE);
      expect(asked.length).toBe(1); // only the held call ever reached the shell

      held[0]('{"ok":true}');
      expect(await running).toEqual({ ok: true });
      await tick();
      expect(relaunched()).toBe(0); // the quiet period still applies
      await sleep(app.ENGINE_QUIET_MS + 50);
      await run;
      expect(relaunched()).toBe(1);
    } finally {
      delete g.window;
    }
  });

  test('a dialog still held past the cap gives the reader "Restart now" instead of waiting forever', async () => {
    const { app, flow, seen, relaunched } = await wired(30);
    const release = app.holdEngine();
    try {
      await flow.start();
      expect(seen.map((p) => p?.kind).slice(-2)).toEqual(['waiting', 'stalled']);
      expect(relaunched()).toBe(0);
      await flow.start();
      expect(relaunched()).toBe(1);
    } finally {
      release();
      delete g.window;
    }
  });
});

describe('a failed cleanup after a good install is not a failed update', () => {
  // updateInstall closes the plugin's Update object whatever happened. The
  // bundle is already swapped once downloadAndInstall resolves, so a close()
  // that throws afterwards must not report a failure: that draws "Try again",
  // which reinstalls a bundle already on disk.
  function fakeUpdate(over: Record<string, unknown> = {}) {
    const calls = { download: 0, close: 0 };
    const update = {
      version: '0.8.0',
      currentVersion: '0.7.2',
      downloadAndInstall: async (onEvent: (e: unknown) => void) => {
        calls.download += 1;
        onEvent({ event: 'Finished' });
      },
      close: async () => { calls.close += 1; throw new Error('resource already gone'); },
      ...over,
    };
    return { update, calls };
  }

  async function quietly<T>(run: () => Promise<T>) {
    const logged: unknown[][] = [];
    const original = console.error;
    console.error = (...args: unknown[]) => { logged.push(args); };
    try {
      return { value: await run(), logged };
    } finally {
      console.error = original;
    }
  }

  test('updateInstall resolves when only close() throws, and logs the close error', async () => {
    const app = await import(APP);
    const { update, calls } = fakeUpdate();
    const { logged } = await quietly(() => app.updateInstall(update, () => {}));
    expect(calls).toEqual({ download: 1, close: 1 });
    expect(logged.length).toBe(1);
    expect(String(logged[0].at(-1))).toContain('resource already gone');
  });

  test('a download that fails still fails, and still closes', async () => {
    const app = await import(APP);
    const { update, calls } = fakeUpdate({
      downloadAndInstall: async () => { throw new Error('no network'); },
    });
    let message = '';
    await quietly(() => app.updateInstall(update, () => {}).catch((e: Error) => { message = e.message; }));
    expect(message).toBe('no network');
    expect(calls.close).toBe(1);
  });

  test('through the flow: installed, retired, restarted, and installed once', async () => {
    const app = await import(APP);
    const flowMod = await import(join(UI, 'update-flow.js'));
    const { update, calls } = fakeUpdate();
    let retired = 0;
    let restarted = 0;
    const s = store({ updateOptIn: 'true', updateAsked: 'true' });
    const flow = flowMod.createUpdateFlow({
      usable: () => true,
      now: () => 1,
      check: async () => null,
      install: app.updateInstall,
      busy: () => false,
      whenIdle: async () => {},
      restartReady: () => true,
      restart: async () => { restarted += 1; },
      retire: () => { retired += 1; },
      currentVersion: '0.7.2',
      storage: () => s,
    });
    const seen: any[] = [];
    flow.subscribe((phase: unknown) => seen.push(phase));
    flow.offerFound({ outcome: 'offer', version: '0.8.0', body: '', update });
    await quietly(async () => {
      await flow.start();
      await flow.start(); // a second click must not reinstall
    });
    expect(seen.map((p) => p?.kind)).not.toContain('failed');
    expect(seen.at(-1).kind).toBe('restarting');
    expect(retired).toBe(1);
    expect(restarted).toBe(1);
    expect(calls.download).toBe(1);
  });
});
