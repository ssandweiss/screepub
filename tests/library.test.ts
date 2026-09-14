import { afterAll, describe, test, expect } from 'bun:test';
import {
  chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
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
  const HOME = '/home/ada';

  test('each platform gets its own conventional folder', () => {
    expect(libraryRoot('darwin', { HOME })).toBe('/home/ada/Library/Application Support/Screepub');
    // Windows paths are computed the WINDOWS way even from this Linux test
    // run — that is the seam where a host-flavoured isAbsolute() would have
    // thrown %APPDATA% away.
    expect(libraryRoot('win32', { HOME, APPDATA: 'C:\\Users\\Ada\\AppData\\Roaming' }))
      .toBe('C:\\Users\\Ada\\AppData\\Roaming\\Screepub');
    expect(libraryRoot('linux', { HOME })).toBe('/home/ada/.local/share/screepub');
    expect(libraryRoot('linux', { HOME, XDG_DATA_HOME: '/data/ada' }))
      .toBe('/data/ada/screepub');
  });

  test('SCREEPUB_LIBRARY wins on every platform, and that is the test seam', () => {
    for (const platform of ['darwin', 'win32', 'linux'] as NodeJS.Platform[]) {
      expect(libraryRoot(platform, {
        HOME, APPDATA: 'C:\\Roaming', XDG_DATA_HOME: '/data', SCREEPUB_LIBRARY: '/tmp/lib',
      })).toBe('/tmp/lib');
    }
  });

  test('a blank or relative override is not a library', () => {
    // An empty SCREEPUB_LIBRARY is how an unset variable arrives through a
    // shell wrapper; honouring it would make the library the process's cwd.
    expect(libraryRoot('linux', { HOME, SCREEPUB_LIBRARY: '  ' }))
      .toBe('/home/ada/.local/share/screepub');
    // XDG says a relative XDG_DATA_HOME must be ignored. Resolving it would
    // put the library wherever the window happened to be launched from.
    expect(libraryRoot('linux', { HOME, XDG_DATA_HOME: 'data' }))
      .toBe('/home/ada/.local/share/screepub');
    expect(libraryRoot('win32', { USERPROFILE: 'C:\\Users\\Ada', APPDATA: 'Roaming' }))
      .toBe('C:\\Users\\Ada\\AppData\\Roaming\\Screepub');
  });

  test('USERPROFILE stands in for HOME, as it does on Windows', () => {
    expect(libraryRoot('win32', { USERPROFILE: 'C:\\Users\\Ada' }))
      .toBe('C:\\Users\\Ada\\AppData\\Roaming\\Screepub');
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
