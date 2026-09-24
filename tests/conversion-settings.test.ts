// A script's saved settings must reach the book this conversion produces —
// not just a later re-render. The library ADOPTED a sidecar and then handed
// the reader a book built at the defaults: `--for epub` returns the library
// EPUB untouched and the KFX/AZW3 rungs convert it as it stands, so a Kobo,
// a tolino, a reMarkable and most Kindles got the defaults.
//
// Every assertion here is a DISAGREEMENT: the same fixture, converted with
// and without the sidecar, must produce different CSS, and the value asserted
// is one the defaults do not carry.
import { afterAll, beforeAll, describe, test, expect } from 'bun:test';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import JSZip from 'jszip';
import { libraryOutput } from '../src/library';
import { writeAppSettings } from '../src/settings/app';

const ROOT = new URL('..', import.meta.url).pathname;
const FIXTURES = new URL('./fixtures/', import.meta.url).pathname;
// Nothing here goes anywhere near a real home directory or the committed
// fixtures folder: the PDF is COPIED out, because a sidecar beside the input
// is the whole subject and tests/fixtures/ holds exactly its five files.
const SCRATCH = mkdtempSync(join(tmpdir(), 'screepub-convert-settings-'));

afterAll(() => rmSync(SCRATCH, { recursive: true, force: true }));

