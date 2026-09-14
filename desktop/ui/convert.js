// The drop well, the progress line and the result card. Filled in by its
// own task; this is the frame's placeholder so the routing can be seen.
import { el } from './dom.js';

export function mount(pane) {
  pane.append(
    el('h2', { class: 'slug' }, 'Int. convert - day'),
    el('p', { class: 'prose' }, 'Where a screenplay lands and becomes a book.'),
  );
}

/** Opened by the Ctrl/Cmd-O shortcut in main.js. */
export function choose() {}
