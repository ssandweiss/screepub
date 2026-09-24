import { afterAll, describe, expect, test } from 'bun:test';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { appSettingsPath, readAppSettings, writeAppSettings } from '../src/settings/app';
import { TEST_SETTINGS_GUARD } from './isolate-app-settings';

const ROOT = new URL('..', import.meta.url).pathname;

// Every path this file writes to is under here. No test may write the real
// app-settings file: that is exactly what SCREEPUB_CONFIG_DIR is for.
const SCRATCH = mkdtempSync(join(tmpdir(), 'screepub-app-settings-'));

afterAll(() => {
  rmSync(SCRATCH, { recursive: true, force: true });
});

let counter = 0;
function scratchDir(name: string): string {
  return join(SCRATCH, `${name}-${counter++}`);
}

describe('where the app settings file is', () => {
  // This HOME does not exist, which is the point: resolving must not depend
  // on reading anything, and nothing here may touch a real home directory.
  const HOME = '/home/ada';

  test('darwin: under Application Support', () => {
    expect(appSettingsPath('darwin', { HOME })).toBe(
      '/home/ada/Library/Application Support/Screepub/settings.json',
    );
  });

  test('win32: under APPDATA when set', () => {
    expect(
      appSettingsPath('win32', { APPDATA: 'C:\\Users\\a\\AppData\\Roaming' }),
    ).toBe('C:\\Users\\a\\AppData\\Roaming\\Screepub\\settings.json');
  });

  test('win32: falls back to USERPROFILE\\AppData\\Roaming without APPDATA', () => {
    expect(appSettingsPath('win32', { USERPROFILE: 'C:\\Users\\a' })).toBe(
      'C:\\Users\\a\\AppData\\Roaming\\Screepub\\settings.json',
    );
  });

  test('win32: a blank APPDATA is ignored, same as absent', () => {
    expect(appSettingsPath('win32', { USERPROFILE: 'C:\\Users\\a', APPDATA: '   ' })).toBe(
      'C:\\Users\\a\\AppData\\Roaming\\Screepub\\settings.json',
    );
  });

  test('linux: an absolute XDG_CONFIG_HOME is honoured', () => {
    expect(
      appSettingsPath('linux', { HOME, XDG_CONFIG_HOME: '/home/ada/.xdgconfig' }),
    ).toBe('/home/ada/.xdgconfig/screepub/settings.json');
  });

  test('linux: a relative XDG_CONFIG_HOME is ignored, falls back to ~/.config', () => {
    expect(
      appSettingsPath('linux', { HOME, XDG_CONFIG_HOME: 'not/absolute' }),
    ).toBe('/home/ada/.config/screepub/settings.json');
  });

  test('linux: no XDG_CONFIG_HOME at all falls back to ~/.config', () => {
    expect(appSettingsPath('linux', { HOME })).toBe('/home/ada/.config/screepub/settings.json');
  });

  test('SCREEPUB_CONFIG_DIR wins on every platform', () => {
    for (const platform of ['darwin', 'win32', 'linux'] as NodeJS.Platform[]) {
      const dir = scratchDir('config-dir');
      expect(appSettingsPath(platform, { HOME, SCREEPUB_CONFIG_DIR: dir })).toBe(
        join(dir, 'settings.json'),
      );
    }
  });

  test('a whitespace-only SCREEPUB_CONFIG_DIR is ignored', () => {
    expect(appSettingsPath('linux', { HOME, SCREEPUB_CONFIG_DIR: '   ' })).toBe(
      '/home/ada/.config/screepub/settings.json',
    );
  });
});

describe('reading app settings never throws', () => {
  test('a missing file reads as {}', () => {
    const path = join(scratchDir('read'), 'settings.json');
    expect(readAppSettings(path)).toEqual({});
  });

  test('text that is not JSON reads as {}', () => {
    const dir = scratchDir('read');
    writeFileSync(dir + '.json', 'not json');
    expect(readAppSettings(dir + '.json')).toEqual({});
  });

  test('JSON that is not an object (an array) reads as {}', () => {
    const dir = scratchDir('read');
    writeFileSync(dir + '.json', '[1,2]');
    expect(readAppSettings(dir + '.json')).toEqual({});
  });

  test('JSON null reads as {}', () => {
    const dir = scratchDir('read');
    writeFileSync(dir + '.json', 'null');
    expect(readAppSettings(dir + '.json')).toEqual({});
  });

  test('a valid object reads back as itself', () => {
    const dir = scratchDir('read');
    writeFileSync(dir + '.json', JSON.stringify({ lastRoute: 'apple-books', libraryPath: '/x' }));
    expect(readAppSettings(dir + '.json')).toEqual({ lastRoute: 'apple-books', libraryPath: '/x' });
  });
});

