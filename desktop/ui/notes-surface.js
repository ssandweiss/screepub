// Notes: what changed in the version you are running.
//
// The notes are compiled into desktop/ui/notes.js at build time by
// tools/build-desktop-notes.ts, so this works offline and needs no markdown
// library. Everything here is built with el(); nothing is ever markup.
import { RELEASE } from './notes.js';
import { el } from './dom.js';

export function mount(pane) {
  pane.append(
    el('h2', { class: 'slug' }, `Screepub ${RELEASE.version}`),
    el('p', { class: 'prose' }, RELEASE.headline),
    // A section can survive the trip from markdown with no bold-led bullets
    // under it (Good to know's caveats are often plain sentences, not
    // claims) — an empty heading with nothing beneath it would read as
    // broken, so a section with nothing to show is skipped rather than
    // printed bare.
    ...RELEASE.sections
      .filter((section) => section.items.length > 0)
      .map((section) =>
        el('section', { class: 'notes-section' },
          el('h3', { class: 'state-label' }, section.title),
          ...section.items.map((item) =>
            el('p', { class: 'note-item' },
              el('strong', { class: 'note-lead' }, item.lead),
              ` ${item.body}`,
            ),
          ),
        ),
      ),
    // D ships no auto-update, by design. A reader who came here looking for
    // a newer version has to be told where one lives, not left guessing.
    el('p', { class: 'caption' },
      'Screepub does not update itself. New releases are at ' +
      'github.com/ssandweiss/screepub/releases.'),
  );
}
