import { describe, test, expect } from 'bun:test';
import { ruleFor } from './css-rules';
import { SCREENPLAY_CSS } from '../src/epub/css';

// A small hand-written fixture that reproduces the shape that actually bit
// once (commit 3abeba3): a grouped selector list appearing BEFORE a bare
// rule for one of its own members, plus a comment whose text overlaps a
// property name a caller might assert on.
const FIXTURE = `
/* shadow rule: the comma-joined list is a distinct entry, page-break-inside
   is mentioned here purely to prove comments don't leak into extraction */
.keep-together, table.dual-dialogue { -webkit-column-break-inside: avoid; }

.keep-together {
  page-break-inside: avoid;
  break-inside: avoid;
}

table.dual-dialogue {
  width: 100%;
  page-break-inside: avoid;
  break-inside: avoid;
}
`;

describe('ruleFor', () => {
  test('exact match returns the body of the selector requested', () => {
    const rule = ruleFor(FIXTURE, 'table.dual-dialogue');
    expect(rule).toContain('width: 100%');
    expect(rule).toContain('break-inside: avoid');
  });

  test('grouped-selector match: asking for the bare selector does NOT return the grouped rule', () => {
    const rule = ruleFor(FIXTURE, 'table.dual-dialogue');
    expect(rule).not.toContain('-webkit-column-break-inside');
  });

  test('grouped-selector match: asking for the grouped selector verbatim DOES return it', () => {
    const rule = ruleFor(FIXTURE, '.keep-together, table.dual-dialogue');
    expect(rule).toContain('-webkit-column-break-inside: avoid');
  });

  test('the shadowing case: unanchored regex would grab the grouped rule first; ruleFor does not', () => {
    // This is the exact failure mode that shipped once: an unanchored
    // /table\.dual-dialogue\s*{[^}]*}/ matches starting inside the comma
    // list because it appears earlier in the file.
    const oldStyle = FIXTURE.match(/table\.dual-dialogue\s*{[^}]*}/)![0];
    expect(oldStyle).toContain('-webkit-column-break-inside'); // the bug, demonstrated
    const correct = ruleFor(FIXTURE, 'table.dual-dialogue');
    expect(correct).not.toContain('-webkit-column-break-inside');
    expect(correct).toContain('width: 100%');
  });

  test('body-only guarantee: a leading comment never contaminates the returned rule', () => {
    const rule = ruleFor(FIXTURE, '.keep-together, table.dual-dialogue');
    // The fixture's own comment contains this exact string; if the
    // comment rode along, this assertion would wrongly pass.
    expect(rule).not.toContain('page-break-inside');
  });

  test('not-found throws rather than returning undefined', () => {
    expect(() => ruleFor(FIXTURE, 'p.does-not-exist')).toThrow('no rule for selector: p.does-not-exist');
  });

  test('against the real stylesheet: the historical incident stays fixed', () => {
    // Regression check tied to commit 3abeba3: table.dual-dialogue is
    // requested bare and must resolve to the real rule, not the shadow
    // rule that sits earlier in SCREENPLAY_CSS.
    const rule = ruleFor(SCREENPLAY_CSS, 'table.dual-dialogue');
    expect(rule).toContain('width: 100%');
    expect(rule).not.toContain('-webkit-column-break-inside');

    const shadow = ruleFor(SCREENPLAY_CSS, '.keep-together, table.dual-dialogue');
    expect(shadow).toContain('-webkit-column-break-inside: avoid');
  });
});
