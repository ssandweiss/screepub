import { afterAll, describe, expect, test } from 'bun:test';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { appSettingsPath, readAppSettings, writeAppSettings } from '../src/settings/app';

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

describe('module boundaries', () => {
  test('the module never imports anything from desktop/', () => {
    const source = readFileSync(new URL('../src/settings/app.ts', import.meta.url), 'utf8');
    expect(source).not.toMatch(/from ['"].*\/?desktop\//);
  });
});
