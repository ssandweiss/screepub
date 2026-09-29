// tools/bump-version.ts: the release commit's version bump, all four files
// and the window's notes, or nothing at all.
//
// Cutting 0.7.0 through 0.7.3 by hand found the same things each time: the
// version lives in package.json, Cargo.toml, Cargo.lock's screepub-desktop
// entry and tauri.conf.json, and desktop/ui/notes.js has to be regenerated
// from the notes, whose generator refuses a second paragraph before the
// first heading. These tests run the tool on scratch copies of the real
// files, so they check the files it will really meet.
import { afterAll, describe, expect, test } from 'bun:test';
import { chmodSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { cargoPackageVersion } from '../tools/build-app-bundle';
import { parseReleaseNotes, renderNotesModule } from '../tools/build-desktop-notes';
import {
  NOTES_MODULE, VERSION_FILES, bumpVersion, setCargoLockVersion, setCargoTomlVersion, setJsonVersion,
} from '../tools/bump-version';

const ROOT = join(import.meta.dir, '..');
const SCRATCH = mkdtempSync(join(tmpdir(), 'screepub-bump-version-'));
afterAll(() => rmSync(SCRATCH, { recursive: true, force: true }));

const real = (path: string) => readFileSync(join(ROOT, path), 'utf8');
const CURRENT = (JSON.parse(real('package.json')) as { version: string }).version;

const GOOD_NOTES = `# Screepub 9.8.7

**One line that says what changed.** And a second sentence in the same paragraph.

## Better

- **A claim.** Its explanation,
  wrapped onto a second line.

## Good to know

- A plain caveat.
`;

/** A scratch repo holding copies of the real version files, plus notes. */
function scratchRepo(notes: string | null = GOOD_NOTES, version = '9.8.7'): string {
  const dir = mkdtempSync(join(SCRATCH, 'repo-'));
  for (const file of [...VERSION_FILES, NOTES_MODULE]) {
    mkdirSync(dirname(join(dir, file)), { recursive: true });
    cpSync(join(ROOT, file), join(dir, file));
  }
  mkdirSync(join(dir, 'docs', 'releases'), { recursive: true });
  if (notes !== null) writeFileSync(join(dir, 'docs', 'releases', `${version}.md`), notes);
  return dir;
}

const snapshot = (dir: string) =>
  Object.fromEntries([...VERSION_FILES, NOTES_MODULE].map((f) => [f, readFileSync(join(dir, f), 'utf8')]));

/** The lines of `after` that differ from `before`, which must have as many. */
function changedLines(before: string, after: string): string[] {
  const a = before.split('\n');
  const b = after.split('\n');
  expect(b.length).toBe(a.length);
  return b.filter((line, i) => line !== a[i]);
}

describe('each file changes on its version line and nowhere else', () => {
  test('package.json and tauri.conf.json: the top-level version, formatting kept', () => {
    for (const file of ['package.json', 'desktop/src-tauri/tauri.conf.json']) {
      const before = real(file);
      const after = setJsonVersion(before, '9.8.7', file);
      expect(changedLines(before, after)).toEqual([expect.stringContaining('"version": "9.8.7"')]);
      expect((JSON.parse(after) as { version: string }).version).toBe('9.8.7');
    }
  });

  test('a JSON file the tool would reformat is refused, not rewritten', () => {
    const fourSpaces = '{\n    "name": "x",\n    "version": "1.0.0"\n}\n';
    expect(() => setJsonVersion(fourSpaces, '9.8.7', 'odd.json')).toThrow('odd.json');
    expect(() => setJsonVersion('{\n  "name": "x"\n}\n', '9.8.7', 'none.json')).toThrow('none.json');
  });

  test('Cargo.toml: the [package] version, not a dependency\'s', () => {
    const before = real('desktop/src-tauri/Cargo.toml');
    const after = setCargoTomlVersion(before, '9.8.7');
    expect(changedLines(before, after)).toEqual(['version = "9.8.7"']);
    expect(cargoPackageVersion(after)).toBe('9.8.7');

    const noOwnVersion = '[package]\nname = "x"\n\n[dependencies]\nserde = { version = "1" }\nfoo = "2"\n';
    expect(() => setCargoTomlVersion(noOwnVersion, '9.8.7')).toThrow('[package]');

    // A version line ABOVE [package] (a workspace table, say) stays put.
    const workspaceFirst = '[workspace.package]\nversion = "0.0.1"\n\n[package]\nname = "x"\nversion = "1.0.0"\n';
    expect(setCargoTomlVersion(workspaceFirst, '9.8.7')).toBe(workspaceFirst.replace('"1.0.0"', '"9.8.7"'));
  });

  test('Cargo.lock: the screepub-desktop entry, one line of hundreds', () => {
    const before = real('desktop/src-tauri/Cargo.lock');
    expect((before.match(/^version = /gm) ?? []).length).toBeGreaterThan(100);
    const after = setCargoLockVersion(before, '9.8.7');
    expect(changedLines(before, after)).toEqual(['version = "9.8.7"']);
    expect(after).toContain('[[package]]\nname = "screepub-desktop"\nversion = "9.8.7"\n');
  });

  test('Cargo.lock without exactly one screepub-desktop entry is refused', () => {
    const entry = '[[package]]\nname = "screepub-desktop"\nversion = "1.0.0"\n';
    expect(() => setCargoLockVersion('[[package]]\nname = "other"\nversion = "1.0.0"\n', '9.8.7')).toThrow(
      'screepub-desktop',
    );
    expect(() => setCargoLockVersion(`${entry}\n${entry}`, '9.8.7')).toThrow('screepub-desktop');
  });
});

describe('bumpVersion', () => {
  test('sets all four files and writes the window\'s notes from the release notes', () => {
    const dir = scratchRepo();
    const written = bumpVersion(dir, '9.8.7');
    expect(written).toEqual([...VERSION_FILES, NOTES_MODULE]);
    expect((JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')) as { version: string }).version).toBe('9.8.7');
    expect(cargoPackageVersion(readFileSync(join(dir, 'desktop/src-tauri/Cargo.toml'), 'utf8'))).toBe('9.8.7');
    expect(readFileSync(join(dir, 'desktop/src-tauri/Cargo.lock'), 'utf8')).toContain(
      'name = "screepub-desktop"\nversion = "9.8.7"\n',
    );
    const conf = JSON.parse(readFileSync(join(dir, 'desktop/src-tauri/tauri.conf.json'), 'utf8')) as { version: string };
    expect(conf.version).toBe('9.8.7');
    expect(readFileSync(join(dir, NOTES_MODULE), 'utf8')).toBe(
      renderNotesModule(parseReleaseNotes('9.8.7', GOOD_NOTES)),
    );
  });

  test('a second paragraph before the first heading stops it, and nothing is written', () => {
    // The pre-lede line has to share the headline's paragraph, as
    // docs/releases/0.7.3.md does. On its own line it is a second paragraph.
    const dir = scratchRepo(GOOD_NOTES.replace('\n\n**One line', '\n\n**A pre-lede line.**\n\n**One line'));
    const before = snapshot(dir);
    expect(() => bumpVersion(dir, '9.8.7')).toThrow('second paragraph');
    expect(snapshot(dir)).toEqual(before);
  });

  test('a Cargo.lock it cannot bump stops it before package.json is touched', () => {
    const dir = scratchRepo();
    const lock = join(dir, 'desktop/src-tauri/Cargo.lock');
    writeFileSync(lock, readFileSync(lock, 'utf8').replace('name = "screepub-desktop"', 'name = "renamed"'));
    const before = snapshot(dir);
    expect(() => bumpVersion(dir, '9.8.7')).toThrow('screepub-desktop');
    expect(snapshot(dir)).toEqual(before);
  });

  test('a write that fails part-way is undone, so every file is as it was', () => {
    // tauri.conf.json is written fourth: read-only, it fails after three
    // files already hold the new version.
    const dir = scratchRepo();
    const before = snapshot(dir);
    const conf = join(dir, 'desktop/src-tauri/tauri.conf.json');
    chmodSync(conf, 0o444);
    try {
      expect(() => bumpVersion(dir, '9.8.7')).toThrow();
    } finally {
      chmodSync(conf, 0o644);
    }
    expect(snapshot(dir)).toEqual(before);
  });

  test('missing notes stop it, and nothing is written', () => {
    const dir = scratchRepo(null);
    const before = snapshot(dir);
    expect(() => bumpVersion(dir, '9.8.7')).toThrow('docs/releases/9.8.7.md');
    expect(snapshot(dir)).toEqual(before);
  });

  test('a version the release workflow would reject is refused', () => {
    const dir = scratchRepo();
    const before = snapshot(dir);
    for (const bad of ['v9.8.7', '9.8', '9.8.7.1', '9.8.7-', '']) {
      expect(() => bumpVersion(dir, bad)).toThrow('version');
    }
    expect(snapshot(dir)).toEqual(before);
  });

  test('check mode reads the notes the way the window will, and writes nothing', () => {
    const dir = scratchRepo();
    const before = snapshot(dir);
    expect(bumpVersion(dir, '9.8.7', { check: true })).toEqual([]);
    expect(snapshot(dir)).toEqual(before);
    const bad = scratchRepo('# Screepub 9.8.7\n\nHeadline.\n\nA second paragraph.\n\n## X\n\n- y\n');
    expect(() => bumpVersion(bad, '9.8.7', { check: true })).toThrow('second paragraph');
  });

  test('the real repository\'s files are already in the shape it needs', () => {
    // Bumping to the current version changes no byte of the version files:
    // proof the tool neither reformats nor misses a line on the real files.
    const dir = scratchRepo(real(`docs/releases/${CURRENT}.md`), CURRENT);
    const before = snapshot(dir);
    bumpVersion(dir, CURRENT);
    expect(snapshot(dir)).toEqual(before);
  });
});

describe('the command', () => {
  test('it names every file it wrote, and fails with the reason and nothing written', async () => {
    const dir = scratchRepo();
    const ok = Bun.spawnSync(['bun', join(ROOT, 'tools', 'bump-version.ts'), '9.8.7', '--repo', dir]);
    expect(ok.exitCode).toBe(0);
    const out = ok.stdout.toString();
    for (const file of [...VERSION_FILES, NOTES_MODULE]) expect(out).toContain(file);

    const bad = scratchRepo(null);
    const before = snapshot(bad);
    const refused = Bun.spawnSync(['bun', join(ROOT, 'tools', 'bump-version.ts'), '9.8.7', '--repo', bad]);
    expect(refused.exitCode).toBe(1);
    expect(refused.stderr.toString()).toContain('docs/releases/9.8.7.md');
    expect(snapshot(bad)).toEqual(before);
    expect(existsSync(join(bad, 'docs', 'releases', '9.8.7.md'))).toBe(false);
  });
});

describe('it covers what the release checks at a tag', () => {
  test('every version file release.yml compares with the tag is one this tool sets', () => {
    const checks = real('.github/workflows/release.yml');
    const step = checks.slice(checks.indexOf('Release notes and version are publishable'));
    for (const file of ['package.json', 'desktop/src-tauri/Cargo.toml', 'desktop/src-tauri/tauri.conf.json']) {
      expect(step).toContain(file);
      expect(VERSION_FILES as readonly string[]).toContain(file);
    }
    expect(VERSION_FILES as readonly string[]).toContain('desktop/src-tauri/Cargo.lock');
  });
});
