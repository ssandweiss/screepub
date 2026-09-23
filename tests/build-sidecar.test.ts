import { describe, test, expect, afterAll } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  BINARIES_DIR,
  SIDECAR_FLOOR_BYTES,
  parseSidecarArgs,
  sidecarPath,
  compileSidecarArgv,
  buildSidecar,
  verifySidecar,
  lipoArgv,
  lipoUniversalSidecar,
} from '../tools/build-sidecar';
import { SIDECAR_TARGETS, sidecarTargetFor, sidecarFileName } from '../tools/sidecar-targets';
import type { Spawn } from '../tools/build-cli';

const SCRATCH = mkdtempSync(join(tmpdir(), 'screepub-build-sidecar-'));
afterAll(() => rmSync(SCRATCH, { recursive: true, force: true }));

function tmpOut(): string {
  return mkdtempSync(join(SCRATCH, 'sidecar-'));
}

describe('parseSidecarArgs', () => {
  test('--host resolves the running machine', () => {
    expect(parseSidecarArgs(['--host'], 'linux', 'arm64').targets).toEqual(['bun-linux-arm64']);
    expect(parseSidecarArgs(['--host'], 'darwin', 'arm64').targets).toEqual(['bun-darwin-arm64']);
  });

  test('--target names one or several, and commas split', () => {
    expect(parseSidecarArgs(['--target', 'bun-windows-x64']).targets).toEqual(['bun-windows-x64']);
    expect(parseSidecarArgs(['--target', 'bun-linux-x64,bun-darwin-arm64']).targets).toEqual([
      'bun-linux-x64',
      'bun-darwin-arm64',
    ]);
  });

  test('--all is every target, in table order', () => {
    expect(parseSidecarArgs(['--all']).targets).toEqual(SIDECAR_TARGETS.map((t) => t.bunTarget));
  });

  test('no target selector at all is an error, not a default', () => {
    // A default of "--all" would cost a cross-compile per table entry
    // (hundreds of MB and minutes) to someone who typed the command to see
    // its help; a default of "--host" would silently build the wrong thing
    // in CI for another platform. Say which.
    expect(() => parseSidecarArgs([])).toThrow(/--host, --target .* or --all/);
  });

  test('the no-target error names the true cost of --all, derived from the table', () => {
    // Three prose copies of "five cross-compiles" went stale when
    // SIDECAR_TARGETS grew to seven rows (the musl fix) and nothing
    // noticed. This one is code, not prose, so it is checked against the
    // table's actual length rather than a number typed by hand — a
    // hardcoded "7" here would pass today and go stale exactly the same
    // way the moment an eighth target is added.
    expect(() => parseSidecarArgs([])).toThrow(
      new RegExp(`--all costs ${SIDECAR_TARGETS.length} cross-compiles`),
    );
  });

  test('an unknown target is rejected by name', () => {
    expect(() => parseSidecarArgs(['--target', 'bun-linux-riscv64'])).toThrow(/bun-linux-riscv64/);
  });

  test('the default output directory is the externalBin directory tauri.conf.json names', () => {
    // Not a coincidence to be maintained by hand: the config says
    // "binaries/screepub-engine", relative to src-tauri.
    expect(parseSidecarArgs(['--host'], 'linux', 'arm64').outDir).toBe(BINARIES_DIR);
    expect(BINARIES_DIR.endsWith(join('desktop', 'src-tauri', 'binaries'))).toBe(true);
  });

  test('--out overrides it, so a test never writes into the repo', () => {
    expect(parseSidecarArgs(['--host', '--out', '/tmp/x'], 'linux', 'x64').outDir).toBe('/tmp/x');
  });

  test('--host carries the injected triple resolver, for the caller to use instead of the pinned table', () => {
    const musl = () => 'x86_64-unknown-linux-musl';
    const args = parseSidecarArgs(['--host'], 'linux', 'x64', musl);
    expect(args.targets).toEqual(['bun-linux-x64']);
    expect(args.hostTriple).toBe(musl);
  });

  test('--target and --all never carry a resolver: the pinned table stays authoritative there', () => {
    // This is the fix's boundary: fix round 1 only touches --host. A
    // resolver leaking onto --target/--all would let a cross-compiled
    // target's filename be renamed by whatever rustc happens to be
    // installed on the machine doing the cross-compile, which is exactly
    // the drift the pinned, cross-pinned table exists to prevent.
    expect(parseSidecarArgs(['--target', 'bun-linux-x64']).hostTriple).toBeUndefined();
    expect(parseSidecarArgs(['--all']).hostTriple).toBeUndefined();
  });
});

describe('sidecarPath', () => {
  test('is the output directory plus the triple-suffixed name', () => {
    const win = sidecarTargetFor('bun-windows-x64');
    const lin = sidecarTargetFor('bun-linux-arm64');
    expect(sidecarPath(win, '/out')).toBe('/out/screepub-engine-x86_64-pc-windows-msvc.exe');
    expect(sidecarPath(lin, '/out')).toBe('/out/screepub-engine-aarch64-unknown-linux-gnu');
  });

  test('no two targets land on the same path', () => {
    const paths = SIDECAR_TARGETS.map((t) => sidecarPath(t, '/out'));
    expect(new Set(paths).size).toBe(SIDECAR_TARGETS.length);
  });
});

