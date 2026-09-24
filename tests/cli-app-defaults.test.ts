// A conversion's own precedence (flags > sidecar > defaults, see
// tests/conversion-settings.test.ts) gains one more layer underneath the
// defaults: the user's app-wide format defaults (piece C), read from the
// app settings file. Every assertion here is a DISAGREEMENT, the same
// discipline conversion-settings.test.ts uses: the same fixture, converted
// with and without the app defaults, must produce different CSS.
import { afterAll, beforeAll, describe, test, expect } from 'bun:test';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import JSZip from 'jszip';

const ROOT = new URL('..', import.meta.url).pathname;
const FIXTURES = new URL('./fixtures/', import.meta.url).pathname;
// Nothing here goes anywhere near a real home directory or the committed
// fixtures folder: the PDF is COPIED out, and every app settings file lives
// under its own scratch folder, never the real per-platform one.
const SCRATCH = mkdtempSync(join(tmpdir(), 'screepub-cli-app-defaults-'));

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

/** A fresh SCREEPUB_CONFIG_DIR folder, holding `settings.json` with the
 * given `formatDefaults` (or no file at all, when `formatDefaults` is
 * omitted, or the raw text given when it is a string: a way to write a
 * corrupt file). appSettingsPath joins 'settings.json' onto this folder, so
 * this is the value a test hands to SCREEPUB_CONFIG_DIR, never a settings
 * file path itself. */
