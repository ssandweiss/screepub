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
 * The return value is the requested selector plus the declaration body
 * (`${selector} {...}`), reconstructed from the requested selector and
 * the matched declarations — never any leading comment or preceding text
 * the regex captured ahead of the selector. That matters: css.ts's
 * shadow-rule comment contains the literal string "page-break-inside",
 * so a `.toContain(...)` assertion would spuriously pass if a leading
 * comment rode along.
 *
 * Matching normalizes both the source selector and the requested one
 * (comments stripped, runs of whitespace collapsed to a single space,
 * trimmed), so a selector list that happens to be wrapped across lines
 * in the stylesheet is still found by its natural single-line form, and
 * a same-line leading comment can't shift what "the selector" is.
 *
 * Throws if no rule has that exact selector, so a typo'd or renamed
 * selector fails loudly at the call site instead of a downstream
 * `undefined` crash with no context.
 *
 * Known limits, all true of `eachRule` below too. The first three are
 * harmless today and fail LOUDLY: only flat stylesheets are supported —
 * a rule nested inside an at-rule such as `@media` is not found and this
 * throws; a duplicate selector returns the FIRST match, whereas the CSS
 * cascade would apply the last; and comments INSIDE a declaration body
 * are not stripped. The fourth fails SILENTLY, so it is the one to watch:
 * rules are split on braces BEFORE comments are stripped, so a comment
 * containing `{` or `}` shifts every rule boundary after it and lookups
 * return a body assembled from the wrong span. No such comment exists in
 * css.ts; don't add one.
 *
 * Note the returned string's selector prefix is the MATCHED selector,
 * which by construction equals your normalized argument. It is there so a
 * failure message names its rule — never assert on it, or you are
 * asserting on your own lookup key.
 */
export function ruleFor(css: string, selector: string): string {
  const target = normalizeSelector(selector);
  const hit = eachRule(css).find((r) => r.selector === target);
  if (!hit) throw new Error(`no rule for selector: ${selector}`);
  return `${hit.selector} {${hit.body}}`;
}

/** Comments stripped, whitespace runs collapsed, trimmed — so a selector
 * list means the same thing however it happens to be wrapped or spaced. */
export function normalizeSelector(s: string): string {
  return s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\s+/g, ' ').trim();
}

/**
 * Every rule in the stylesheet, selectors normalized. This is the one
 * parser: `ruleFor` looks up a single rule through it, and the inventory
 * guards in epub.test.ts sweep ALL rules through it to assert that a
 * mechanism (a keep, widows/orphans) appears on exactly the selectors the
 * css.ts header says it does. Those guards previously carried their own
 * copy of this regex plus a `selector.split('\n').pop()` last-line
 * comparison, which is the bug `normalizeSelector` exists to kill: a
 * cosmetic line-wrap of a grouped selector made them read only its final
 * member.
 */
export function eachRule(css: string): { selector: string; body: string }[] {
  return [...css.matchAll(/([^{}]+)\{([^}]*)\}/g)].map(([, selector, body]) => ({
    selector: normalizeSelector(selector),
    body,
  }));
}
