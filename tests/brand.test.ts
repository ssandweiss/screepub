import { describe, test, expect } from 'bun:test';
import { themeColors, parseThemeColors, cssValue } from './theme-colors';

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

  test('tokens.css declares every token in tokens.json, in both modes', async () => {
    const css = await Bun.file(new URL('../brand/tokens.css', import.meta.url)).text();

    const blockAfter = (marker: string): string => {
      const start = css.indexOf(marker);
      expect(start, `tokens.css is missing ${marker}`).toBeGreaterThan(-1);
      return css.slice(start, css.indexOf('}', start));
    };

    const declared = (block: string): Record<string, string> => {
      const out: Record<string, string> = {};
      for (const [, name, value] of block.matchAll(/--([\w-]+):\s*([^;]+);/g)) {
        out[name] = value.trim();
      }
      return out;
    };

    // blockAfter stops at the first '}', which for the media query is the
    // close of its inner :root, so it captures exactly the dark overrides.
    const light = declared(blockAfter(':root {'));
    const dark = declared(blockAfter('@media (prefers-color-scheme: dark)'));

    for (const [name, value] of Object.entries(tokens.colors) as [string, any][]) {
      expect(light[name], `tokens.css :root is missing --${name}`).toBe(value.light);
      // Tokens whose dark value equals their light value are correctly
      // absent from the dark block: brass is a material, not a hue.
      if (value.dark !== value.light) {
        expect(dark[name], `tokens.css dark block is missing --${name}`).toBe(value.dark);
      } else {
        expect(dark[name], `--${name} should not be re-declared in dark`).toBeUndefined();
      }
    }
  });
});

describe('parseThemeColors', () => {
  test('a declaration with only one of light:/dark: is dropped, not fabricated', () => {
    // Regression test for a real bug: the parser's fallback used to read
    // the WHOLE chunk when a label's own regex missed, on the assumption
    // that only fully-unlabeled declarations (Theme.brass) ever reach
    // that branch. But an asymmetric declaration (exactly one of the two
    // labels present) also reaches it, and the chunk still contains the
    // OTHER label's literal sitting right there, so the fallback would
    // silently adopt it instead of leaving the missing side unresolved.
    //
    // `alarm` below mirrors the exact repro: Theme.swift's real `alarm`
    // with the word "dark:" deleted and its value left in place. Before
    // the fix this produced alarm.dark === alarm.light === '#AF3220'
    // instead of the real '#EA7A65', a wrong value with no signal
    // anything was off. `ink` mirrors the same failure with "light:"
    // deleted instead, to cover both branches of the fix. `paper` stays
    // fully labeled as a control: normal declarations must still resolve.
    const src = `
      static let paper = dynamic(
          light: NSColor(red: 0.969, green: 0.949, blue: 0.902, alpha: 1),
          dark: NSColor(red: 0.118, green: 0.110, blue: 0.098, alpha: 1)
      )
      static let alarm = dynamic(
          light: NSColor(red: 0.686, green: 0.196, blue: 0.125, alpha: 1),
          NSColor(red: 0.918, green: 0.478, blue: 0.396, alpha: 1)
      )
      static let ink = dynamic(
          NSColor(red: 0.114, green: 0.106, blue: 0.086, alpha: 1),
          dark: NSColor(red: 0.910, green: 0.886, blue: 0.827, alpha: 1)
      )
    `;
    const parsed = parseThemeColors(src);

    expect(parsed.paper).toBeDefined();
    expect(parsed.alarm).toBeUndefined();
    expect(parsed.ink).toBeUndefined();
  });

  test('a declaration with neither label uses its one literal for both modes', () => {
    // Theme.brass shape: no light:/dark: labels at all. This is the only
    // case the whole-chunk fallback is meant for, and must keep working.
    const src = `
      static let brass = Color(red: 0.910, green: 0.639, blue: 0.239)
    `;
    const parsed = parseThemeColors(src);

    expect(parsed.brass).toBeDefined();
    expect(parsed.brass.light).toEqual(parsed.brass.dark);
    expect(parsed.brass.light).toEqual({ r: 232, g: 163, b: 61, a: 1 });
  });
});
