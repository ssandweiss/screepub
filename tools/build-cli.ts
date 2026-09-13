// Cross-compile, package and VERIFY the Linux and Windows CLI artifacts.
//
// A Bun script and not shell, because a build matrix in bash is exactly the
// platform-locked tooling the cross-platform ADR is retiring, and because a
// release tool nobody can run locally is a release tool nobody can debug.
//
// It never produces a macOS artifact. Those are built, signed and notarized
// by app/release.sh on a macOS runner, and tools/bump-tap.sh hardcodes their
// names; a cross-compiled Mach-O could not be notarized from here, so moving
// that build would trade a clean download for a Gatekeeper warning.
//
//   bun tools/build-cli.ts --version 0.6.0 --out dist/
//   bun tools/build-cli.ts --version 0.6.0 --out dist/ --only windows-x64

import { closeSync, openSync, readSync } from 'node:fs';

export type BinaryFormat =
  | 'elf-x86-64'
  | 'elf-aarch64'
  | 'pe-x86-64'
  | 'macho-arm64'
  | 'macho-x86-64'
  | 'unknown';

/** How many leading bytes are enough to name every format below. A real
 *  PE header sits at 0x78 in bun's output; 4096 leaves room to spare. */
const HEAD_BYTES = 4096;

/** Name the executable format from its header.
 *
 *  Shelling out to `file` was the alternative and is not usable: it does not
 *  exist on a Windows runner, is not guaranteed in a container, and answers
 *  in prose. These offsets are the on-disk ABI and were confirmed against
 *  real `bun build --compile` output for all four targets. */
export function detectBinaryFormat(head: Uint8Array): BinaryFormat {
  const view = new DataView(head.buffer, head.byteOffset, head.byteLength);
  const u16 = (o: number): number => (o >= 0 && o + 2 <= head.length ? view.getUint16(o, true) : -1);
  const u32 = (o: number): number => (o >= 0 && o + 4 <= head.length ? view.getUint32(o, true) : -1);

  // ELF: 7f 'E' 'L' 'F', EI_CLASS=2 (64-bit), EI_DATA=1 (little endian),
  // then e_machine as a u16 at 0x12.
  if (head[0] === 0x7f && head[1] === 0x45 && head[2] === 0x4c && head[3] === 0x46) {
    if (head[4] !== 2 || head[5] !== 1) return 'unknown';
    const machine = u16(0x12);
    if (machine === 0x3e) return 'elf-x86-64';
    if (machine === 0xb7) return 'elf-aarch64';
    return 'unknown';
  }

  // PE: 'MZ', a u32 at 0x3c pointing at 'PE\0\0', machine as a u16 after it.
  if (head[0] === 0x4d && head[1] === 0x5a) {
    const off = u32(0x3c);
    if (off < 0 || off + 6 > head.length) return 'unknown';
    const isPe =
      head[off] === 0x50 && head[off + 1] === 0x45 && head[off + 2] === 0 && head[off + 3] === 0;
    if (!isPe) return 'unknown';
    return u16(off + 4) === 0x8664 ? 'pe-x86-64' : 'unknown';
  }

  // Mach-O 64-bit, little endian: magic 0xfeedfacf, cputype at 0x04.
  if (u32(0) === 0xfeedfacf) {
    const cpu = u32(4);
    if (cpu === 0x0100000c) return 'macho-arm64';
    if (cpu === 0x01000007) return 'macho-x86-64';
  }

  return 'unknown';
}

/** Read only the header, never the whole 100 MB file. Throws if the path
 *  does not exist; callers check existence first and say so themselves. */
export function readBinaryFormat(path: string): BinaryFormat {
  const fd = openSync(path, 'r');
  try {
    const head = new Uint8Array(HEAD_BYTES);
    const read = readSync(fd, head, 0, HEAD_BYTES, 0);
    return detectBinaryFormat(head.subarray(0, read));
  } finally {
    closeSync(fd);
  }
}
