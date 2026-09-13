import { describe, test, expect } from 'bun:test';
import {
  SIDECAR_TARGETS,
  SIDECAR_BASENAME,
  rustTripleFor,
  sidecarFileName,
  sidecarTargetFor,
  hostBunTarget,
} from '../tools/sidecar-targets';
import { TARGETS } from '../tools/build-cli';

describe('the triple map', () => {
  test('every Bun desktop target maps to exactly one Rust triple', () => {
    // Pinned whole, not sampled. These strings are not decorative: Tauri
    // resolves the sidecar by this exact filename suffix (Task 1), so a
    // typo here produces a window that cannot find its engine rather than
    // anything that fails to build.
    expect(
      Object.fromEntries(SIDECAR_TARGETS.map((t) => [t.bunTarget, t.rustTriple])),
    ).toEqual({
      'bun-linux-x64': 'x86_64-unknown-linux-gnu',
      'bun-linux-arm64': 'aarch64-unknown-linux-gnu',
      'bun-windows-x64': 'x86_64-pc-windows-msvc',
      'bun-darwin-x64': 'x86_64-apple-darwin',
      'bun-darwin-arm64': 'aarch64-apple-darwin',
    });
  });

  test('no two targets share a triple, and no triple is empty', () => {
    // A copy-paste that left two rows with the same triple would overwrite
    // one sidecar with the other's binary — same filename, wrong machine,
    // and it would run fine on the developer's own box.
    const triples = SIDECAR_TARGETS.map((t) => t.rustTriple);
    expect(new Set(triples).size).toBe(SIDECAR_TARGETS.length);
    for (const t of triples) expect(t.length).toBeGreaterThan(0);
  });

  test('each target names the binary format its output must have', () => {
    expect(
      Object.fromEntries(SIDECAR_TARGETS.map((t) => [t.bunTarget, t.format])),
    ).toEqual({
      'bun-linux-x64': 'elf-x86-64',
      'bun-linux-arm64': 'elf-aarch64',
      'bun-windows-x64': 'pe-x86-64',
      'bun-darwin-x64': 'macho-x86-64',
      'bun-darwin-arm64': 'macho-arm64',
    });
  });

  test('only the Windows target carries .exe', () => {
    for (const t of SIDECAR_TARGETS) {
      expect(t.exeSuffix).toBe(t.bunTarget === 'bun-windows-x64' ? '.exe' : '');
    }
  });
});

describe('rustTripleFor', () => {
  test('answers for every known target', () => {
    for (const t of SIDECAR_TARGETS) {
      expect(rustTripleFor(t.bunTarget)).toBe(t.rustTriple);
    }
  });

  test('an unknown target throws, and never falls back to a default', () => {
    // The failure this exists to prevent: a silent default would build the
    // host's binary, name it for a machine it cannot run on, and the
    // mistake would only surface on someone else's computer.
    for (const bad of ['bun-linux-riscv64', 'bun-darwin-arm', 'linux-x64', '', 'bun-windows-arm64']) {
      expect(() => rustTripleFor(bad)).toThrow(/unknown bun target/i);
    }
  });

  test('the error names the target it was given and the ones it knows', () => {
    expect(() => rustTripleFor('bun-linux-riscv64')).toThrow(/bun-linux-riscv64/);
    expect(() => rustTripleFor('bun-linux-riscv64')).toThrow(/bun-linux-x64/);
  });
});

describe('sidecarFileName', () => {
  test('is the basename, a hyphen, the triple, and the platform suffix', () => {
    // The single most important string in this piece. Task 1 observed the
    // rule on a real build; this pins the observation.
    const names = SIDECAR_TARGETS.map(sidecarFileName);
    expect(names).toEqual([
      'screepub-engine-x86_64-unknown-linux-gnu',
      'screepub-engine-aarch64-unknown-linux-gnu',
      'screepub-engine-x86_64-pc-windows-msvc.exe',
      'screepub-engine-x86_64-apple-darwin',
      'screepub-engine-aarch64-apple-darwin',
    ]);
  });

  test('every name begins with the basename the Rust asks for', () => {
    // desktop/src-tauri/src/sidecar.rs passes SIDECAR_BASENAME to
    // sidecar(); a name that did not start with it would never resolve.
    for (const t of SIDECAR_TARGETS) {
      expect(sidecarFileName(t).startsWith(`${SIDECAR_BASENAME}-`)).toBe(true);
    }
  });

  test('no name contains a path separator', () => {
    for (const t of SIDECAR_TARGETS) {
      expect(sidecarFileName(t)).not.toContain('/');
      expect(sidecarFileName(t)).not.toContain('\\');
    }
  });
});

describe('hostBunTarget', () => {
  test('maps the platform/arch pairs a developer or runner can be on', () => {
    expect(hostBunTarget('linux', 'x64')).toBe('bun-linux-x64');
    expect(hostBunTarget('linux', 'arm64')).toBe('bun-linux-arm64');
    expect(hostBunTarget('win32', 'x64')).toBe('bun-windows-x64');
    expect(hostBunTarget('darwin', 'x64')).toBe('bun-darwin-x64');
    expect(hostBunTarget('darwin', 'arm64')).toBe('bun-darwin-arm64');
  });

  test('an unsupported host throws rather than guessing', () => {
    expect(() => hostBunTarget('linux', 'ia32')).toThrow(/no sidecar target/i);
    expect(() => hostBunTarget('freebsd', 'x64')).toThrow(/no sidecar target/i);
    expect(() => hostBunTarget('win32', 'arm64')).toThrow(/no sidecar target/i);
  });

  test('this machine is a supported host', () => {
    const t = hostBunTarget(process.platform, process.arch);
    expect(SIDECAR_TARGETS.map((x) => x.bunTarget)).toContain(t);
  });
});

describe('the two target tables agree', () => {
  test('every release target in build-cli.ts has a sidecar triple', () => {
    // The drift this catches: someone adds a target to the release matrix
    // and the desktop app silently stops shipping an engine for it. The
    // reverse is allowed — darwin is a sidecar target and not a release
    // target, deliberately, because signed macOS artifacts come from
    // app/release.sh.
    const sidecarBunTargets = new Set<string>(SIDECAR_TARGETS.map((t) => t.bunTarget));
    for (const t of TARGETS) {
      expect(`${t.id} has a sidecar triple: ${sidecarBunTargets.has(t.bunTarget)}`).toBe(
        `${t.id} has a sidecar triple: true`,
      );
    }
  });

  test('where both tables name a format, they name the same one', () => {
    for (const t of TARGETS) {
      expect(sidecarTargetFor(t.bunTarget).format).toBe(t.format);
    }
  });
});
