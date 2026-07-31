import { describe, test, expect } from 'bun:test';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { collectCommits } from '../tools/release-notes';

/** A throwaway git repo, so tests never depend on live history. */
function scratchRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), 'relnotes-'));
  const run = (cmd: string) => Bun.spawnSync(['sh', '-c', cmd], { cwd: dir });
  run('git init -q');
  run('git config user.email dev@example.com');
  run('git config user.name Dev');
  writeFileSync(join(dir, 'a.txt'), 'one');
  run('git add -A && git commit -q -m "first"');
  run('git tag v0.1.0');
  return dir;
}

describe('collectCommits', () => {
  test('returns subjects since the given tag', () => {
    const dir = scratchRepo();
    const run = (cmd: string) => Bun.spawnSync(['sh', '-c', cmd], { cwd: dir });
    writeFileSync(join(dir, 'b.txt'), 'two');
    run('git add -A && git commit -q -m "add the second thing"');

    const commits = collectCommits(dir, 'v0.1.0');
    expect(commits).toHaveLength(1);
    expect(commits[0].subject).toBe('add the second thing');
  });

  test('truncates a very long subject and strips control characters', () => {
    const dir = scratchRepo();
    const run = (cmd: string) => Bun.spawnSync(['sh', '-c', cmd], { cwd: dir });
    // \x1B is the ANSI escape introducer, written as an escape on purpose:
    // a literal control character does not survive copy-paste.
    const nasty = 'x'.repeat(400) + '\x1B[31mred';
    writeFileSync(join(dir, 'c.txt'), 'three');
    run(`git add -A && git commit -q -m ${JSON.stringify(nasty)}`);

    const [commit] = collectCommits(dir, 'v0.1.0');
    expect(commit.subject.length).toBeLessThanOrEqual(200);
    expect(commit.subject).not.toContain('\x1B');
  });
});
