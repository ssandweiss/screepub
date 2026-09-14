// The format options. Filled in by its own task; this is the frame's
// placeholder so the routing can be seen.
import { el } from './dom.js';

export function mount(pane) {
  pane.append(
    el('h2', { class: 'slug' }, 'Int. tune - day'),
    el('p', { class: 'prose' }, 'Where the formatting of this script is decided.'),
  );
}
