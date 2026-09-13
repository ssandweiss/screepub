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