function appConfigDir(formatDefaults?: Record<string, unknown> | string): string {
  const dir = scratch('config');
  if (formatDefaults !== undefined) {
    const text = typeof formatDefaults === 'string'
      ? formatDefaults
      : JSON.stringify({ formatDefaults });
    writeFileSync(join(dir, 'settings.json'), text);
  }
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

/** The stylesheet out of a built EPUB, same helper as
 * tests/conversion-settings.test.ts, where every knob this file moves
 * becomes something a reader can see. */
async function epubCss(path: string): Promise<string> {
  const zip = await JSZip.loadAsync(readFileSync(path));
  const name = Object.keys(zip.files).find((f) => f.endsWith('.css'));
  if (name === undefined) throw new Error(`no stylesheet in ${path}`);
  return zip.file(name)!.async('string');
}

// dialogueSideMarginPct is written unconditionally into .dialogue-block, and
// cueIndentPct only appears when cueAlignment is 'indented' (the same
// visibility choice conversion-settings.test.ts makes), so setting both in
// the APP defaults and moving only one of them in the sidecar proves the
// sidecar was overlaid ON the app defaults rather than resolved straight
// over the shipped ones.
const DEFAULTS = JSON.parse(readFileSync(`${ROOT}format-defaults.json`, 'utf8'));
const APP_SIDE = 11;
const APP_CUE = 44;
const SIDECAR_SIDE = 3;
const FLAG_SIDE = 24;

beforeAll(() => {
  for (const v of [APP_SIDE, SIDECAR_SIDE, FLAG_SIDE]) expect(DEFAULTS.dialogueSideMarginPct).not.toBe(v);
  expect(DEFAULTS.cueIndentPct).not.toBe(APP_CUE);
  expect(DEFAULTS.cueAlignment).toBe('centered');
});

describe('a conversion starts from the app-wide format defaults', () => {
  test('no sidecar, no flags: the app defaults reach the book', async () => {
    const scripts = await scriptFolder('AppOnly.pdf');
    const configDir = appConfigDir({ dialogueSideMarginPct: APP_SIDE });
    const out = join(scratch('out'), 'app-only.epub');

    const { stdout, exitCode } = await runCli(
      [join(scripts, 'AppOnly.pdf'), '-o', out, '--no-fountain', '--json'],
      { SCREEPUB_CONFIG_DIR: configDir },
    );
    expect(exitCode).toBe(0);
    const css = await epubCss(JSON.parse(stdout).epubPath);
    expect(css).toContain(`margin-left: ${APP_SIDE}%`);
    expect(css).not.toContain(`margin-left: ${DEFAULTS.dialogueSideMarginPct}%`);
  }, 120000);

  test('the same env, but no settings file at that path: the shipped defaults reach the book', async () => {
    // Same mechanism as the test above, proving the FIRST test's result came
    // from the settings file and not from some other effect of the env var.
    const scripts = await scriptFolder('NoAppSettings.pdf');
    const configDir = appConfigDir(); // no settings.json written at all
    const out = join(scratch('out'), 'no-app-settings.epub');

    const { stdout, exitCode } = await runCli(
      [join(scripts, 'NoAppSettings.pdf'), '-o', out, '--no-fountain', '--json'],
      { SCREEPUB_CONFIG_DIR: configDir },
    );
    expect(exitCode).toBe(0);
    const css = await epubCss(JSON.parse(stdout).epubPath);
    expect(css).toContain(`margin-left: ${DEFAULTS.dialogueSideMarginPct}%`);
    expect(css).not.toContain(`margin-left: ${APP_SIDE}%`);
  }, 120000);

  test('a corrupt settings file changes nothing: the shipped defaults reach the book', async () => {
    const scripts = await scriptFolder('Corrupt.pdf');
    const configDir = appConfigDir('{ this is not json');
    const out = join(scratch('out'), 'corrupt.epub');

    const { stdout, exitCode } = await runCli(
      [join(scripts, 'Corrupt.pdf'), '-o', out, '--no-fountain', '--json'],
      { SCREEPUB_CONFIG_DIR: configDir },
    );
    expect(exitCode).toBe(0);
    const answer = JSON.parse(stdout);
    expect(answer.ok).toBe(true);
    expect(await epubCss(answer.epubPath)).toContain(`margin-left: ${DEFAULTS.dialogueSideMarginPct}%`);
  }, 120000);

  test('a sidecar outranks the app defaults, knob by knob', async () => {
    const scripts = await scriptFolder('Sidecar.pdf');
    const configDir = appConfigDir({
      dialogueSideMarginPct: APP_SIDE, cueIndentPct: APP_CUE, cueAlignment: 'indented',
    });
    // The sidecar only ever mentions ONE of those three knobs.
    writeFileSync(join(scripts, 'Sidecar.screepub.json'), JSON.stringify({ dialogueSideMarginPct: SIDECAR_SIDE }));
    const out = join(scratch('out'), 'sidecar.epub');

    const { stdout, exitCode } = await runCli(
      [join(scripts, 'Sidecar.pdf'), '-o', out, '--no-fountain', '--json'],
      { SCREEPUB_CONFIG_DIR: configDir },
    );
    expect(exitCode).toBe(0);
    const css = await epubCss(JSON.parse(stdout).epubPath);
    // The knob the sidecar named is the sidecar's.
    expect(css).toContain(`margin-left: ${SIDECAR_SIDE}%`);
    expect(css).not.toContain(`margin-left: ${APP_SIDE}%`);
    // The knobs it never mentioned are still the APP defaults, not
    // Screepub's shipped ones: proof the sidecar was read OVER the app
    // defaults rather than straight over DEFAULT_FORMAT_OPTIONS.
    expect(css).toContain(`margin-left: ${APP_CUE}%`); // cueIndentPct, same CSS property name
  }, 120000);

  test('an explicit --options-json flag wins over both the sidecar and the app defaults', async () => {
    const scripts = await scriptFolder('Flagged.pdf');
    const configDir = appConfigDir({ dialogueSideMarginPct: APP_SIDE });
    writeFileSync(join(scripts, 'Flagged.screepub.json'), JSON.stringify({ dialogueSideMarginPct: SIDECAR_SIDE }));
    const out = join(scratch('out'), 'flagged.epub');

    const { stdout, exitCode } = await runCli(
      [join(scripts, 'Flagged.pdf'), '-o', out, '--no-fountain', '--json',
        '--options-json', JSON.stringify({ dialogueSideMarginPct: FLAG_SIDE })],
      { SCREEPUB_CONFIG_DIR: configDir },
    );
    expect(exitCode).toBe(0);
    const css = await epubCss(JSON.parse(stdout).epubPath);
    expect(css).toContain(`margin-left: ${FLAG_SIDE}%`);
    expect(css).not.toContain(`margin-left: ${SIDECAR_SIDE}%`);
    expect(css).not.toContain(`margin-left: ${APP_SIDE}%`);
  }, 120000);
});

describe('conversion --help', () => {
  test('says a conversion starts from the app-wide format defaults', async () => {
    const { stdout, exitCode } = await runCli(['--help']);
    expect(exitCode).toBe(0);
    expect(stdout).toContain('app-wide format defaults');
  });
});
