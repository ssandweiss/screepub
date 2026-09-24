// Compile the Screepub engine and put it where the Tauri shell looks for it.
//
//   bun tools/build-sidecar.ts --host           # this machine, ~30s
//   bun tools/build-sidecar.ts --universal      # both darwin slices, lipo'd
//   bun tools/build-sidecar.ts --target bun-windows-x64
//   bun tools/build-sidecar.ts --all            # every target (~100 MB each)
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
// Two different sources answer "what is the Rust triple?", for two
// different questions. For --target/--all, it is the PINNED constant in
// tools/sidecar-targets.ts's SIDECAR_TARGETS — which has Linux musl rows
// (bun-linux-x64-musl, bun-linux-arm64-musl) alongside the glibc ones: Bun
// really does compile musl-linked Linux binaries, this was verified on this
// machine, not assumed. Cross-compiling for a machine you are not on, there
// is no toolchain to ask, and the table is cross-pinned against
// build-cli.ts's release matrix so it cannot drift silently. For --host, it
// is asked of THIS machine's own rustc (hostSidecarTarget, in
// tools/sidecar-targets.ts) rather than mapped from process.platform/
// process.arch: Node's platform/arch enum has no gnu/musl axis (glibc and
// musl Linux both report 'linux'/'x64'), so a value derived from it can
// silently name the wrong libc even when the OS and CPU guesses are right.
// hostSidecarTarget uses that same rustc answer to pick the musl BunTarget
// too, not only the filename — naming a sidecar correctly but building it
// from the glibc row is still a build that fails on a musl host, just
// loudly instead of silently. Task 1 already showed what the fully silent
// version looks like: cargo build succeeds, the sidecar bundles under the
// wrong name, and the app fails at runtime with a bare "No such file or
// directory" naming no file. Anyone running --host is about to `cargo
// build` on this same machine, so asking its own rustc is both correct and
// always available.

