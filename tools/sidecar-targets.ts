// Which Rust target triple corresponds to each Bun compile target, and what
// the sidecar file must therefore be called.
//
// This is the one fact in piece C that a mistake hides rather than reveals.
// Tauri resolves a bundled external binary by name, with the Rust triple as
// a filename suffix; the rule was VERIFIED by running a real build and a
// real app on this machine (see desktop/README.md, "How Tauri finds the
// engine"), not read out of documentation. A wrong triple here compiles
// cleanly, bundles cleanly, and fails at runtime on someone else's computer.
//
// Two tables exist on purpose. tools/build-cli.ts's TARGETS is the RELEASE
// matrix and holds no darwin row, because a macOS artifact must come signed
// and notarized from app/release.sh. A sidecar is not a release artifact:
// it is an input to a build, so darwin belongs here. tests/sidecar-targets
// .test.ts pins that the release table is a subset of this one.

import type { BinaryFormat } from './build-cli';

export type BunTarget =
  | 'bun-linux-x64'
  | 'bun-linux-arm64'
  | 'bun-windows-x64'
  | 'bun-darwin-x64'
  | 'bun-darwin-arm64';

export interface SidecarTarget {
  bunTarget: BunTarget;
  /** The suffix Tauri requires on the sidecar's filename. */
  rustTriple: string;
  /** What `bun build --compile` actually writes for this target. */
  exeSuffix: '' | '.exe';
  /** What the compiled binary must be. Checked, never assumed. */
  format: BinaryFormat;
}

/** The name the Rust passes to `sidecar()`. Every file below starts with it. */
export const SIDECAR_BASENAME = 'screepub-engine';

export const SIDECAR_TARGETS: readonly SidecarTarget[] = [
  {
    bunTarget: 'bun-linux-x64',
    rustTriple: 'x86_64-unknown-linux-gnu',
    exeSuffix: '',
    format: 'elf-x86-64',
  },
  {
    bunTarget: 'bun-linux-arm64',
    rustTriple: 'aarch64-unknown-linux-gnu',
    exeSuffix: '',
    format: 'elf-aarch64',
  },
  {
    bunTarget: 'bun-windows-x64',
    rustTriple: 'x86_64-pc-windows-msvc',
    exeSuffix: '.exe',
    format: 'pe-x86-64',
  },
  {
    bunTarget: 'bun-darwin-x64',
    rustTriple: 'x86_64-apple-darwin',
    exeSuffix: '',
    format: 'macho-x86-64',
  },
  {
    bunTarget: 'bun-darwin-arm64',
    rustTriple: 'aarch64-apple-darwin',
    exeSuffix: '',
    format: 'macho-arm64',
  },
];

const KNOWN = SIDECAR_TARGETS.map((t) => t.bunTarget).join(', ');

export function sidecarTargetFor(bunTarget: string): SidecarTarget {
  const found = SIDECAR_TARGETS.find((t) => t.bunTarget === bunTarget);
  if (!found) {
    throw new Error(
      `build-sidecar: unknown bun target "${bunTarget}"; known targets are ${KNOWN}`,
    );
  }
  return found;
}

export function rustTripleFor(bunTarget: string): string {
  return sidecarTargetFor(bunTarget).rustTriple;
}

export function sidecarFileName(target: SidecarTarget): string {
  return `${SIDECAR_BASENAME}-${target.rustTriple}${target.exeSuffix}`;
}

/** Which target this machine is. Throws rather than guessing: a guess would
 *  produce a sidecar named for a machine it cannot run on. */
export function hostBunTarget(platform: string, arch: string): BunTarget {
  if (platform === 'linux' && arch === 'x64') return 'bun-linux-x64';
  if (platform === 'linux' && arch === 'arm64') return 'bun-linux-arm64';
  if (platform === 'win32' && arch === 'x64') return 'bun-windows-x64';
  if (platform === 'darwin' && arch === 'x64') return 'bun-darwin-x64';
  if (platform === 'darwin' && arch === 'arm64') return 'bun-darwin-arm64';
  throw new Error(
    `build-sidecar: no sidecar target for ${platform}/${arch}; known targets are ${KNOWN}`,
  );
}

/** A resolver for "what Rust triple is this machine", injected the same way
 *  build-cli.ts and build-sidecar.ts already inject `Spawn`: a real
 *  implementation by default, a fake one in tests. */
export type HostTriple = () => string;

/** Pull the triple out of `rustc -vV`'s `host:` line. Exported so a
 *  malformed capture can be tested without spawning a real process. */
export function parseRustcHost(output: string): string {
  const match = /^host:\s*(\S+)/m.exec(output);
  if (!match) {
    throw new Error(
      `build-sidecar: \`rustc -vV\` printed no "host:" line to read a triple from:\n${output.trim()}`,
    );
  }
  return match[1]!;
}

/** The real resolver: ask the toolchain that will actually run `cargo
 *  build` what ITS host is, instead of mapping process.platform/
 *  process.arch (see hostSidecarTarget for why). Anyone invoking --host is
 *  about to `cargo build`, so rustc is definitionally present — there is no
 *  silent fallback here for a missing or broken one, because a --host build
 *  that cannot ask rustc has no way left to get the one fact this file
 *  exists to get right. */
export function rustcHostTriple(): string {
  let proc: { exitCode: number | null; stdout: Uint8Array; stderr: Uint8Array };
  try {
    proc = Bun.spawnSync(['rustc', '-vV'], { stdout: 'pipe', stderr: 'pipe' });
  } catch (err) {
    throw new Error(
      `build-sidecar: could not run \`rustc -vV\` to resolve the host triple (${
        err instanceof Error ? err.message : String(err)
      })`,
    );
  }
  if ((proc.exitCode ?? 1) !== 0) {
    throw new Error(
      `build-sidecar: \`rustc -vV\` exited ${proc.exitCode} while resolving the host triple: ` +
        Buffer.from(proc.stderr).toString().trim(),
    );
  }
  return parseRustcHost(Buffer.from(proc.stdout).toString());
}

/** The SidecarTarget for THIS machine, named for what a same-machine
 *  `cargo build` will actually look for.
 *
 *  `bunTarget` still comes from platform/arch: Bun's own --compile targets
 *  have no gnu/musl axis to choose between, so there is nothing else to ask
 *  for that part. But the RUST TRIPLE — the part Tauri uses to resolve the
 *  sidecar's filename — is asked of the toolchain, not read from the
 *  pinned SIDECAR_TARGETS table. Node's platform/arch cannot tell a glibc
 *  host from a musl one (both report 'linux'/'x64'), and the pinned table
 *  has only one Linux row per architecture; on a musl host the pinned row
 *  would silently name the sidecar for the wrong libc, and Task 1 already
 *  showed what that failure looks like — cargo build succeeds, the sidecar
 *  bundles under the wrong name, and the app fails at runtime with a bare
 *  "No such file or directory" naming no file at all.
 *
 *  Cross-compiled targets (--target / --all in build-sidecar.ts) keep the
 *  pinned table exactly: you cannot ask rustc about a triple it is not
 *  installed for. */
export function hostSidecarTarget(
  platform: string = process.platform,
  arch: string = process.arch,
  hostTriple: HostTriple = rustcHostTriple,
): SidecarTarget {
  const base = sidecarTargetFor(hostBunTarget(platform, arch));
  return { ...base, rustTriple: hostTriple() };
}
