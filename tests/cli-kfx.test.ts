// `screepub kfx-status` and `screepub kfx-install`.
//
// The handlers are tested in process with a fake probe and a fake installer.
// NOTHING in this file may reach the real installer: it downloads a plugin
// and writes it into the Calibre of whatever machine runs the suite.
import { describe, test, expect, afterAll } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  kfxStatusCommand,
  kfxInstallCommand,
  setupLines,
  installLines,
} from '../src/cli-kfx';
import { CliError } from '../src/cli-errors';
import type { KfxInstallResult, KfxStatus } from '../src/export/kfx';
import { resolveCommand, VERBS } from '../src/cli-devices';

const SCRATCH = mkdtempSync(join(tmpdir(), 'screepub-cli-kfx-'));
afterAll(() => rmSync(SCRATCH, { recursive: true, force: true }));

const ROOT = new URL('..', import.meta.url).pathname;

/** Spawn the real CLI. CALIBRE_CONFIG_DIRECTORY points Calibre at a
 *  throwaway config inside SCRATCH, so if a refusal below ever regressed and
 *  let `kfx-install` through, it would install into that folder and not into
 *  the Calibre of the machine running the suite. Verified 2026-09-23: with
 *  this set, kfxStatus() reads the scratch config and the real one is not
 *  touched. */
