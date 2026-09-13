import { describe, test, expect } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, isAbsolute } from 'node:path';
import {
  detectBinaryFormat,
  readBinaryFormat,
  TARGETS,
  buildDir,
  compileOutfile,
  binaryPath,
  archivePath,
  targetIdForHost,
  hostTarget,
  parseBuildArgs,
  assertPackageVersion,
  type TargetId,
} from '../tools/build-cli';

/** A header with the exact bytes a real executable of that shape carries,
 *  and zeros elsewhere. Built by hand rather than by copying a 100 MB
 *  artifact into the repo. */
function elfHeader(machine: number): Uint8Array {
  const b = new Uint8Array(256);
  b.set([0x7f, 0x45, 0x4c, 0x46, 2, 1, 1, 0], 0); // magic, 64-bit, LE, SysV
  new DataView(b.buffer).setUint16(0x12, machine, true);
  return b;
}

function peHeader(machine: number, peOffset = 0x78): Uint8Array {
  const bufSize = peOffset >= 256 ? 256 : Math.max(256, peOffset + 6);
  const b = new Uint8Array(bufSize);
  b.set([0x4d, 0x5a], 0); // 'MZ'
  new DataView(b.buffer).setUint32(0x3c, peOffset, true);
  if (peOffset < bufSize && peOffset + 6 <= bufSize) {
    b.set([0x50, 0x45, 0x00, 0x00], peOffset); // 'PE\0\0'
    new DataView(b.buffer).setUint16(peOffset + 4, machine, true);
  }
  return b;
}

function machoHeader(cputype: number): Uint8Array {
  const b = new Uint8Array(256);
  const v = new DataView(b.buffer);
  v.setUint32(0, 0xfeedfacf, true);
  v.setUint32(4, cputype, true);
  return b;
}

describe('detectBinaryFormat', () => {
  test('names each format this project can produce', () => {
    expect(detectBinaryFormat(elfHeader(0x3e))).toBe('elf-x86-64');
    expect(detectBinaryFormat(elfHeader(0xb7))).toBe('elf-aarch64');
    expect(detectBinaryFormat(peHeader(0x8664))).toBe('pe-x86-64');
    expect(detectBinaryFormat(machoHeader(0x0100000c))).toBe('macho-arm64');
    expect(detectBinaryFormat(machoHeader(0x01000007))).toBe('macho-x86-64');
  });

  test('the two ELF architectures are never confused for each other', () => {
    // The whole point of the check. An implementation that stopped at the
    // 0x7f454c46 magic would pass every "is it an ELF" question and ship an
    // x86-64 binary in the arm64 tarball.
    expect(detectBinaryFormat(elfHeader(0x3e))).not.toBe('elf-aarch64');
    expect(detectBinaryFormat(elfHeader(0xb7))).not.toBe('elf-x86-64');
    expect(detectBinaryFormat(elfHeader(0x28))).toBe('unknown'); // 32-bit ARM
  });

  test('a 32-bit or big-endian ELF is not accepted as one of ours', () => {
    const b32 = elfHeader(0x3e);
    b32[4] = 1; // EI_CLASS = 32-bit
    expect(detectBinaryFormat(b32)).toBe('unknown');
    const be = elfHeader(0x3e);
    be[5] = 2; // EI_DATA = big endian
    expect(detectBinaryFormat(be)).toBe('unknown');
  });

  test('an MZ stub that is not a PE, or is the wrong machine, is unknown', () => {
    const notPe = peHeader(0x8664);
    notPe[0x78] = 0x00; // break the 'PE\0\0' signature
    expect(detectBinaryFormat(notPe)).toBe('unknown');
    expect(detectBinaryFormat(peHeader(0x014c))).toBe('unknown'); // i386
    expect(detectBinaryFormat(peHeader(0xaa64))).toBe('unknown'); // arm64
  });

  test('empty, short and garbage input is unknown, never a crash', () => {
    // A 0-byte output file is the single most likely compiler failure, and
    // it must NOT read as a valid anything.
    expect(detectBinaryFormat(new Uint8Array(0))).toBe('unknown');
    expect(detectBinaryFormat(new Uint8Array([0x7f, 0x45]))).toBe('unknown');
    expect(detectBinaryFormat(new Uint8Array(64))).toBe('unknown');
    expect(detectBinaryFormat(new TextEncoder().encode('#!/bin/sh\nexit 0\n'))).toBe('unknown');
    // A PE whose header offset points past the bytes we read.
    expect(detectBinaryFormat(peHeader(0x8664, 0xfffff0))).toBe('unknown');
  });
});

