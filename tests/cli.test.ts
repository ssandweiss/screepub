import { afterAll, describe, test, expect } from 'bun:test';
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mapConversionError } from '../src/cli-errors';

const ROOT = new URL('..', import.meta.url).pathname;
const FIXTURES = new URL('./fixtures/', import.meta.url).pathname;
const SCRATCH = mkdtempSync(join(tmpdir(), 'screepub-cli-'));

afterAll(() => rmSync(SCRATCH, { recursive: true, force: true }));

async function runCli(args: string[]) {
  const proc = Bun.spawn(['bun', `${ROOT}src/cli.ts`, ...args], {
    stdout: 'pipe',
    stderr: 'pipe',
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  return { stdout, stderr, exitCode };
}

describe('cli --version', () => {
  test('prints a semver and exits 0', async () => {
    const { stdout, exitCode } = await runCli(['--version']);
    expect(exitCode).toBe(0);
    expect(stdout.trim()).toMatch(/^screepub \d+\.\d+\.\d+/);
  });

  test('matches the version in package.json', async () => {
    const pkg = await Bun.file(`${ROOT}package.json`).json();
    const { stdout } = await runCli(['--version']);
    expect(stdout.trim()).toBe(`screepub ${pkg.version}`);
  });
});

// pdf.js warns about our build choices — the modern-build notice fires at
// import time, and the standard-font notice on every base-14 PDF, which is
// most screenplays. Neither is actionable for someone converting a script,
// and both look like errors. They belong behind --debug.
describe('cli quiets pdf.js internals', () => {
  test('a normal conversion prints nothing to stderr', async () => {
    const { stderr, exitCode } = await runCli([
      `${FIXTURES}screenplay.pdf`, '-o', `${SCRATCH}/quiet.epub`, '--no-fountain',
    ]);
    expect(exitCode).toBe(0);
    expect(stderr).toBe('');
  }, 60000);

  test('--debug lets them through', async () => {
    const { stderr, exitCode } = await runCli([
      `${FIXTURES}screenplay.pdf`, '-o', `${SCRATCH}/loud.epub`, '--no-fountain', '--debug',
    ]);
    expect(exitCode).toBe(0);
    expect(stderr).toContain('Warning');
  }, 60000);
});

describe('cli --json contract', () => {
  test('success emits a single machine-readable JSON object', async () => {
    const out = `${SCRATCH}/cli-json-test.epub`;
    const { stdout, exitCode } = await runCli([
      `${FIXTURES}screenplay.pdf`, '-o', out, '--no-fountain', '--json',
    ]);
    expect(exitCode).toBe(0);
    const result = JSON.parse(stdout);
    expect(result.ok).toBe(true);
    expect(result.title).toBe('The Last Video Store');
    expect(result.author).toBe('A. N. Placeholder');
    expect(result.pages).toBe(5);
    expect(result.scenes).toBe(5);
    expect(result.epubPath).toBe(out);
    expect(result.fountainPath).toBeUndefined();
    expect(Array.isArray(result.topCharacters)).toBe(true);
    expect(result.topCharacters.slice(0, 3)).toEqual(['MARGO', 'DEV', 'NIECE']);
    expect(Array.isArray(result.warnings)).toBe(true);
  }, 60000);

  test('guard errors emit structured JSON with a code and exit 1', async () => {
    const { stdout, exitCode } = await runCli([
      `${FIXTURES}prose.pdf`, '-o', `${SCRATCH}/nope.epub`, '--json',
    ]);
    expect(exitCode).toBe(1);
    const result = JSON.parse(stdout);
    expect(result.ok).toBe(false);
    expect(result.error.code).toBe('not-screenplay');
    expect(result.error.message).toContain('--force');
  }, 60000);

  test('scanned PDFs report their own error code', async () => {
    const { stdout, exitCode } = await runCli([
      `${FIXTURES}blank-pages.pdf`, '-o', `${SCRATCH}/nope2.epub`, '--json',
    ]);
    expect(exitCode).toBe(1);
    expect(JSON.parse(stdout).error.code).toBe('scanned');
  }, 60000);

  // --json is the app's only channel: EVERY exit in that mode must be a
  // parseable JSON object on stdout, or the app shows the user a raw
  // stack trace (or "engine produced no output").

  test('an unknown flag with --json still emits JSON, not a stack trace', async () => {
    const { stdout, exitCode } = await runCli([
      `${FIXTURES}screenplay.pdf`, '--json', '--no-such-flag',
    ]);
    expect(exitCode).toBe(1);
    const result = JSON.parse(stdout);
    expect(result.ok).toBe(false);
    expect(result.error.code).toBe('usage');
  });

  test('no input with --json emits JSON, not help text on stdout', async () => {
    const { stdout, exitCode } = await runCli(['--json']);
    expect(exitCode).toBe(1);
    const result = JSON.parse(stdout);
    expect(result.ok).toBe(false);
    expect(result.error.code).toBe('usage');
  });

  test('two inputs is a usage error, not an internal one', async () => {
    const { stdout } = await runCli([
      `${FIXTURES}screenplay.pdf`, `${FIXTURES}prose.pdf`, '--json',
    ]);
    expect(JSON.parse(stdout).error.code).toBe('usage');
  });

  test('a directory named .pdf reports unreadable', async () => {
    const dir = `${SCRATCH}/a-folder.pdf`;
    mkdirSync(dir);
    const { stdout, exitCode } = await runCli([dir, '--json']);
    expect(exitCode).toBe(1);
    expect(JSON.parse(stdout).error.code).toBe('unreadable');
  });

  test('a malformed options file reports bad-options', async () => {
    const opts = `${SCRATCH}/bad-options.json`;
    writeFileSync(opts, 'not json');
    const { stdout } = await runCli([
      `${FIXTURES}screenplay.pdf`, '--options', opts, '--json',
    ]);
    expect(JSON.parse(stdout).error.code).toBe('bad-options');
  });

  test('a corrupt PDF emits pure JSON on stdout, never a stack trace', async () => {
    const p = `${SCRATCH}/garbage.pdf`;
    writeFileSync(p, 'not a pdf at all');
    const { stdout, exitCode } = await runCli([p, '--json']);
    expect(exitCode).toBe(1);
    const result = JSON.parse(stdout); // throws if anything non-JSON leaked
    expect(result.ok).toBe(false);
    expect(typeof result.error.code).toBe('string');
  }, 60000);

  test('an unreadable-permissions file emits JSON with a code', async () => {
    const p = `${SCRATCH}/locked.pdf`;
    writeFileSync(p, 'x');
    chmodSync(p, 0o000);
    const { stdout, exitCode } = await runCli([p, '--json']);
    chmodSync(p, 0o644);
    expect(exitCode).toBe(1);
    expect(JSON.parse(stdout).error.code).toBe('unreadable');
  });

  test('the success payload keys match the committed contract sample', async () => {
    // Every optional output is requested so every key is present; the
    // sample is the SAME file kit-check decodes into EngineResult, so a
    // key rename must break one suite or the other before it breaks the
    // app.
    const out = `${SCRATCH}/contract.epub`;
    const { stdout } = await runCli([
      `${FIXTURES}screenplay.pdf`, '-o', out, '--json', '--mobi', '--debug',
      '--preview-html', `${SCRATCH}/contract.html`,
    ]);
    const result = JSON.parse(stdout);
    const sample = await Bun.file(`${FIXTURES}engine-result-sample.json`).json();
    expect(Object.keys(result).sort()).toEqual(Object.keys(sample).sort());
  }, 60000);
});

describe('conversion error mapping', () => {
  test('password detection is typed, not substring', () => {
    expect(mapConversionError({ name: 'PasswordException', message: 'No password given' })?.code)
      .toBe('password');
    // A message that merely CONTAINS "password" (a file path, say) must
    // not classify — the old substring check did.
    expect(mapConversionError(new Error('/scripts/password-notes/x.pdf broke'))).toBeNull();
  });

  test('missing, directory, and permission errors are all unreadable', () => {
    for (const code of ['ENOENT', 'EISDIR', 'EACCES']) {
      const err = Object.assign(new Error(code), { code });
      expect(mapConversionError(err)?.code).toBe('unreadable');
    }
  });

  test('a corrupt PDF maps to unreadable with pdf.js named exceptions', () => {
    expect(mapConversionError({ name: 'InvalidPDFException', message: 'Invalid PDF structure.' })?.code)
      .toBe('unreadable');
  });
});
