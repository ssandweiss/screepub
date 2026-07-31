// Selector-exact CSS rule extractor shared by epub.test.ts and
// options.test.ts. Both suites assert on individual rule bodies pulled out
// of src/epub/css.ts's generated stylesheet. The naive way to do that is
// an unanchored regex like /p\.action\s*{[^}]*}/, but that silently
// matches the WRONG rule whenever a GROUPED selector list appearing
// earlier in the file happens to END with the target selector — e.g.
// `.keep-together, table.dual-dialogue { -webkit-column-break-inside:
// avoid; }` shadows a bare `table.dual-dialogue { ... }` extraction. It's
// loud for positive assertions (wrong content, test fails) but SILENT for
// negative ones (`.not.toContain(...)` can pass against the wrong body
// while the real rule regressed unnoticed). This module is not a test
// file itself (no .test. in the name) so `bun test` does not collect it;
// tests/css-rules.test.ts covers it directly.

/**
 * Return the declaration body of the CSS rule whose selector is EXACTLY
 * `selector`, after trimming. Matching is selector-EXACT, not selector-
 * ENDS-WITH or selector-CONTAINS, which resolves grouped selectors
 * deliberately rather than by accident:
 *
 *   ruleFor(css, 'table.dual-dialogue')
 *     -> matches `table.dual-dialogue { ... }` only.
 *     -> does NOT match `.keep-together, table.dual-dialogue { ... }`,
 *        even though that list ends with the same text — the full
 *        trimmed selector differs from the requested one.
 *
 *   ruleFor(css, '.keep-together, table.dual-dialogue')
 *     -> matches that GROUPED rule verbatim. A caller that legitimately
 *        wants the grouped rule (e.g. asserting on the column-spelling
 *        shadow rule) passes the selector list exactly as written in
 *        css.ts, comma and all.
 *
 * The return value is the rule's declaration BODY ONLY
 * (`${selector} {...}`), reconstructed from the requested selector and
 * the matched declarations — never the raw text the regex captured ahead
 * of the selector. That matters: css.ts's shadow-rule comment contains
 * the literal string "page-break-inside", so a `.toContain(...)`
 * assertion would spuriously pass if a leading comment rode along.
 *
 * Throws if no rule has that exact selector, so a typo'd or renamed
 * selector fails loudly at the call site instead of a downstream
 * `undefined` crash with no context.
 */
export function ruleFor(css: string, selector: string): string {
  const hit = [...css.matchAll(/([^{}]+)\{([^}]*)\}/g)]
    .find(([, sel]) => sel.trim().split('\n').pop()!.trim() === selector);
  if (!hit) throw new Error(`no rule for selector: ${selector}`);
  return `${selector} {${hit[2]}}`;
}