describe('readBinaryFormat', () => {
  test('reads the format off disk, including a 0-byte file', () => {
    const dir = mkdtempSync(join(tmpdir(), 'screepub-fmt-'));
    try {
      writeFileSync(join(dir, 'arm'), elfHeader(0xb7));
      writeFileSync(join(dir, 'empty'), new Uint8Array(0));
      expect(readBinaryFormat(join(dir, 'arm'))).toBe('elf-aarch64');
      expect(readBinaryFormat(join(dir, 'empty'))).toBe('unknown');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('the target table', () => {
  test('is exactly the three non-macOS targets, and nothing darwin', () => {
    // Pinned as a whole, not sampled. An added 'darwin-arm64' row would
    // silently start producing an unsigned, unnotarized macOS artifact
    // alongside the signed one app/release.sh builds.
    expect(TARGETS.map((t) => t.id)).toEqual(['linux-x64', 'linux-arm64', 'windows-x64']);
    expect(TARGETS.map((t) => t.bunTarget)).toEqual([
      'bun-linux-x64',
      'bun-linux-arm64',
      'bun-windows-x64',
    ]);
    expect(TARGETS.map((t) => t.format)).toEqual(['elf-x86-64', 'elf-aarch64', 'pe-x86-64']);
    expect(TARGETS.map((t) => t.archiveName)).toEqual([
      'screepub-cli-linux-x64.tar.gz',
      'screepub-cli-linux-arm64.tar.gz',
      'screepub-cli-windows-x64.zip',
    ]);
  });

  test('every archive name is a bare filename with no path', () => {
    // SHA256SUMS lists these verbatim; a path component there breaks
    // `sha256sum -c` for anyone who downloads the file.
    for (const t of TARGETS) {
      expect(t.archiveName).not.toContain('/');
      expect(t.archiveName).not.toContain('\\');
    }
  });
});

describe('paths around a target', () => {
  const OUT = '/tmp/screepub-out';

  test('each target builds in its own directory, archives land flat', () => {
    const dirs = TARGETS.map((t) => buildDir(t, OUT));
    expect(new Set(dirs).size).toBe(TARGETS.length); // no two collide
    expect(dirs).toEqual([
      '/tmp/screepub-out/linux-x64',
      '/tmp/screepub-out/linux-arm64',
      '/tmp/screepub-out/windows-x64',
    ]);
    for (const t of TARGETS) {
      expect(archivePath(t, OUT)).toBe(`/tmp/screepub-out/${t.archiveName}`);
    }
  });

  test('the outfile we PASS never carries .exe; the file bun WRITES does', () => {
    // bun build --compile appends .exe for the windows target. Passing
    // 'screepub.exe' would produce 'screepub.exe.exe'; expecting no .exe
    // afterwards would look for a file that is not there.
    for (const t of TARGETS) {
      expect(compileOutfile(t, OUT).endsWith('.exe')).toBe(false);
    }
    const win = TARGETS.find((t) => t.id === 'windows-x64')!;
    const lin = TARGETS.find((t) => t.id === 'linux-x64')!;
    expect(binaryPath(win, OUT)).toBe('/tmp/screepub-out/windows-x64/screepub.exe');
    expect(binaryPath(lin, OUT)).toBe('/tmp/screepub-out/linux-x64/screepub');
  });
});

describe('hostTarget', () => {
  test('maps the platform/arch pairs that matter', () => {
    expect(targetIdForHost('linux', 'x64')).toBe('linux-x64');
    expect(targetIdForHost('linux', 'arm64')).toBe('linux-arm64');
    expect(targetIdForHost('win32', 'x64')).toBe('windows-x64');
    // macOS is deliberately NOT a target of this tool, so the host mapping
    // must answer "nothing", not fall back to something runnable-looking.
    expect(targetIdForHost('darwin', 'arm64')).toBeUndefined();
    expect(targetIdForHost('darwin', 'x64')).toBeUndefined();
    expect(targetIdForHost('linux', 'ia32')).toBeUndefined();
    expect(targetIdForHost('freebsd', 'x64')).toBeUndefined();
  });

  test('hostTarget agrees with the running process', () => {
    const host = hostTarget();
    const expected = targetIdForHost(process.platform, process.arch);
    expect(host?.id).toBe(expected as TargetId | undefined);
    if (host) expect(TARGETS).toContain(host);
  });
});

describe('parseBuildArgs', () => {
  test('takes a version and an output directory', () => {
    const args = parseBuildArgs(['--version', '0.6.0', '--out', '/tmp/x']);
    expect(args.version).toBe('0.6.0');
    expect(args.outDir).toBe('/tmp/x');
    expect(args.only).toEqual(['linux-x64', 'linux-arm64', 'windows-x64']);
  });

  test('accepts a tag spelling and normalises it', () => {
    expect(parseBuildArgs(['--version', 'v0.6.0', '--out', '/tmp/x']).version).toBe('0.6.0');
    expect(parseBuildArgs(['--version', 'v0.6.0-rc1', '--out', '/tmp/x']).version).toBe('0.6.0-rc1');
  });

  test('refuses a version that is not MAJOR.MINOR.PATCH', () => {
    expect(() => parseBuildArgs(['--out', '/tmp/x'])).toThrow(/--version/);
    expect(() => parseBuildArgs(['--version', '0.6', '--out', '/tmp/x'])).toThrow(/--version/);
    expect(() => parseBuildArgs(['--version', 'main', '--out', '/tmp/x'])).toThrow(/--version/);
    expect(() => parseBuildArgs(['--version', '', '--out', '/tmp/x'])).toThrow(/--version/);
  });

  test('refuses to invent an output directory', () => {
    // The artifacts are 39-119 MB each. A default would put a quarter of a
    // gigabyte somewhere nobody asked for.
    expect(() => parseBuildArgs(['--version', '0.6.0'])).toThrow(/--out/);
  });

  test('resolves the output directory to an absolute path', () => {
    const args = parseBuildArgs(['--version', '0.6.0', '--out', 'dist']);
    expect(isAbsolute(args.outDir)).toBe(true);
    expect(args.outDir.endsWith('dist')).toBe(true);
  });

  test('--only narrows the matrix, and rejects a target that does not exist', () => {
    expect(parseBuildArgs(['--version', '0.6.0', '--out', '/tmp/x', '--only', 'windows-x64']).only)
      .toEqual(['windows-x64']);
    expect(parseBuildArgs(['--version', '0.6.0', '--out', '/tmp/x', '--only', 'linux-x64,windows-x64']).only)
      .toEqual(['linux-x64', 'windows-x64']);
    // A typo must stop the build, not quietly produce nothing — which is
    // what filtering an unknown id out of the matrix would do.
    expect(() => parseBuildArgs(['--version', '0.6.0', '--out', '/tmp/x', '--only', 'darwin-arm64']))
      .toThrow(/darwin-arm64/);
    expect(() => parseBuildArgs(['--version', '0.6.0', '--out', '/tmp/x', '--only', 'linux_x64']))
      .toThrow(/linux-x64, linux-arm64, windows-x64/);
  });

  test('rejects an unknown flag rather than ignoring it', () => {
    expect(() => parseBuildArgs(['--version', '0.6.0', '--out', '/tmp/x', '--sign'])).toThrow();
  });
});

describe('assertPackageVersion', () => {
  function repoWith(version: unknown): string {
    const dir = mkdtempSync(join(tmpdir(), 'screepub-pkg-'));
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'screepub', version }));
    return dir;
  }

  test('passes when package.json agrees with the requested version', () => {
    const dir = repoWith('0.6.0');
    try {
      expect(() => assertPackageVersion('0.6.0', dir)).not.toThrow();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('refuses to build a binary that would misreport itself', () => {
    const dir = repoWith('0.5.4');
    try {
      // Both numbers in the message: the whole value of this guard is that
      // whoever hits it knows which one to change.
      expect(() => assertPackageVersion('0.6.0', dir)).toThrow(/0\.5\.4/);
      expect(() => assertPackageVersion('0.6.0', dir)).toThrow(/0\.6\.0/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('the real repo agrees with itself', () => {
    const pkg = JSON.parse(readFileSync('package.json', 'utf8')) as { version: string };
    expect(() => assertPackageVersion(pkg.version)).not.toThrow();
  });
});
