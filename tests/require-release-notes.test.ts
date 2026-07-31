import { describe, test, expect } from 'bun:test';
import { join } from 'node:path';
import { mkdtempSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';

const HOOK = join(import.meta.dir, '..', 'tools', 'hooks', 'require-release-notes.sh');

function runHook(command: string): { code: number; stderr: string } {
  const input = JSON.stringify({ tool_input: { command } });
  const proc = Bun.spawnSync(['bash', HOOK], { stdin: Buffer.from(input) });
  return { code: proc.exitCode ?? 0, stderr: proc.stderr.toString() };
}

// Runs the hook with a PATH that has everything it needs EXCEPT jq, so the
// "jq is missing" fallback path is genuinely exercised rather than assumed.
function runHookNoJq(command: string): { code: number; stderr: string } {
  const sandbox = mkdtempSync(join(tmpdir(), 'require-release-notes-nojq-'));
  try {
    for (const bin of ['git', 'grep', 'sort', 'cat', 'wc']) {
      const real = Bun.which(bin);
      if (!real) throw new Error(`test setup: "${bin}" not found on PATH`);
      symlinkSync(real, join(sandbox, bin));
    }
    const input = JSON.stringify({ tool_input: { command } });
    const proc = Bun.spawnSync(['/bin/bash', HOOK], {
      stdin: Buffer.from(input),
      env: { PATH: sandbox },
    });
    return { code: proc.exitCode ?? 0, stderr: proc.stderr.toString() };
  } finally {
    rmSync(sandbox, { recursive: true, force: true });
  }
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

  test('a bare lookalike string is not tag-touching at all, but naming it as a tag fails closed', () => {
    // `notaversion` alone has nothing to do with tags: exit 0. Only once
    // it appears as the argument to `git tag` does the guard engage, and
    // it then fails closed because no vX.Y.Z can be resolved from it.
    expect(runHook('notaversion').code).toBe(0);
    expect(runHook('git tag notaversion').code).toBe(2);
  });

  test('CRITICAL: a plain `git push` naming a tag is matched even without --tags/--follow-tags/refs form', () => {
    // This is the exact command the release flow is designed to print:
    // no bulk-push flag at all, just the tag named directly.
    const a = runHook('git push origin v99.0.0');
    expect(a.code).toBe(2);
    expect(a.stderr).toContain('docs/releases/99.0.0.md');

    const b = runHook('git push --atomic origin main v99.0.0');
    expect(b.code).toBe(2);
    expect(b.stderr).toContain('docs/releases/99.0.0.md');
  });

  test('CRITICAL: a plain `git push` naming a tag with existing notes is allowed', () => {
    expect(runHook('git push --atomic origin main v0.5.0').code).toBe(0);
  });

  test('CRITICAL: prerelease versions are matched in full, mirroring release.yml\'s regex', () => {
    // release.yml strips only the leading `v` and requires
    // docs/releases/<version>.md for the FULL version including any
    // prerelease suffix. Resolving v0.5.0-rc1 down to 0.5.0 would let
    // this hook pass a tag that CI rejects.
    const { code, stderr } = runHook('git tag -a v0.5.0-rc1 -m release');
    expect(code).toBe(2);
    expect(stderr).toContain('docs/releases/0.5.0-rc1.md');
  });

  test('IMPORTANT: recovery matching is anchored to the command form, not a bare substring', () => {
    // A real tag creation must not ride along after a real delete in a
    // compound command.
    const compound = runHook('git tag -d v0.5.0 && git tag v99.0.0');
    expect(compound.code).toBe(2);

    // "tag -d" inside a trailing comment must not look like recovery.
    const comment = runHook('git tag v99.0.0 # tag -d');
    expect(comment.code).toBe(2);

    // "tag -d" inside a commit message must not look like recovery.
    const inMessage = runHook('git tag -a v99.0.0 -m "see git tag -d"');
    expect(inMessage.code).toBe(2);
  });

  test('IMPORTANT: every version token in the command is checked, not just the first', () => {
    const a = runHook('git push --tags origin v0.5.0 v99.0.0');
    expect(a.code).toBe(2);

    const b = runHook('git push --tags origin v99.0.0 v0.5.0');
    expect(b.code).toBe(2);
  });

  test('IMPORTANT: read-only tag listing is never blocked', () => {
    expect(runHook('git tag').code).toBe(0);
    expect(runHook('git tag --list').code).toBe(0);
    expect(runHook("git tag -l 'v*'").code).toBe(0);
    expect(runHook('git tag --contains HEAD').code).toBe(0);
    expect(runHook('git tag --points-at HEAD').code).toBe(0);
    expect(runHook('git tag --sort=-v:refname').code).toBe(0);
  });

  test('R1: compound detection catches ||, |, single &, and $(...), not just ; && and newline', () => {
    // Each of these hides a real tag creation behind a listing/delete
    // joined by a separator the earlier ; / && / newline check missed.
    expect(runHook('git tag --list || git tag v99.0.0').code).toBe(2);
    expect(runHook('git tag --list | xargs -I{} git tag v99.0.0').code).toBe(2);
    expect(runHook('git tag --list & git tag v99.0.0').code).toBe(2);
    expect(runHook('git tag --list $(git tag v99.0.0)').code).toBe(2);
    // Recovery must not ride through `||` either.
    expect(runHook('git tag -d v0.5.0 || git tag v99.0.0').code).toBe(2);
  });

  test('R1: a metacharacter alone does not make a command compound', () => {
    // The fix is "metacharacter AND more than one invocation", not a flat
    // metacharacter ban -- piping listing output through another tool is
    // ordinary, legitimate usage and must stay allowed.
    expect(runHook('git tag --list | wc -l').code).toBe(0);
  });

  test('R2: a create whose message merely mentions a listing flag is still checked', () => {
    const a = runHook('git tag -a v99.0.0 -m "--list"');
    expect(a.code).toBe(2);
    expect(a.stderr).toContain('docs/releases/99.0.0.md');

    const b = runHook('git tag -a v99.0.0 -m "see --format"');
    expect(b.code).toBe(2);
    expect(b.stderr).toContain('docs/releases/99.0.0.md');
  });

  test('R3 BLOCKING: recovery still works when jq is unavailable', () => {
    // With jq missing, `cmd` is the raw JSON payload (it starts with "{",
    // not "git"), so the anchored recovery regex can never match. The
    // guard must fall back to the old bare-substring test here instead of
    // leaving recovery blocked in this degraded mode.
    expect(runHookNoJq('git tag -d v99.0.0').code).toBe(0);
    expect(runHookNoJq('git push origin :refs/tags/v99.0.0').code).toBe(0);
  });
});
