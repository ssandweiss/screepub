// The developer and release tools that make a temp folder remove it again,
// on the way out of a failure as well as a pass.
//
// Each tool runs as a real process with TMPDIR pointed at a folder of this
// file's own, so whatever it leaves behind shows up here and never lands in
// the shared temp folder. (Counting the shared one would be wrong anyway:
// another worktree's suite or a real capture can write there at the same
// moment.) The failure that started this: every one of these called
// process.exit() inside its try, which ends the process on the spot and
// skips the finally, so a failed verify-signing run left its work folder
// behind with the release DMG still mounted inside it.
import { afterAll, expect, test } from 'bun:test';
import { chmodSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { platform } from 'node:process';

const ROOT = join(import.meta.dir, '..');
const SCRATCH = mkdtempSync(join(tmpdir(), 'screepub-tool-temp-folders-'));
afterAll(() => rmSync(SCRATCH, { recursive: true, force: true }));

/** Runs `bun <args>` from the repo root with a TMPDIR of its own, and says
 *  what the run left in it. */
async function withOwnTmp(args: string[], env: Record<string, string> = {}) {
  const tmp = mkdtempSync(join(SCRATCH, 'tmp-'));
  const proc = Bun.spawn(['bun', ...args], {
    cwd: ROOT,
    env: { ...process.env, ...env, TMPDIR: tmp },
    stdout: 'pipe',
    stderr: 'pipe',
  });
  const [exitCode, stderr] = await Promise.all([proc.exited, new Response(proc.stderr).text()]);
  return { exitCode, stderr, left: readdirSync(tmp) };
}

test('smoke-cli removes its work folder after a passing smoke', async () => {
  // The engine itself, run through bun, stands in for a compiled binary.
  // Both device seams are pinned so `devices --json` reads no real mount
  // and reaches no real tablet: port 9 refuses the connection at once.
  const binary = join(SCRATCH, 'screepub');
  writeFileSync(binary, `#!/bin/sh\nexec bun "${join(ROOT, 'src', 'cli.ts')}" "$@"\n`);
  chmodSync(binary, 0o755);
  const r = await withOwnTmp(['tools/smoke-cli.ts', '--binary', binary], {
    SCREEPUB_VOLUME_ROOTS: mkdtempSync(join(SCRATCH, 'no-mounts-')),
    SCREEPUB_REMARKABLE_ENDPOINT: 'http://127.0.0.1:9',
  });
  expect(r.stderr).toBe('');
  expect(r.exitCode).toBe(0);
  expect(r.left).toEqual([]);
}, 60_000);

test('smoke-cli removes its work folder after a failing smoke, and still fails', async () => {
  const r = await withOwnTmp(['tools/smoke-cli.ts', '--binary', join(SCRATCH, 'no-such-binary')]);
  expect(r.stderr).toContain('no binary at');
  expect(r.exitCode).toBe(1);
  expect(r.left).toEqual([]);
});

test('smoke-bundle removes its work folder after a refusal, and still fails', async () => {
  const r = await withOwnTmp([
    'tools/smoke-bundle.ts', '--bundle', join(SCRATCH, 'not-a-bundle.txt'), '--expect-version', '0.0.0',
  ]);
  expect(r.stderr).toContain('is not a .deb, .rpm, .dmg or .exe');
  expect(r.exitCode).toBe(1);
  expect(r.left).toEqual([]);
});

test('verify-signing removes its work folder when the image will not mount, and still fails', async () => {
  if (platform !== 'darwin') return; // it refuses to start anywhere else
  const r = await withOwnTmp([
    'tools/verify-signing.ts', '--dmg', join(SCRATCH, 'no-such.dmg'), '--expect', 'coexist',
  ]);
  expect(r.stderr).toContain('hdiutil attach failed');
  expect(r.exitCode).toBe(1);
  expect(r.left).toEqual([]);
}, 30_000);
