// Compile the Screepub engine and put it where the Tauri shell looks for it.
//
//   bun tools/build-sidecar.ts --host           # this machine, ~30s
//   bun tools/build-sidecar.ts --target bun-windows-x64
//   bun tools/build-sidecar.ts --all            # every target (~500 MB)
//
// This is a build input, not a release artifact: it produces no archive, no
// checksum and nothing that reaches a user. Release artifacts are
// tools/build-cli.ts's job, and the signed macOS CLI is app/release.sh's.
//
// The binary's NAME is the whole point. Tauri resolves a bundled external
// binary by name with the Rust target triple as a suffix — a rule verified
// by running a real build and a real app on this machine, recorded in
// desktop/README.md. Get it wrong and nothing fails until the window is
// open.
//
// The triple for each target in tools/sidecar-targets.ts is a PINNED
// constant, not something computed here from process.platform/process.arch:
// Node's platform/arch enum has no gnu/musl axis (glibc and musl Linux both
// report 'linux'/'x64'), so a mapping computed from it can silently name
// the wrong libc even when the OS and CPU guesses are right. The only
// value that cannot drift from what `cargo build` will actually demand is
// the toolchain's own report — `rustc -vV`'s `host:` line — which is what
// this tool's build step is checked against by hand (see desktop/README.md
// and the task report), not re-derived in code on every run.

import { existsSync, mkdirSync, statSync } from 'node:fs';
import { join, isAbsolute, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { REPO_DIR, readBinaryFormat, type Spawn } from './build-cli';
import {
  SIDECAR_TARGETS,
  sidecarTargetFor,
  sidecarFileName,
  hostBunTarget,
  type BunTarget,
  type SidecarTarget,
} from './sidecar-targets';

/** Exactly the directory tauri.conf.json's `externalBin` points at. */
export const BINARIES_DIR = join(REPO_DIR, 'desktop', 'src-tauri', 'binaries');

/** A compiled engine embeds the whole Bun runtime: 64-119 MB. Anything an
 *  order of magnitude under that is a truncated write or a stub, not a
 *  lean build. Same reasoning, same order of magnitude, as
 *  build-cli.ts's RELEASE_FLOORS.binaryBytes. */
export const SIDECAR_FLOOR_BYTES = 20_000_000;

const realSpawn: Spawn = (argv, cwd) => {
  const proc = Bun.spawnSync(argv, { cwd, stdout: 'inherit', stderr: 'pipe' });
  return { exitCode: proc.exitCode ?? 1, stderr: proc.stderr.toString() };
};

export interface SidecarArgs {
  targets: BunTarget[];
  outDir: string;
}

export function parseSidecarArgs(
  argv: string[],
  platform: string = process.platform,
  arch: string = process.arch,
): SidecarArgs {
  const { values } = parseArgs({
    args: argv,
    options: {
      host: { type: 'boolean', default: false },
      all: { type: 'boolean', default: false },
      target: { type: 'string', multiple: true },
      out: { type: 'string' },
    },
    strict: true,
    allowPositionals: false,
  });

  const named = (values.target ?? [])
    .flatMap((s) => s.split(','))
    .map((s) => s.trim())
    .filter(Boolean);

  let targets: BunTarget[];
  if (values.all) {
    targets = SIDECAR_TARGETS.map((t) => t.bunTarget);
  } else if (named.length) {
    // sidecarTargetFor throws, by name, on anything unknown.
    targets = named.map((n) => sidecarTargetFor(n).bunTarget);
  } else if (values.host) {
    targets = [hostBunTarget(platform, arch)];
  } else {
    throw new Error(
      'build-sidecar: say which targets — --host, --target <bun-target> or --all. ' +
        'There is no default: --all costs five cross-compiles and about 500 MB, ' +
        'and --host would build the wrong machine’s binary in CI.',
    );
  }

  const outDir = values.out
    ? isAbsolute(values.out)
      ? values.out
      : resolve(values.out)
    : BINARIES_DIR;

  return { targets, outDir };
}

/** Where this target's sidecar must sit, under the name Tauri asks for. */
export function sidecarPath(target: SidecarTarget, outDir: string): string {
  return join(outDir, sidecarFileName(target));
}

/** The one invocation, as data, so it is asserted element by element.
 *  `--outfile` never carries `.exe`: bun appends it for the windows target
 *  and passing it would produce `...msvc.exe.exe`, which Tauri would not
 *  find. */
export function compileSidecarArgv(target: SidecarTarget, outDir: string): string[] {
  const full = sidecarPath(target, outDir);
  const bare = full.slice(0, full.length - target.exeSuffix.length);
  return [
    'bun',
    'build',
    '--compile',
    `--target=${target.bunTarget}`,
    'src/cli.ts',
    `--outfile=${bare}`,
  ];
}

/** Returns the path actually written. Checks that it exists rather than
 *  trusting the exit code: `bun build` can exit 0 and leave nothing where
 *  we expected it, and the only later symptom is a window that cannot find
 *  its engine. */
export function buildSidecar(
  target: SidecarTarget,
  outDir: string,
  spawn: Spawn = realSpawn,
  repoDir: string = REPO_DIR,
): string {
  mkdirSync(outDir, { recursive: true });
  const { exitCode, stderr } = spawn(compileSidecarArgv(target, outDir), repoDir);
  if (exitCode !== 0) {
    throw new Error(
      `build-sidecar: ${target.bunTarget} failed to compile (exit ${exitCode})\n${stderr.trim()}`,
    );
  }
  const path = sidecarPath(target, outDir);
  if (!existsSync(path)) {
    throw new Error(
      `build-sidecar: ${target.bunTarget} compiled but wrote nothing at ${path}. ` +
        `Tauri looks for exactly ${sidecarFileName(target)}; see desktop/README.md.`,
    );
  }
  return path;
}

/** Check what was PRODUCED. A mis-typed --target= exits 0 while producing a
 *  perfectly valid binary for the wrong machine, and a file-exists check
 *  cannot tell the difference. */
export function verifySidecar(
  target: SidecarTarget,
  outDir: string,
  floor: number = SIDECAR_FLOOR_BYTES,
): void {
  const path = sidecarPath(target, outDir);
  if (!existsSync(path)) {
    throw new Error(`build-sidecar: no sidecar at ${path} (expected ${sidecarFileName(target)})`);
  }
  const bytes = statSync(path).size;
  if (bytes < floor) {
    throw new Error(
      `build-sidecar: ${sidecarFileName(target)} is ${bytes} bytes, under the ${floor}-byte floor`,
    );
  }
  const format = readBinaryFormat(path);
  if (format !== target.format) {
    throw new Error(
      `build-sidecar: ${sidecarFileName(target)} is ${format}, expected ${target.format}`,
    );
  }
}

if (import.meta.main) {
  try {
    const { targets, outDir } = parseSidecarArgs(process.argv.slice(2));
    for (const bunTarget of targets) {
      const target = sidecarTargetFor(bunTarget);
      console.log(`building ${bunTarget} → ${sidecarFileName(target)}`);
      buildSidecar(target, outDir);
      verifySidecar(target, outDir);
      console.log(`  ok: ${sidecarPath(target, outDir)}`);
    }
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }
}