import { existsSync, mkdirSync, statSync } from 'node:fs';
import { join, isAbsolute, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { REPO_DIR, readBinaryFormat, type Spawn } from './build-cli';
import {
  SIDECAR_TARGETS,
  sidecarTargetFor,
  sidecarFileName,
  SIDECAR_BASENAME,
  hostBunTarget,
  hostSidecarTarget,
  rustcHostTriple,
  type BunTarget,
  type SidecarTarget,
  type HostTriple,
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
  /** Set only when targets came from --host. The caller should then build
   *  with hostSidecarTarget(..., hostTriple) instead of
   *  sidecarTargetFor(bunTarget), so the sidecar is named for what THIS
   *  machine's rustc actually reports rather than the pinned table's
   *  assumption. --target and --all leave this undefined and keep the
   *  pinned table exactly. */
  hostTriple?: HostTriple;
  /** Set only by --universal: build both darwin slices, then lipo them into
   *  the one file `cargo tauri build --target universal-apple-darwin` looks
   *  for. Not a BunTarget, because bun has no universal target — it is a
   *  post-processing step over two real builds. */
  universal?: boolean;
}

export function parseSidecarArgs(
  argv: string[],
  platform: string = process.platform,
  arch: string = process.arch,
  hostTriple: HostTriple = rustcHostTriple,
): SidecarArgs {
  const { values } = parseArgs({
    args: argv,
    options: {
      host: { type: 'boolean', default: false },
      universal: { type: 'boolean', default: false },
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
  let viaHost = false;
  if (values.universal) {
    // Deliberately NOT --host plus a lipo: --host gives one slice, and a
    // universal bundle fused from one slice is a thin binary wearing a
    // universal name. Both, always, named by the pinned table.
    if (platform !== 'darwin') {
      throw new Error(
        `build-sidecar: --universal needs lipo, which is macOS-only, and this machine is ${platform}.`,
      );
    }
    targets = ['bun-darwin-x64', 'bun-darwin-arm64'];
  } else if (values.all) {
    targets = SIDECAR_TARGETS.map((t) => t.bunTarget);
  } else if (named.length) {
    // sidecarTargetFor throws, by name, on anything unknown.
    targets = named.map((n) => sidecarTargetFor(n).bunTarget);
  } else if (values.host) {
    targets = [hostBunTarget(platform, arch)];
    viaHost = true;
  } else {
    throw new Error(
      'build-sidecar: say which targets — --host, --target <bun-target> or --all. ' +
        `There is no default: --all costs ${SIDECAR_TARGETS.length} cross-compiles and ` +
        `about ${SIDECAR_TARGETS.length * 100} MB, and --host would build the wrong ` +
        'machine’s binary in CI.',
    );
  }

  const outDir = values.out
    ? isAbsolute(values.out)
      ? values.out
      : resolve(values.out)
    : BINARIES_DIR;

  if (values.universal) return { targets, outDir, universal: true };
  return viaHost ? { targets, outDir, hostTriple } : { targets, outDir };
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


// ── the universal macOS sidecar ──────────────────────────────────────
//
// bun compiles one architecture at a time, so there is no bun target that
// produces a universal binary and no SIDECAR_TARGETS row for one: it is a
// lipo of two real builds, not a build. That is why this lives here as a
// post-processing step rather than as a seventh row in the table.
//
// Why it is worth having at all: the frozen Swift updater takes the FIRST
// .dmg asset on a release and has no architecture logic, because it was
// written when there was exactly one universal DMG to take. Per-arch Mac
// bundles are therefore not merely awkward for the Homebrew cask, they are
// what makes an automatic migration off the Swift app impossible. See
// docs/adr/2026-09-14-swift-app-update-path.md.

/** Not a rustc target triple bun knows; the name Tauri gives the slot when
 *  built with `--target universal-apple-darwin`. */
export const UNIVERSAL_TRIPLE = 'universal-apple-darwin';

export function universalSidecarPath(outDir: string): string {
  return join(outDir, `${SIDECAR_BASENAME}-${UNIVERSAL_TRIPLE}`);
}

/** The two thin sidecars lipo reads, in the order it reads them. Exported
 *  as data so the invocation is asserted element by element rather than by
 *  running it, which only a Mac can do. */
export function lipoArgv(outDir: string): string[] {
  const thin = ['x86_64-apple-darwin', 'aarch64-apple-darwin'].map((triple) =>
    join(outDir, `${SIDECAR_BASENAME}-${triple}`),
  );
  return ['lipo', '-create', '-output', universalSidecarPath(outDir), ...thin];
}

/** Fuse the two darwin sidecars. Both must already exist.
 *
 *  Checks what was PRODUCED, for the same reason verifySidecar does: lipo
 *  can exit 0 and leave a THIN binary (hand it one input and it copies it),
 *  and a thin binary inside something labelled universal is the exact
 *  failure this whole path exists to prevent — every Intel user gets an
 *  arm64 app, the old updater installs it without complaint, and the only
 *  symptom is an app that will not open on someone else's computer. */
export function lipoUniversalSidecar(
  outDir: string,
  spawn: Spawn = realSpawn,
  repoDir: string = REPO_DIR,
): string {
  mkdirSync(outDir, { recursive: true });
  const { exitCode, stderr } = spawn(lipoArgv(outDir), repoDir);
  if (exitCode !== 0) {
    throw new Error(`build-sidecar: lipo failed (exit ${exitCode})\n${stderr.trim()}`);
  }
  const path = universalSidecarPath(outDir);
  if (!existsSync(path)) {
    throw new Error(
      `build-sidecar: lipo exited 0 but wrote nothing at ${path}. ` +
        `Tauri looks for exactly ${SIDECAR_BASENAME}-${UNIVERSAL_TRIPLE}.`,
    );
  }
  const format = readBinaryFormat(path);
  if (format !== 'macho-universal') {
    throw new Error(
      `build-sidecar: ${path} is ${format}, not macho-universal. A thin binary ` +
        'inside a universal bundle ships an app that cannot run on half of all Macs, ' +
        'and the frozen Swift updater has no architecture check to catch it.',
    );
  }
  return path;
}

// LAST in the file on purpose: this runs at import time, so every const and
// function it reaches must already be initialised. It used to sit above the
// universal section and died with "Cannot access 'UNIVERSAL_TRIPLE' before
// initialization" the first time --universal ran.
if (import.meta.main) {
  try {
    const { targets, outDir, hostTriple, universal } = parseSidecarArgs(process.argv.slice(2));
    for (const bunTarget of targets) {
      // --host: resolve against THIS machine's rustc — which can swap in
      // a musl bunTarget the pre-parsed `targets` array above never knew
      // about, so the log below reads target.bunTarget, not the loop
      // variable. --target/--all: name it from the pinned table
      // (hostTriple is undefined, so `target` matches `bunTarget`).
      const target = hostTriple
        ? hostSidecarTarget(process.platform, process.arch, hostTriple)
        : sidecarTargetFor(bunTarget);
      console.log(`building ${target.bunTarget} → ${sidecarFileName(target)}`);
      buildSidecar(target, outDir);
      verifySidecar(target, outDir);
      console.log(`  ok: ${sidecarPath(target, outDir)}`);
    }
    if (universal) {
      console.log(`fusing → ${SIDECAR_BASENAME}-${UNIVERSAL_TRIPLE}`);
      console.log(`  ok: ${lipoUniversalSidecar(outDir)}`);
    }
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }
}
