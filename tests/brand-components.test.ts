import { describe, test, expect } from 'bun:test';

describe('brand component previews', () => {
  const dir = new URL('../brand/components/', import.meta.url);
  const expected = [
    'brad', 'page-frame', 'title-block', 'slugline',
    'transition-rule', 'buttons', 'device-table', 'shot-frame',
  ];

  test('every preview opens with a @dsCard marker naming its group', async () => {
    for (const name of expected) {
      const text = await Bun.file(new URL(`${name}.html`, dir)).text();
      const first = text.split('\n')[0];
      expect(first, `${name}.html must open with a @dsCard marker`).toMatch(
        /^<!-- @dsCard group="(Brand|Type|Components)" -->$/,
      );
    }
  });

  test('previews use tokens, never raw brand colors', async () => {
    // White and black are allowed: they carry opacity in the brass
    // gradients and are not brand colors. Everything else must be a token.
    const carriers = new Set(['#FFF', '#FFFFFF', '#000', '#000000']);

    for (const name of expected) {
      const raw = await Bun.file(new URL(`${name}.html`, dir)).text();
      // Strip SVG fragment references first. An id like #dad or #face is
      // valid hex and would otherwise read as a hardcoded color.
      const text = raw
        .replace(/url\(#[\w-]+\)/g, '')
        .replace(/href="[^"]*"/g, '');

      for (const [literal] of text.matchAll(/#[0-9a-fA-F]{3,8}\b/g)) {
        expect(
          carriers.has(literal.toUpperCase()),
          `${name}.html hardcodes ${literal}; use a var(--token) instead`,
        ).toBe(true);
      }
    }
  });
});