describe('compileSidecarArgv', () => {
  test('compiles the engine entry point for the named target', () => {
    const argv = compileSidecarArgv(sidecarTargetFor('bun-linux-x64'), '/out');
    expect(argv.slice(0, 4)).toEqual(['bun', 'build', '--compile', '--target=bun-linux-x64']);
    expect(argv).toContain('src/cli.ts');
  });

  test('the outfile we PASS never carries .exe; bun appends it', () => {
    // The trap tools/build-cli.ts already hit: passing 'x.exe' produces
    // 'x.exe.exe'. Here it would produce a file Tauri never looks for.
    const win = sidecarTargetFor('bun-windows-x64');
    const outfile = compileSidecarArgv(win, '/out').find((a) => a.startsWith('--outfile='))!;
    expect(outfile.endsWith('.exe')).toBe(false);
    expect(outfile).toBe('--outfile=/out/screepub-engine-x86_64-pc-windows-msvc');
    // ...and the file we then expect on disk DOES.
    expect(sidecarPath(win, '/out').endsWith('.exe')).toBe(true);
  });
});

describe('buildSidecar', () => {
  test('reports the compiler’s own stderr when the compile fails', () => {
    const spawn: Spawn = () => ({ exitCode: 1, stderr: 'error: no such target' });
    expect(() => buildSidecar(sidecarTargetFor('bun-linux-x64'), tmpOut(), spawn)).toThrow(
      /no such target/,
    );
  });

  test('a compile that exits 0 without writing the file is still a failure', () => {
    // The mistake this catches: trusting the exit code. `bun build` can
    // succeed and write nothing where we expected it, and the app would
    // then open and fail at runtime with "sidecar not found" — the exact
    // failure this whole piece is arranged to prevent.
    const spawn: Spawn = () => ({ exitCode: 0, stderr: '' });
    expect(() => buildSidecar(sidecarTargetFor('bun-linux-x64'), tmpOut(), spawn)).toThrow(
      /screepub-engine-x86_64-unknown-linux-gnu/,
    );
  });

  test('returns the path it wrote, which is the path Tauri will look for', () => {
    const out = tmpOut();
    const target = sidecarTargetFor('bun-linux-x64');
    const spawn: Spawn = (argv) => {
      const outfile = argv.find((a) => a.startsWith('--outfile='))!.slice('--outfile='.length);
      writeFileSync(outfile + target.exeSuffix, 'x');
      return { exitCode: 0, stderr: '' };
    };
    expect(buildSidecar(target, out, spawn)).toBe(sidecarPath(target, out));
  });
});

describe('verifySidecar', () => {
  const elf = (machine: number, bytes: number): Uint8Array => {
    const b = new Uint8Array(bytes);
    b.set([0x7f, 0x45, 0x4c, 0x46, 2, 1, 1, 0], 0);
    new DataView(b.buffer).setUint16(0x12, machine, true);
    return b;
  };

  test('accepts a binary of the right format and size', () => {
    const out = tmpOut();
    const t = sidecarTargetFor('bun-linux-x64');
    writeFileSync(sidecarPath(t, out), elf(0x3e, 4096));
    expect(() => verifySidecar(t, out, 1024)).not.toThrow();
  });

  test('rejects a binary built for the wrong machine', () => {
    // The single failure a file-exists check cannot see, and the one that
    // silently ships: aarch64 bytes under the x86_64 name. This is why the
    // check reads the ELF e_machine field rather than stat()ing the path.
    const out = tmpOut();
    const t = sidecarTargetFor('bun-linux-x64');
    writeFileSync(sidecarPath(t, out), elf(0xb7, 4096));
    expect(() => verifySidecar(t, out, 1024)).toThrow(/elf-aarch64.*expected.*elf-x86-64/);
  });

  test('rejects a truncated write', () => {
    const out = tmpOut();
    const t = sidecarTargetFor('bun-linux-x64');
    writeFileSync(sidecarPath(t, out), elf(0x3e, 64));
    expect(() => verifySidecar(t, out, 1024)).toThrow(/under the 1024-byte floor/);
  });

  test('rejects a missing file, naming the exact path Tauri needs', () => {
    const out = tmpOut();
    const t = sidecarTargetFor('bun-darwin-arm64');
    expect(() => verifySidecar(t, out)).toThrow(new RegExp(sidecarFileName(t)));
  });

  test('the production floor is large enough to reject anything but a real build', () => {
    // A compiled engine embeds the whole Bun runtime: 64-119 MB. A floor of
    // a few kilobytes would pass a shell script named like a binary.
    expect(SIDECAR_FLOOR_BYTES).toBeGreaterThanOrEqual(20_000_000);
  });
});

