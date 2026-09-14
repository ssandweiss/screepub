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
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import JSZip from 'jszip';
import { libraryOutput } from '../src/library';

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
