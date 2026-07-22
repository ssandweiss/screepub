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
      cueAlignment: 'indented',
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
  test('scene-heading keep-together wrapper can be disabled', () => {
    // Governs the HEADING wrapper only — the cue-keeps-dialogue wrapper
    // inside dialogue blocks is always on.
    const off = tokensToBody(tokens(), { format: resolveFormatOptions({ keepSceneHeadingWithScene: false }) });
    expect(off.files[0].xhtml).not.toMatch(/<div class="keep-together">\s*<h2/);
    const on = tokensToBody(tokens(), { format: resolveFormatOptions({}) });
    expect(on.files[0].xhtml).toMatch(/<div class="keep-together">\s*<h2/);
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

// ── CONT'D modes (registry #8a) ──────────────────────────

describe("contdMode", () => {
  let id2 = 0;
  const el2 = (over: Partial<ScreenplayElement> & { text: string; type: ScreenplayElement['type'] }): ScreenplayElement => ({
    id: `c${id2++}`, pageNum: 1, isTitlePage: false, isReadable: true, ...over,
  });
  const sp2 = (elements: ScreenplayElement[]): ParsedScreenplay => ({ elements, characters: [], scenes: [], pageCount: 1 });

  const INTERRUPTED = [
    el2({ text: 'INT. LAB - DAY', type: 'scene' }),
    el2({ text: 'JACK', type: 'character', character: 'JACK' }),
    el2({ text: 'Look at this.', type: 'dialogue', character: 'JACK' }),
    el2({ text: 'He points.', type: 'action' }),
    el2({ text: 'JACK', type: 'character', character: 'JACK' }),
    el2({ text: 'See?', type: 'dialogue', character: 'JACK' }),
  ];

  test('auto adds (CONT’D) when the same speaker continues through action', () => {
    const out = toFountain(sp2(INTERRUPTED), undefined, resolveFormatOptions({ contdMode: 'auto' }));
    expect(out).toContain("@JACK (CONT'D)\nSee?");
  });

  test('auto strips stale (CONT’D) after a different speaker', () => {
    const out = toFountain(sp2([
      el2({ text: 'ANNE', type: 'character', character: 'ANNE' }),
      el2({ text: 'Hi.', type: 'dialogue', character: 'ANNE' }),
      el2({ text: "JACK (CONT'D)", type: 'character', character: 'JACK' }),
      el2({ text: 'Hello.', type: 'dialogue', character: 'JACK' }),
    ]), undefined, resolveFormatOptions({ contdMode: 'auto' }));
    expect(out).toContain('@JACK\nHello.');
    expect(out).not.toContain("JACK (CONT'D)");
  });

  test('auto resets at scene boundaries', () => {
    const out = toFountain(sp2([
      el2({ text: 'JACK', type: 'character', character: 'JACK' }),
      el2({ text: 'Bye.', type: 'dialogue', character: 'JACK' }),
      el2({ text: 'INT. HALL - DAY', type: 'scene' }),
      el2({ text: 'JACK', type: 'character', character: 'JACK' }),
      el2({ text: 'New scene.', type: 'dialogue', character: 'JACK' }),
    ]), undefined, resolveFormatOptions({ contdMode: 'auto' }));
    expect(out).toContain('@JACK\nNew scene.');
  });

  test('strip removes all (CONT’D) and adds none', () => {
    const withContd = [...INTERRUPTED];
    withContd[4] = el2({ text: "JACK (CONT'D)", type: 'character', character: 'JACK' });
    const out = toFountain(sp2(withContd), undefined, resolveFormatOptions({ contdMode: 'strip' }));
    expect(out).not.toContain("CONT'D");
  });

  test('keep leaves source cues untouched', () => {
    const out = toFountain(sp2(INTERRUPTED), undefined, resolveFormatOptions({ contdMode: 'keep' }));
    expect(out).toContain('@JACK\nSee?');
  });
});

// ── cue alignment (registry #2b) ─────────────────────────

describe('cueAlignment', () => {
  test('default centers cues and parentheticals in the column', () => {
    const css = screenplayCss(resolveFormatOptions({}));
    expect(css.match(/p\.character\s*{[^}]*}/)![0]).toContain('text-align: center');
    expect(css.match(/p\.parenthetical\s*{[^}]*}/)![0]).toContain('text-align: center');
  });

  test('indented mode uses print-style % indents instead', () => {
    const css = screenplayCss(resolveFormatOptions({ cueAlignment: 'indented', cueIndentPct: 40 }));
    const cue = css.match(/p\.character\s*{[^}]*}/)![0];
    expect(cue).toContain('margin-left: 40%');
    expect(cue).not.toContain('text-align: center');
  });
});

// ── original page markers (registry #13a) ────────────────

describe('showPageMarkers', () => {
  let id3 = 0;
  const el3 = (over: Partial<ScreenplayElement> & { text: string; type: ScreenplayElement['type']; pageNum: number }): ScreenplayElement => ({
    id: `p${id3++}`, isTitlePage: false, isReadable: true, ...over,
  });
  const sp3 = (elements: ScreenplayElement[]): ParsedScreenplay => ({ elements, characters: [], scenes: [], pageCount: 3 });

  // Sheets 1-3; printed page numbers "1."/"2." on sheets 2-3 (title page
  // offsets the count by one, the standard screenplay situation).
  const ELS = [
    el3({ text: 'INT. LAB - DAY', type: 'scene', pageNum: 1 }),
    el3({ text: 'Work happens.', type: 'action', pageNum: 1 }),
    el3({ text: '1.', type: 'page-number', pageNum: 2 }),
    el3({ text: 'More work.', type: 'action', pageNum: 2 }),
    el3({ text: '2.', type: 'page-number', pageNum: 3 }),
    el3({ text: 'Even more.', type: 'action', pageNum: 3 }),
  ];

  test('off by default — no markers', () => {
    expect(toFountain(sp3(ELS))).not.toContain('= pg');
  });

  test('on: markers carry the PDF-printed numbering, not the sheet index', () => {
    const out = toFountain(sp3(ELS), undefined, resolveFormatOptions({ showPageMarkers: true }));
    expect(out).toContain('= pg 1\n\nMore work.');
    expect(out).toContain('= pg 2\n\nEven more.');
  });

  test('a page starting mid-speech defers its marker to the next block', () => {
    const els = [
      el3({ text: '5.', type: 'page-number', pageNum: 5 }),
      el3({ text: 'Setup.', type: 'action', pageNum: 5 }),
      el3({ text: 'JACK', type: 'character', character: 'JACK', pageNum: 5 }),
      el3({ text: 'Speech starts here', type: 'dialogue', character: 'JACK', pageNum: 5 }),
      el3({ text: 'and continues overleaf.', type: 'dialogue', character: 'JACK', pageNum: 6 }),
      el3({ text: 'He exits.', type: 'action', pageNum: 6 }),
    ];
    const out = toFountain(sp3(els), undefined, resolveFormatOptions({ showPageMarkers: true }));
    expect(out).toContain('Speech starts here\nand continues overleaf.');
    expect(out).toContain('= pg 6\n\nHe exits.');
  });
});
