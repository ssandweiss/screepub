// `screepub update-decision` and `screepub update-should-check`.
//
// The window reaches the comparator through desktop/ui/update-compare.js,
// transpiled from the engine. These verbs are the same answer for
// everything that is NOT the window: a script, a headless caller, a
// person at a terminal asking why an update was or was not offered.
// Without them src/update/compare.ts would be implemented and
// unreachable outside the webview, which is the exact shape the parity
// audit found in the KFX installer and gave its own category.
//
// BOTH VERBS ARE OFFLINE. Neither one fetches anything: the caller hands
// over the versions, or the timestamps, and gets a judgement back. The
// engine makes no network requests and these verbs must not be the thing
// that changes that, so one test below asserts it directly.
import { describe, test, expect } from 'bun:test';
import { readFileSync } from 'node:fs';
import { updateDecisionCommand, updateShouldCheckCommand } from '../src/cli-update';
import { resolveCommand, VERBS } from '../src/cli-devices';

const ROOT = new URL('..', import.meta.url).pathname;

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

describe('updateDecisionCommand', () => {
  test('a newer release is offered', () => {
    expect(updateDecisionCommand({ offered: '0.7.0', current: '0.6.0' })).toEqual({
      offer: true,
      version: '0.7.0',
    });
  });

  test('the downgrade to a post-tag dev build is refused, with the reason', () => {
    // The case the whole engine-side comparator exists for.
    const d = updateDecisionCommand({ offered: '0.6.0', current: '0.6.0-1-g965cb10' });
    expect(d.offer).toBe(false);
    if (!d.offer) expect(d.reason).toContain('not newer');
  });

  test('a missing flag is a USAGE error, not a refusal', () => {
    // A refusal means "I judged it and said no". A missing --current
    // means nothing was judged. Folding the second into the first would
    // let a caller with a typo believe no update exists.
    expect(() => updateDecisionCommand({ offered: '0.7.0', current: undefined })).toThrow(
      /--current/,
    );
    expect(() => updateDecisionCommand({ offered: undefined, current: '0.6.0' })).toThrow(
      /--offered/,
    );
  });
});

describe('updateShouldCheckCommand', () => {
  const now = 1_800_000_000_000;

  test('never without opt-in', () => {
    expect(updateShouldCheckCommand({ optedIn: false, lastChecked: undefined, now })).toEqual({
      check: false,
    });
  });

  test('first opted-in launch checks; an hour later does not; a day later does', () => {
    expect(updateShouldCheckCommand({ optedIn: true, lastChecked: undefined, now }).check).toBe(true);
    expect(
      updateShouldCheckCommand({ optedIn: true, lastChecked: String(now - 3600_000), now }).check,
    ).toBe(false);
    expect(
      updateShouldCheckCommand({ optedIn: true, lastChecked: String(now - 25 * 3600_000), now })
        .check,
    ).toBe(true);
  });

  test('a --last-checked that is not a number is a usage error, not "never checked"', () => {
    // Reading garbage as "never" would turn one corrupted preference
    // into a network request on every launch, which breaks the README's
    // once-a-day promise through a typo.
    expect(() => updateShouldCheckCommand({ optedIn: true, lastChecked: 'yesterday', now })).toThrow(
      /--last-checked/,
    );
  });
});

describe('the verbs exist and resolve', () => {
  test('both are registered verbs', () => {
    expect(VERBS as readonly string[]).toContain('update-decision');
    expect(VERBS as readonly string[]).toContain('update-should-check');
  });

  test('a real file of that name still wins, per the verb rule', () => {
    // The CLI's standing compatibility promise: a verb is only a verb
    // when no file of that name exists.
    expect(resolveCommand(['update-decision'], () => true)).toEqual({ kind: 'convert' });
    expect(resolveCommand(['update-decision', '--json'], () => false)).toMatchObject({
      kind: 'verb',
      verb: 'update-decision',
    });
  });
});

