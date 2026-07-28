import { afterAll, describe, test, expect } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

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
});
