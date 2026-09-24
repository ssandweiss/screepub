// `screepub routes` and `screepub route`: the ranked list of every way a
// book can leave, and the verb that performs one of them.
//
// Handlers are driven IN PROCESS with injected facts, a fake Opener that
// records argv, and a settings path inside SCRATCH. Nothing here may open an
// app, a URL or a folder, read the real mail handler, or write the real app
// settings file.
//
// The spawned-CLI tests cover only refusals, --help and `routes` (which is
// read-only). Every spawn gets SCREEPUB_CONFIG_DIR, SCREEPUB_LIBRARY and
// SCREEPUB_VOLUME_ROOTS in SCRATCH, the reMarkable probe pointed at a port
// that refuses at once, and a PATH whose first folder holds a fake `open`,
// `xdg-open` and `defaults`: each one logs its argv and exits 1. So the mail
// probe reads a canned "could not tell" instead of this machine's handler,
// and a refusal that ever stopped refusing would log an open here instead of
// opening anything. The last test in this file reads that log.
import { afterAll, describe, expect, test } from 'bun:test';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import { CliError } from '../src/cli-errors';
import { routesCommand, routesLines } from '../src/cli-routes';
import { routes, type RouteFacts } from '../src/export/routes';
import { resolveCommand } from '../src/cli-devices';
import type { ConnectedDevice } from '../src/device/types';

const SCRATCH = mkdtempSync(join(tmpdir(), 'screepub-cli-routes-'));
afterAll(() => rmSync(SCRATCH, { recursive: true, force: true }));

const ROOT = new URL('..', import.meta.url).pathname;
const EM_DASH = '\u2014';

const kindle: ConnectedDevice = { kind: 'kindle', name: 'Kindle', volume: '/Volumes/Kindle' };

/** A readable book. The handlers only need a file that is there; nothing in
 *  this file parses it. */
function book(name = 'Script.epub'): string {
  const path = join(mkdtempSync(join(SCRATCH, 'book-')), name);
  writeFileSync(path, 'book-bytes');
  return path;
}

/** A settings file path in its own fresh folder, never created here. */
function settingsFile(): string {
  return join(mkdtempSync(join(SCRATCH, 'config-')), 'settings.json');
}

/** Facts, counted. Darwin with Books, no Amazon app, Apple Mail default,
 *  nothing plugged in, unless a test says otherwise. */
function factsOf(over: Partial<RouteFacts> = {}) {
  const counter = { calls: 0 };
  const facts = async (): Promise<RouteFacts> => {
    counter.calls += 1;
    return {
      platform: 'darwin',
      devices: [],
      booksApp: true,
      sendToKindleApp: false,
      appleMailDefault: true,
      ...over,
    };
  };
  return { counter, facts };
}

async function thrown(run: () => Promise<unknown>): Promise<CliError> {
  try {
    await run();
  } catch (err) {
    expect(err).toBeInstanceOf(CliError);
    return err as CliError;
  }
  throw new Error('expected a CliError, and nothing was thrown');
}