describe('nothing large can be committed', () => {
  test('.gitignore covers the sidecar directory and the cargo target directory', () => {
    const ignore = readFileSync(new URL('../.gitignore', import.meta.url), 'utf8');
    for (const rule of ['desktop/src-tauri/binaries/', 'desktop/src-tauri/target/']) {
      expect(ignore).toContain(rule);
    }
  });

  test('git itself agrees, which the file contents alone do not prove', () => {
    // A rule can be present and still not match — a leading slash, a typo,
    // an earlier negation. Ask git, which is the thing that decides.
    mkdirSync(BINARIES_DIR, { recursive: true });
    const probe = join(BINARIES_DIR, 'screepub-engine-probe');
    writeFileSync(probe, 'probe');
    try {
      const proc = Bun.spawnSync(['git', 'check-ignore', '-q', probe], {
        cwd: new URL('..', import.meta.url).pathname,
      });
      expect(proc.exitCode).toBe(0); // 0 = ignored
    } finally {
      rmSync(probe, { force: true });
    }
  });
});

// ── the universal macOS sidecar ──────────────────────────────────────
//
// The frozen Swift updater has no architecture logic: it takes the first
// .dmg asset it finds, because it was written when there was exactly one
// universal DMG to find (ADR 2026-09-14). Per-arch bundles are therefore
// not only a Homebrew cask inconvenience, they are what makes an automatic
// migration impossible. This is the other half of fixing that: bun compiles
// one arch at a time, so the universal sidecar is a lipo of two builds
// rather than a target bun knows about.
describe('the universal macOS sidecar', () => {
  /** A fat Mach-O header with both slices, enough for readBinaryFormat. */
  function fatBytes(cputypes = [0x01000007, 0x0100000c]): Uint8Array {
    const b = new Uint8Array(256);
    const v = new DataView(b.buffer);
    v.setUint32(0, 0xcafebabe, false);
    v.setUint32(4, cputypes.length, false);
    cputypes.forEach((cpu, i) => v.setUint32(8 + i * 20, cpu, false));
    return b;
  }
  /** A thin arm64 Mach-O: what a lipo that silently did nothing leaves. */
  function thinArm64(): Uint8Array {
    const b = new Uint8Array(256);
    const v = new DataView(b.buffer);
    v.setUint32(0, 0xfeedfacf, true);
    v.setUint32(4, 0x0100000c, true);
    return b;
  }

  test('--universal asks for exactly the two darwin slices, and says so', () => {
    const parsed = parseSidecarArgs(['--universal'], 'darwin', 'arm64');
    expect(parsed.targets).toEqual(['bun-darwin-x64', 'bun-darwin-arm64']);
    expect(parsed.universal).toBe(true);
    // NOT the host shortcut: --host would give one slice and a universal
    // bundle built from it is thin, which is the failure this guards.
    expect(parsed.hostTriple).toBeUndefined();
  });

  test('without --universal nothing claims to be universal', () => {
    expect(parseSidecarArgs(['--host'], 'darwin', 'arm64').universal).toBeFalsy();
    expect(
      parseSidecarArgs(['--target', 'bun-darwin-arm64'], 'darwin', 'arm64').universal,
    ).toBeFalsy();
  });

  test('the lipo invocation names both slices and the universal output', () => {
    const argv = lipoArgv('/out');
    expect(argv).toEqual([
      'lipo',
      '-create',
      '-output',
      '/out/screepub-engine-universal-apple-darwin',
      '/out/screepub-engine-x86_64-apple-darwin',
      '/out/screepub-engine-aarch64-apple-darwin',
    ]);
  });

  test('a lipo that exits non-zero fails loudly, carrying its stderr', () => {
    const dir = mkdtempSync(join(SCRATCH, 'lipo-'));
    try {
      expect(() =>
        lipoUniversalSidecar(dir, () => ({ exitCode: 1, stdout: '', stderr: 'lipo: no such file' })),
      ).toThrow(/lipo: no such file/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('a lipo that exits 0 having produced a THIN binary is refused', () => {
    // The failure this check exists for. Shipping it would hand every Intel
    // user an arm64 app inside something labelled universal, and the old
    // updater would install it without complaint.
    const dir = mkdtempSync(join(SCRATCH, 'lipo-'));
    try {
      expect(() =>
        lipoUniversalSidecar(dir, () => {
          writeFileSync(join(dir, 'screepub-engine-universal-apple-darwin'), thinArm64());
          return { exitCode: 0, stdout: '', stderr: '' };
        }),
      ).toThrow(/macho-universal|universal/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('a real fat binary is accepted and its path returned', () => {
    const dir = mkdtempSync(join(SCRATCH, 'lipo-'));
    try {
      const out = lipoUniversalSidecar(dir, () => {
        writeFileSync(join(dir, 'screepub-engine-universal-apple-darwin'), fatBytes());
        return { exitCode: 0, stdout: '', stderr: '' };
      });
      expect(out).toBe(join(dir, 'screepub-engine-universal-apple-darwin'));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('lipo exiting 0 while writing nothing is refused, not returned', () => {
    const dir = mkdtempSync(join(SCRATCH, 'lipo-'));
    try {
      expect(() =>
        lipoUniversalSidecar(dir, () => ({ exitCode: 0, stdout: '', stderr: '' })),
      ).toThrow(/wrote nothing|not found|no such/i);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
