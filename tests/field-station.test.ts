// tests/fixtures/field-station.pdf is the invented feature every README and
// site picture shows. Two things must hold for the pictures to be honest:
// the engine reads it as a real screenplay (so the result screen's counts
// and the scene index look like a feature), and the scene the SITE draws
// really is in the book, word for word, on the pages the site says, so the
// site's before-and-after and the window's pictures show one story.
import { describe, test, expect } from 'bun:test';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname;
const PDF = join(ROOT, 'tests', 'fixtures', 'field-station.pdf');

async function convert() {
  const out = mkdtempSync(join(tmpdir(), 'screepub-field-station-'));
  const proc = Bun.spawn(
    ['bun', join(ROOT, 'src', 'cli.ts'), PDF, '--json', '-o', join(out, 'field-station.epub')],
    { stdout: 'pipe', stderr: 'pipe' },
  );
  const [stdout, code] = await Promise.all([new Response(proc.stdout).text(), proc.exited]);
  expect(code).toBe(0);
  return JSON.parse(stdout) as {
    ok: boolean; title: string; pages: number; scenes: number; characters: number;
    fountainPath: string;
  };
}

/** site/index.html's window.SCENE, read out of the page itself. */
function siteScene(): [string, string][] {
  const html = readFileSync(join(ROOT, 'site', 'index.html'), 'utf8');
  const m = /window\.SCENE = (\[[\s\S]*?\n\]);/.exec(html);
  if (!m) throw new Error('site/index.html no longer declares window.SCENE');
  // Our own file, and an array literal of string pairs.
  return new Function(`return ${m[1]}`)() as [string, string][];
}

const plain = (s: string) =>
  s.replace(/[’‘]/g, "'").replace(/[“”]/g, '"').replace(/\s+/g, ' ').trim();

describe('Field Station', () => {
  test('the engine reads it as a feature, with the invented title and cast', async () => {
    const a = await convert();
    expect(a.ok).toBe(true);
    expect(a.title.toUpperCase()).toBe('FIELD STATION');
    expect(a.scenes).toBe(11);
    expect(a.pages).toBeGreaterThanOrEqual(18);
    expect(a.characters).toBeGreaterThanOrEqual(3);
  });

  test('every line of the site’s scene is in the book, word for word', async () => {
    const a = await convert();
    const fountain = plain(readFileSync(a.fountainPath, 'utf8'));
    for (const [kind, text] of siteScene()) {
      if (kind === 'pg' || kind === 'c') continue; // markers, and cues the engine normalises
      expect(fountain).toContain(plain(text));
    }
  });

  test('the site’s scene starts on printed page 14, as the site says it does', async () => {
    const a = await convert();
    const fountain = readFileSync(a.fountainPath, 'utf8');
    // Page markers travel as synopsis lines, `= pg N` (registry 13a).
    const at14 = fountain.indexOf('= pg 14');
    const scene = fountain.indexOf('INT. FIELD STATION - NIGHT');
    expect(at14).toBeGreaterThanOrEqual(0);
    expect(scene).toBeGreaterThan(at14);
    expect(fountain.indexOf('= pg 15')).toBeGreaterThan(scene);
  });
});