describe('routesCommand', () => {
  test('lists exactly the catalog for the probed facts, in its order', async () => {
    const { facts } = factsOf({ devices: [kindle] });
    const answer = await routesCommand(book(), { facts, settingsPath: settingsFile() });
    expect(answer.routes).toEqual(routes(await facts()));
  });

  test('chosen follows a remembered key', async () => {
    const path = settingsFile();
    writeFileSync(path, JSON.stringify({ lastRoute: 'save-kindle' }));
    const { facts } = factsOf();
    const answer = await routesCommand(book(), { facts, settingsPath: path });
    expect(answer.chosen).toBe('save-kindle');
  });

  test('chosen is the row id, not the key: a remembered Kindle picks the connected one', async () => {
    // A connected device's id carries its volume; its key does not. The
    // window matches rows by id, so answering the key would choose nothing.
    const path = settingsFile();
    writeFileSync(path, JSON.stringify({ lastRoute: 'device:kindle' }));
    const { facts } = factsOf({ devices: [kindle] });
    const answer = await routesCommand(book(), { facts, settingsPath: path });
    expect(answer.chosen).toBe('device:kindle#/Volumes/Kindle');
  });

  test('a remembered Kindle that is unplugged stays chosen', async () => {
    const path = settingsFile();
    writeFileSync(path, JSON.stringify({ lastRoute: 'device:kindle' }));
    const { facts } = factsOf();
    const answer = await routesCommand(book(), { facts, settingsPath: path });
    expect(answer.chosen).toBe('device:kindle');
  });

  test('falls back to the first available row when nothing is remembered', async () => {
    const { facts } = factsOf();
    const answer = await routesCommand(book(), { facts, settingsPath: settingsFile() });
    expect(answer.chosen).toBe('apple-books');
  });

  test('a lastRoute that is not a string is treated as nothing remembered', async () => {
    const path = settingsFile();
    writeFileSync(path, JSON.stringify({ lastRoute: 7 }));
    const { facts } = factsOf({ platform: 'linux', booksApp: false, appleMailDefault: false });
    const answer = await routesCommand(book(), { facts, settingsPath: path });
    expect(answer.chosen).toBe('send-to-kindle');
  });

  test('read-only: no settings file appears, and an existing one is left byte for byte', async () => {
    const absent = settingsFile();
    await routesCommand(book(), { facts: factsOf().facts, settingsPath: absent });
    expect(existsSync(absent)).toBe(false);

    const present = settingsFile();
    const text = '{"lastRoute":"save-epub","libraryPath":"/somewhere"}';
    writeFileSync(present, text);
    const before = statSync(present).mtimeMs;
    await routesCommand(book(), { facts: factsOf().facts, settingsPath: present });
    expect(readFileSync(present, 'utf8')).toBe(text);
    expect(statSync(present).mtimeMs).toBe(before);
  });

  test('an unreadable book is refused first: no probe runs', async () => {
    const { counter, facts } = factsOf();
    const err = await thrown(() =>
      routesCommand(join(SCRATCH, 'no-such.epub'), { facts, settingsPath: settingsFile() }),
    );
    expect(err.code).toBe('unreadable');
    expect(err.message).toContain('no-such.epub');
    expect(counter.calls).toBe(0);
  });

  test('a folder given as the book is unreadable too', async () => {
    const { counter, facts } = factsOf();
    const err = await thrown(() =>
      routesCommand(mkdtempSync(join(SCRATCH, 'dir-')), { facts, settingsPath: settingsFile() }),
    );
    expect(err.code).toBe('unreadable');
    expect(counter.calls).toBe(0);
  });
});

describe('routes for a person', () => {
  test('one line per route, a star on the chosen one, dimmed rows carry their fix', async () => {
    const { facts } = factsOf({ appleMailDefault: false });
    const answer = await routesCommand(book(), { facts, settingsPath: settingsFile() });
    const lines = routesLines(answer);
    expect(lines).toHaveLength(answer.routes.length);
    expect(lines.filter((l) => l.startsWith('*'))).toHaveLength(1);
    const chosen = lines.find((l) => l.startsWith('*'))!;
    expect(chosen).toContain('apple-books');
    expect(chosen).toContain('Apple Books');
    const email = lines.find((l) => l.includes('email-to-kindle'))!;
    expect(email).toContain('(dimmed: needs Apple Mail as the default mail app');
    const save = lines.find((l) => l.includes('save-epub'))!;
    expect(save).not.toContain('dimmed');
    expect(save).toContain('for email, Apple Books and most e-readers');
    for (const line of lines) expect(line).not.toContain(EM_DASH);
  });

  test('the star follows the row id: of two Kindles, only the chosen one is starred', async () => {
    // Two connected Kindles share the key device:kindle and differ only by
    // id, so a star matched by key marks neither (chosen is an id) or both.
    const path = settingsFile();
    writeFileSync(path, JSON.stringify({ lastRoute: 'device:kindle' }));
    const twin: ConnectedDevice = { kind: 'kindle', name: 'KINDLE2', volume: '/Volumes/KINDLE2' };
    const { facts } = factsOf({ devices: [kindle, twin] });
    const lines = routesLines(await routesCommand(book(), { facts, settingsPath: path }));
    const starred = lines.filter((l) => l.startsWith('*'));
    expect(starred).toHaveLength(1);
    expect(starred[0]).toContain('Kindle: over USB');
    expect(lines.find((l) => l.includes('KINDLE2'))!.startsWith(' ')).toBe(true);
  });
});

