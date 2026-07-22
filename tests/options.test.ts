import { describe, test, expect } from 'bun:test';
import { Fountain } from 'fountain-js';
import JSZip from 'jszip';
import { DEFAULT_FORMAT_OPTIONS, resolveFormatOptions } from '../src/options';
import { screenplayCss } from '../src/epub/css';
import { tokensToBody } from '../src/epub/html';
import { buildEpub } from '../src/epub/build';
import { toFountain } from '../src/fountain/serialize';
import { convertFountain } from '../src/convert';
import type { ScreenplayElement, ParsedScreenplay } from '../src/parser/types';

const SAMPLE = `INT. KITCHEN - DAY #7#

Jack enters.

@JACK
Hello.

EXT. YARD - NIGHT

Stars.
`;

function tokens() {
  return new Fountain().parse(SAMPLE, true).tokens;
}

// ── resolveFormatOptions ─────────────────────────────────

describe('resolveFormatOptions', () => {
  test('empty input yields defaults', () => {
    expect(resolveFormatOptions({})).toEqual(DEFAULT_FORMAT_OPTIONS);
    expect(resolveFormatOptions(undefined)).toEqual(DEFAULT_FORMAT_OPTIONS);
  });

  test('numeric knobs are clamped to sane ranges', () => {
    const opts = resolveFormatOptions({
      dialogueSideMarginPct: 90,
      cueIndentPct: -5,
      elementSpacingEm: 99,
    });
    expect(opts.dialogueSideMarginPct).toBeLessThanOrEqual(30);
    expect(opts.cueIndentPct).toBeGreaterThanOrEqual(0);
    expect(opts.elementSpacingEm).toBeLessThanOrEqual(2);
  });

  test('unknown keys are ignored', () => {
    const opts = resolveFormatOptions({ nonsense: true } as Record<string, unknown>);
    expect(opts).toEqual(DEFAULT_FORMAT_OPTIONS);
  });
});

// ── screenplayCss(options) ───────────────────────────────

describe('screenplayCss with options', () => {
  test('dialogue geometry knobs land in the stylesheet', () => {
    const css = screenplayCss(resolveFormatOptions({
      dialogueSideMarginPct: 25,
      cueIndentPct: 40,
      parentheticalIndentPct: 12,
    }));
    expect(css).toContain('margin-left: 25%');
    expect(css).toContain('margin-right: 25%');
    expect(css.match(/p\.character\s*{[^}]*}/)![0]).toContain('margin-left: 40%');
    expect(css.match(/p\.parenthetical\s*{[^}]*}/)![0]).toContain('margin-left: 12%');
  });

  test('element spacing scales the vertical rhythm', () => {
    const css = screenplayCss(resolveFormatOptions({ elementSpacingEm: 0.6 }));
    expect(css.match(/p\.action\s*{[^}]*}/)![0]).toContain('margin: 0.6em 0');
  });

  test('scene page breaks add a break rule only when enabled', () => {
    const off = screenplayCss(resolveFormatOptions({}));
    expect(off).not.toContain('section.scene { page-break-before');
    const on = screenplayCss(resolveFormatOptions({ scenePageBreaks: true }));
    expect(on).toContain('section.scene { page-break-before: always; }');
  });

  test('font family option switches the body stack', () => {
    expect(screenplayCss(resolveFormatOptions({ fontFamily: 'serif' }))).toMatch(/body\s*{[^}]*font-family:\s*serif/);
    expect(screenplayCss(resolveFormatOptions({ fontFamily: 'courier' }))).toContain('"Courier Prime"');
  });
});

// ── tokensToBody(options) ────────────────────────────────

describe('tokensToBody with options', () => {
  test('keep-together wrapper can be disabled', () => {
    const off = tokensToBody(tokens(), { format: resolveFormatOptions({ keepSceneHeadingWithScene: false }) });
    expect(off.files[0].xhtml).not.toContain('keep-together');
    const on = tokensToBody(tokens(), { format: resolveFormatOptions({}) });
    expect(on.files[0].xhtml).toContain('keep-together');
  });

  test('scene numbers render in headings when enabled', () => {
    const on = tokensToBody(tokens(), { format: resolveFormatOptions({ showSceneNumbers: true }) });
    expect(on.files[0].xhtml).toContain('<h2 class="scene-heading"><span class="scene-number">7</span> INT. KITCHEN - DAY</h2>');
    const off = tokensToBody(tokens(), { format: resolveFormatOptions({}) });
    expect(off.files[0].xhtml).toContain('<h2 class="scene-heading">INT. KITCHEN - DAY</h2>');
  });
});

// ── buildEpub(options) ───────────────────────────────────

describe('buildEpub with options', () => {
  test('title page can be excluded from manifest, spine, and landmarks', async () => {
    const body = tokensToBody(tokens());
    const bytes = await buildEpub({ title: 'T' }, body, resolveFormatOptions({ includeTitlePage: false }));
    const zip = await JSZip.loadAsync(bytes);
    expect(zip.file('OEBPS/titlepage.xhtml')).toBeNull();
    const opf = await zip.file('OEBPS/package.opf')!.async('string');
    expect(opf).not.toContain('titlepage');
    const nav = await zip.file('OEBPS/nav.xhtml')!.async('string');
    expect(nav).not.toContain('titlepage');
  });
});

// ── serializer rejoin option ─────────────────────────────

describe('toFountain rejoin option', () => {
  let id = 0;
  const el = (over: Partial<ScreenplayElement> & { text: string; type: ScreenplayElement['type'] }): ScreenplayElement => ({
    id: `o${id++}`, pageNum: 1, isTitlePage: false, isReadable: true, ...over,
  });
  const sp = (elements: ScreenplayElement[]): ParsedScreenplay => ({ elements, characters: [], scenes: [], pageCount: 1 });

  const SPLIT = [
    el({ text: 'JACK', type: 'character', character: 'JACK' }),
    el({ text: 'First half', type: 'dialogue', character: 'JACK' }),
    el({ text: "JACK (CONT'D)", type: 'character', character: 'JACK' }),
    el({ text: 'second half.', type: 'dialogue', character: 'JACK' }),
  ];

  test('rejoin on (default) merges the split speech', () => {
    expect(toFountain(sp(SPLIT))).toBe('@JACK\nFirst half\nsecond half.\n');
  });

  test('rejoin off keeps the (CONT’D) cue', () => {
    const out = toFountain(sp(SPLIT), undefined, resolveFormatOptions({ rejoinSplitDialogue: false }));
    expect(out).toBe("@JACK\nFirst half\n\n@JACK (CONT'D)\nsecond half.\n");
  });
});

// ── end-to-end through convertFountain ───────────────────

describe('convertFountain carries format options into the EPUB', () => {
  test('custom geometry reaches style.css', async () => {
    const result = await convertFountain('INT. A - DAY\n\nText.\n', {
      format: { dialogueSideMarginPct: 28, scenePageBreaks: true },
    });
    const zip = await JSZip.loadAsync(result.epub);
    const css = await zip.file('OEBPS/style.css')!.async('string');
    expect(css).toContain('margin-left: 28%');
    expect(css).toContain('section.scene { page-break-before: always; }');
  });
});
