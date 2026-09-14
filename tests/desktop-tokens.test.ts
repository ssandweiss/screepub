import { describe, test, expect } from 'bun:test';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { buildDesktopTokens, CORE_IN_STYLE_CSS } from '../tools/build-desktop-tokens';

const REPO = new URL('..', import.meta.url).pathname;
const TOKENS_JSON = readFileSync(join(REPO, 'brand', 'tokens.json'), 'utf8');
const BRAND_CSS = readFileSync(join(REPO, 'brand', 'tokens.css'), 'utf8');
const GENERATED = readFileSync(join(REPO, 'desktop', 'ui', 'tokens.css'), 'utf8');

describe('desktop/ui/tokens.css is generated, not typed', () => {
  test('the committed file is exactly what the generator produces', () => {
    // Byte equality. A hand edit — the failure mode brand/README.md and
    // tests/brand-tokens.test.ts both exist to prevent — fails here.
    expect(GENERATED).toBe(buildDesktopTokens(TOKENS_JSON, BRAND_CSS));
  });

  test('every colour it declares matches brand/tokens.json', () => {
    const colors = JSON.parse(TOKENS_JSON).colors as Record<
      string, { light: string; dark: string }
    >;
    const light = GENERATED.slice(0, GENERATED.indexOf('@media'));
    let checked = 0;
    for (const [, name, value] of light.matchAll(/--([\w-]+):\s*([^;]+);/g)) {
      if (!colors[name]) continue;
      expect(value.trim().toLowerCase()).toBe(colors[name].light.toLowerCase());
      checked += 1;
    }
    // Guards the loop itself: a generator that emitted no colours at all
    // would otherwise sail through with zero iterations.
    expect(checked).toBeGreaterThanOrEqual(8);
  });

  test('it does not redeclare the seven style.css already pins', () => {
    // Two files declaring the same token is how a "which one wins?" bug
    // starts. style.css owns those seven because desktop-shell.test.ts
    // pins them there.
    for (const name of CORE_IN_STYLE_CSS) {
      expect(
        new RegExp(`--${name}\\s*:`).test(GENERATED),
        `tokens.css redeclares --${name}, which style.css owns`,
      ).toBe(false);
    }
    expect(CORE_IN_STYLE_CSS).toHaveLength(7);
  });

  test('it carries the scales the components need', () => {
    for (const token of [
      '--font-structure', '--font-prose',
      '--text-fine', '--text-note', '--text-label', '--text-ui', '--text-caption',
      '--text-code', '--text-body', '--text-lede', '--text-title', '--text-display',
      '--radius-mark', '--radius', '--radius-well',
      '--motion-press', '--motion-state', '--ease',
      '--space-1', '--space-10', '--measure', '--brad-size', '--page-shadow',
      '--page-max', '--binding-margin', '--page-right', '--hole-center',
      '--hole', '--ink-soft', '--brass-highlight', '--brass-rim',
    ]) {
      expect(GENERATED.includes(`${token}:`), `tokens.css is missing ${token}`).toBe(true);
    }
  });

  test('the dark block overrides the mode-dependent tokens it owns', () => {
    const dark = GENERATED.slice(GENERATED.indexOf('@media'));
    expect(dark).toContain('--hole:');
    expect(dark).toContain('--ink-soft:');
    const colors = JSON.parse(TOKENS_JSON).colors;
    expect(dark).toContain(colors['ink-soft'].dark);
    expect(dark).toContain(colors['hole'].dark);
  });
});

describe('the fonts are bundled, not assumed', () => {
  const dir = join(REPO, 'desktop', 'ui', 'fonts');

  test('the same six subsets the website self-hosts are present', () => {
    const site = readdirSync(join(REPO, 'site', 'fonts')).sort();
    expect(readdirSync(dir).sort()).toEqual(site);
    expect(site).toHaveLength(6);
  });

  test('each is a real WOFF2, not a placeholder', () => {
    for (const name of readdirSync(dir)) {
      const bytes = readFileSync(join(dir, name));
      // wOF2 magic. A zero-byte or text placeholder fails here, which an
      // "it exists" test would not.
      expect(bytes.subarray(0, 4).toString('latin1')).toBe('wOF2');
      expect(bytes.length).toBeGreaterThan(2000);
    }
  });

  test('they are byte-identical to the website copies', () => {
    for (const name of readdirSync(dir)) {
      expect(readFileSync(join(dir, name)).equals(
        readFileSync(join(REPO, 'site', 'fonts', name)),
      )).toBe(true);
    }
  });

  test('THIRD-PARTY-NOTICES no longer says the app never uses them', () => {
    const notices = readFileSync(join(REPO, 'THIRD-PARTY-NOTICES.md'), 'utf8');
    expect(notices).toContain('desktop/ui/fonts/');
    expect(notices).not.toContain('Website only; the app has no running prose');
  });
});
