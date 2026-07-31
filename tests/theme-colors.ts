/// Parses the color literals out of the SwiftUI theme so the web tokens can
/// be pinned to them. Theme.swift is the source; brand/ mirrors it.
export type Rgba = { r: number; g: number; b: number; a: number };

const THEME = new URL('../app/Sources/ScreepubApp/Theme.swift', import.meta.url);

const byte = (v: number): number => Math.round(v * 255);

export function hex({ r, g, b }: Rgba): string {
  return '#' + [r, g, b].map((c) => c.toString(16).padStart(2, '0')).join('').toUpperCase();
}

/// Opaque colors render as hex; translucent ones as rgba(), which is how
/// tokens.json and tokens.css both spell them.
export function cssValue(c: Rgba): string {
  return c.a === 1 ? hex(c) : `rgba(${c.r},${c.g},${c.b},${c.a.toFixed(2)})`;
}

export function fromHex(h: string): Rgba {
  const s = h.replace('#', '');
  const w = s.length === 3 ? s.split('').map((c) => c + c).join('') : s;
  return {
    r: parseInt(w.slice(0, 2), 16),
    g: parseInt(w.slice(2, 4), 16),
    b: parseInt(w.slice(4, 6), 16),
    a: 1,
  };
}

function parseColor(src: string): Rgba | null {
  // Order here is harmless defense-in-depth, not a correctness
  // requirement: the 3-argument Color(red:green:blue:) pattern below
  // requires a `)` immediately after the blue digits, and
  // NSColor(...:alpha:) always has `, alpha: ...)` there instead, so the
  // plain pattern can never match inside an NSColor call either way.
  const rgb = src.match(/NSColor\(red:\s*([\d.]+),\s*green:\s*([\d.]+),\s*blue:\s*([\d.]+),\s*alpha:\s*([\d.]+)\)/);
  if (rgb) return { r: byte(+rgb[1]), g: byte(+rgb[2]), b: byte(+rgb[3]), a: +rgb[4] };

  const white = src.match(/NSColor\(white:\s*([\d.]+),\s*alpha:\s*([\d.]+)\)/);
  if (white) {
    const v = byte(+white[1]);
    return { r: v, g: v, b: v, a: +white[2] };
  }

  const plain = src.match(/Color\(red:\s*([\d.]+),\s*green:\s*([\d.]+),\s*blue:\s*([\d.]+)\)/);
  if (plain) return { r: byte(+plain[1]), g: byte(+plain[2]), b: byte(+plain[3]), a: 1 };

  return null;
}

type ThemeColors = Record<string, { light: Rgba; dark: Rgba }>;

/// Every `static let NAME` in Theme.swift source text that resolves to a
/// color pair. A declaration with neither a light: nor a dark: label
/// (Theme.brass) uses its one literal for both modes, which is exactly
/// what the app does. A declaration with exactly one of the two labels is
/// dropped, not guessed: falling back to the whole chunk would pick up
/// the OTHER label's literal, since it is still sitting right there in
/// the same chunk, and silently fabricate a value for the missing side
/// instead of surfacing it as unresolved.
///
/// Known limits. `parseColor` recognizes exactly three literal forms:
/// NSColor(red:green:blue:alpha:), NSColor(white:alpha:), and
/// Color(red:green:blue:). Any other color expression (an asset-catalog
/// color, a semantic literal like Color.white, NSColor.systemBlue, a
/// hue/saturation/brightness initializer, or a declaration that just
/// refers to another color by name) fails to match and is SILENTLY
/// dropped from the map: no throw, no warning, the key is simply absent
/// from the result. The asymmetric-label case above is dropped the same
/// way. That is deliberate, not accidental: a missing key surfaces
/// loudly downstream through `expect(theme[name]).toBeDefined()` in
/// tests/brand-tokens.test.ts, but only because that call site checks for it.
/// Any future caller of `parseThemeColors` or `themeColors` must check
/// for the key rather than assume every `static let` in Theme.swift made
/// it into the map.
export function parseThemeColors(text: string): ThemeColors {
  const out: ThemeColors = {};

  for (const chunk of text.split('static let ').slice(1)) {
    const name = chunk.match(/^(\w+)/)?.[1];
    if (!name) continue;

    const lightSrc = chunk.match(/light:\s*([^\n]+)/)?.[1];
    const darkSrc = chunk.match(/dark:\s*([^\n]+)/)?.[1];

    let light: Rgba | null;
    let dark: Rgba | null;
    if (lightSrc === undefined && darkSrc === undefined) {
      const both = parseColor(chunk);
      light = both;
      dark = both;
    } else {
      light = lightSrc !== undefined ? parseColor(lightSrc) : null;
      dark = darkSrc !== undefined ? parseColor(darkSrc) : null;
    }

    if (light && dark) out[name] = { light, dark };
  }
  return out;
}

export async function themeColors(): Promise<ThemeColors> {
  const text = await Bun.file(THEME).text();
  return parseThemeColors(text);
}

/// WCAG 2.1 relative luminance and contrast ratio.
export function luminance({ r, g, b }: Rgba): number {
  const f = (c: number) => {
    const s = c / 255;
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}

export function contrast(a: Rgba, b: Rgba): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}
