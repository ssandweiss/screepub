import { afterAll, describe, test, expect } from 'bun:test';
import {
  chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, win32 } from 'node:path';
import { adoptSidecar, libraryOutput, libraryRoot } from '../src/library';

const ROOT = new URL('..', import.meta.url).pathname;
const FIXTURES = new URL('./fixtures/', import.meta.url).pathname;
// Every path this file writes to is under here. No test may put anything in
// a real home directory, which is exactly what SCREEPUB_LIBRARY is for.
const SCRATCH = mkdtempSync(join(tmpdir(), 'screepub-library-'));

afterAll(() => {
  // The unwritable-library test leaves a 0o500 directory behind; put it back
  // before rm, or the cleanup fails and the next run inherits it.
  for (const dir of readdirSync(SCRATCH)) {
    try { chmodSync(join(SCRATCH, dir), 0o700); } catch { /* not a directory we locked */ }
  }
  rmSync(SCRATCH, { recursive: true, force: true });
});

let counter = 0;
function scratch(name: string): string {
  const dir = join(SCRATCH, `${name}-${counter++}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

async function runCli(args: string[], env: Record<string, string> = {}) {
  const proc = Bun.spawn(['bun', `${ROOT}src/cli.ts`, ...args], {
    stdout: 'pipe',
    stderr: 'pipe',
    env: { ...process.env, ...env },
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  return { stdout, stderr, exitCode };
}

/** The fixture PDF, copied under a name of our choosing into a scratch
 * folder that stands in for "wherever the user keeps their scripts". */
async function scriptFolderWith(pdfName: string, fixture = 'screenplay.pdf'): Promise<string> {
  const dir = scratch('scripts');
  await Bun.write(join(dir, pdfName), Bun.file(`${FIXTURES}${fixture}`));
  return dir;
}

describe('where the library is', () => {
  // Every platform's answer is checked from this one machine: the paths are
  // the product's promise on three operating systems and only one of them
  // can ever run these tests.
  //
  // This HOME does not exist, which is the point: resolving must not depend
  // on reading anything, and nothing here may touch a real home directory.
  const HOME = '/home/ada';

  test('the library is under Documents, not under application state', () => {
    // A converted book is the user's document, not our state — and
    // ~/Documents/Screepub is where the SwiftUI app this replaces already
    // keeps one.
    expect(libraryRoot('darwin', { HOME })).toBe('/home/ada/Documents/Screepub');
    expect(libraryRoot('linux', { HOME })).toBe('/home/ada/Documents/Screepub');
    // The locations this deliberately moved OFF, named so a revert is loud.
    for (const platform of ['darwin', 'win32', 'linux'] as NodeJS.Platform[]) {
      expect(libraryRoot(platform, { HOME })).not.toContain('.local');
      expect(libraryRoot(platform, { HOME })).not.toContain('Application Support');
      expect(libraryRoot(platform, { HOME })).not.toContain('AppData');
    }
  });

  test('Windows keeps Documents under the profile, the Windows way', () => {
    // Computed with WINDOWS path rules even from this Linux test run — the
    // seam where a host-flavoured join() gets it wrong.
    expect(libraryRoot('win32', { USERPROFILE: 'C:\\Users\\Ada' }))
      .toBe('C:\\Users\\Ada\\Documents\\Screepub');
    // USERPROFILE stands in for HOME, which Windows usually does not set.
    expect(libraryRoot('win32', { HOME: 'C:\\Users\\Bo' }))
      .toBe('C:\\Users\\Bo\\Documents\\Screepub');
  });

  test('SCREEPUB_LIBRARY wins on every platform, and that is the test seam', () => {
    for (const platform of ['darwin', 'win32', 'linux'] as NodeJS.Platform[]) {
      expect(libraryRoot(platform, { HOME, SCREEPUB_LIBRARY: '/tmp/lib' })).toBe('/tmp/lib');
    }
  });

  test('a blank override is not a library', () => {
    // An empty SCREEPUB_LIBRARY is how an unset variable arrives through a
    // shell wrapper; honouring it would make the library the process's cwd.
    expect(libraryRoot('linux', { HOME, SCREEPUB_LIBRARY: '  ' }))
      .toBe('/home/ada/Documents/Screepub');
  });
});

describe('the Documents folder a Linux user actually has', () => {
  /** A fake home with an xdg-user-dirs file in it. Never a real one. */
  function homeWithUserDirs(body: string | null): string {
    const home = scratch('home');
    if (body !== null) {
      mkdirSync(join(home, '.config'), { recursive: true });
      writeFileSync(join(home, '.config', 'user-dirs.dirs'), body);
    }
    return home;
  }

  test('a renamed Documents folder is honoured, not overruled', () => {
    // The whole reason this reads a file: XDG_DOCUMENTS_DIR is almost never
    // in a process's environment — xdg-user-dirs writes it here and only a
    // login shell sources it. A Dutch desktop's folder is "Documenten", and
    // writing to ~/Documents there would make a second one beside it.
    const home = homeWithUserDirs(
      '# generated\nXDG_DESKTOP_DIR="$HOME/Bureaublad"\nXDG_DOCUMENTS_DIR="$HOME/Documenten"\n',
    );
    expect(libraryRoot('linux', { HOME: home })).toBe(join(home, 'Documenten', 'Screepub'));
  });

  test('an absolute path in the file is taken as written', () => {
    const home = homeWithUserDirs('XDG_DOCUMENTS_DIR="/mnt/work/docs"\n');
    expect(libraryRoot('linux', { HOME: home })).toBe('/mnt/work/docs/Screepub');
  });

  test('XDG_CONFIG_HOME says where that file is', () => {
    const home = scratch('home');
    const config = scratch('config');
    writeFileSync(join(config, 'user-dirs.dirs'), 'XDG_DOCUMENTS_DIR="$HOME/Papers"\n');
    expect(libraryRoot('linux', { HOME: home, XDG_CONFIG_HOME: config }))
      .toBe(join(home, 'Papers', 'Screepub'));
  });

  test('the environment variable wins over the file when it is set', () => {
    const home = homeWithUserDirs('XDG_DOCUMENTS_DIR="$HOME/Documenten"\n');
    expect(libraryRoot('linux', { HOME: home, XDG_DOCUMENTS_DIR: '/srv/docs' }))
      .toBe('/srv/docs/Screepub');
  });

  test('the environment branch gets every guard the file branch gets', () => {
    // It used not to: the variable was taken raw, so each of these four was
    // read one way out of the environment and the opposite way out of
    // user-dirs.dirs — the same value, from the same authority, disagreeing
    // with itself. Each case is checked against the FILE's answer for the
    // identical value, so the two can never drift apart again.
    const cases = ['$HOME', '$HOME/', '/', '"$HOME/Documenten"'];
    for (const value of cases) {
      const home = homeWithUserDirs(`XDG_DOCUMENTS_DIR=${value}\n`);
      expect(`${value} → ${libraryRoot('linux', { HOME: home, XDG_DOCUMENTS_DIR: value })}`)
        .toBe(`${value} → ${libraryRoot('linux', { HOME: home })}`);
    }
    // And what those answers are, so agreeing on a wrong answer is not a pass.
    const home = scratch('home');
    for (const value of ['$HOME', '$HOME/', '/']) {
      // "no such folder", and the filesystem root: neither may hold a library.
      expect(libraryRoot('linux', { HOME: home, XDG_DOCUMENTS_DIR: value }))
        .toBe(join(home, 'Documents', 'Screepub'));
    }
    // A quoted value is honoured, not silently dropped on the floor.
    expect(libraryRoot('linux', { HOME: home, XDG_DOCUMENTS_DIR: '"$HOME/Documenten"' }))
      .toBe(join(home, 'Documenten', 'Screepub'));
  });

  test('no file, no entry, or a Documents that is the home itself: ~/Documents', () => {
    // The common path on a minimal install: no user-dirs.dirs at all, and
    // often no Documents folder either. Resolving never creates it — the
    // conversion that needs it does, with mkdir -p.
    const bare = homeWithUserDirs(null);
    expect(libraryRoot('linux', { HOME: bare })).toBe(join(bare, 'Documents', 'Screepub'));
    expect(existsSync(join(bare, 'Documents'))).toBe(false);

    const noEntry = homeWithUserDirs('XDG_MUSIC_DIR="$HOME/Music"\n');
    expect(libraryRoot('linux', { HOME: noEntry })).toBe(join(noEntry, 'Documents', 'Screepub'));

    // xdg-user-dirs writes `"$HOME/"` for "this user has no such folder".
    // Taking it literally would scatter script folders across the home
    // directory, so it falls through to ~/Documents like the others.
    const disabled = homeWithUserDirs('XDG_DOCUMENTS_DIR="$HOME/"\n');
    expect(libraryRoot('linux', { HOME: disabled })).toBe(join(disabled, 'Documents', 'Screepub'));

    const relative = homeWithUserDirs('XDG_DOCUMENTS_DIR="Documenten"\n');
    expect(libraryRoot('linux', { HOME: relative })).toBe(join(relative, 'Documents', 'Screepub'));
  });

  test('macOS and Windows do not read the file, even if one is there', () => {
    // ~/Documents is fixed on both; macOS localizes the display name only.
    const home = homeWithUserDirs('XDG_DOCUMENTS_DIR="$HOME/Documenten"\n');
    expect(libraryRoot('darwin', { HOME: home })).toBe(join(home, 'Documents', 'Screepub'));
    expect(libraryRoot('win32', { HOME: home })).toBe(win32.join(home, 'Documents', 'Screepub'));
  });
});

describe('which folder a script owns', () => {
  test('one folder per script, named for it, holding its whole stem', () => {
    const root = scratch('lib');
    const output = libraryOutput('/scripts/Bright Angel.pdf', root);
    expect(output).toBe(join(root, 'Bright Angel', 'Bright Angel'));
    expect(existsSync(join(root, 'Bright Angel'))).toBe(true);
  });

  test('the same script always comes back to the same folder', () => {
    const root = scratch('lib');
    const first = libraryOutput('/scripts/Draft.pdf', root);
    const second = libraryOutput('/scripts/Draft.pdf', root);
    expect(second).toBe(first);
    // And a relative spelling of the same file is the same file.
    expect(libraryOutput('/scripts/../scripts/Draft.pdf', root)).toBe(first);
  });

  test('two different scripts called the same thing do NOT share a folder', () => {
    // The data-loss bug this exists to prevent: everybody has a Draft.pdf.
    const root = scratch('lib');
    const mine = libraryOutput('/producers/alice/Draft.pdf', root);
    const theirs = libraryOutput('/producers/bob/Draft.pdf', root);
    expect(theirs).not.toBe(mine);
    // The first one keeps the plain name; the second is marked, not renamed
    // past recognition.
    expect(mine).toBe(join(root, 'Draft', 'Draft'));
    expect(basename(dirname(theirs))).toMatch(/^Draft-[0-9a-f]{8}$/);
    // Both are stable, so neither ever moves out from under its own book.
    expect(libraryOutput('/producers/bob/Draft.pdf', root)).toBe(theirs);
    expect(libraryOutput('/producers/alice/Draft.pdf', root)).toBe(mine);
  });

  test('the hashed name is not a free-for-all either', () => {
    // A script really called `Draft-5a47cba7` owns that folder by its PLAIN
    // name. Handing it to some other Draft.pdf — which is where the hashed
    // candidate lands — overwrote its marker and orphaned it from its own
    // .epub: it would come back next time to a further-hashed folder and
    // find none of its files.
    // What the intruder's hashed name WILL be, learned from a throwaway
    // library rather than hard-coded. Getting this by hand is how the first
    // draft of this test quietly stopped testing anything: on a fresh root
    // `Draft` is free, so the intruder never reaches its hashed name at all
    // and the test re-ran the ordinary collision.
    const probe = scratch('lib');
    libraryOutput('/x/Draft.pdf', probe);
    const hashed = basename(dirname(libraryOutput('/producers/bob/Draft.pdf', probe)));
    expect(hashed).toMatch(/^Draft-[0-9a-f]{8}$/);

    // Now a library where `Draft` is somebody else's AND a script genuinely
    // called `Draft-<those 8 hex>` has already claimed its own plain name.
    const root = scratch('lib');
    libraryOutput('/x/Draft.pdf', root);
    const decoy = libraryOutput(`/a/${hashed}.pdf`, root);
    expect(dirname(decoy)).toBe(join(root, hashed));

    const intruder = libraryOutput('/producers/bob/Draft.pdf', root);
    expect(dirname(intruder)).not.toBe(join(root, hashed));
    expect(basename(dirname(intruder))).toMatch(/^Draft-[0-9a-f]{12}$/);
    // The marker is still the decoy's — this is the value the bug rewrote,
    // and rewriting it orphaned the decoy from its own .epub.
    expect(JSON.parse(readFileSync(join(root, hashed, 'source.json'), 'utf8')))
      .toEqual({ source: `/a/${hashed}.pdf` });
    // So the decoy still comes home to its own folder, not a further-hashed
    // one, and the intruder is stable too.
    expect(libraryOutput(`/a/${hashed}.pdf`, root)).toBe(decoy);
    expect(libraryOutput('/producers/bob/Draft.pdf', root)).toBe(intruder);
  });

  test('a FILE standing where the folder would go is not clobbered', () => {
    // Not hypothetical: the SwiftUI app writes its library flat, so
    // `~/Documents/Screepub/Draft.epub` is a file it made — and a PDF called
    // `Draft.epub.pdf` asks for exactly that name. It is the existsSync
    // check plus recordedSource failing with ENOTDIR that reroutes this, not
    // any "files and folders cannot collide" property.
    const root = scratch('lib');
    writeFileSync(join(root, 'Draft.epub'), 'the Mac app’s book');
    const output = libraryOutput('/scripts/Draft.epub.pdf', root);
    expect(basename(dirname(output))).toMatch(/^Draft\.epub-[0-9a-f]{8}$/);
    expect(readFileSync(join(root, 'Draft.epub'), 'utf8')).toBe('the Mac app’s book');
  });

  test('a folder the engine did not make is left alone', () => {
    const root = scratch('lib');
    mkdirSync(join(root, 'Notes'));
    writeFileSync(join(root, 'Notes', 'mine.txt'), 'not the library’s');
    const output = libraryOutput('/scripts/Notes.pdf', root);
    expect(dirname(output)).not.toBe(join(root, 'Notes'));
    expect(readdirSync(join(root, 'Notes'))).toEqual(['mine.txt']);
  });
});

describe('tuning follows the script into the library', () => {
  test('a sidecar beside the PDF is adopted on the first library conversion', () => {
    const root = scratch('lib');
    const scripts = scratch('scripts');
    writeFileSync(join(scripts, 'Draft.pdf'), 'not really a pdf');
    writeFileSync(join(scripts, 'Draft.screepub.json'), '{"cueIndentPct": 41}');

    const output = libraryOutput(join(scripts, 'Draft.pdf'), root);
    expect(adoptSidecar(join(scripts, 'Draft.pdf'), output)).toBe(true);
    expect(JSON.parse(readFileSync(`${output}.screepub.json`, 'utf8'))).toEqual({ cueIndentPct: 41 });
  });

  test('tuning already in the library is never overwritten by the old copy', () => {
    const root = scratch('lib');
    const scripts = scratch('scripts');
    writeFileSync(join(scripts, 'Draft.pdf'), 'not really a pdf');
    writeFileSync(join(scripts, 'Draft.screepub.json'), '{"cueIndentPct": 41}');
    const output = libraryOutput(join(scripts, 'Draft.pdf'), root);
    writeFileSync(`${output}.screepub.json`, '{"cueIndentPct": 12}');

    expect(adoptSidecar(join(scripts, 'Draft.pdf'), output)).toBe(false);
    // The value it would have been overwritten WITH is 41; asserting it is
    // still 12 is the only way this test can fail on a wrong implementation.
    expect(JSON.parse(readFileSync(`${output}.screepub.json`, 'utf8'))).toEqual({ cueIndentPct: 12 });
  });

  test('nothing to adopt is not a failure', () => {
    const root = scratch('lib');
    const scripts = scratch('scripts');
    writeFileSync(join(scripts, 'Draft.pdf'), 'not really a pdf');
    const output = libraryOutput(join(scripts, 'Draft.pdf'), root);
    expect(adoptSidecar(join(scripts, 'Draft.pdf'), output)).toBe(false);
    expect(existsSync(`${output}.screepub.json`)).toBe(false);
  });
});

describe('the CLI with --library', () => {
  test('nothing lands beside the PDF, and everything lands in the library', async () => {
    const scripts = await scriptFolderWith('Bright Angel.pdf');
    const root = join(scratch('lib'), 'not-yet-made');
    const before = readdirSync(scripts);

    const { stdout, exitCode } = await runCli(
      [join(scripts, 'Bright Angel.pdf'), '--library', '--json'],
      { SCREEPUB_LIBRARY: root },
    );
    expect(exitCode).toBe(0);
    const answer = JSON.parse(stdout);
    expect(answer.ok).toBe(true);

    // The whole point: the user's folder is exactly as they left it.
    expect(readdirSync(scripts)).toEqual(before);
    expect(before).toEqual(['Bright Angel.pdf']);

    const folder = join(root, 'Bright Angel');
    expect(answer.epubPath).toBe(join(folder, 'Bright Angel.epub'));
    expect(answer.fountainPath).toBe(join(folder, 'Bright Angel.fountain'));
    expect(existsSync(answer.epubPath)).toBe(true);
    expect(existsSync(answer.fountainPath)).toBe(true);
    // A library root that did not exist is made on demand, not up front.
    expect(readdirSync(folder).sort())
      .toEqual(['Bright Angel.epub', 'Bright Angel.fountain', 'source.json'].sort());
  }, 90000);

  test('without --library the CLI still writes beside its input', async () => {
    // The command-line default is deliberately unchanged; scripts already
    // rely on it, and a tool that hides its output somewhere in ~ is not one.
    const scripts = await scriptFolderWith('Beside.pdf');
    const root = scratch('lib');
    const { exitCode } = await runCli([join(scripts, 'Beside.pdf'), '--json'],
      { SCREEPUB_LIBRARY: root });
    expect(exitCode).toBe(0);
    expect(readdirSync(scripts).sort()).toEqual(['Beside.epub', 'Beside.fountain', 'Beside.pdf']);
    expect(readdirSync(root)).toEqual([]);
  }, 90000);

  test('a sidecar beside the PDF survives the move into the library', async () => {
    const scripts = await scriptFolderWith('Tuned.pdf');
    const root = scratch('lib');
    // 41 is not the default — options.test.ts pins the defaults to
    // format-defaults.json — so finding 41 in the library proves the file
    // travelled rather than being reinvented.
    writeFileSync(join(scripts, 'Tuned.screepub.json'), '{"cueIndentPct":41}\n');
    const defaults = JSON.parse(readFileSync(`${ROOT}format-defaults.json`, 'utf8'));
    expect(defaults.cueIndentPct).not.toBe(41);

    const { stdout, exitCode } = await runCli(
      [join(scripts, 'Tuned.pdf'), '--library', '--json'], { SCREEPUB_LIBRARY: root },
    );
    expect(exitCode).toBe(0);
    const answer = JSON.parse(stdout);

    // Read it back the way the window does: `screepub settings` on the
    // library .fountain, which is the path the answer just handed over.
    const said = await runCli(['settings', answer.fountainPath, '--json']);
    expect(said.exitCode).toBe(0);
    const settings = JSON.parse(said.stdout);
    expect(settings.settings.cueIndentPct).toBe(41);
    expect(settings.sidecar).toBe(join(root, 'Tuned', 'Tuned.screepub.json'));
  }, 90000);

  test('a refused input leaves NO trace in the library', async () => {
    // The library used to be opened before the input was even looked at, so
    // every typo'd path and every wrong file type left a permanent marked
    // folder behind — and it claimed the PLAIN stem name, so the real script
    // called that would afterwards be pushed into a hashed folder by a file
    // that never converted.
    const root = scratch('lib');
    const scripts = scratch('scripts');
    writeFileSync(join(scripts, 'readme.md'), '# not a screenplay\n');

    const wrongType = await runCli([join(scripts, 'readme.md'), '--library', '--json'],
      { SCREEPUB_LIBRARY: root });
    expect(JSON.parse(wrongType.stdout).error.code).toBe('unsupported-type');

    const missing = await runCli([join(scripts, 'ghost.pdf'), '--library', '--json'],
      { SCREEPUB_LIBRARY: root });
    expect(JSON.parse(missing.stdout).error.code).toBe('unreadable');

    const notScreenplay = await runCli([`${FIXTURES}prose.pdf`, '--library', '--json'],
      { SCREEPUB_LIBRARY: root });
    expect(JSON.parse(notScreenplay.stdout).error.code).toBe('not-screenplay');

    // Not "no folder called readme" — NOTHING. The root itself is untouched.
    expect(readdirSync(root)).toEqual([]);
    expect(readdirSync(scripts)).toEqual(['readme.md']);

    // And the name is still free, so the real script of that name gets it.
    const real = await scriptFolderWith('readme.pdf');
    const { stdout } = await runCli([join(real, 'readme.pdf'), '--library', '--json'],
      { SCREEPUB_LIBRARY: root });
    expect(JSON.parse(stdout).epubPath).toBe(join(root, 'readme', 'readme.epub'));
  }, 90000);

  test('--library and -o together is a refusal, not a silent winner', async () => {
    const scripts = await scriptFolderWith('Both.pdf');
    const out = join(scratch('out'), 'both.epub');
    const { stdout, exitCode } = await runCli(
      [join(scripts, 'Both.pdf'), '--library', '-o', out, '--json'],
      { SCREEPUB_LIBRARY: scratch('lib') },
    );
    expect(exitCode).toBe(1);
    expect(JSON.parse(stdout).error.code).toBe('usage');
    // Neither destination was written: the refusal comes before any work.
    expect(existsSync(out)).toBe(false);
  }, 30000);

  test('a library it cannot make is one JSON object, not a stack trace', async () => {
    const locked = scratch('locked');
    chmodSync(locked, 0o500);
    const scripts = await scriptFolderWith('NoRoom.pdf');

    const { stdout, stderr, exitCode } = await runCli(
      [join(scripts, 'NoRoom.pdf'), '--library', '--json'],
      { SCREEPUB_LIBRARY: join(locked, 'screepub') },
    );
    expect(exitCode).toBe(1);
    // Exactly one object on stdout, which is the whole of the --json
    // contract, and the code the window has a heading for.
    const answer = JSON.parse(stdout.trim());
    expect(answer).toEqual({
      ok: false,
      error: { code: 'library', message: expect.stringContaining('library folder') },
    });
    expect(stdout.trim().split('\n').length).toBe(1);
    expect(stderr).toBe('');
    // It failed before converting, not after: nothing was written anywhere.
    expect(readdirSync(scripts)).toEqual(['NoRoom.pdf']);
  }, 30000);
});
