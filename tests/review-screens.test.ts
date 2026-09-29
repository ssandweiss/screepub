// tools/review-screens.ts: which pictures a capture changed, shown old
// beside new, so the owner can check them at /release's first moment the
// way he checks the notes, including that nothing real is in frame
// (spec 2026-09-22, part 5).
//
// Run against scratch git repositories, never this one: what changed is
// asked of git, and the answer has to come from a history the test made.
import { afterAll, describe, expect, test } from 'bun:test';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { PICTURE_DIRS, changedPictures, reviewPage } from '../tools/capture/review';
import { SHOTS, outputsFor } from '../tools/capture/shots';

const ROOT = join(import.meta.dir, '..');
const SCRATCH = mkdtempSync(join(tmpdir(), 'screepub-review-screens-'));
afterAll(() => rmSync(SCRATCH, { recursive: true, force: true }));

function git(dir: string, ...args: string[]): void {
  const proc = Bun.spawnSync(['git', ...args], { cwd: dir });
  if (proc.exitCode !== 0) throw new Error(`git ${args.join(' ')} failed: ${proc.stderr.toString()}`);
}

/** Stand-ins for PNGs: the tool compares bytes and never decodes them. */
const png = (label: string) => new TextEncoder().encode(`\x89PNG fake ${label}`);

function put(dir: string, path: string, bytes: Uint8Array | string): void {
  mkdirSync(dirname(join(dir, path)), { recursive: true });
  writeFileSync(join(dir, path), bytes);
}

/** A repository whose last commit holds the light drop picture in both
 *  places, the dark one in the README's, and a stray non-picture file. */
function scratchRepo(): string {
  const dir = mkdtempSync(join(SCRATCH, 'repo-'));
  git(dir, 'init', '-q');
  git(dir, 'config', 'user.email', 'dev@example.com');
  git(dir, 'config', 'user.name', 'Dev');
  git(dir, 'config', 'commit.gpgsign', 'false');
  put(dir, 'assets/screens/drop-light.png', png('drop old'));
  put(dir, 'site/img/drop-light.png', png('drop old'));
  put(dir, 'assets/screens/drop-dark.png', png('dark old'));
  put(dir, 'assets/screens/notes.txt', 'not a picture');
  put(dir, 'README.md', 'readme');
  git(dir, 'add', '-A');
  git(dir, 'commit', '-q', '-m', 'first');
  return dir;
}

const text = (b: Uint8Array | null) => (b === null ? null : new TextDecoder().decode(b));

describe('which pictures changed', () => {
  test('it looks where the capture tool writes, and nowhere else', () => {
    const dirs = [...new Set(SHOTS.flatMap((s) => s.themes.flatMap((t) => outputsFor(s, t))).map(dirname))];
    expect([...PICTURE_DIRS].sort()).toEqual(dirs.sort());
  });

  test('nothing changed: an empty list', () => {
    expect(changedPictures(scratchRepo())).toEqual([]);
  });

  test('the same new picture in two places is one picture to look at, with both paths', () => {
    const dir = scratchRepo();
    put(dir, 'assets/screens/drop-light.png', png('drop new'));
    put(dir, 'site/img/drop-light.png', png('drop new'));
    const found = changedPictures(dir);
    expect(found).toHaveLength(1);
    expect(found[0]!.paths).toEqual(['assets/screens/drop-light.png', 'site/img/drop-light.png']);
    expect(text(found[0]!.before)).toBe(text(png('drop old')));
    expect(text(found[0]!.after)).toBe(text(png('drop new')));
  });

  test('new and removed pictures say so, and a staged change still counts', () => {
    const dir = scratchRepo();
    put(dir, 'assets/screens/hero-light.png', png('hero'));
    rmSync(join(dir, 'assets/screens/drop-dark.png'));
    put(dir, 'site/img/drop-light.png', png('site only'));
    git(dir, 'add', 'site/img/drop-light.png');
    const found = changedPictures(dir);
    expect(found.map((p) => [p.paths, text(p.before), text(p.after)])).toEqual([
      [['assets/screens/drop-dark.png'], text(png('dark old')), null],
      [['assets/screens/hero-light.png'], null, text(png('hero'))],
      [['site/img/drop-light.png'], text(png('drop old')), text(png('site only'))],
    ]);
  });

  test('a staged rename shows the old path going as well as the new one arriving', () => {
    const dir = scratchRepo();
    git(dir, 'mv', 'assets/screens/drop-dark.png', 'assets/screens/drop-night.png');
    const found = changedPictures(dir);
    expect(found.map((p) => [p.paths, text(p.before), text(p.after)])).toEqual([
      [['assets/screens/drop-dark.png'], text(png('dark old')), null],
      [['assets/screens/drop-night.png'], null, text(png('dark old'))],
    ]);
  });

  test('files that are not pictures, or not in those folders, are not its business', () => {
    const dir = scratchRepo();
    put(dir, 'assets/screens/notes.txt', 'changed');
    put(dir, 'README.md', 'changed');
    put(dir, 'assets/other.png', png('elsewhere'));
    expect(changedPictures(dir)).toEqual([]);
  });
});

