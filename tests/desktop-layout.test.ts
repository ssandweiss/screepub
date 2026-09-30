// The window layout pass (docs/superpowers/specs/2026-09-29-window-layout-pass-design.md):
// the page fills the window, the brads sit near its left edge, Read gives
// the scene index a slot of its own, and Settings gives the preview the
// room. These read the stylesheets rule by rule, with comments stripped, so
// a selector or a value named in a comment can never satisfy a test.
import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const REPO = join(import.meta.dir, '..');
const UI = join(REPO, 'desktop', 'ui');

function css(path: string): string {
  return readFileSync(path, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
}
const windowCss = (name: string) => css(join(UI, name));

/** The first declaration block for a selector. Base rules come before the
 *  @media blocks in these files, so the first one is the base rule. */
function ruleBlock(sheet: string, selector: string): string {
  const at = sheet.indexOf(`${selector} {`);
  expect(at, `${selector} is missing`).toBeGreaterThan(-1);
  return sheet.slice(at, sheet.indexOf('}', at) + 1);
}

/** Every @media block for one query, joined, braces balanced. */
function mediaBlocks(sheet: string, query: string): string {
  const out: string[] = [];
  const head = `@media ${query} {`;
  let at = sheet.indexOf(head);
  while (at !== -1) {
    let i = sheet.indexOf('{', at);
    const start = i;
    let depth = 0;
    for (; i < sheet.length; i++) {
      if (sheet[i] === '{') depth++;
      else if (sheet[i] === '}' && --depth === 0) break;
    }
    out.push(sheet.slice(start, i + 1));
    at = sheet.indexOf(head, i);
  }
  expect(out.length, `no ${head} block`).toBeGreaterThan(0);
  return out.join('\n');
}

describe('the page fills the window (frame B)', () => {
  const brand = css(join(REPO, 'brand', 'tokens.css'));
  const style = windowCss('style.css');

  test('the frame is measured in pixels from the window, not as shares of a capped page', () => {
    expect(brand).toContain('--block-max: 1180px;');
    expect(brand).toContain('--binding-margin: 100px;');
    expect(brand).toContain('--page-right: 48px;');
    expect(brand).toContain('--hole-center: 44px;');
    expect(brand).not.toContain('--page-max');
  });

  test('nothing in the window still names the old page cap', () => {
    for (const name of ['style.css', 'surfaces.css', 'tokens.css']) {
      expect(`${name}: ${windowCss(name).includes('--page-max')}`).toBe(`${name}: false`);
    }
  });

  test('the page is not capped: its sides are the binding and the right margin', () => {
    const page = ruleBlock(style, '.page');
    expect(page).not.toContain('max-width');
    expect(page).toContain('padding: 0 var(--page-right) 0 var(--binding-margin)');
  });

  test('the sheet is one block, capped and centred, with no side padding of its own', () => {
    const sheet = ruleBlock(style, '.sheet');
    expect(sheet).toContain('max-width: var(--block-max)');
    expect(sheet).toContain('margin: 0 auto');
    expect(sheet).toContain('padding: var(--space-7) 0 var(--space-10)');
  });

  test('the brads are placed from the window’s left edge', () => {
    const rail = ruleBlock(style, '.rail');
    expect(rail).not.toContain('max-width');
    expect(rail).not.toContain('translateX');
    expect(rail).toMatch(/left:\s*0;/);
    expect(ruleBlock(style, '.rail svg')).toContain('left: var(--hole-center)');
  });

  test('the foot and the dead-engine line sit on the block’s right edge', () => {
    expect(ruleBlock(style, '.rev-foot')).toMatch(/right:\s*0;/);
    expect(ruleBlock(style, '.engine-fault')).toMatch(/right:\s*0;/);
  });

  test('a narrow window narrows the binding on the page, as before', () => {
    const narrow = mediaBlocks(style, '(max-width: 720px)');
    expect(narrow).toContain('.page { padding-left: 11%; padding-right: var(--space-4); }');
    expect(narrow).not.toContain('.sheet {');
  });

  test('on a narrow window the brads sit in the middle of the narrow binding', () => {
    // Under 720 the binding is 11% of the width; a fixed 44px would put the
    // 20px brads on the text below about 490px wide.
    expect(mediaBlocks(style, '(max-width: 720px)')).toContain('.rail svg { left: 5.5%; width: 20px; height: 20px; }');
  });
});

describe('the brand draws the same frame the window uses', () => {
  const frame = readFileSync(join(REPO, 'brand', 'components', 'page-frame.html'), 'utf8');
  const preview = css(join(REPO, 'brand', 'components', '_preview.css'));

  test('the frame card’s rail spans the window and is not centred on a capped page', () => {
    expect(frame).not.toContain('--page-max');
    expect(frame).not.toContain('translateX(-50%)');
    expect(frame).toMatch(/\.rail \{\s*position: fixed; top: 0; bottom: 0; left: 0; right: 0;/);
  });

  test('the component previews keep a page-sized card made of the new tokens', () => {
    expect(preview).not.toContain('--page-max');
    expect(ruleBlock(preview, '.page'))
      .toContain('max-width: calc(var(--block-max) + var(--binding-margin) + var(--page-right))');
  });
});

describe('Convert keeps a column of its own inside the wide block', () => {
  test('the drop area, the progress, the result and a refusal stop at 820 wide, centred', () => {
    const rule = ruleBlock(windowCss('surfaces.css'), '#surface-convert');
    expect(rule).toContain('max-width: 820px');
    expect(rule).toContain('margin-left: auto');
    expect(rule).toContain('margin-right: auto');
  });
});

describe('Read gives the scene index a slot of its own', () => {
  const surfaces = windowCss('surfaces.css');

  test('the reader is two columns: the index slot, then the script at today’s width', () => {
    const reader = ruleBlock(surfaces, '.reader');
    expect(reader).toContain('display: grid');
    expect(reader).toContain('grid-template-columns: 218px minmax(0, 706px)');
  });

  test('the index keeps its slot open or shut, so the script never moves', () => {
    const rail = ruleBlock(surfaces, '.scene-rail');
    expect(rail).toContain('grid-column: 1');
    expect(rail).not.toContain('position: absolute');
    expect(rail).not.toContain('width: min(');
    expect(ruleBlock(surfaces, '.script-stage')).toContain('grid-column: 2');
  });

  test('open, it is simply shown: no slide out of the margin, no shadow over the page', () => {
    const open = ruleBlock(surfaces, '.reader.index-open .scene-rail');
    expect(open).toContain('opacity: 1');
    expect(open).toContain('visibility: visible');
    expect(open).not.toContain('translateX(-100%)');
    expect(open).not.toContain('box-shadow');
  });

  test('under 900 wide the index goes above the script, and a shut one takes no room', () => {
    const narrow = mediaBlocks(surfaces, '(max-width: 900px)');
    expect(narrow).toContain('.reader { grid-template-columns: minmax(0, 1fr); }');
    expect(narrow).toContain('.reader:not(.index-open) .scene-rail { display: none; }');
    expect(narrow).toContain('.script-stage { grid-column: 1; grid-row: 2; }');
  });

  test('a short window only grows the rail when it is still beside the script, not stacked above it', () => {
    // Below 900px wide the rail is already a short strip (the 900px block
    // above caps it at 6.5rem); a short-window override meant for the
    // two-column layout must not also apply there.
    const short = mediaBlocks(surfaces, '(max-height: 560px) and (min-width: 901px)');
    expect(short).toContain('.scene-rail { max-height: 62vh; }');
  });
});

describe('Settings gives the preview the room', () => {
  const surfaces = windowCss('surfaces.css');

  test('the settings take a fixed 420 and the preview everything else', () => {
    expect(ruleBlock(surfaces, '.tune-split')).toContain('grid-template-columns: 420px minmax(0, 1fr)');
  });

  test('the preview stays pinned and runs the window’s height', () => {
    expect(ruleBlock(surfaces, '.tune-preview')).toContain('position: sticky');
    const frame = ruleBlock(surfaces, '.tune-preview-frame');
    expect(frame).toContain('height: calc(100vh - var(--space-5) - var(--space-7) - var(--space-9))');
    expect(frame).not.toContain('62vh');
  });

  test('under 900 wide it is still one column, with the preview unpinned', () => {
    const narrow = mediaBlocks(surfaces, '(max-width: 900px)');
    expect(narrow).toContain('.tune-split { grid-template-columns: 1fr; }');
    expect(narrow).toContain('.tune-preview { position: static; }');
  });
});
