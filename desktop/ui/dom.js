// Three helpers, no framework. Everything the window draws goes through
// these, so there is exactly one place that sets text — and therefore no
// place that sets markup with engine output in it.

/** el('p', { class: 'x', onclick: fn }, 'text', childNode) */
export function el(tag, props = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (value === null || value === undefined || value === false) continue;
    if (key.startsWith('on') && typeof value === 'function') {
      node.addEventListener(key.slice(2), value);
    } else if (key === 'class') {
      node.className = value;
    } else if (key === 'disabled' || key === 'hidden' || key === 'checked' || key === 'value') {
      node[key] = value;
    } else {
      node.setAttribute(key, String(value));
    }
  }
  for (const child of children.flat()) {
    if (child === null || child === undefined || child === false) continue;
    node.append(typeof child === 'string' ? document.createTextNode(child) : child);
  }
  return node;
}

export function clear(node) {
  while (node.firstChild) node.removeChild(node.firstChild);
  return node;
}

/** Always textContent. A script's title, a device's name and the engine's
 *  messages are all data from outside this window; none of it is markup. */
export function text(node, value) {
  node.textContent = value === null || value === undefined ? '' : String(value);
  return node;
}