describe('end to end, through the real CLI', () => {
  test('update-decision --json answers one JSON object', async () => {
    const { stdout, exitCode } = await runCli([
      'update-decision', '--offered', '0.7.0', '--current', '0.6.0', '--json',
    ]);
    expect(exitCode).toBe(0);
    expect(JSON.parse(stdout)).toEqual({ ok: true, offer: true, version: '0.7.0' });
  });

  test('a refusal is exit 0 with offer false: it is an ANSWER, not an error', async () => {
    // The caller asked a question and got a no. Exiting non-zero would
    // make every up-to-date check look like a crash to a script.
    const { stdout, exitCode } = await runCli([
      'update-decision', '--offered', '0.6.0', '--current', '0.6.0-1-g965cb10', '--json',
    ]);
    expect(exitCode).toBe(0);
    const d = JSON.parse(stdout);
    expect(d.ok).toBe(true);
    expect(d.offer).toBe(false);
    expect(d.reason).toContain('0.6.0-1-g965cb10');
  });

  test('a missing flag is a usage error with a non-zero exit', async () => {
    const { stdout, exitCode } = await runCli(['update-decision', '--offered', '0.7.0', '--json']);
    expect(exitCode).not.toBe(0);
    // The engine's standing --json error contract nests under `error`;
    // these verbs inherit it rather than inventing a second shape.
    const d = JSON.parse(stdout);
    expect(d.ok).toBe(false);
    expect(d.error.code).toBe('usage');
    expect(d.error.message).toContain('--current');
  });

  test('update-should-check --json answers the throttle', async () => {
    const { stdout, exitCode } = await runCli(['update-should-check', '--opted-in', '--json']);
    expect(exitCode).toBe(0);
    expect(JSON.parse(stdout)).toEqual({ ok: true, check: true });
  });

  test('without --opted-in the answer is no, even never having checked', async () => {
    const { stdout } = await runCli(['update-should-check', '--json']);
    expect(JSON.parse(stdout)).toEqual({ ok: true, check: false });
  });

  test('a flag from another verb is rejected, not ignored', async () => {
    // House rule, stated in cli.ts: silently accepting a flag the command
    // cannot act on teaches the user it did something.
    const { stdout, exitCode } = await runCli([
      'update-decision', '--offered', '0.7.0', '--current', '0.6.0', '--device', 'kindle', '--json',
    ]);
    expect(exitCode).not.toBe(0);
    const d = JSON.parse(stdout);
    expect(d.error.code).toBe('usage');
    expect(d.error.message).toContain('--device belongs to send');
  });
});

describe('the new flags do not leak into the OTHER verbs', () => {
  // The four update flags live in the schema every verb shares, so
  // adding them made `screepub devices --offered 1.0` quietly succeed.
  // Found by running it, not by reading: the house rule is that a flag a
  // command cannot act on is rejected, because accepting it teaches the
  // user it did something.
  test('devices refuses each update flag and names its owner', async () => {
    const cases: [string[], string][] = [
      [['--offered', '1.0'], '--offered belongs to update-decision'],
      [['--current', '1.0'], '--current belongs to update-decision'],
      [['--last-checked', '5'], '--last-checked belongs to update-should-check'],
      [['--opted-in'], '--opted-in belongs to update-should-check'],
    ];
    for (const [flags, expected] of cases) {
      const { stdout, exitCode } = await runCli(['devices', ...flags, '--json']);
      expect(exitCode).not.toBe(0);
      const d = JSON.parse(stdout);
      expect(d.error.code).toBe('usage');
      expect(d.error.message).toContain(expected);
    }
  });

  test('the update verbs refuse EACH OTHER’S flags too', async () => {
    const a = await runCli([
      'update-decision', '--offered', '1.0', '--current', '0.9', '--opted-in', '--json',
    ]);
    expect(JSON.parse(a.stdout).error.message).toContain('--opted-in belongs to update-should-check');
    const b = await runCli(['update-should-check', '--offered', '1.0', '--json']);
    expect(JSON.parse(b.stdout).error.message).toContain('--offered belongs to update-decision');
  });
});

describe('the verbs stay offline', () => {
  test('cli-update.ts imports nothing that can reach a network', () => {
    // The engine's promise is that it makes no network requests, and the
    // README says so on a public page. These verbs JUDGE versions a
    // caller hands them; the moment one of them fetches a release list
    // itself, that promise is broken by the feature least likely to be
    // suspected of it.
    const src = readFileSync(`${ROOT}src/cli-update.ts`, 'utf8');
    const compare = readFileSync(`${ROOT}src/update/compare.ts`, 'utf8');
    for (const text of [src, compare]) {
      expect(text).not.toMatch(/\bfetch\s*\(/);
      expect(text).not.toMatch(/from 'node:(http|https|net|dns|tls)'/);
    }
  });
});
