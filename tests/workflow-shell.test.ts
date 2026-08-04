import { describe, test, expect } from 'bun:test';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

// The release runs on macOS, whose bash is 3.2. There, expanding an EMPTY
// array under `set -u` is an unbound-variable ERROR, not an empty expansion.
//
// v0.5.0 died on exactly this, AFTER notarization, with the DMG already
// built: `"${PRE[@]}"` where PRE=() for every non-prerelease. The bug is
// invisible on prereleases, which is the only kind of tag the code path had
// ever been exercised with, so it shipped looking tested.
describe('release.yml is safe under bash 3.2 + set -u', () => {
  const yml = readFileSync('.github/workflows/release.yml', 'utf8');

  test('no bare "${arr[@]}" expansion of a possibly-empty array', () => {
    // Bare `"${NAME[@]}"`, not preceded by the ${NAME[@]+ guard.
    const bare = [...yml.matchAll(/(?<!\+)"\$\{([A-Za-z_][A-Za-z0-9_]*)\[@\]\}"/g)]
      .map((m) => m[0]);
    expect(bare).toEqual([]);
  });

  test('the guarded spelling actually survives an empty array here', () => {
    // Runs under the real /bin/bash on this machine. On macOS that IS 3.2,
    // so this is the genuine article rather than a stand-in.
    const run = spawnSync(
      '/bin/bash',
      ['-c', 'set -euo pipefail; PRE=(); args=(x ${PRE[@]+"${PRE[@]}"}); echo "${#args[@]}"'],
      { encoding: 'utf8' },
    );
    expect(run.status).toBe(0);
    expect(run.stdout.trim()).toBe('1');
  });

  test('and still passes the flag through when the array is NOT empty', () => {
    const run = spawnSync(
      '/bin/bash',
      ['-c', 'set -euo pipefail; PRE=(--prerelease); args=(x ${PRE[@]+"${PRE[@]}"}); echo "${args[1]}"'],
      { encoding: 'utf8' },
    );
    expect(run.status).toBe(0);
    expect(run.stdout.trim()).toBe('--prerelease');
  });
});
