// The release notes. Filled in by its own task; this is the frame's
// placeholder so the routing can be seen. Named notes-surface.js so it does
// not collide with the generated notes.js the task ships beside it.
import { el } from './dom.js';

export function mount(pane) {
  pane.append(
    el('h2', { class: 'slug' }, 'Int. notes - day'),
    el('p', { class: 'prose' }, 'Where what changed in this version is written down.'),
  );
}
