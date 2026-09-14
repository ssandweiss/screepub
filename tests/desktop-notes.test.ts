import { describe, test, expect } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseReleaseNotes, renderNotesModule } from '../tools/build-desktop-notes';

const REPO = new URL('..', import.meta.url).pathname;
const VERSION = JSON.parse(readFileSync(join(REPO, 'package.json'), 'utf8')).version;
const MARKDOWN = readFileSync(join(REPO, 'docs', 'releases', `${VERSION}.md`), 'utf8');
const GENERATED = readFileSync(join(REPO, 'desktop', 'ui', 'notes.js'), 'utf8');

describe('the notes the window shows are the notes that were written', () => {
  test('the committed module is exactly what the generator produces', () => {
    expect(GENERATED).toBe(renderNotesModule(parseReleaseNotes(VERSION, MARKDOWN)));
  });

  test('it is the running version’s notes, not a stale file', () => {
    // The failure this catches is the one that actually happens: a release
    // bumps package.json and nobody regenerates.
    expect(GENERATED).toContain(`version: ${JSON.stringify(VERSION)}`);
  });

  test('the headline and every section title survive the trip', () => {
    const notes = parseReleaseNotes(VERSION, MARKDOWN);
    expect(notes.headline.length).toBeGreaterThan(10);
    const titles = MARKDOWN.split('\n')
      .filter((l) => l.startsWith('## '))
      .map((l) => l.slice(3).trim());
    expect(notes.sections.map((s) => s.title)).toEqual(titles);
    expect(titles.length).toBeGreaterThan(0);
  });

  test('every bullet keeps its lead and its body', () => {
    const notes = parseReleaseNotes(VERSION, MARKDOWN);
    const items = notes.sections.flatMap((s) => s.items);
    const bullets = MARKDOWN.split('\n').filter((l) => l.startsWith('- **')).length;
    expect(items).toHaveLength(bullets);
    for (const item of items) {
      expect(item.lead.length).toBeGreaterThan(0);
      // A parser that dropped the body would leave a page of bare headings
      // that looks plausible at a glance.
      expect(item.body.length).toBeGreaterThan(0);
      expect(item.lead).not.toContain('**');
      expect(item.body).not.toContain('**');
    }
  });

  test('a wrapped bullet is joined into one sentence, not cut at the newline', () => {
    const notes = parseReleaseNotes('9.9.9', [
      '# Screepub 9.9.9',
      '',
      'A headline.',
      '',
      '## A section',
      '',
      '- **A lead.** A body that runs on',
      '  across a second line and a',
      '  third.',
      '',
    ].join('\n'));
    expect(notes.sections[0].items[0].body).toBe(
      'A body that runs on across a second line and a third.',
    );
  });

  test('the module is plain data, not markup', () => {
    // notes-surface.js builds DOM with el(); a generator that emitted HTML
    // would put a string of markup one innerHTML away from the page.
    expect(GENERATED).not.toContain('<p');
    expect(GENERATED).not.toContain('<div');
    expect(GENERATED).toContain('export const RELEASE');
  });
});

describe('the Notes surface', () => {
  const surface = readFileSync(
    join(REPO, 'desktop', 'ui', 'notes-surface.js'), 'utf8',
  );

  test('it renders the generated data and nothing else', () => {
    expect(surface).toContain('RELEASE');
    expect(surface).not.toContain('innerHTML');
    expect(surface).not.toContain('fetch(');
  });

  test('it says plainly that it does not update itself', () => {
    // The honest limit: D ships no auto-update, so a reader who came here
    // looking for a new version must be told where to get one.
    expect(surface).toContain('github.com/');
  });
});
