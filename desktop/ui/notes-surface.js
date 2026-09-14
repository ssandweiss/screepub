// Notes: what changed in the version you are running.
//
// The notes are compiled into desktop/ui/notes.js at build time by
// tools/build-desktop-notes.ts, so this works offline and needs no markdown
// library. Everything here is built with el(); nothing is ever markup.
import { RELEASE } from './notes.js';
import { el } from './dom.js';

/** What the surface decides: which sections have anything to show. The
 *  generator now throws rather than shipping a heading with zero bullets
 *  (build-desktop-notes.ts), so this should never actually drop one — it
 *  stays as the surface's own guarantee that a heading is never printed
 *  with nothing beneath it, and it is what a test calls directly rather
 *  than a DOM emulator. */
export function visibleSections(sections) {
  return sections.filter((section) => section.items.length > 0);
}

/** A plain Good to know caveat has no bold claim to lead with — its lead
 *  is '' — so it prints as plain prose instead of an empty <strong> and a
 *  stray leading space. */
function noteItem(item) {
  return item.lead
    ? el('p', { class: 'note-item' },
        el('strong', { class: 'note-lead' }, item.lead), ` ${item.body}`)
    : el('p', { class: 'note-item' }, item.body);
}

export function mount(pane) {
  pane.append(
    el('h2', { class: 'slug' }, `Screepub ${RELEASE.version}`),
    el('p', { class: 'prose' }, RELEASE.headline),
    ...visibleSections(RELEASE.sections).map((section) =>
      el('section', { class: 'notes-section' },
        el('h3', { class: 'state-label' }, section.title),
        ...section.items.map(noteItem),
      ),
    ),
    // D ships no auto-update, by design. A reader who came here looking for
    // a newer version has to be told where one lives, not left guessing.
    el('p', { class: 'caption' },
      'Screepub does not update itself. New releases are at ' +
      'github.com/ssandweiss/screepub/releases.'),
  );
}
