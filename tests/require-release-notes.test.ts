import { describe, test, expect } from 'bun:test';
import { join } from 'node:path';

const HOOK = join(import.meta.dir, '..', 'tools', 'hooks', 'require-release-notes.sh');

function runHook(command: string): { code: number; stderr: string } {
  const input = JSON.stringify({ tool_input: { command } });
  const proc = Bun.spawnSync(['bash', HOOK], { stdin: Buffer.from(input) });
  return { code: proc.exitCode ?? 0, stderr: proc.stderr.toString() };
}

describe('require-release-notes hook', () => {
  test('ignores commands that have nothing to do with tags', () => {
    expect(runHook('bun test').code).toBe(0);
    expect(runHook('git status').code).toBe(0);
    expect(runHook('git commit -m "wip"').code).toBe(0);
  });

  test('never blocks deleting a tag: recovery must always work', () => {
    expect(runHook('git tag -d v0.5.0').code).toBe(0);
    expect(runHook('git push origin :refs/tags/v0.5.0').code).toBe(0);
  });

  test('blocks tagging a version whose notes are missing', () => {
    const { code, stderr } = runHook('git tag -a v99.0.0 -m release');
    expect(code).toBe(2);
    expect(stderr).toContain('docs/releases/99.0.0.md');
  });

  test('blocks gh release create for a version with no notes', () => {
    expect(runHook('gh release create v99.0.0').code).toBe(2);
  });

  test('allows tagging a version whose notes exist', () => {
    expect(runHook('git tag -a v0.5.0 -m release').code).toBe(0);
  });

  test('fails CLOSED when it matches but cannot resolve a version', () => {
    // `git push --follow-tags` names no version, and it is close to what
    // the release flow actually runs. Blocking with an explanation beats
    // silently passing.
    const { code, stderr } = runHook('git push --follow-tags');
    expect(code).toBe(2);
    expect(stderr).toContain('/release');
  });
});
