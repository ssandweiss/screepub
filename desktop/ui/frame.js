// The page as a sheet of paper on a desk: punched holes and brads down the
// binding margin, fixed to the window while the paper scrolls under them.
// Adapted from brand/components/page-frame.html and brand/components/brad.html.
//
// brand/README.md records that cross-file <use href="brad.html#brad"> does
// not resolve, so the symbols are defined once here, at the window's root,
// and every <use> points inside this document.
import { el } from './dom.js';

const SURFACES = [
  { id: 'convert', label: 'Convert' },
  { id: 'read', label: 'Read' },
  { id: 'tune', label: 'Tune' },
  { id: 'send', label: 'Send' },
  { id: 'notes', label: 'Notes' },
];

// This window's own constant, character for character from brad.html's
// <defs>. It is the one piece of markup in the window that is not built from
// data, which is why it may be assigned rather than constructed.
const DEFS = `<defs>
  <radialGradient id="bradFace" cx="50%" cy="50%" r="58%" fx="33%" fy="27%">
    <stop offset="0" stop-color="var(--brass-specular)"/>
    <stop offset="0.17" stop-color="var(--brass-highlight)"/>
    <stop offset="0.45" stop-color="var(--brass)"/>
    <stop offset="0.76" stop-color="var(--brass-shadow)"/>
    <stop offset="1" stop-color="var(--brass-rim)"/>
  </radialGradient>
  <radialGradient id="bradSpec">
    <stop offset="0" stop-color="#fff" stop-opacity="0.88"/>
    <stop offset="0.55" stop-color="#fff" stop-opacity="0.2"/>
    <stop offset="1" stop-color="#fff" stop-opacity="0"/>
  </radialGradient>
  <radialGradient id="bradCast">
    <stop offset="0.52" stop-color="#000" stop-opacity="0.36"/>
    <stop offset="1" stop-color="#000" stop-opacity="0"/>
  </radialGradient>
  <radialGradient id="punchShade" cx="50%" cy="40%" r="54%">
    <stop offset="0.7" stop-color="#000" stop-opacity="0.6"/>
    <stop offset="1" stop-color="#000" stop-opacity="0"/>
  </radialGradient>
  <symbol id="brad" viewBox="0 0 100 100">
    <ellipse cx="53" cy="56" rx="47" ry="46" fill="url(#bradCast)"/>
    <circle cx="50" cy="50" r="41" fill="var(--brass-edge)"/>
    <circle cx="50" cy="50" r="39.5" fill="url(#bradFace)"/>
    <ellipse cx="63" cy="67" rx="15" ry="8" fill="var(--brass-bounce)" opacity="0.34" transform="rotate(-28 63 67)"/>
    <ellipse cx="38" cy="33" rx="17" ry="11" fill="url(#bradSpec)" transform="rotate(-28 38 33)"/>
    <circle cx="50" cy="50" r="39.5" fill="none" stroke="var(--brass-edge)" stroke-opacity="0.55" stroke-width="1.6"/>
  </symbol>
  <symbol id="punch" viewBox="0 0 100 100">
    <circle cx="50" cy="52.4" r="31.5" fill="var(--paper)"/>
    <circle cx="50" cy="50" r="30" fill="var(--ground)"/>
    <circle cx="50" cy="50" r="30" fill="url(#punchShade)"/>
  </symbol>
</defs>`;

function svgUse(cls, symbol) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('class', cls);
  svg.setAttribute('aria-hidden', 'true');
  const use = document.createElementNS('http://www.w3.org/2000/svg', 'use');
  use.setAttribute('href', `#${symbol}`);
  svg.append(use);
  return svg;
}

export function mountFrame(root) {
  const defs = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  defs.setAttribute('width', '0');
  defs.setAttribute('height', '0');
  defs.setAttribute('aria-hidden', 'true');
  defs.setAttribute('class', 'defs');
  defs.innerHTML = DEFS;

  const handlers = [];
  let current = null;

  const tabs = SURFACES.map(({ id, label }) =>
    el('button', {
      type: 'button',
      class: 'tab',
      id: `tab-${id}`,
      role: 'tab',
      tabindex: '-1',
      'aria-selected': 'false',
      'aria-controls': `surface-${id}`,
      onclick: () => setSurface(id),
    }, label),
  );
  const tabFor = (id) => tabs[SURFACES.findIndex((s) => s.id === id)];

  // The tabs live ON the paper, inside the binding margin, so they line up
  // with the slugline below them and read as part of the page rather than as
  // chrome around it.
  const tablist = el('nav', { class: 'tabs', role: 'tablist', 'aria-label': 'Screepub' }, tabs);
  const sheet = el('div', { class: 'sheet' }, tablist);
  const page = el('div', { class: 'page' }, sheet);
  const rail = el('div', { class: 'rail', 'aria-hidden': 'true' },
    svgUse('a', 'brad'), svgUse('b', 'punch'), svgUse('c', 'brad'));

  root.append(defs, page, rail);

  function setSurface(id) {
    if (id === current) return;
    current = id;
    for (const tab of tabs) {
      const mine = tab.id === `tab-${id}`;
      tab.setAttribute('aria-selected', mine ? 'true' : 'false');
      tab.classList.toggle('tab-on', mine);
      // Roving tabindex: one stop for Tab, then the arrows move inside.
      // Five tabs in the Tab order would make every surface five presses
      // further away than the one before it.
      tab.tabIndex = mine ? 0 : -1;
    }
    for (const handler of handlers) handler(id);
  }

  // Left/Right move between surfaces, which is what a tablist owes a
  // keyboard: Tab alone walks into the surface and never comes back.
  // Home/End are the same contract's ends.
  tablist.addEventListener('keydown', (event) => {
    const step = event.key === 'ArrowRight' ? 1
      : event.key === 'ArrowLeft' ? -1
      : event.key === 'Home' ? 'first'
      : event.key === 'End' ? 'last'
      : 0;
    if (step === 0) return;
    const from = SURFACES.findIndex((s) => s.id === current);
    const order = typeof step === 'number'
      ? Array.from({ length: SURFACES.length - 1 },
        (_, hop) => SURFACES[(from + step * (hop + 1) + SURFACES.length * SURFACES.length)
          % SURFACES.length])
      : step === 'first' ? SURFACES : [...SURFACES].reverse();
    for (const next of order) {
      const button = tabFor(next.id);
      if (button.disabled) continue; // a dimmed surface is not a stop
      event.preventDefault();
      setSurface(next.id);
      button.focus();
      return;
    }
  });

  return {
    sheet,
    setSurface,
    onSurface: (handler) => handlers.push(handler),
    enable: (id, on) => {
      tabFor(id).disabled = !on;
      // Never leave the reader standing on a surface that has just gone
      // dark: the panel would be there with nothing in it.
      if (!on && current === id) setSurface('convert');
    },
  };
}
