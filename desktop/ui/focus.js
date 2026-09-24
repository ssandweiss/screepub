// Where the keyboard stands when something takes the focus away.
//
// A native file dialog is the clearest case: the OS window takes the focus,
// and when it closes the page may have none — no focused element at all, so
// Tab, Shift-Tab and the tablist's arrow keys have nothing to move FROM and
// the window is unusable without a mouse. Redrawing a surface does the same
// thing more quietly: the element that had the focus is thrown away with the
// rest of the pane.
//
// So this is not an event handler's business. It is a decision — which
// element a surface hands the keyboard back to — and it is the same decision
// for every surface and every dialog, which is why it lives here as a pure
// function instead of in the one handler that first needed it.
//
// The whole of it is exported and tested by tests/desktop-ui.test.ts; main.js
// does nothing with it but query the selectors and call focus().

/** What a keyboard can stand on. Deliberately not `[tabindex]` in general:
 *  an element with tabindex="-1" is reachable by script and NOT by Tab, so
 *  landing on one would put the reader somewhere Tab cannot leave the way
 *  they arrived. The panes carry tabindex="0" and are matched by name. */
export const FOCUSABLE = [
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  'a[href]',
  // Not `iframe`: the reader's frame is deliberately tabindex="-1", because
  // this window paints no focus on one. Its stage carries the tabindex="0"
  // below and is the stop instead. See read.js's scrollStep.
  '[tabindex="0"]',
].join(', ');

/** The one tab that is never disabled: Convert needs no script, so it is
 *  always a place the keyboard can stand. The plan's last resort. */
export const ALWAYS = '#tab-convert';

/** The candidates, in the order they should be tried, for the surface that is
 *  actually on screen. Four steps, each a fallback for the one before it:
 *
 *  1. the first control INSIDE the showing pane — the surface's own work,
 *     which is what someone who just dismissed a dialog wants to get on with;
 *  2. the pane itself, for a surface with no control at all (the progress
 *     bar, a reader still loading) — it carries tabindex="0" so Tab continues
 *     from it;
 *  3. the surface's own tab, if the pane has somehow gone;
 *  4. the Convert tab, which exists in every state of the window.
 *
 *  Returned as selectors rather than nodes so the decision can be read, and
 *  tested, without a document. */
export function focusPlan(surface) {
  const id = String(surface ?? '');
  const pane = `#surface-${id}`;
  return [
    FOCUSABLE.split(', ').map((part) => `${pane} ${part}`).join(', '),
    pane,
    `#tab-${id}`,
    ALWAYS,
  ];
}

/** Whether this node can actually take the focus now. A selector match is not
 *  enough: a control in a pane that is hidden, or one already detached by the
 *  redraw that lost the focus in the first place, would take focus nowhere
 *  visible and leave the keyboard exactly as stuck as before. */
export function canFocus(node) {
  if (node === null || node === undefined) return false;
  if (node.isConnected === false) return false;
  if (node.disabled === true) return false;
  if (node.hidden === true) return false;
  // A pane is hidden by its own [hidden]; a control inside one inherits that
  // and is just as unreachable.
  if (typeof node.closest === 'function' && node.closest('[hidden]') !== null) return false;
  return true;
}

/** The whole decision, composed: which element the keyboard goes back to on
 *  the surface that is showing. `queryAll` is the only thing this needs from
 *  a document, which is what lets the composition — and the ORDER, which is
 *  the part a wrong implementation gets wrong — be tested without one.
 *  Null means "leave the focus where it is": nowhere better was found. */
export function stopAfterDialog(surface, queryAll) {
  const candidates = focusPlan(surface).flatMap((selector) => [...queryAll(selector)]);
  return firstStop(candidates);
}

/** The first of the candidates that can actually take the focus, or null if
 *  none can — which is the answer that tells a caller to leave the focus
 *  alone rather than move it somewhere worse. */
export function firstStop(candidates) {
  for (const node of candidates ?? []) {
    if (canFocus(node)) return node;
  }
  return null;
}
