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

  test('every bullet keeps its lead and its body, bold-led or plain', () => {
    // docs/release-notes-template.md §9 allows a Good to know caveat with
    // no bold claim at all — a plain "- <caveat>" line. The first version
    // of this test counted only "- **" lines, which is what let the parser
    // drop 0.5.4.md's caveat without either of them noticing: a count that
    // only measures the bold form agrees with a parser that only keeps the
    // bold form. Every "- " line, bold or plain, is a bullet.
    const notes = parseReleaseNotes(VERSION, MARKDOWN);
    const items = notes.sections.flatMap((s) => s.items);
    const bulletLines = MARKDOWN.split('\n').filter((l) => l.startsWith('- '));
    const boldLines = bulletLines.filter((l) => l.startsWith('- **'));
    const plainLines = bulletLines.filter((l) => !l.startsWith('- **'));
    expect(items).toHaveLength(bulletLines.length);
    // Bold bullets keep their lead; plain ones (Good to know) have none —
    // asserting both counts catches a parser that keeps the right TOTAL by
    // miscounting which lines are which.
    expect(items.filter((i) => i.lead.length > 0)).toHaveLength(boldLines.length);
    expect(items.filter((i) => i.lead.length === 0)).toHaveLength(plainLines.length);
    for (const item of items) {
      // A parser that dropped the body would leave a page of bare headings
      // that looks plausible at a glance.
      expect(item.body.length).toBeGreaterThan(0);
      expect(item.lead).not.toContain('**');
      expect(item.body).not.toContain('**');
      // The caveat marker is bookkeeping for the next release file, not a
      // sentence a reader should see.
      expect(item.body).not.toContain('<!--');
    }
  });

  test('the Good to know caveat is not dropped', () => {
    // The bug this whole fix round is about: a plain caveat bullet parsed
    // to zero items and the window showed nothing where the caveat used to
    // be, with no error anywhere. This reconstructs the caveat's text a
    // SECOND way — by slicing the raw lines under the heading, not by
    // reusing the source's bullet regex or its open/continuation state —
    // so this test cannot agree with the parser just because it shares its
    // bug.
    const notes = parseReleaseNotes(VERSION, MARKDOWN);
    const goodToKnow = notes.sections.find((s) => s.title === 'Good to know');
    expect(goodToKnow).toBeDefined();

    const lines = MARKDOWN.split('\n');
    const start = lines.indexOf('## Good to know') + 1;
    expect(start).toBeGreaterThan(0);
    const rest = lines.slice(start);
    const end = rest.findIndex((l) => l.startsWith('## '));
    const section = (end === -1 ? rest : rest.slice(0, end)).filter((l) => l.trim() !== '');
    const reference = section
      .join(' ')
      .replace(/<!--.*?-->/g, '')
      .replace(/\s+/g, ' ')
      .trim()
      .replace(/^-\s*/, '');

    expect(reference.length).toBeGreaterThan(20);
    expect(goodToKnow!.items).toHaveLength(1);
    expect(goodToKnow!.items[0].lead).toBe('');
    expect(goodToKnow!.items[0].body).toBe(reference);
  });

  test('a line under a heading that is neither a bullet nor a continuation ' +
    'is a template violation, not a silent drop', () => {
    const md = [
      '# Screepub 9.9.9', '', 'A headline.', '',
      '## A section', '', 'A stray paragraph, not a bullet.', '',
    ].join('\n');
    expect(() => parseReleaseNotes('9.9.9', md)).toThrow();
  });

  test('a heading with no bullets under it is a template violation, not a ' +
    'bare heading in the window', () => {
    const md = [
      '# Screepub 9.9.9', '', 'A headline.', '',
      '## Empty', '',
      '## A section', '', '- **A lead.** A body.', '',
    ].join('\n');
    expect(() => parseReleaseNotes('9.9.9', md)).toThrow();
  });

  test('a plain Good to know bullet becomes an item with no lead', () => {
    const notes = parseReleaseNotes('9.9.9', [
      '# Screepub 9.9.9', '', 'A headline.', '',
      '## Good to know', '',
      '- A caveat with no bold claim, spanning',
      '  a second line. <!-- caveat: registry-1 -->',
      '',
    ].join('\n'));
    expect(notes.sections[0].items[0]).toEqual({
      lead: '',
      body: 'A caveat with no bold claim, spanning a second line.',
    });
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

  test('a section with no items is never shown, so a heading cannot render bare', async () => {
    // What the surface decides lives in a pure, exported function — no DOM
    // emulator needed to prove a section with nothing under it is dropped
    // rather than printed as an empty heading. A dynamic import, like
    // tests/desktop-ui.test.ts uses throughout, because desktop/ui/*.js
    // ships no type declarations for a static import to resolve.
    const { visibleSections } = await import(join(REPO, 'desktop', 'ui', 'notes-surface.js'));
    const sections = [
      { title: 'Good to know', items: [] },
      { title: 'What changed', items: [{ lead: 'A lead.', body: 'A body.' }] },
    ];
    expect(visibleSections(sections).map((s: { title: string }) => s.title))
      .toEqual(['What changed']);
  });
});
