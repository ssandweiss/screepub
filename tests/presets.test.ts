import { test, expect } from 'bun:test';
import { DEFAULT_FORMAT_OPTIONS } from '../src/options';
import { DEVICE_PRESETS, matchingPreset } from '../src/settings/presets';

test('the Kindle e-ink preset is exactly the defaults', () => {
  expect(DEVICE_PRESETS.kindleEink.settings).toEqual(DEFAULT_FORMAT_OPTIONS);
});

test('a preset does not alias the module-level defaults', () => {
  // Swift's FormatOptions was a value type, so this could not happen there.
  // Handing out DEFAULT_FORMAT_OPTIONS by reference would let one mutation
  // through a preset corrupt every conversion in the process.
  expect(DEVICE_PRESETS.kindleEink.settings).not.toBe(DEFAULT_FORMAT_OPTIONS);
});

test('the phone preset widens the column and drops side-by-side dual dialogue', () => {
  expect(DEVICE_PRESETS.phone.settings).toEqual({
    ...DEFAULT_FORMAT_OPTIONS,
    dialogueSideMarginPct: 10,
    dualDialogue: 'sequential',
  });
});

test('matchingPreset names the preset whose settings match exactly', () => {
  expect(matchingPreset(DEFAULT_FORMAT_OPTIONS)).toBe('kindleEink');
  expect(matchingPreset(DEVICE_PRESETS.phone.settings)).toBe('phone');
});

test('matchingPreset returns null once a knob is tuned away from every preset', () => {
  expect(matchingPreset({ ...DEFAULT_FORMAT_OPTIONS, cueIndentPct: 41 })).toBeNull();
});

test('matchingPreset compares by value, not by object identity', () => {
  // A fresh object with identical fields must still resolve — this is what
  // stops a regression to reference equality passing the suite.
  expect(matchingPreset({ ...DEFAULT_FORMAT_OPTIONS })).toBe('kindleEink');
  expect(matchingPreset({ ...DEVICE_PRESETS.phone.settings })).toBe('phone');
});

test('every preset has a display name', () => {
  for (const preset of Object.values(DEVICE_PRESETS)) {
    expect(preset.displayName.length).toBeGreaterThan(0);
  }
});
