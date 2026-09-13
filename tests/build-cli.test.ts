import { describe, test, expect } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { detectBinaryFormat, readBinaryFormat } from '../tools/build-cli';

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