describe('writing app settings', () => {
  test('creates missing parent folders', () => {
    const path = join(scratchDir('write'), 'nested', 'deeper', 'settings.json');
    expect(existsSync(path)).toBe(false);
    writeAppSettings({ lastRoute: 'kindle' }, path);
    expect(existsSync(path)).toBe(true);
    expect(readAppSettings(path)).toEqual({ lastRoute: 'kindle' });
  });

  test('merges over what is on disk, keeping unknown keys (a B write must not drop a C key)', () => {
    const path = join(scratchDir('write'), 'settings.json');
    writeAppSettings({ libraryPath: 'x' }, path);
    const result = writeAppSettings({ lastRoute: 'apple-books' }, path);
    expect(result).toEqual({ libraryPath: 'x', lastRoute: 'apple-books' });
    expect(readAppSettings(path)).toEqual({ libraryPath: 'x', lastRoute: 'apple-books' });
  });

  test('a key set to undefined is removed', () => {
    const path = join(scratchDir('write'), 'settings.json');
    writeAppSettings({ libraryPath: 'x', lastRoute: 'kindle' }, path);
    const result = writeAppSettings({ lastRoute: undefined }, path);
    expect(result).toEqual({ libraryPath: 'x' });
    expect(readAppSettings(path)).toEqual({ libraryPath: 'x' });
  });

  test('leaves no temp file behind in the folder after a write', () => {
    const dir = scratchDir('write');
    const path = join(dir, 'settings.json');
    writeAppSettings({ lastRoute: 'kindle' }, path);
    expect(readdirSync(dir)).toEqual(['settings.json']);
  });

  test('returns exactly what was written', () => {
    const path = join(scratchDir('write'), 'settings.json');
    const result = writeAppSettings({ lastRoute: 'kindle' }, path);
    expect(result).toEqual(JSON.parse(readFileSync(path, 'utf8')));
  });
});

describe('the test-run guard: no test can reach the real settings file', () => {
  // bunfig.toml preloads tests/isolate-app-settings.ts before any test
  // file runs, which sets SCREEPUB_CONFIG_DIR unless a developer already
  // set it themselves. See that file for the full explanation, including
  // why root .env.test also has to exist.

  // The real per-platform location, computed WITHOUT the guard, so a test
  // can tell "guarded" from "genuinely the developer's own settings file"
  // by comparison rather than by assuming the guard's own path. Computed
  // once and reused below. os.homedir() reads the account's actual home
  // directory regardless of SCREEPUB_CONFIG_DIR, which is a different
  // variable.
  const REAL_SETTINGS_PATH = appSettingsPath(process.platform, { HOME: homedir() });

  test('SCREEPUB_CONFIG_DIR is set, and it does not resolve to the real settings file', () => {
    expect((process.env.SCREEPUB_CONFIG_DIR ?? '').trim()).not.toBe('');
    // What appSettingsPath() sees on an ordinary call, with process.env as
    // production code would read it.
    expect(appSettingsPath()).not.toBe(REAL_SETTINGS_PATH);
  });

  test('a write through the guarded path fails loudly, rather than silently succeeding', () => {
    // The other half of the guard's promise: not just "empty", but a write
    // a forgetful test made cannot land anywhere at all. Proves the
    // /dev/null claim in tests/isolate-app-settings.ts against the actual
    // guarded path this run is using, not just the literal by itself.
    //
    // The path is checked FIRST, and only then handed to writeAppSettings.
    // Without that check, a run where the guard is missing (bun test from
    // a subfolder that never reads bunfig.toml or .env.test; a developer
    // who set SCREEPUB_CONFIG_DIR to somewhere real on purpose) would have
    // this test itself write {} into whatever settings file appSettingsPath()
    // actually resolves to on that run, which can be the real one.
    const live = appSettingsPath();
    expect(live).toBe(join(TEST_SETTINGS_GUARD, 'settings.json'));
    expect(() => writeAppSettings({}, live)).toThrow();
  });

  test('a spawned CLI child inherits the same guarded path, and it is not the real one either', async () => {
    // Most of this suite spawns `bun src/cli.ts` with no `env` option at
    // all, which picks up whatever bun itself started with, not a runtime
    // mutation of process.env in this process. See tests/isolate-app-
    // settings.ts for why root .env.test, not this file's preload, is what
    // makes that work.
    const proc = Bun.spawn(
      ['bun', '-e', "console.log(require('./src/settings/app.ts').appSettingsPath())"],
      { cwd: ROOT, stdout: 'pipe', stderr: 'pipe' },
    );
    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);
    expect(stderr).toBe('');
    expect(exitCode).toBe(0);
    // Not just "the child agrees with the parent": if BOTH somehow resolved
    // to the real path, they would still agree with each other and this
    // test would wrongly pass. Checked independently against the real path.
    expect(stdout.trim()).not.toBe(REAL_SETTINGS_PATH);
    expect(stdout.trim()).toBe(appSettingsPath());
  });

  test('.env.test and the preload agree on the guard path', () => {
    // "Keep the two values identical" is a comment in both files, not
    // enforced by either. This is the enforcement: a drift here means one
    // half of the guard silently stops matching the other.
    const envTest = readFileSync(join(ROOT, '.env.test'), 'utf8');
    const match = envTest.match(/^SCREEPUB_CONFIG_DIR=(.*)$/m);
    expect(match).not.toBeNull();
    expect(match![1]).toBe(TEST_SETTINGS_GUARD);
  });
});

describe('module boundaries', () => {
  test('the module never imports anything from desktop/', () => {
    const source = readFileSync(new URL('../src/settings/app.ts', import.meta.url), 'utf8');
    expect(source).not.toMatch(/from ['"].*\/?desktop\//);
  });
});