describe('the page', () => {
  const page = reviewPage([
    { paths: ['assets/screens/drop-light.png', 'site/img/drop-light.png'], before: png('a'), after: png('b') },
    { paths: ['assets/screens/<new>.png'], before: null, after: png('c') },
    { paths: ['assets/screens/gone.png'], before: png('d'), after: null },
  ]);
  const b64 = (label: string) => Buffer.from(png(label)).toString('base64');

  test('every picture is inside it, old beside new, so it opens anywhere on its own', () => {
    for (const label of ['a', 'b', 'c', 'd']) expect(page).toContain(`data:image/png;base64,${b64(label)}`);
    expect(page.indexOf(b64('a'))).toBeLessThan(page.indexOf(b64('b')));
    expect(page).not.toMatch(/src="(?!data:)/);
  });

  test('it names every path, escaped, and says which pictures are new or gone', () => {
    expect(page).toContain('assets/screens/drop-light.png');
    expect(page).toContain('site/img/drop-light.png');
    expect(page).toContain('assets/screens/&lt;new&gt;.png');
    expect(page).not.toContain('<new>');
    expect(page).toContain('No picture before');
    expect(page).toContain('Removed');
  });

  test('it asks for the confidentiality check, in plain words with no em dash', () => {
    expect(page).toContain('anything real in frame');
    expect(page).toContain('Field Station');
    expect(page).not.toMatch(/—|&mdash;/);
  });
});

describe('the command', () => {
  const run = (dir: string, ...args: string[]) => {
    const proc = Bun.spawnSync(['bun', join(ROOT, 'tools', 'review-screens.ts'), '--repo', dir, ...args]);
    return { code: proc.exitCode, out: proc.stdout.toString(), err: proc.stderr.toString() };
  };

  test('nothing changed: one line, and no page', () => {
    const dir = scratchRepo();
    const out = join(SCRATCH, 'unchanged.html');
    const r = run(dir, '--out', out);
    expect(r.code).toBe(0);
    expect(r.out).toBe('No picture changed.\n');
    expect(existsSync(out)).toBe(false);
  });

  test('changes: the page is written, and each picture is named on a line of its own', () => {
    const dir = scratchRepo();
    put(dir, 'assets/screens/drop-light.png', png('drop new'));
    put(dir, 'site/img/drop-light.png', png('drop new'));
    put(dir, 'assets/screens/hero-light.png', png('hero'));
    const out = join(SCRATCH, 'changed.html');
    const r = run(dir, '--out', out);
    expect(r.code).toBe(0);
    expect(r.out.split('\n')).toEqual([
      `2 pictures changed. Old beside new: ${out}`,
      '  changed  assets/screens/drop-light.png site/img/drop-light.png',
      '  new      assets/screens/hero-light.png',
      '',
    ]);
    expect(readFileSync(out, 'utf8')).toContain(Buffer.from(png('hero')).toString('base64'));
  });

  test('without --out it refuses before looking', () => {
    const r = run(scratchRepo());
    expect(r.code).toBe(1);
    expect(r.err).toContain('--out');
  });
});
