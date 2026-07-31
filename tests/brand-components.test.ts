import { describe, test, expect } from 'bun:test';
import { readdirSync } from 'node:fs';

// A byte-order mark (U+FEFF) on line 1 of a preview file makes the
// @dsCard check below fail, but the failure is visually indistinguishable
// from a pass in most terminals, because the BOM itself renders as
// nothing: the expected marker and the actual (BOM-prefixed) first line
// look identical side by side even though they are not equal. Strip it
// and normalize CRLF before comparing. BOM_CHAR is built from its code
// point (0xFEFF) rather than written as a literal escape in a regex, so
// this file cannot end up quietly carrying the very invisible character
// it exists to catch.
const BOM_CHAR = String.fromCharCode(0xfeff);
const DS_CARD_MARKER = /^<!-- @dsCard group="(Brand|Type|Components)" -->$/;
const firstLine = (text: string): string => {
  const withoutBom = text.startsWith(BOM_CHAR) ? text.slice(BOM_CHAR.length) : text;
  return withoutBom.split(/\r?\n/)[0];
};

describe('brand component previews', () => {
  const dir = new URL('../brand/components/', import.meta.url);

  // The list of previews a reviewer would type from memory, kept ONLY to
  // catch a deletion or rename: the two invariant tests below no longer
  // iterate it. They enumerate the directory instead, because a
  // hardcoded array is exactly how a ninth preview (added straight to
  // brand/components/, hardcoding #FF00FF) got a clean test run: nothing
  // ever asked the filesystem what was actually there. Directory
  // enumeration means a new file is checked automatically, with no
  // second place to remember to update. But enumeration alone would let
  // a deletion pass just as quietly, fewer files just means fewer loop
  // iterations, not a failure, so this list still exists for that half.
  const expected = [
    'brad', 'page-frame', 'title-block', 'slugline',
    'transition-rule', 'buttons', 'device-table', 'shot-frame',
  ];

  const found = readdirSync(dir)
    .filter((f) => f.endsWith('.html'))
    .map((f) => f.slice(0, -'.html'.length))
    .sort();

  test('the eight expected previews are all present', () => {
    for (const name of expected) {
      expect(found.includes(name), `${name}.html is missing from brand/components/`).toBe(true);
    }
  });

  test('every preview opens with a @dsCard marker naming its group', async () => {
    for (const name of found) {
      const text = await Bun.file(new URL(`${name}.html`, dir)).text();
      expect(firstLine(text), `${name}.html must open with a @dsCard marker`).toMatch(
        DS_CARD_MARKER,
      );
    }
  });

  test('firstLine strips a leading BOM so a BOM-prefixed marker still matches', () => {
    // Regression test for the blind spot above. Proven against a
    // synthetic string, not by writing a BOM into a real preview file, so
    // this test does not depend on the previews staying BOM-free to keep
    // passing.
    const withBom = `${BOM_CHAR}<!-- @dsCard group="Brand" -->\r\n<p>rest of file</p>`;
    expect(firstLine(withBom)).toMatch(DS_CARD_MARKER);
  });

  test('previews use tokens, never raw brand colors', async () => {
    // White and black are allowed: they carry opacity in the brass
    // gradients and are not brand colors. Everything else must be a token.
    const carriers = new Set(['#FFF', '#FFFFFF', '#000', '#000000']);

    for (const name of found) {
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
