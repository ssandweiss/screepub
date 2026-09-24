import { afterAll, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { appDefaultOptions, appDefaultsCustomized } from '../src/settings/app-defaults';
import { writeAppSettings } from '../src/settings/app';
import { DEFAULT_FORMAT_OPTIONS } from '../src/options';

const SCRATCH = mkdtempSync(join(tmpdir(), 'screepub-settings-app-defaults-'));
afterAll(() => rmSync(SCRATCH, { recursive: true, force: true }));

let counter = 0;
function settingsPath(): string {
  return join(SCRATCH, `settings-${counter++}.json`);
}

describe('appDefaultOptions', () => {
  test('no settings file: exactly the shipped defaults', () => {
    const path = settingsPath();
    expect(appDefaultOptions(path)).toEqual(DEFAULT_FORMAT_OPTIONS);
  });

  test('a stored formatDefaults knob overrides the shipped default', () => {
    const path = settingsPath();
    writeAppSettings({ formatDefaults: { dialogueSideMarginPct: 5 } }, path);
    const result = appDefaultOptions(path);
    expect(result.dialogueSideMarginPct).toBe(5);
    // Everything else stays the shipped value: a partial stored object must
    // not blank out the seventeen knobs it did not mention.
    expect(result.contdMode).toBe(DEFAULT_FORMAT_OPTIONS.contdMode);
  });

  test('a stored formatDefaults is returned FULL, every key present', () => {
    const path = settingsPath();
    writeAppSettings({ formatDefaults: { justifyText: true } }, path);
    expect(Object.keys(appDefaultOptions(path))).toHaveLength(
      Object.keys(DEFAULT_FORMAT_OPTIONS).length,
    );
  });

  test('an out-of-range stored value is clamped, not trusted', () => {
    const path = settingsPath();
    writeAppSettings({ formatDefaults: { dialogueSideMarginPct: 999 } }, path);
    expect(appDefaultOptions(path).dialogueSideMarginPct).toBe(30);
  });

  test('formatDefaults as an array reads as absent', () => {
    const path = settingsPath();
    writeAppSettings({ formatDefaults: [1, 2, 3] }, path);
    expect(appDefaultOptions(path)).toEqual(DEFAULT_FORMAT_OPTIONS);
  });

  test('formatDefaults as a string reads as absent', () => {
    const path = settingsPath();
    writeAppSettings({ formatDefaults: 'nope' }, path);
    expect(appDefaultOptions(path)).toEqual(DEFAULT_FORMAT_OPTIONS);
  });

  test('formatDefaults as a number reads as absent', () => {
    const path = settingsPath();
    writeAppSettings({ formatDefaults: 7 }, path);
    expect(appDefaultOptions(path)).toEqual(DEFAULT_FORMAT_OPTIONS);
  });

  test('formatDefaults as null reads as absent', () => {
    const path = settingsPath();
    writeAppSettings({ formatDefaults: null }, path);
    expect(appDefaultOptions(path)).toEqual(DEFAULT_FORMAT_OPTIONS);
  });

  test('a corrupt settings file changes nothing: reads as the shipped defaults', () => {
    const path = settingsPath();
    writeFileSync(path, '{ this is not json');
    expect(appDefaultOptions(path)).toEqual(DEFAULT_FORMAT_OPTIONS);
  });

  test('a settings file with other keys (lastRoute, libraryPath) but no formatDefaults reads as absent', () => {
    const path = settingsPath();
    writeAppSettings({ lastRoute: 'kindle', libraryPath: '/x' }, path);
    expect(appDefaultOptions(path)).toEqual(DEFAULT_FORMAT_OPTIONS);
  });
});

describe('appDefaultsCustomized', () => {
  test('false when nothing has been stored', () => {
    expect(appDefaultsCustomized(settingsPath())).toBe(false);
  });

  test('false when formatDefaults is stored but happens to equal the shipped defaults', () => {
    const path = settingsPath();
    writeAppSettings({ formatDefaults: { ...DEFAULT_FORMAT_OPTIONS } }, path);
    expect(appDefaultsCustomized(path)).toBe(false);
  });

  test('true once a single knob differs from the shipped default', () => {
    const path = settingsPath();
    writeAppSettings({ formatDefaults: { justifyText: !DEFAULT_FORMAT_OPTIONS.justifyText } }, path);
    expect(appDefaultsCustomized(path)).toBe(true);
  });

  test('false again for a non-object formatDefaults, since it reads as absent', () => {
    const path = settingsPath();
    writeAppSettings({ formatDefaults: 'nope' }, path);
    expect(appDefaultsCustomized(path)).toBe(false);
  });
});