let counter = 0;
function scratch(name: string): string {
  const dir = join(SCRATCH, `${name}-${counter++}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

/** The fixture PDF under a scratch name, plus the folder holding it. */
async function scriptFolder(pdfName = 'Tuned.pdf'): Promise<string> {
  const dir = scratch('scripts');
  await Bun.write(join(dir, pdfName), Bun.file(`${FIXTURES}screenplay.pdf`));
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

/** The stylesheet out of a built EPUB — where every knob this file moves
 * becomes something a reader can see. */
async function epubCss(path: string): Promise<string> {
  const zip = await JSZip.loadAsync(readFileSync(path));
  const name = Object.keys(zip.files).find((f) => f.endsWith('.css'));
  if (name === undefined) throw new Error(`no stylesheet in ${path}`);
  return zip.file(name)!.async('string');
}

// The knobs are chosen for visibility: dialogueSideMarginPct is written
// unconditionally into .dialogue-block, and cueIndentPct only appears when
// cueAlignment is 'indented' — so a sidecar carrying both proves the merge
// carried more than one key.
const DEFAULTS = JSON.parse(readFileSync(`${ROOT}format-defaults.json`, 'utf8'));
const SIDE = 7;
const CUE = 41;

beforeAll(() => {
  // If a "distinctive" value were ever the default, every test below would
  // pass against an implementation that does nothing at all.
  expect(DEFAULTS.dialogueSideMarginPct).not.toBe(SIDE);
  expect(DEFAULTS.cueIndentPct).not.toBe(CUE);
  expect(DEFAULTS.cueAlignment).toBe('centered');
});

const TUNING = JSON.stringify({
  dialogueSideMarginPct: SIDE,
  cueIndentPct: CUE,
  cueAlignment: 'indented',
});

describe('a conversion renders with the script it is converting', () => {
  test('the same PDF converts differently with and without its sidecar', async () => {
    const withIt = await scriptFolder('With.pdf');
    writeFileSync(join(withIt, 'With.screepub.json'), `${TUNING}\n`);
    const without = await scriptFolder('Without.pdf');

    const a = await runCli([
      join(withIt, 'With.pdf'), '-o', join(scratch('out'), 'with.epub'), '--no-fountain', '--json',
    ]);
    const b = await runCli([
      join(without, 'Without.pdf'), '-o', join(scratch('out'), 'without.epub'), '--no-fountain',
      '--json',
    ]);
    expect(a.exitCode).toBe(0);
    expect(b.exitCode).toBe(0);

    const tuned = await epubCss(JSON.parse(a.stdout).epubPath);
    const plain = await epubCss(JSON.parse(b.stdout).epubPath);
    // Disagreement first: whatever else is true, these two books are not the
    // same book, and they differ in the place the sidecar named.
    expect(tuned).not.toBe(plain);
    expect(tuned).toContain(`margin-left: ${SIDE}%`);
    expect(plain).toContain(`margin-left: ${DEFAULTS.dialogueSideMarginPct}%`);
    expect(plain).not.toContain(`margin-left: ${SIDE}%`);
    // The second key, and the one it enables: a merge that carried only the
    // first would pass everything above.
    expect(tuned).toContain(`margin-left: ${CUE}%`);
    expect(plain).not.toContain(`margin-left: ${CUE}%`);
  }, 120000);

  test('--library renders with the sidecar it adopts, on the FIRST conversion', async () => {
    // The defect exactly: adoptSidecar copied the file in, and the book that
    // had just been built knew nothing about it.
    const scripts = await scriptFolder('Adopted.pdf');
    writeFileSync(join(scripts, 'Adopted.screepub.json'), `${TUNING}\n`);
    const root = scratch('lib');

    const { stdout, stderr, exitCode } = await runCli(
      [join(scripts, 'Adopted.pdf'), '--library', '--json'], { SCREEPUB_LIBRARY: root },
    );
    expect(exitCode).toBe(0);
    const answer = JSON.parse(stdout);
    expect(answer.ok).toBe(true);
    expect(await epubCss(answer.epubPath)).toContain(`margin-left: ${SIDE}%`);

    // Said out loud, and on stderr — stdout is one JSON object and nothing
    // else, which parsing it above already proved.
    expect(stderr).toContain('saved settings');
    expect(stderr).toContain(join(scripts, 'Adopted.screepub.json'));
    expect(answer.settingsPath).toBe(join(scripts, 'Adopted.screepub.json'));
  }, 120000);

  test('a sidecar already in the library outranks the old copy beside the PDF', async () => {
    const scripts = await scriptFolder('Both.pdf');
    const root = scratch('lib');
    // The library's word, written the way `screepub settings` writes it.
    const prefix = libraryOutput(join(scripts, 'Both.pdf'), root);
    writeFileSync(`${prefix}.screepub.json`, `${TUNING}\n`);
    // The stale copy beside the PDF says something else entirely. 29 is the
    // value this test would show if the wrong file won.
    writeFileSync(join(scripts, 'Both.screepub.json'), '{"dialogueSideMarginPct":29}\n');

    const { stdout, exitCode } = await runCli(
      [join(scripts, 'Both.pdf'), '--library', '--json'], { SCREEPUB_LIBRARY: root },
    );
    expect(exitCode).toBe(0);
    const answer = JSON.parse(stdout);
    expect(answer.settingsPath).toBe(`${prefix}.screepub.json`);
    const css = await epubCss(answer.epubPath);
    expect(css).toContain(`margin-left: ${SIDE}%`);
    expect(css).not.toContain('margin-left: 29%');
  }, 120000);

  test('an explicit --options-json wins, knob by knob, over the sidecar', async () => {
    const scripts = await scriptFolder('Flagged.pdf');
    writeFileSync(join(scripts, 'Flagged.screepub.json'), `${TUNING}\n`);
    const out = join(scratch('out'), 'flagged.epub');

    const { stdout, stderr, exitCode } = await runCli([
      join(scripts, 'Flagged.pdf'), '-o', out, '--no-fountain', '--json',
      '--options-json', JSON.stringify({ dialogueSideMarginPct: 13 }),
    ]);
    expect(exitCode).toBe(0);
    const css = await epubCss(JSON.parse(stdout).epubPath);
    // The knob the flag names is the flag's.
    expect(css).toContain('margin-left: 13%');
    expect(css).not.toContain(`margin-left: ${SIDE}%`);
    // The knobs it does not name are still the script's — NOT the defaults,
    // which is what a merge written as "flag or sidecar" would give.
    expect(css).toContain(`margin-left: ${CUE}%`);
    expect(stderr).toContain('override them');
  }, 120000);

  test('a malformed sidecar is ignored out loud, not fatally', async () => {
    const scripts = await scriptFolder('Broken.pdf');
    writeFileSync(join(scripts, 'Broken.screepub.json'), '{"dialogueSideMarginPct": 7,,,\n');
    const out = join(scratch('out'), 'broken.epub');

    const { stdout, stderr, exitCode } = await runCli(
      [join(scripts, 'Broken.pdf'), '-o', out, '--no-fountain', '--json'],
    );
    expect(exitCode).toBe(0);
    const answer = JSON.parse(stdout);
    expect(answer.ok).toBe(true);
    expect(answer.settingsPath).toBeUndefined();
    // It converted at the defaults rather than half-applying a broken file.
    expect(await epubCss(answer.epubPath))
      .toContain(`margin-left: ${DEFAULTS.dialogueSideMarginPct}%`);
    expect(stderr).toContain('not a settings object');
  }, 120000);

  test('no sidecar says nothing and reports nothing', async () => {
    const scripts = await scriptFolder('Quiet.pdf');
    const { stdout, stderr, exitCode } = await runCli([
      join(scripts, 'Quiet.pdf'), '-o', join(scratch('out'), 'quiet.epub'), '--no-fountain',
      '--json',
    ]);
    expect(exitCode).toBe(0);
    expect(stderr).toBe('');
    expect(JSON.parse(stdout).settingsPath).toBeUndefined();
  }, 120000);
});

// A script with no sidecar of its own reads its settings off the app-wide
// format defaults on every conversion, forever. Changing those defaults
// later (the Settings page's "Reset new scripts to Screepub's defaults")
// then silently redraws every untuned book already in the library,
// including ones already on a reader's device. So the first --library
// conversion of a PDF that finds no sidecar saves what it started from as
// the script's own, and the script is independent of the app defaults from
// then on.
describe('a library conversion saves the settings it started from', () => {
  const APP_MARGIN = 19;

  beforeAll(() => {
    // Same guard as the suite above: a "distinctive" app-default value that
    // happened to equal the shipped default would make every assertion
    // below pass against a no-op implementation.
    expect(DEFAULTS.dialogueSideMarginPct).not.toBe(APP_MARGIN);
  });

  /** A scratch SCREEPUB_CONFIG_DIR holding an app-wide formatDefaults, and
   * the settings.json path inside it: matching appSettingsPath's own rule
   * for a SCREEPUB_CONFIG_DIR override (folder + 'settings.json'), so
   * writing here is writing exactly what the spawned CLI will read. */
  function appConfig(
    formatDefaults: Record<string, unknown>,
    other: Record<string, unknown> = {},
  ): { dir: string; file: string } {
    const dir = scratch('config');
    const file = join(dir, 'settings.json');
    writeAppSettings({ formatDefaults, ...other }, file);
    return { dir, file };
  }

  test(
    'the FIRST --library conversion of an untuned script pins this run\'s ' +
      'settings, so a later app-default change no longer reaches it',
    async () => {
      const { dir: configDir } = appConfig({ dialogueSideMarginPct: APP_MARGIN });
      const scripts = await scriptFolder('Pinned.pdf');
      const root = scratch('lib');

      const { stdout, exitCode } = await runCli(
        [join(scripts, 'Pinned.pdf'), '--library', '--json'],
        { SCREEPUB_LIBRARY: root, SCREEPUB_CONFIG_DIR: configDir },
      );
      expect(exitCode).toBe(0);
      const answer = JSON.parse(stdout);
      expect(answer.ok).toBe(true);
      // The book itself was built at the app default, same as before this
      // change: pinning is about what happens to LATER reads, not this
      // conversion's own output.
      expect(await epubCss(answer.epubPath)).toContain(`margin-left: ${APP_MARGIN}%`);

      const sidecar = join(root, 'Pinned', 'Pinned.screepub.json');
      expect(existsSync(sidecar)).toBe(true);
      const pinned = JSON.parse(readFileSync(sidecar, 'utf8'));
      // The FULL resolved options, not just the one knob a partial
      // formatDefaults named: resolveFormatOptions already filled every
      // other key from the shipped defaults, and that whole object is what
      // got saved.
      expect(pinned.dialogueSideMarginPct).toBe(APP_MARGIN);
      expect(pinned.cueAlignment).toBe(DEFAULTS.cueAlignment);
      expect(Object.keys(pinned).length).toBe(Object.keys(DEFAULTS).length);

      // The regression test proper: change the app defaults afterward (the
      // Settings page's Reset, modelled by overwriting the same file this
      // run read), and ask the engine what THIS script's settings are now.
      // Before the fix this returns the NEW app default, because a
      // sidecar-less script always re-read the live app defaults.
      appConfig({ dialogueSideMarginPct: 31 });
      const said = await runCli(
        ['settings', answer.fountainPath, '--json'],
        { SCREEPUB_CONFIG_DIR: configDir },
      );
      expect(said.exitCode).toBe(0);
      const settings = JSON.parse(said.stdout);
      expect(settings.settings.dialogueSideMarginPct).toBe(APP_MARGIN);
    },
    120000,
  );

  test('a SECOND --library conversion with a sidecar already present leaves it unchanged, even when a flag overrides a knob', async () => {
    const { dir: configDir } = appConfig({ dialogueSideMarginPct: APP_MARGIN });
    const scripts = await scriptFolder('Twice.pdf');
    const root = scratch('lib');

    const first = await runCli(
      [join(scripts, 'Twice.pdf'), '--library', '--json'],
      { SCREEPUB_LIBRARY: root, SCREEPUB_CONFIG_DIR: configDir },
    );
    expect(first.exitCode).toBe(0);
    const sidecar = join(root, 'Twice', 'Twice.screepub.json');
    const before = readFileSync(sidecar, 'utf8');

    const second = await runCli(
      [
        join(scripts, 'Twice.pdf'), '--library', '--json',
        '--options-json', JSON.stringify({ dialogueSideMarginPct: 25 }),
      ],
      { SCREEPUB_LIBRARY: root, SCREEPUB_CONFIG_DIR: configDir },
    );
    expect(second.exitCode).toBe(0);
    const answer = JSON.parse(second.stdout);
    // The flag won for THIS conversion...
    expect(await epubCss(answer.epubPath)).toContain('margin-left: 25%');
    // ...but flags do not save: the sidecar written by the first
    // conversion is untouched, byte for byte.
    expect(readFileSync(sidecar, 'utf8')).toBe(before);
  }, 120000);

  test('a sidecar beside the PDF is still adopted, not overwritten by the pin', async () => {
    const scripts = await scriptFolder('Adopted.pdf');
    writeFileSync(join(scripts, 'Adopted.screepub.json'), '{"cueIndentPct":41}\n');
    const root = scratch('lib');

    const { exitCode } = await runCli(
      [join(scripts, 'Adopted.pdf'), '--library', '--json'], { SCREEPUB_LIBRARY: root },
    );
    expect(exitCode).toBe(0);
    const sidecar = join(root, 'Adopted', 'Adopted.screepub.json');
    // Exactly the file that was beside the PDF, unexpanded: had the pin
    // fired here too, this would hold every FormatOptions key rather than
    // the one adoptSidecar carried in.
    expect(JSON.parse(readFileSync(sidecar, 'utf8'))).toEqual({ cueIndentPct: 41 });
  }, 120000);

  test('a plain conversion, without --library, writes no sidecar beside the input', async () => {
    const scripts = await scriptFolder('NoLibrary.pdf');
    const { exitCode } = await runCli([
      join(scripts, 'NoLibrary.pdf'), '-o', join(scratch('out'), 'no-library.epub'),
      '--no-fountain', '--json',
    ]);
    expect(exitCode).toBe(0);
    expect(existsSync(join(scripts, 'NoLibrary.screepub.json'))).toBe(false);
  }, 120000);

  test('a conversion that fails after the library folder opens leaves no sidecar behind', async () => {
    const scripts = await scriptFolder('Blocked.pdf');
    const root = scratch('lib');
    // Claiming the folder ahead of time, the way an earlier conversion
    // would, then putting a DIRECTORY where the book is about to land:
    // writeFileAtomic's rename onto an existing directory fails with
    // EISDIR, so this conversion never finishes.
    const prefix = libraryOutput(join(scripts, 'Blocked.pdf'), root);
    mkdirSync(`${prefix}.epub`);

    const { exitCode } = await runCli(
      [join(scripts, 'Blocked.pdf'), '--library', '--json'], { SCREEPUB_LIBRARY: root },
    );
    expect(exitCode).toBe(1);
    // The book never landed, so the settings it would have started from
    // must not be recorded as this script's own either.
    expect(existsSync(`${prefix}.screepub.json`)).toBe(false);
  }, 30000);

  test('a flag used on the very first --library conversion is not pinned: what gets saved is what the script started from', async () => {
    const { dir: configDir } = appConfig({ dialogueSideMarginPct: APP_MARGIN });
    const scripts = await scriptFolder('FlagFirst.pdf');
    const root = scratch('lib');

    const { stdout, exitCode } = await runCli(
      [
        join(scripts, 'FlagFirst.pdf'), '--library', '--json',
        '--options-json', JSON.stringify({ dialogueSideMarginPct: 5 }),
      ],
      { SCREEPUB_LIBRARY: root, SCREEPUB_CONFIG_DIR: configDir },
    );
    expect(exitCode).toBe(0);
    const answer = JSON.parse(stdout);
    // The flag won for THIS conversion...
    expect(await epubCss(answer.epubPath)).toContain('margin-left: 5%');
    // ...but a flag used for one conversion must never freeze into the
    // script's standing choice. What gets saved is the app default this
    // script started from (this block only ever runs when there was no
    // sidecar to read, so that is exactly what the conversion's own
    // options were, minus the flag).
    const sidecar = join(root, 'FlagFirst', 'FlagFirst.screepub.json');
    const pinned = JSON.parse(readFileSync(sidecar, 'utf8'));
    expect(pinned.dialogueSideMarginPct).toBe(APP_MARGIN);
  }, 120000);

  test('a --library conversion of a .fountain input saves nothing: there is no library .fountain to attach it to', async () => {
    const scripts = scratch('scripts');
    const fountainInput = join(scripts, 'Loose.fountain');
    writeFileSync(fountainInput, 'Title: Loose\n\nINT. ROOM - DAY\n\nAction holds.\n');
    const root = scratch('lib');

    const { stdout, exitCode } = await runCli(
      [fountainInput, '--library', '--json'], { SCREEPUB_LIBRARY: root },
    );
    expect(exitCode).toBe(0);
    expect(JSON.parse(stdout).ok).toBe(true);
    // A .fountain input never gets a .fountain written into the library
    // (only a PDF produces one), so a saved sidecar here would have no
    // library .fountain for `screepub settings` to read it against, while
    // still outranking the user's own sidecar beside their .fountain input
    // on the next conversion.
    expect(existsSync(join(root, 'Loose', 'Loose.screepub.json'))).toBe(false);
  }, 30000);

  test('a sidecar write that fails does not fail the conversion, and says so once on stderr', async () => {
    const scripts = await scriptFolder('CannotPin.pdf');
    const root = scratch('lib');
    // A monkeypatch, not a permission trick: chmod can only lock the WHOLE
    // script folder, which would also stop the book itself from being
    // written (the EISDIR case above already covers a conversion that
    // fails outright). This blocks only the sidecar's own temp file, by
    // name, so the book writes succeed and only the save afterward fails.
    const preload = join(scratch('preload'), 'block-sidecar-write.ts');
    writeFileSync(preload, [
      "const fs = require('node:fs');",
      'const original = fs.writeFileSync;',
      'fs.writeFileSync = (path, ...rest) => {',
      "  if (typeof path === 'string' && path.endsWith('.tmp') && path.includes('.screepub.json.')) {",
      "    throw new Error('EACCES: permission denied (test)');",
      '  }',
      '  return original(path, ...rest);',
      '};',
    ].join('\n'));

    const proc = Bun.spawn(
      [
        'bun', '--preload', preload, `${ROOT}src/cli.ts`,
        join(scripts, 'CannotPin.pdf'), '--library', '--json',
      ],
      { stdout: 'pipe', stderr: 'pipe', env: { ...process.env, SCREEPUB_LIBRARY: root } },
    );
    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);
    expect(exitCode).toBe(0);
    const answer = JSON.parse(stdout);
    expect(answer.ok).toBe(true);
    // The book is written and correct...
    expect(existsSync(answer.epubPath)).toBe(true);
    // ...the save that could not happen leaves no half-written sidecar...
    expect(existsSync(join(root, 'CannotPin', 'CannotPin.screepub.json'))).toBe(false);
    // ...and is said exactly once, not swallowed and not a stack trace.
    const lines = stderr.trim().split('\n').filter((l) => l !== '');
    expect(lines.length).toBe(1);
    expect(lines[0]).toContain('could not save');
  }, 120000);
});

// The Settings page's choice (spec 2026-09-24-keep-script-settings-choice-
// design.md). keepScriptSettings: false in the app settings file means
// "Follow the defaults": the pin above is skipped, so an untuned script
// keeps following the app defaults. It is ONLY the pin that is skipped: a
// sidecar that is already there, pinned or tuned (the two cannot be told
// apart), is never deleted or rewritten because of this setting.
describe('keepScriptSettings chooses whether a library conversion pins', () => {
  const APP_MARGIN = 19;

  function appConfig(settings: Record<string, unknown>): { dir: string; file: string } {
    const dir = scratch('config');
    const file = join(dir, 'settings.json');
    writeAppSettings(settings, file);
    return { dir, file };
  }

  beforeAll(() => {
    expect(DEFAULTS.dialogueSideMarginPct).not.toBe(APP_MARGIN);
  });

  test('OFF: an untuned script gets no sidecar, and a later app-default change reaches it', async () => {
    const { dir: configDir, file } = appConfig({
      formatDefaults: { dialogueSideMarginPct: APP_MARGIN }, keepScriptSettings: false,
    });
    const scripts = await scriptFolder('Follows.pdf');
    const root = scratch('lib');

    const { stdout, exitCode } = await runCli(
      [join(scripts, 'Follows.pdf'), '--library', '--json'],
      { SCREEPUB_LIBRARY: root, SCREEPUB_CONFIG_DIR: configDir },
    );
    expect(exitCode).toBe(0);
    const answer = JSON.parse(stdout);
    // The book itself is still built at the app defaults: the choice is
    // about what LATER reads see, not this conversion's output.
    expect(await epubCss(answer.epubPath)).toContain(`margin-left: ${APP_MARGIN}%`);
    expect(existsSync(join(root, 'Follows', 'Follows.screepub.json'))).toBe(false);

    // The opposite of the pin's regression test: the app defaults move, and
    // this script, having nothing of its own, moves with them.
    writeAppSettings({ formatDefaults: { dialogueSideMarginPct: 27 } }, file);
    const said = await runCli(['settings', answer.fountainPath, '--json'], { SCREEPUB_CONFIG_DIR: configDir });
    expect(said.exitCode).toBe(0);
    expect(JSON.parse(said.stdout).settings.dialogueSideMarginPct).toBe(27);
  }, 120000);

  test('ON, stored explicitly: the pin is written, the same as when the key is absent', async () => {
    const { dir: configDir } = appConfig({
      formatDefaults: { dialogueSideMarginPct: APP_MARGIN }, keepScriptSettings: true,
    });
    const scripts = await scriptFolder('Keeps.pdf');
    const root = scratch('lib');
    const { exitCode } = await runCli(
      [join(scripts, 'Keeps.pdf'), '--library', '--json'],
      { SCREEPUB_LIBRARY: root, SCREEPUB_CONFIG_DIR: configDir },
    );
    expect(exitCode).toBe(0);
    const sidecar = join(root, 'Keeps', 'Keeps.screepub.json');
    expect(JSON.parse(readFileSync(sidecar, 'utf8')).dialogueSideMarginPct).toBe(APP_MARGIN);
  }, 120000);

  test('switching OFF never deletes or rewrites a sidecar already in the library, pinned or tuned', async () => {
    const { dir: configDir, file } = appConfig({ formatDefaults: { dialogueSideMarginPct: APP_MARGIN } });
    const scripts = await scriptFolder('Already.pdf');
    const root = scratch('lib');
    const env = { SCREEPUB_LIBRARY: root, SCREEPUB_CONFIG_DIR: configDir };

    // ON (absent): the first conversion pins.
    const first = await runCli([join(scripts, 'Already.pdf'), '--library', '--json'], env);
    expect(first.exitCode).toBe(0);
    const sidecar = join(root, 'Already', 'Already.screepub.json');
    const pinned = readFileSync(sidecar, 'utf8');

    // OFF now, and the app defaults moved too: converting again leaves the
    // pinned file exactly as it was, byte for byte, and renders with it.
    writeAppSettings({ keepScriptSettings: false, formatDefaults: { dialogueSideMarginPct: 31 } }, file);
    const second = await runCli([join(scripts, 'Already.pdf'), '--library', '--json'], env);
    expect(second.exitCode).toBe(0);
    expect(readFileSync(sidecar, 'utf8')).toBe(pinned);
    expect(await epubCss(JSON.parse(second.stdout).epubPath)).toContain(`margin-left: ${APP_MARGIN}%`);

    // A partial, hand-tuned sidecar is the same story: not expanded, not
    // removed.
    writeFileSync(sidecar, '{"cueIndentPct":41}\n');
    const third = await runCli([join(scripts, 'Already.pdf'), '--library', '--json'], env);
    expect(third.exitCode).toBe(0);
    expect(readFileSync(sidecar, 'utf8')).toBe('{"cueIndentPct":41}\n');
  }, 180000);

  test('OFF: a sidecar beside the PDF is still adopted, because that one is tuning, not a pin', async () => {
    const { dir: configDir } = appConfig({ keepScriptSettings: false });
    const scripts = await scriptFolder('Beside.pdf');
    writeFileSync(join(scripts, 'Beside.screepub.json'), '{"cueIndentPct":41}\n');
    const root = scratch('lib');
    const { exitCode } = await runCli(
      [join(scripts, 'Beside.pdf'), '--library', '--json'],
      { SCREEPUB_LIBRARY: root, SCREEPUB_CONFIG_DIR: configDir },
    );
    expect(exitCode).toBe(0);
    expect(JSON.parse(readFileSync(join(root, 'Beside', 'Beside.screepub.json'), 'utf8')))
      .toEqual({ cueIndentPct: 41 });
  }, 120000);
});
