// The `app-settings` verb: reads and writes `libraryPath` and
// `formatDefaults`, the two app-wide settings piece C owns in the shared
// settings file (`src/settings/app.ts`). Most of this file drives the
// handler IN PROCESS with an injected settingsPath, which never touches a
// real settings file regardless of the test-run guard; the last describe
// spawns the real CLI, guarded by an explicit SCREEPUB_CONFIG_DIR the same
// way tests/cli-app-defaults.test.ts does.
import { afterAll, describe, expect, test } from 'bun:test';
import {
  chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { appSettingsCommand } from '../src/cli-app-settings';
import { DEFAULT_FORMAT_OPTIONS } from '../src/options';
import { readAppSettings, writeAppSettings } from '../src/settings/app';

const ROOT = new URL('..', import.meta.url).pathname;
const SCRATCH = mkdtempSync(join(tmpdir(), 'screepub-cli-app-settings-'));

afterAll(() => {
  // The unwritable-folder test leaves a 0o500 directory behind; put it back
  // before rm, or the cleanup fails and the next run inherits it.
  for (const dir of readdirSync(SCRATCH)) {
    try { chmodSync(join(SCRATCH, dir), 0o700); } catch { /* not a directory we locked */ }
  }
  rmSync(SCRATCH, { recursive: true, force: true });
});

let counter = 0;
function scratch(name: string): string {
  const dir = join(SCRATCH, `${name}-${counter++}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

/** A settings.json path inside its own fresh scratch folder, unwritten. */
function settingsFile(): string {
  return join(scratch('settings'), 'settings.json');
}

// This HOME does not exist, same reasoning as tests/library.test.ts: nothing
// here may depend on, or touch, a real home directory.
const HOME = '/home/ada';
function env(extra: Record<string, string | undefined> = {}): Record<string, string | undefined> {
  return { HOME, ...extra };
}

function codeOf(err: unknown): string {
  return (err as { code?: string }).code ?? '';
}

describe('appSettingsCommand: a plain read', () => {
  test('no settings file: shipped defaults, no chosen folder, not customized', () => {
    const file = settingsFile();
    const result = appSettingsCommand({}, { settingsPath: file, platform: 'linux', env: env() });
    expect(result.file).toBe(file);
    expect(result.library.chosen).toBeNull();
    expect(result.library.path).toBe(join(HOME, 'Documents', 'Screepub'));
    expect(result.library.platformDefault).toBe(result.library.path);
    expect(result.library.fromEnv).toBe(false);
    expect(result.home).toBe(HOME);
    expect(result.formatDefaults).toEqual(DEFAULT_FORMAT_OPTIONS);
    expect(result.shippedDefaults).toEqual(DEFAULT_FORMAT_OPTIONS);
    expect(result.customized).toBe(false);
    // A read must not create the file it reads.
    expect(existsSync(file)).toBe(false);
  });
});

describe('appSettingsCommand: setting and resetting libraryPath', () => {
  test('a good absolute folder is stored, created, and reported back as chosen', () => {
    const file = settingsFile();
    const chosen = join(scratch('chosen-lib'), 'not-yet-made');
    const result = appSettingsCommand(
      { set: JSON.stringify({ libraryPath: chosen }) },
      { settingsPath: file, platform: 'linux', env: env() },
    );
    expect(result.library.chosen).toBe(chosen);
    expect(result.library.path).toBe(chosen);
    expect(readAppSettings(file).libraryPath).toBe(chosen);
    // The check IS making the folder, per the spec.
    expect(existsSync(chosen)).toBe(true);
  });

  test('null resets it: the key is removed, not written as null', () => {
    const file = settingsFile();
    const chosen = scratch('chosen-lib');
    appSettingsCommand({ set: JSON.stringify({ libraryPath: chosen }) }, { settingsPath: file, platform: 'linux', env: env() });

    const result = appSettingsCommand(
      { set: JSON.stringify({ libraryPath: null }) },
      { settingsPath: file, platform: 'linux', env: env() },
    );
    expect(result.library.chosen).toBeNull();
    expect(result.library.path).toBe(join(HOME, 'Documents', 'Screepub'));
    expect('libraryPath' in readAppSettings(file)).toBe(false);
  });
});

describe('appSettingsCommand: setting and resetting formatDefaults', () => {
  test('an object is stored as the FULL resolved options, clamped', () => {
    const file = settingsFile();
    // 999 is well outside dialogueSideMarginPct's 0-30 range, so a clamped
    // 30 in the answer proves resolveFormatOptions ran, not a raw echo.
    const result = appSettingsCommand(
      { set: JSON.stringify({ formatDefaults: { dialogueSideMarginPct: 999 } }) },
      { settingsPath: file, platform: 'linux', env: env() },
    );
    expect(result.formatDefaults.dialogueSideMarginPct).toBe(30);
    expect(Object.keys(result.formatDefaults).sort()).toEqual(Object.keys(DEFAULT_FORMAT_OPTIONS).sort());
    expect(result.customized).toBe(true);

    const onDisk = readAppSettings(file).formatDefaults as Record<string, unknown>;
    expect(onDisk.dialogueSideMarginPct).toBe(30);
    // The FULL object landed on disk, not the one key the caller sent.
    expect(Object.keys(onDisk).sort()).toEqual(Object.keys(DEFAULT_FORMAT_OPTIONS).sort());
  });

  test('null resets it: the key is removed, customized goes back to false', () => {
    const file = settingsFile();
    appSettingsCommand(
      { set: JSON.stringify({ formatDefaults: { justifyText: true } }) },
      { settingsPath: file, platform: 'linux', env: env() },
    );
    const result = appSettingsCommand(
      { set: JSON.stringify({ formatDefaults: null }) },
      { settingsPath: file, platform: 'linux', env: env() },
    );
    expect(result.formatDefaults).toEqual(DEFAULT_FORMAT_OPTIONS);
    expect(result.customized).toBe(false);
    expect('formatDefaults' in readAppSettings(file)).toBe(false);
  });
});

describe('appSettingsCommand: refusals before anything is written', () => {
  test('an unknown key is usage, naming the two allowed keys, and writes nothing', () => {
    const file = settingsFile();
    let err: unknown;
    try {
      appSettingsCommand({ set: JSON.stringify({ theme: 'dark' }) }, { settingsPath: file, platform: 'linux', env: env() });
    } catch (e) { err = e; }
    expect(codeOf(err)).toBe('usage');
    expect((err as Error).message).toContain('libraryPath');
    expect((err as Error).message).toContain('formatDefaults');
    expect(existsSync(file)).toBe(false);
  });

  test('lastRoute is refused here: it belongs to piece B, not writable through this verb', () => {
    const file = settingsFile();
    let err: unknown;
    try {
      appSettingsCommand({ set: JSON.stringify({ lastRoute: 'kindle' }) }, { settingsPath: file, platform: 'linux', env: env() });
    } catch (e) { err = e; }
    expect(codeOf(err)).toBe('usage');
    expect(existsSync(file)).toBe(false);
  });

  test('--set that is not valid JSON is bad-settings, nothing written', () => {
    const file = settingsFile();
    let err: unknown;
    try {
      appSettingsCommand({ set: '{oops' }, { settingsPath: file, platform: 'linux', env: env() });
    } catch (e) { err = e; }
    expect(codeOf(err)).toBe('bad-settings');
    expect(existsSync(file)).toBe(false);
  });

  test('--set as a JSON array is bad-settings, not silently accepted', () => {
    // typeof [] === 'object', so this has to be checked explicitly.
    const file = settingsFile();
    let err: unknown;
    try {
      appSettingsCommand({ set: '[1,2,3]' }, { settingsPath: file, platform: 'linux', env: env() });
    } catch (e) { err = e; }
    expect(codeOf(err)).toBe('bad-settings');
    expect(existsSync(file)).toBe(false);
  });

  test('libraryPath that is not a string or null is bad-settings', () => {
    const file = settingsFile();
    let err: unknown;
    try {
      appSettingsCommand({ set: JSON.stringify({ libraryPath: 7 }) }, { settingsPath: file, platform: 'linux', env: env() });
    } catch (e) { err = e; }
    expect(codeOf(err)).toBe('bad-settings');
    expect(existsSync(file)).toBe(false);
  });

  test('formatDefaults that is not an object or null is bad-settings', () => {
    const file = settingsFile();
    let err: unknown;
    try {
      appSettingsCommand({ set: JSON.stringify({ formatDefaults: 'kindleEink' }) }, { settingsPath: file, platform: 'linux', env: env() });
    } catch (e) { err = e; }
    expect(codeOf(err)).toBe('bad-settings');
    expect(existsSync(file)).toBe(false);
  });

  test('a relative libraryPath is refused, and nothing is written', () => {
    const file = settingsFile();
    let err: unknown;
    try {
      appSettingsCommand({ set: JSON.stringify({ libraryPath: 'Scripts' }) }, { settingsPath: file, platform: 'linux', env: env() });
    } catch (e) { err = e; }
    expect(codeOf(err)).toBe('bad-settings');
    expect((err as Error).message).toContain('full path');
    expect(existsSync(file)).toBe(false);
  });

  test('a path through a regular file is refused, not a stack trace', () => {
    const dir = scratch('blocker');
    const blocker = join(dir, 'not-a-dir');
    writeFileSync(blocker, 'x');
    const target = join(blocker, 'library');
    const file = settingsFile();
    let err: unknown;
    try {
      appSettingsCommand({ set: JSON.stringify({ libraryPath: target }) }, { settingsPath: file, platform: 'linux', env: env() });
    } catch (e) { err = e; }
    expect(codeOf(err)).toBe('bad-settings');
    expect(existsSync(file)).toBe(false);
  });

  // Root bypasses ordinary permission bits, and Windows has no chmod-style
  // read-only-directory story that mkdirSync/accessSync would trip on here.
  test.skipIf(process.platform === 'win32' || process.getuid?.() === 0)(
    'an unwritable folder is refused, and nothing is written',
    () => {
      const locked = scratch('locked');
      chmodSync(locked, 0o500);
      const target = join(locked, 'child');
      const file = settingsFile();
      let err: unknown;
      try {
        appSettingsCommand({ set: JSON.stringify({ libraryPath: target }) }, { settingsPath: file, platform: 'linux', env: env() });
      } catch (e) { err = e; }
      expect(codeOf(err)).toBe('bad-settings');
      expect((err as Error).message).toContain('permission denied');
      expect(existsSync(file)).toBe(false);
    },
  );

  test('good formatDefaults alongside a bad libraryPath stores neither', () => {
    const file = settingsFile();
    let err: unknown;
    try {
      appSettingsCommand(
        { set: JSON.stringify({ formatDefaults: { justifyText: true }, libraryPath: 'relative' }) },
        { settingsPath: file, platform: 'linux', env: env() },
      );
    } catch (e) { err = e; }
    expect(codeOf(err)).toBe('bad-settings');
    expect(existsSync(file)).toBe(false);
  });
});

describe('appSettingsCommand: one write covers both keys', () => {
  test('both keys land together, in one write, keeping lastRoute', () => {
    const file = settingsFile();
    writeAppSettings({ lastRoute: 'kindle' }, file);
    const chosen = scratch('both-chosen');

    const result = appSettingsCommand(
      { set: JSON.stringify({ libraryPath: chosen, formatDefaults: { justifyText: true } }) },
      { settingsPath: file, platform: 'linux', env: env() },
    );
    expect(result.library.chosen).toBe(chosen);
    expect(result.formatDefaults.justifyText).toBe(true);

    const onDisk = readAppSettings(file);
    expect(onDisk.libraryPath).toBe(chosen);
    expect((onDisk.formatDefaults as Record<string, unknown>).justifyText).toBe(true);
    // lastRoute (piece B's key) survived a write this verb made.
    expect(onDisk.lastRoute).toBe('kindle');
    // One write, one file: no leftover temp artifact from a second pass.
    expect(readdirSync(dirname(file))).toEqual(['settings.json']);
  });
});

describe('appSettingsCommand: fromEnv and chosen disagree on purpose', () => {
  test('SCREEPUB_LIBRARY overrides path, but chosen still names the stored choice', () => {
    const file = settingsFile();
    const chosen = scratch('env-chosen');
    appSettingsCommand({ set: JSON.stringify({ libraryPath: chosen }) }, { settingsPath: file, platform: 'linux', env: env() });

    const result = appSettingsCommand(
      {},
      { settingsPath: file, platform: 'linux', env: env({ SCREEPUB_LIBRARY: '/env/lib' }) },
    );
    expect(result.library.fromEnv).toBe(true);
    expect(result.library.path).toBe('/env/lib');
    expect(result.library.chosen).toBe(chosen);
  });

  test('a blank SCREEPUB_LIBRARY does not count as fromEnv', () => {
    const file = settingsFile();
    const result = appSettingsCommand({}, { settingsPath: file, platform: 'linux', env: env({ SCREEPUB_LIBRARY: '   ' }) });
    expect(result.library.fromEnv).toBe(false);
  });
});

describe('appSettingsCommand: chosen is null for anything libraryRoot would not honour', () => {
  test('a stored relative path is not reported as chosen', () => {
    const file = settingsFile();
    writeAppSettings({ libraryPath: 'Scripts' }, file);
    const result = appSettingsCommand({}, { settingsPath: file, platform: 'linux', env: env() });
    expect(result.library.chosen).toBeNull();
    expect(result.library.path).toBe(join(HOME, 'Documents', 'Screepub'));
  });
});

describe('appSettingsCommand: platformDefault', () => {
  test('is correct for darwin with a fake HOME, independent of a chosen folder', () => {
    const file = settingsFile();
    const chosen = scratch('darwin-chosen');
    writeAppSettings({ libraryPath: chosen }, file);

    const result = appSettingsCommand({}, { settingsPath: file, platform: 'darwin', env: env() });
    expect(result.library.platformDefault).toBe(join(HOME, 'Documents', 'Screepub'));
    // The chosen folder still wins for `path`; platformDefault is a separate
    // fact, not what conversions actually use.
    expect(result.library.path).toBe(chosen);
  });
});

describe('appSettingsCommand: home', () => {
  test('is present, and is the same HOME the engine resolves everything else from', () => {
    const file = settingsFile();
    const result = appSettingsCommand({}, { settingsPath: file, platform: 'linux', env: env() });
    expect(result.home).toBe(HOME);
  });
});

describe('screepub app-settings (through the CLI)', () => {
  async function runCli(args: string[], extraEnv: Record<string, string> = {}) {
    const proc = Bun.spawn(['bun', `${ROOT}src/cli.ts`, ...args], {
      stdout: 'pipe',
      stderr: 'pipe',
      // SCREEPUB_LIBRARY defaults to blank so a developer's own shell
      // variable cannot leak into an assertion about the DEFAULT library
      // location; a test that means to exercise the override sets its own
      // value in extraEnv, which still wins (it is spread last).
      env: { ...process.env, SCREEPUB_LIBRARY: '', ...extraEnv },
    });
    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);
    return { stdout, stderr, exitCode };
  }

  test('--json answer has the documented shape', async () => {
    const configDir = scratch('config');
    const { stdout, exitCode } = await runCli(['app-settings', '--json'], { SCREEPUB_CONFIG_DIR: configDir });
    expect(exitCode).toBe(0);
    const answer = JSON.parse(stdout);
    expect(answer.ok).toBe(true);
    expect(answer.file).toBe(join(configDir, 'settings.json'));
    expect(answer.library.chosen).toBeNull();
    expect(typeof answer.library.path).toBe('string');
    expect(typeof answer.library.platformDefault).toBe('string');
    expect(answer.library.fromEnv).toBe(false);
    expect(typeof answer.home).toBe('string');
    expect(answer.formatDefaults).toBeDefined();
    expect(answer.shippedDefaults).toBeDefined();
    expect(answer.customized).toBe(false);
  });

  test('--set round-trips through the CLI', async () => {
    const configDir = scratch('config');
    const chosen = scratch('cli-chosen');
    const setResult = await runCli(
      ['app-settings', '--set', JSON.stringify({ libraryPath: chosen }), '--json'],
      { SCREEPUB_CONFIG_DIR: configDir },
    );
    expect(setResult.exitCode).toBe(0);
    expect(JSON.parse(setResult.stdout).library.chosen).toBe(chosen);

    const readBack = await runCli(['app-settings', '--json'], { SCREEPUB_CONFIG_DIR: configDir });
    expect(readBack.exitCode).toBe(0);
    expect(JSON.parse(readBack.stdout).library.chosen).toBe(chosen);
  });

  test('human output names the folder and, by default, Screepub\'s own defaults', async () => {
    const configDir = scratch('config');
    const { stdout, exitCode } = await runCli(['app-settings'], { SCREEPUB_CONFIG_DIR: configDir });
    expect(exitCode).toBe(0);
    const lines = stdout.trim().split('\n');
    expect(lines[0]).toContain('books are saved in');
    expect(lines[0]).toContain('default folder');
    expect(lines[1]).toBe("new scripts start from: Screepub's defaults");
  });

  test('human output says "your own defaults" once formatDefaults are customized', async () => {
    const configDir = scratch('config');
    await runCli(
      ['app-settings', '--set', JSON.stringify({ formatDefaults: { justifyText: true } }), '--json'],
      { SCREEPUB_CONFIG_DIR: configDir },
    );
    const { stdout } = await runCli(['app-settings'], { SCREEPUB_CONFIG_DIR: configDir });
    expect(stdout.trim().split('\n')[1]).toBe('new scripts start from: your own defaults');
  });

  test('refuses a foreign flag as a usage error', async () => {
    const configDir = scratch('config');
    const { stdout, exitCode } = await runCli(['app-settings', '--device', 'x', '--json'], { SCREEPUB_CONFIG_DIR: configDir });
    expect(exitCode).toBe(1);
    const answer = JSON.parse(stdout);
    expect(answer.error.code).toBe('usage');
    expect(answer.error.message).toContain('--device');
  });

  test('refuses a stray positional', async () => {
    const configDir = scratch('config');
    const { stdout, exitCode } = await runCli(['app-settings', 'extra', '--json'], { SCREEPUB_CONFIG_DIR: configDir });
    expect(exitCode).toBe(1);
    const answer = JSON.parse(stdout);
    expect(answer.error.code).toBe('usage');
    expect(answer.error.message).toContain('extra');
  });

  test('--help describes what --set accepts and the SCREEPUB_LIBRARY override', async () => {
    const { stdout, exitCode } = await runCli(['app-settings', '--help']);
    expect(exitCode).toBe(0);
    expect(stdout).toContain('screepub app-settings');
    expect(stdout).toContain('libraryPath');
    expect(stdout).toContain('formatDefaults');
    expect(stdout).toContain('SCREEPUB_LIBRARY');
  });
});
