// tests/fixtures/field-station.pdf is the invented feature every README and
// site picture shows. Two things must hold for the pictures to be honest:
// the engine reads it as a real screenplay (so the result screen's counts
// and the scene index look like a feature), and the scene the SITE draws
// really is in the book, word for word, on the pages the site says, so the
// site's before-and-after and the window's pictures show one story.
import { afterAll, beforeAll, describe, test, expect } from 'bun:test';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname;
const PDF = join(ROOT, 'tests', 'fixtures', 'field-station.pdf');
const SCRATCH = mkdtempSync(join(tmpdir(), 'screepub-field-station-'));

type Answer = {
  ok: boolean; title: string; pages: number; scenes: number; characters: number;
  topCharacters: string[]; fountainPath: string;
};

// One conversion for the whole file: every test reads the same answer and
// the same .fountain, which lands in SCRATCH beside the book.
let answer: Answer;

beforeAll(async () => {
  const proc = Bun.spawn(
    ['bun', join(ROOT, 'src', 'cli.ts'), PDF, '--json', '-o', join(SCRATCH, 'field-station.epub')],
    { stdout: 'pipe', stderr: 'pipe' },
  );
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  if (exitCode !== 0) throw new Error(`cli exited ${exitCode} on field-station.pdf:\n${stderr}`);
  answer = JSON.parse(stdout) as Answer;
});

afterAll(() => rmSync(SCRATCH, { recursive: true, force: true }));

/** site/index.html's window.SCENE, read out of the page itself. */
function siteScene(): [string, string][] {
  const html = readFileSync(join(ROOT, 'site', 'index.html'), 'utf8');
  const m = /window\.SCENE = (\[[\s\S]*?\n\]);/.exec(html);
  if (!m) throw new Error('site/index.html no longer declares window.SCENE');
  // Our own file, and an array literal of string pairs.
  return new Function(`return ${m[1]}`)() as [string, string][];
}

// The same straightening the generator's ASCII_MAP does, plus the engine's
// own curly quotes back to straight, so the site's text and the book's text
// compare as what a reader sees.
const plain = (s: string) =>
  s
    .replace(/[’‘]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/—/g, '--')
    .replace(/–/g, '-')
    .replace(/…/g, '...')
    .replace(/\s+/g, ' ')
    .trim();

describe('Field Station', () => {
  test('the engine reads it as a feature, with the invented title and cast', () => {
    expect(answer.ok).toBe(true);
    expect(answer.title.toUpperCase()).toBe('FIELD STATION');
    expect(answer.scenes).toBe(11);
    expect(answer.pages).toBe(19);
    expect(answer.characters).toBe(4);
    expect([...answer.topCharacters].sort()).toEqual(['DELACROIX', 'IVERSEN', 'MARA', 'TEO']);
  });

  // What this proves: every row of the site's scene is in the book, in the
  // site's order, on the printed page the site's own marker puts it on, and
  // every speech is said by the character the site gives it to. The book is
  // split at its `= pg N` page markers (registry 13a); walking SCENE, a `pg`
  // row switches page, a cue is looked for together with its speech as
  // `@CUE speech`, and each match must come after the one before it on that
  // page. So a line that moves page, changes speaker, or swaps order fails,
  // as does the site renumbering its pages or losing its scene.
  test('the site’s scene is in the book, word for word, on the pages the site says', () => {
    const pages = new Map<number, string>();
    const parts = readFileSync(answer.fountainPath, 'utf8').split(/^= pg (\d+)$/m);
    for (let i = 1; i < parts.length; i += 2) pages.set(Number(parts[i]), plain(parts[i + 1]!));

    const scene = siteScene();
    expect(scene.filter(([k]) => k === 'pg').map(([, t]) => parseInt(t, 10))).toEqual([14, 15, 16, 17, 18]);
    // Not a vacuous walk: the site's scene is five pages of rows, not a stub.
    expect(scene.filter(([k]) => k !== 'pg').length).toBeGreaterThanOrEqual(40);

    let page = 0, from = 0;
    scene.forEach(([kind, text], i) => {
      if (kind === 'pg') { page = parseInt(text, 10); from = 0; return; }
      if (kind === 'd') return; // checked with its cue
      const want = kind === 'c' ? `@${plain(text)} ${plain(scene[i + 1]![1])}` : plain(text);
      const at = (pages.get(page) ?? '').indexOf(want, from);
      expect(at, `page ${page}: ${want}`).toBeGreaterThanOrEqual(0);
      from = at + want.length;
    });
  });
});