// ---- the spawned CLI ----------------------------------------------------

const CONFIG = join(SCRATCH, 'config');
const LIBRARY = join(SCRATCH, 'library');
const NO_MOUNTS = mkdtempSync(join(SCRATCH, 'mounts-'));
const FAKE_BIN = mkdtempSync(join(SCRATCH, 'bin-'));
const TOOL_LOG = join(SCRATCH, 'tools.log');
for (const tool of ['open', 'xdg-open', 'defaults']) {
  const script = join(FAKE_BIN, tool);
  writeFileSync(script, `#!/bin/sh\necho "${tool} $*" >> '${TOOL_LOG}'\nexit 1\n`);
  chmodSync(script, 0o755);
}

async function runCli(args: string[], env: Record<string, string> = {}) {
  const proc = Bun.spawn(['bun', `${ROOT}src/cli.ts`, ...args], {
    stdout: 'pipe',
    stderr: 'pipe',
    cwd: ROOT,
    env: {
      ...process.env,
      SCREEPUB_CONFIG_DIR: CONFIG,
      SCREEPUB_LIBRARY: LIBRARY,
      SCREEPUB_VOLUME_ROOTS: NO_MOUNTS,
      SCREEPUB_REMARKABLE_ENDPOINT: 'http://127.0.0.1:9',
      PATH: `${FAKE_BIN}${delimiter}${process.env.PATH ?? ''}`,
      ...env,
    },
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  return { stdout, stderr, exitCode };
}

/** stdout is EXACTLY one parseable object. */
function soleJson(stdout: string): any {
  const lines = stdout.trim().split('\n');
  expect(lines).toHaveLength(1);
  return JSON.parse(lines[0]!);
}

function toolLog(): string[] {
  return existsSync(TOOL_LOG) ? readFileSync(TOOL_LOG, 'utf8').trim().split('\n').filter(Boolean) : [];
}

describe('screepub routes (through the CLI)', () => {
  test('is a verb, and a file of that name still converts', () => {
    expect(resolveCommand(['routes', 'x.epub'], () => false)).toEqual({
      kind: 'verb', verb: 'routes', args: ['x.epub'],
    });
    expect(resolveCommand(['routes'], (p) => p === 'routes')).toEqual({ kind: 'convert' });
  });

  test('--json is one object: ok, every route, the save rows available, and chosen among them', async () => {
    const { stdout, exitCode } = await runCli(['routes', book(), '--json']);
    expect(exitCode).toBe(0);
    const answer = soleJson(stdout);
    expect(answer.ok).toBe(true);
    expect(Object.keys(answer).sort()).toEqual(['chosen', 'ok', 'routes']);
    const byKey = new Map(answer.routes.map((r: any) => [r.key, r]));
    expect((byKey.get('save-epub') as any).available).toBe(true);
    expect((byKey.get('save-kindle') as any).available).toBe(true);
    expect(answer.routes.map((r: any) => r.id)).toContain(answer.chosen);
    if (process.platform === 'darwin') {
      // The fake `defaults` exits 1, so the mail probe could not tell, which
      // is never Apple Mail: the row is dimmed with its setup fix. That it
      // is, proves the real handler was not the one read.
      expect((byKey.get('email-to-kindle') as any).unavailable).toBe('setup');
      expect(toolLog().some((line) => line.startsWith('defaults read'))).toBe(true);
    }
    // Read-only: no settings file was made.
    expect(existsSync(join(CONFIG, 'settings.json'))).toBe(false);
  });

  test('chosen follows the settings file under SCREEPUB_CONFIG_DIR', async () => {
    const config = mkdtempSync(join(SCRATCH, 'config-'));
    writeFileSync(join(config, 'settings.json'), JSON.stringify({ lastRoute: 'save-kindle' }));
    const { stdout, exitCode } = await runCli(['routes', book(), '--json'], {
      SCREEPUB_CONFIG_DIR: config,
    });
    expect(exitCode).toBe(0);
    expect(soleJson(stdout).chosen).toBe('save-kindle');
  });

  test('a connected Kindle under SCREEPUB_VOLUME_ROOTS is listed first', async () => {
    const mounts = mkdtempSync(join(SCRATCH, 'mounts-'));
    mkdirSync(join(mounts, 'Kindle', 'documents'), { recursive: true });
    const { stdout } = await runCli(['routes', book(), '--json'], { SCREEPUB_VOLUME_ROOTS: mounts });
    const first = soleJson(stdout).routes[0];
    expect(first.key).toBe('device:kindle');
    expect(first.device.volume).toBe(join(mounts, 'Kindle'));
  });

  test('without --json: one line per route, one star', async () => {
    const { stdout, exitCode } = await runCli(['routes', book()]);
    expect(exitCode).toBe(0);
    expect(stdout.trim().startsWith('{')).toBe(false);
    const lines = stdout.trim().split('\n');
    expect(lines.filter((l) => l.startsWith('*'))).toHaveLength(1);
    expect(stdout).toContain('save-epub');
    expect(stdout).toContain('(dimmed: ');
  });

  test('a missing book is unreadable', async () => {
    const { stdout, exitCode } = await runCli(['routes', join(SCRATCH, 'ghost.epub'), '--json']);
    expect(exitCode).toBe(1);
    expect(soleJson(stdout).error.code).toBe('unreadable');
  });

  const FOREIGN: [string[], string, string][] = [
    [['--device', 'x'], '--device', 'send'],
    [['--set', '{}'], '--set', 'settings'],
    [['--for', 'kindle'], '--for', 'export'],
    [['--fountain', '/x.fountain'], '--fountain', 'export'],
    [['--options-json', '{}'], '--options-json', 'export'],
    [['--out', '/x.epub'], '--out', 'export'],
    [['--offered', '1.0'], '--offered', 'update-decision'],
    [['--opted-in'], '--opted-in', 'update-should-check'],
  ];

  test("refuses every other verb's flags as usage errors, naming the flag's owner", async () => {
    for (const [flags, name, owner] of FOREIGN) {
      const { stdout, exitCode } = await runCli(['routes', book(), ...flags, '--json']);
      const answer = soleJson(stdout);
      expect(`routes ${name}: ${exitCode} ${answer.ok} ${answer.error?.code}`).toBe(
        `routes ${name}: 1 false usage`,
      );
      expect(answer.error.message).toContain(`routes takes no ${name} (${name} belongs to ${owner}`);
    }
  });

  test('takes exactly one book', async () => {
    const none = soleJson((await runCli(['routes', '--json'])).stdout);
    expect(none.error.code).toBe('usage');
    const two = await runCli(['routes', book(), book(), '--json']);
    expect(two.exitCode).toBe(1);
    expect(soleJson(two.stdout).error.code).toBe('usage');
  });

  test('--help is its own usage, not the conversion flags', async () => {
    const { stdout, exitCode } = await runCli(['routes', '--help', '--json']);
    expect(exitCode).toBe(0);
    const { usage } = soleJson(stdout);
    expect(usage).toContain('screepub routes <file.epub>');
    expect(usage).not.toContain('--mobi');
    expect(usage).not.toContain('--out');
    expect(usage).not.toContain(EM_DASH);
  });

  test('the main usage lists it', async () => {
    const { stdout } = await runCli(['--help']);
    expect(stdout).toContain('screepub routes <file.epub> [--json]');
  });
});

describe('the spawned runs stayed harmless', () => {
  // Last in the file on purpose: bun runs a file's tests in order.
  test('no spawned run opened an app, a page or a folder', () => {
    expect(toolLog().filter((line) => !line.startsWith('defaults '))).toEqual([]);
  });
});
