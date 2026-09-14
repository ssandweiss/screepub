// The device table and the transfer. Filled in by its own task; this is the
// frame's placeholder so the routing can be seen.
import { el } from './dom.js';

export function mount(pane) {
  pane.append(
    el('h2', { class: 'slug' }, 'Int. send - day'),
    el('p', { class: 'prose' }, 'Where a book goes to the e-reader on the desk.'),
  );
}