async function runCli(args: string[]) {
  const proc = Bun.spawn(['bun', `${ROOT}src/cli.ts`, ...args], {
    stdout: 'pipe',
    stderr: 'pipe',
    env: { ...process.env, CALIBRE_CONFIG_DIRECTORY: join(SCRATCH, 'calibre-config') },
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  return { stdout, stderr, exitCode };
}

const missingPlugin: KfxStatus = { calibre: true, previewer: true, pluginInstalled: false, ready: false };
const allThere: KfxStatus = { calibre: true, previewer: true, pluginInstalled: true, ready: true };

describe('kfxStatusCommand', () => {
  test('answers the checklist for the probed status and the given platform', async () => {
    const setup = await kfxStatusCommand({ status: async () => missingPlugin, platform: 'darwin' });
    expect(setup.ready).toBe(false);
    expect(setup.possible).toBe(true);
    expect(setup.steps.find((s) => s.id === 'plugin')!.fix).toEqual({ kind: 'install', label: 'Install' });
  });
});

describe('kfxInstallCommand', () => {
  test('success reports the version, the removed forks, and a FRESH checklist', async () => {
    // The status is probed again after the install, so the answer the window
    // redraws from is the one Calibre now reports, not the one from before.
    // The fake status answers according to whether the install has actually
    // happened yet, so a mutant that probes BEFORE installing is caught by a
    // wrong answer (missingPlugin, not allThere), not just a call count.
    let done = false;
    let probed = 0;
    const answer = await kfxInstallCommand({
      install: async (): Promise<KfxInstallResult> => {
        done = true;
        return { ok: true, version: '2.20.1', removed: ['KFX Output (fork)'] };
      },
      status: async () => { probed += 1; return done ? allThere : missingPlugin; },
      platform: 'darwin',
    });
    expect(probed).toBe(1);
    expect(answer.version).toBe('2.20.1');
    expect(answer.removed).toEqual(['KFX Output (fork)']);
    expect(answer.setup.ready).toBe(true);
  });

  test('a missing removed list reads as empty, never undefined', async () => {
    const answer = await kfxInstallCommand({
      install: async () => ({ ok: true, version: '2.20.1' }),
      status: async () => allThere,
      platform: 'darwin',
    });
    expect(answer.removed).toEqual([]);
  });

  test('a failure is a kfx-install-failed CliError carrying Calibre’s reason', async () => {
    let probed = 0;
    const err = await kfxInstallCommand({
      install: async () => ({ ok: false, reason: 'downloaded 10 bytes, index says 20' }),
      status: async () => { probed += 1; return missingPlugin; },
      platform: 'darwin',
    }).catch((e) => e);
    expect(err).toBeInstanceOf(CliError);
    expect((err as CliError).code).toBe('kfx-install-failed');
    expect((err as CliError).message).toBe('could not install the KFX plugin: downloaded 10 bytes, index says 20');
    // No point probing after a failure: nothing changed that the caller
    // does not already have.
    expect(probed).toBe(0);
  });

  test('ok without a version is still a failure: nothing can say what was installed', async () => {
    await expect(kfxInstallCommand({
      install: async () => ({ ok: true }),
      status: async () => allThere,
      platform: 'darwin',
    })).rejects.toBeInstanceOf(CliError);
  });

  test('a failure with no reason still carries a sentence', async () => {
    try {
      await kfxInstallCommand({ install: async () => ({ ok: false }), status: async () => missingPlugin, platform: 'darwin' });
      throw new Error('expected a throw');
    } catch (err) {
      expect((err as CliError).message).toBe(
        'could not install the KFX plugin: Calibre did not say why',
      );
    }
  });
});

describe('human output', () => {
  test('status: the summary, then one aligned line per step with its fix', async () => {
    const setup = await kfxStatusCommand({
      status: async () => ({ calibre: true, previewer: false, pluginInstalled: false, ready: false }),
      platform: 'darwin',
    });
    expect(setupLines(setup)).toEqual([
      'Kindles get AZW3 for now. KFX looks better, and needs the three free tools below.',
      '  Calibre           installed',
      '  Kindle Previewer  not installed: https://kdp.amazon.com/en_US/help/topic/G202131170',
      '  KFX plugin        not installed: run screepub kfx-install',
    ]);
  });

  test('status: an after or unavailable fix prints its reason', async () => {
    const setup = await kfxStatusCommand({
      status: async () => ({ calibre: false, previewer: false, pluginInstalled: false, ready: false }),
      platform: 'linux',
    });
    const lines = setupLines(setup);
    expect(lines[2]).toBe('  Kindle Previewer  not available: Amazon does not make it for Linux');
    expect(lines[3]).toBe('  KFX plugin        not available: Of no use without Kindle Previewer');
    const mac = await kfxStatusCommand({
      status: async () => ({ calibre: false, previewer: false, pluginInstalled: false, ready: false }),
      platform: 'darwin',
    });
    expect(setupLines(mac)[3]).toBe('  KFX plugin        not installed: Install Calibre first');
  });

  test('install: the version, each removed fork, then the summary', () => {
    expect(installLines({
      version: '2.20.1',
      removed: ['KFX Output (fork)'],
      setup: { ready: true, possible: true, summary: 'S.', steps: [] },
    })).toEqual([
      'installed the KFX plugin 2.20.1',
      'removed an older copy: KFX Output (fork)',
      'S.',
    ]);
  });

  test('no line carries an em dash', async () => {
    const setup = await kfxStatusCommand({ status: async () => missingPlugin, platform: 'darwin' });
    for (const line of [...setupLines(setup), ...installLines({ version: '1', removed: ['x'], setup })]) {
      expect(line.includes('—')).toBe(false);
    }
  });
});

describe('the verbs', () => {
  test('both are verbs, and a file of either name still converts', () => {
    expect(VERBS as readonly string[]).toContain('kfx-status');
    expect(VERBS as readonly string[]).toContain('kfx-install');
    expect(resolveCommand(['kfx-install'], () => false)).toEqual({ kind: 'verb', verb: 'kfx-install', args: [] });
    expect(resolveCommand(['kfx-install'], () => true)).toEqual({ kind: 'convert' });
  });

  test('kfx-status --json is one object with the checklist', async () => {
    // Read-only: it probes and prints. Whatever this machine has, the shape
    // is the contract.
    const { stdout, exitCode } = await runCli(['kfx-status', '--json']);
    expect(exitCode).toBe(0);
    const answer = JSON.parse(stdout);
    expect(answer.ok).toBe(true);
    expect(typeof answer.ready).toBe('boolean');
    expect(typeof answer.possible).toBe('boolean');
    expect(typeof answer.summary).toBe('string');
    expect(answer.steps.map((s: { id: string }) => s.id)).toEqual(['calibre', 'previewer', 'plugin']);
  });

  test('kfx-status prints the summary for a person', async () => {
    const { stdout, exitCode } = await runCli(['kfx-status']);
    expect(exitCode).toBe(0);
    expect(stdout).toContain('Kindles get');
    expect(stdout).toContain('KFX plugin');
  });

  test('each verb has its own --help, naming itself and not the conversion flags', async () => {
    for (const verb of ['kfx-status', 'kfx-install']) {
      const { stdout, exitCode } = await runCli([verb, '--json', '--help']);
      expect(exitCode).toBe(0);
      const { usage } = JSON.parse(stdout);
      expect(usage).toContain(`screepub ${verb}`);
      expect(usage).not.toContain('--mobi');
    }
  });

  test('the main usage lists both', async () => {
    const { stdout } = await runCli(['--help']);
    expect(stdout).toContain('screepub kfx-status');
    expect(stdout).toContain('screepub kfx-install');
  });

  // Refused BEFORE anything runs. For kfx-install that order is the whole
  // point: a mistyped command must not reach the network or anyone's Calibre.
  const FOREIGN: [string[], string][] = [
    [['--device', 'x'], '--device'],
    [['--set', '{}'], '--set'],
    [['--for', 'kindle'], '--for'],
    [['--fountain', '/x.fountain'], '--fountain'],
    [['--options-json', '{}'], '--options-json'],
    [['--offered', '1.0'], '--offered'],
    [['--opted-in'], '--opted-in'],
  ];

  for (const verb of ['kfx-status', 'kfx-install']) {
    test(`${verb} refuses every other verb's flags as usage errors`, async () => {
      for (const [flags, name] of FOREIGN) {
        const { stdout, exitCode } = await runCli([verb, ...flags, '--json']);
        const answer = JSON.parse(stdout);
        expect(`${verb} ${name}: ${exitCode} ${answer.ok} ${answer.error?.code}`)
          .toBe(`${verb} ${name}: 1 false usage`);
        expect(answer.error.message).toContain(name);
      }
    });

    test(`${verb} takes no arguments`, async () => {
      const { stdout, exitCode } = await runCli([verb, 'extra', '--json']);
      expect(exitCode).toBe(1);
      const answer = JSON.parse(stdout);
      expect(answer.error.code).toBe('usage');
      expect(answer.error.message).toBe(`${verb} takes no arguments (got "extra")`);
    });
  }
});

describe('kfx-install refuses before it installs', () => {
  test('in the source, every refusal comes before the installer is called', async () => {
    // The spawned refusals above prove each refusal FIRES. This proves the
    // ORDER without ever letting the installer run: in cli.ts's kfx branch,
    // the last refusal is written above the first call to kfxInstallCommand.
    const source = await Bun.file(`${ROOT}src/cli.ts`).text();
    const branch = source.slice(source.indexOf("verb === 'kfx-status' || verb === 'kfx-install'"));
    const installed = branch.indexOf('kfxInstallCommand(');
    const lastRefusal = branch.lastIndexOf("fail({ code: 'usage'", installed);
    expect(installed).toBeGreaterThan(-1);
    expect(lastRefusal).toBeGreaterThan(-1);
    expect(lastRefusal).toBeLessThan(installed);
  });
});
