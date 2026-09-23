// The `kfx-status` and `kfx-install` verbs. Handlers RETURN values and never
// print: cli.ts owns stdout, the same split as cli-export.ts. The checklist is
// src/export/kfx-setup.ts's and the installer is src/export/kfx.ts's; this
// file chooses nothing, it only carries their answers out.
import { platform as hostPlatform } from 'node:process';
import { CliError } from './cli-errors';
import { installKfxPlugin, kfxStatus, type KfxInstallResult, type KfxStatus } from './export/kfx';
import { kfxSetup, type KfxSetup, type KfxStep } from './export/kfx-setup';

/** Injectable seams, defaulted to the real thing, so a test can drive every
 *  outcome without a Calibre, and without ever installing into a real one. */
export interface KfxDeps {
  status?: () => Promise<KfxStatus>;
  install?: () => Promise<KfxInstallResult>;
  platform?: string;
}

export interface KfxInstallAnswer {
  version: string;
  /** Conflicting KFX forks cleared to make room (see installKfxPlugin). */
  removed: string[];
  /** The checklist as Calibre reports it AFTER the install. */
  setup: KfxSetup;
}

export async function kfxStatusCommand(deps: KfxDeps = {}): Promise<KfxSetup> {
  const status = await (deps.status ?? kfxStatus)();
  return kfxSetup(status, deps.platform ?? hostPlatform);
}

/** Install or update the plugin, then probe again so the answer carries the
 *  fresh checklist and the window needs no second call. NEVER call this on
 *  the program's own initiative: it fetches third-party code and writes into
 *  the user's Calibre, so only an explicit request reaches it. */
export async function kfxInstallCommand(deps: KfxDeps = {}): Promise<KfxInstallAnswer> {
  const result = await (deps.install ?? (() => installKfxPlugin()))();
  if (!result.ok || !result.version) {
    throw new CliError(
      'kfx-install-failed',
      `could not install the KFX plugin: ${result.reason ?? 'Calibre did not say why'}`,
    );
  }
  const setup = await kfxStatusCommand(deps);
  return { version: result.version, removed: result.removed ?? [], setup };
}

function stepState(step: KfxStep): string {
  const fix = step.fix;
  if (fix === null) return 'installed';
  if (fix.kind === 'link') return `not installed: ${fix.url}`;
  if (fix.kind === 'install') return 'not installed: run screepub kfx-install';
  if (fix.kind === 'unavailable') return `not available: ${fix.why}`;
  return `not installed: ${fix.why}`;
}

/** `kfx-status` for a person: the summary, then one aligned line per step. */
export function setupLines(setup: KfxSetup): string[] {
  const width = Math.max(0, ...setup.steps.map((s) => s.name.length));
  return [setup.summary, ...setup.steps.map((s) => `  ${s.name.padEnd(width)}  ${stepState(s)}`)];
}

/** `kfx-install` for a person. */
export function installLines(answer: KfxInstallAnswer): string[] {
  return [
    `installed the KFX plugin ${answer.version}`,
    ...answer.removed.map((name) => `removed an older copy: ${name}`),
    answer.setup.summary,
  ];
}
