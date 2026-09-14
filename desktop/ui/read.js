// The reader. Filled in by its own task; this is the frame's placeholder so
// the routing can be seen.
import { el } from './dom.js';

export function mount(pane) {
  pane.append(
    el('h2', { class: 'slug' }, 'Int. read - day'),
    el('p', { class: 'prose' }, 'Where the converted script is read as a script.'),
  );
}
