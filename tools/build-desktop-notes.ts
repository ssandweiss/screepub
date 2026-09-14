// desktop/ui/notes.js, compiled from docs/releases/<version>.md.
//
// The window has no filesystem and no markdown library, and it must work
// offline, so the notes are turned into data at build time. The subset is
// exactly the shape docs/release-notes-template.md produces: one H1, a
// headline paragraph, and H2 sections whose bullets are either the bold-led
// `**Claim.** Explanation.` form or, under Good to know (template §9), a
// PLAIN caveat sentence — which may end in a `<!-- caveat: ... -->` marker
// that is stripped because the template says it never renders. A plain
// bullet becomes an item with an empty `lead`, not a dropped item: the
// first version of this generator matched only the bold form, which took
// docs/releases/0.5.4.md's Good to know caveat out of the window with no
// error at all. Anything still outside the shape — a heading with no
// bullets under it, or a line that is neither a bullet nor a continuation
// of one — throws rather than dropping it silently.
// tests/desktop-notes.test.ts regenerates and compares.
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export interface ReleaseNotes {
  version: string;
  headline: string;
  sections: { title: string; items: { lead: string; body: string }[] }[];
}

const BOLD_BULLET = /^- \*\*(.+?)\*\*\s*(.*)$/;
const PLAIN_BULLET = /^- (.+)$/;

/** Strip the inline markup the template uses, leaving the sentence. Code
 *  spans and links keep their TEXT, because the text is the sentence. The
 *  caveat marker comment is dropped here too: template §9 says it "does
 *  not render on the GitHub release page", and this window is the same
 *  reader, so it must not render here either. */
function plain(value: string): string {
  return value
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
}

export function parseReleaseNotes(version: string, markdown: string): ReleaseNotes {
  const lines = markdown.split('\n');
  let headline = '';
  const sections: ReleaseNotes['sections'] = [];
  let current: ReleaseNotes['sections'][number] | null = null;
  let open: { lead: string; body: string[] } | null = null;

  const closeItem = () => {
    if (open && current) {
      current.items.push({ lead: open.lead, body: plain(open.body.join(' ')) });
    }
    open = null;
  };

  for (const raw of lines) {
    const line = raw.trimEnd();
    if (line.startsWith('# ')) continue; // the title; version carries it
    if (line.startsWith('## ')) {
      closeItem();
      current = { title: line.slice(3).trim(), items: [] };
      sections.push(current);
      continue;
    }
    const bold = BOLD_BULLET.exec(line);
    if (bold) {
      closeItem();
      open = { lead: plain(bold[1]), body: [bold[2]] };
      continue;
    }
    const plainBullet = PLAIN_BULLET.exec(line);
    if (plainBullet) {
      // Good to know's caveats have no bold claim to separate out, so the
      // whole sentence is the body and the lead is empty rather than a
      // guess at where a claim would have started.
      closeItem();
      open = { lead: '', body: [plainBullet[1]] };
      continue;
    }
    if (open && /^\s+\S/.test(raw)) {
      // A wrapped continuation of the bullet above. Joined with a space,
      // because the newline is the file's margin, not the sentence's.
      open.body.push(line.trim());
      continue;
    }
    closeItem();
    if (line.trim() === '') continue;
    if (current === null) {
      if (headline === '') {
        headline = plain(line);
        continue;
      }
      // A second paragraph before the first heading — the pre-lede slot
      // (template §3.1) or a straight mistake, neither of which this
      // generator understands. Either way it is not the reader's problem
      // to inherit silently.
      throw new Error(
        `${version}.md has a second paragraph before the first "## " heading, ` +
          `which this generator does not understand: ${JSON.stringify(line)}`,
      );
    }
    // A line under a heading that is neither a bullet nor a continuation of
    // one — for example the template's optional intro sentence (§3, Slot
    // 4), which this generator has no slot for. Dropping it would lose
    // words a reader was meant to see, the same way the Good to know bug
    // did, so this throws instead.
    throw new Error(
      `${version}.md has a line under "${current.title}" that is neither a ` +
        `bullet nor a continuation of one: ${JSON.stringify(line)}`,
    );
  }
  closeItem();

  if (headline === '') throw new Error(`${version}.md has no headline paragraph`);
  if (sections.length === 0) throw new Error(`${version}.md has no ## sections`);
  for (const section of sections) {
    if (section.items.length === 0) {
      // A heading with nothing under it never appears in the template —
      // rendering it bare would be exactly the silent-drop failure this
      // generator exists to avoid, so it is caught here instead of at the
      // surface.
      throw new Error(`${version}.md's "## ${section.title}" heading has no bullets under it`);
    }
  }
  return { version, headline, sections };
}

export function renderNotesModule(notes: ReleaseNotes): string {
  return (
    '// GENERATED by tools/build-desktop-notes.ts — do not edit.\n' +
    '// Source: docs/releases/' + notes.version + '.md\n' +
    '// Regenerate with: bun tools/build-desktop-notes.ts\n' +
    'export const RELEASE = {\n' +
    `  version: ${JSON.stringify(notes.version)},\n` +
    `  headline: ${JSON.stringify(notes.headline)},\n` +
    '  sections: [\n' +
    notes.sections
      .map(
        (section) =>
          '    {\n' +
          `      title: ${JSON.stringify(section.title)},\n` +
          '      items: [\n' +
          section.items
            .map(
              (item) =>
                `        { lead: ${JSON.stringify(item.lead)}, ` +
                `body: ${JSON.stringify(item.body)} },\n`,
            )
            .join('') +
          '      ],\n' +
          '    },\n',
      )
      .join('') +
    '  ],\n' +
    '};\n'
  );
}

if (import.meta.main) {
  const repo = join(import.meta.dir, '..');
  const version = JSON.parse(readFileSync(join(repo, 'package.json'), 'utf8')).version;
  const markdown = readFileSync(join(repo, 'docs', 'releases', `${version}.md`), 'utf8');
  writeFileSync(
    join(repo, 'desktop', 'ui', 'notes.js'),
    renderNotesModule(parseReleaseNotes(version, markdown)),
  );
  console.log(`wrote desktop/ui/notes.js from docs/releases/${version}.md`);
}
