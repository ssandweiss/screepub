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
});
