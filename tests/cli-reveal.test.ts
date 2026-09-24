// The `reveal` verb: show a file in the system's file manager. The engine
// does this now, not the window (parity piece C). See src/reveal.ts.
//
// No test here may perform a real reveal. Every performer test below passes
// a recording fake in place of the real Bun.spawn opener, and the spawned
// CLI tests at the bottom cover only refusals and --help: never a valid,
// existing path, which is the one input that would actually open Finder.
import { afterAll, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { revealFile, spawnOpener, type Opener } from '../src/reveal';
import { revealCommand } from '../src/cli-reveal';

const SCRATCH = mkdtempSync(join(tmpdir(), 'screepub-cli-reveal-'));
afterAll(() => rmSync(SCRATCH, { recursive: true, force: true }));

const ROOT = new URL('..', import.meta.url).pathname;

function codeOf(err: unknown): string {
  return (err as { code?: string }).code ?? '';
}

/** Records every argv it is called with and never spawns anything for real.
 *  `result` is what the fake reports back, as if a real child had exited. */
function recordingOpener(result: { code: number; stderr: string } = { code: 0, stderr: '' }) {
  const calls: string[][] = [];
  const open: Opener = async (argv) => {
    calls.push(argv);
    return result;
  };
  return { open, calls };
}

describe('revealFile: argv per platform', () => {
  test('darwin: open -R names the file itself, so Finder opens with it selected', async () => {
    const { open, calls } = recordingOpener();
    await revealFile('/Users/sam/Scripts/Field Station.pdf', 'darwin', open);
    expect(calls).toEqual([['open', '-R', '/Users/sam/Scripts/Field Station.pdf']]);
  });

  test('win32: explorer opens the FOLDER, never /select,: a folder with a space and a comma is exactly what breaks that flag\'s quoting', async () => {
    const { open, calls } = recordingOpener();
    const path = String.raw`C:\Users\Sam, O'Brien\My Scripts\Field Station.pdf`;
    await revealFile(path, 'win32', open);
    expect(calls).toEqual([['explorer', String.raw`C:\Users\Sam, O'Brien\My Scripts`]]);
  });

  test('linux, and everything else that is not darwin or win32: xdg-open on the folder', async () => {
    const { open, calls } = recordingOpener();
    await revealFile('/home/sam/Scripts/Field Station.pdf', 'linux', open);
    expect(calls).toEqual([['xdg-open', '/home/sam/Scripts']]);
  });

  test('win32: a trailing "\\." component is normalised away before dirname, so explorer gets the FOLDER, not the file itself', async () => {
    // win32.dirname alone treats the trailing "." as the last path segment
    // and strips only THAT, leaving "C:\x\a.exe" (the file) rather than
    // "C:\x" (its folder). Resolving first collapses "\." away, the same
    // way a shell would, before dirname ever runs.
    const { open, calls } = recordingOpener();
    await revealFile(String.raw`C:\x\a.exe\.`, 'win32', open);
    expect(calls).toEqual([['explorer', String.raw`C:\x`]]);
  });
});

describe('revealFile: explorer\'s exit code is ignored, every other opener\'s is not', () => {
  test('win32 explorer exiting 1 is still success: it does that on plenty of ordinary runs', async () => {
    const { open } = recordingOpener({ code: 1, stderr: 'whatever explorer happens to print' });
    await expect(
      revealFile(String.raw`C:\Users\Sam\Field Station.pdf`, 'win32', open),
    ).resolves.toBeUndefined();
  });

  test('darwin open exiting non-zero is reveal-failed, naming the path and carrying the trimmed stderr', async () => {
    const { open } = recordingOpener({ code: 1, stderr: '  no such file  \n' });
    let err: unknown;
    try {
      await revealFile('/Users/sam/Field Station.pdf', 'darwin', open);
    } catch (e) {
      err = e;
    }
    expect(codeOf(err)).toBe('reveal-failed');
    expect((err as Error).message).toContain('/Users/sam/Field Station.pdf');
    expect((err as Error).message).toContain('no such file');
    // The RAW (untrimmed) stderr must not leak through as-is.
    expect((err as Error).message).not.toContain('  no such file  \n');
  });

  test('linux xdg-open exiting non-zero with no stderr at all is still reveal-failed, and the message stays plain', async () => {
    const { open } = recordingOpener({ code: 1, stderr: '' });
    let err: unknown;
    try {
      await revealFile('/home/sam/Field Station.pdf', 'linux', open);
    } catch (e) {
      err = e;
    }
    expect(codeOf(err)).toBe('reveal-failed');
    expect((err as Error).message).toContain('/home/sam/Field Station.pdf');
  });
});

describe('revealFile: a spawn that cannot start at all', () => {
  test('an opener that throws ENOENT is reveal-failed, not an uncaught crash', async () => {
    const open: Opener = async () => {
      const enoent = new Error('spawn xdg-open ENOENT') as NodeJS.ErrnoException;
      enoent.code = 'ENOENT';
      throw enoent;
    };
    let err: unknown;
    try {
      await revealFile('/home/sam/Field Station.pdf', 'linux', open);
    } catch (e) {
      err = e;
    }
    expect(codeOf(err)).toBe('reveal-failed');
    expect((err as Error).message).toContain('/home/sam/Field Station.pdf');
  });
});

describe('revealCommand: both checks run before anything opens', () => {
  test('a relative path is usage, and the opener sees zero calls', async () => {
    const { open, calls } = recordingOpener();
    let err: unknown;
    try {
      await revealCommand('Field Station.pdf', { open });
    } catch (e) {
      err = e;
    }
    expect(codeOf(err)).toBe('usage');
    expect(calls).toEqual([]);
  });

  test('a missing absolute path is unreadable, names the path, and the opener sees zero calls', async () => {
    const { open, calls } = recordingOpener();
    const missing = join(SCRATCH, 'does-not-exist.pdf');
    let err: unknown;
    try {
      await revealCommand(missing, { open });
    } catch (e) {
      err = e;
    }
    expect(codeOf(err)).toBe('unreadable');
    expect((err as Error).message).toContain(missing);
    expect(calls).toEqual([]);
  });

  test('a directory given as the file is unreadable too, same as send and export', async () => {
    const { open, calls } = recordingOpener();
    let err: unknown;
    try {
      await revealCommand(SCRATCH, { open });
    } catch (e) {
      err = e;
    }
    expect(codeOf(err)).toBe('unreadable');
    expect(calls).toEqual([]);
  });
});

describe('revealCommand: the answer shape', () => {
  test('an existing absolute path answers { revealed: <path> } and calls the opener exactly once', async () => {
    const file = join(SCRATCH, 'Field Station.pdf');
    writeFileSync(file, 'not really a pdf');
    const { open, calls } = recordingOpener();
    const result = await revealCommand(file, { platform: 'linux', open });
    expect(result).toEqual({ revealed: file });
    expect(calls).toEqual([['xdg-open', SCRATCH]]);
  });

  test('a failing opener still refuses cleanly as reveal-failed, from the command level too', async () => {
    const file = join(SCRATCH, 'Field Station 2.pdf');
    writeFileSync(file, 'not really a pdf');
    const { open } = recordingOpener({ code: 1, stderr: 'nope' });
    let err: unknown;
    try {
      await revealCommand(file, { platform: 'linux', open });
    } catch (e) {
      err = e;
    }
    expect(codeOf(err)).toBe('reveal-failed');
  });
});

describe('spawnOpener: the real one, exercised without ever revealing anything', () => {
  // spawnOpener itself is not a fake, so this file's own "no real reveal"
  // rule still holds: neither call below names `open`, `explorer` or
  // `xdg-open`. The first runs another bun process that only prints to
  // stderr and exits, which spawns for real but opens no window and shows
  // no file manager; the second names a program that cannot possibly exist,
  // so nothing runs at all.
  test('runs a real child process and reports its exit code and stderr, trimmed by nobody but the caller', async () => {
    const result = await spawnOpener([process.execPath, '-e', 'console.error(" x "); process.exit(3)']);
    expect(result).toEqual({ code: 3, stderr: ' x \n' });
  });

  test('a program name that cannot exist rejects with ENOENT rather than hanging or crashing the process', async () => {
    let err: unknown;
    try {
      await spawnOpener(['screepub-definitely-not-a-real-program-3fbf27']);
    } catch (e) {
      err = e;
    }
    expect((err as NodeJS.ErrnoException)?.code).toBe('ENOENT');
  });
});

describe('screepub reveal (spawned CLI): refusals and --help ONLY, never a valid existing path', () => {
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

  test('--help describes the verb and exits 0', async () => {
    const { stdout, exitCode } = await runCli(['reveal', '--help']);
    expect(exitCode).toBe(0);
    expect(stdout).toContain('screepub reveal');
    expect(stdout).toContain('file manager');
  });

  test('no positional is a usage refusal', async () => {
    const { stdout, exitCode } = await runCli(['reveal', '--json']);
    expect(exitCode).toBe(1);
    const answer = JSON.parse(stdout);
    expect(answer.ok).toBe(false);
    expect(answer.error.code).toBe('usage');
  });

  test('two positionals is a usage refusal even when both are absolute and neither exists: the count is checked before either path is', async () => {
    // Both absolute and both missing, so a mutant that checked existence (or
    // absoluteness) before the count would fail this on 'unreadable' or
    // 'usage' for the wrong reason, not survive it. Safe either way: neither
    // path exists, so nothing could open even if the count check fell away.
    const a = join(SCRATCH, 'two-positionals-a.pdf');
    const b = join(SCRATCH, 'two-positionals-b.pdf');
    const { stdout, exitCode } = await runCli(['reveal', a, b, '--json']);
    expect(exitCode).toBe(1);
    const answer = JSON.parse(stdout);
    expect(answer.error.code).toBe('usage');
    expect(answer.error.message).toContain('exactly one');
  });

  test('a relative path is refused as usage before anything opens', async () => {
    const { stdout, exitCode } = await runCli(['reveal', 'Field Station.pdf', '--json']);
    expect(exitCode).toBe(1);
    expect(JSON.parse(stdout).error.code).toBe('usage');
  });

  test('a missing absolute path inside SCRATCH is refused as unreadable before anything opens', async () => {
    const missing = join(SCRATCH, 'nope.pdf');
    const { stdout, exitCode } = await runCli(['reveal', missing, '--json']);
    expect(exitCode).toBe(1);
    const answer = JSON.parse(stdout);
    expect(answer.error.code).toBe('unreadable');
    expect(answer.error.message).toContain(missing);
  });

  // Table-driven, the same shape tests/cli-app-settings.test.ts:593-609 uses
  // for its own FOREIGN list. Five rows, not app-settings' four: reveal
  // shares none of these flags with anything, so it refuses --set too,
  // where app-settings does not (it shares --set with settings). Each row
  // pins its OWN flag, so dropping any single refusal in cli.ts fails this
  // test, not just a lone case that happened to still be covered elsewhere.
  const FOREIGN: [string[], string][] = [
    [['--device', 'x'], '--device'],
    [['--set', '{}'], '--set'],
    [['--for', 'kindle'], '--for'],
    [['--fountain', '/x.fountain'], '--fountain'],
    [['--options-json', '{}'], '--options-json'],
  ];

  test('refuses every other verb\'s flags as usage errors', async () => {
    for (const [flags, name] of FOREIGN) {
      const { stdout, exitCode } = await runCli(['reveal', ...flags, '--json']);
      const answer = JSON.parse(stdout);
      expect(`${name}: ${exitCode} ${answer.ok} ${answer.error?.code}`).toBe(`${name}: 1 false usage`);
      expect(answer.error.message).toContain(name);
    }
  });

  test('the top-level --help usage lists reveal', async () => {
    const { stdout, exitCode } = await runCli(['--help']);
    expect(exitCode).toBe(0);
    expect(stdout).toContain('screepub reveal <file> [--json]');
    expect(stdout).toContain("show a file in the system's file manager");
  });
});
