import { describe, test, expect } from 'bun:test';
import { themeColors, cssValue } from './theme-colors';

const tokens = await Bun.file(new URL('../brand/tokens.json', import.meta.url)).json();

describe('brand tokens', () => {
  test('tokens sourced from Theme.swift match it exactly', async () => {
    // The Swift app is the source of truth for the shared palette. This is
    // the same arrangement format-defaults.json has with options.test.ts:
    // the two languages can no longer drift silently.
    const theme = await themeColors();
    const pinned = Object.entries(tokens.colors).filter(
      ([, v]: [string, any]) => v.from === 'Theme.swift',
    );

    expect(pinned.length).toBe(5);

    for (const [name, value] of pinned as [string, any][]) {
      expect(theme[name], `Theme.swift has no color named ${name}`).toBeDefined();
      expect(cssValue(theme[name].light), `${name} light`).toBe(value.light);
      expect(cssValue(theme[name].dark), `${name} dark`).toBe(value.dark);
    }
  });
});
