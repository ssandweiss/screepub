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

import {
  closeSync,
  openSync,
  readSync,
  readFileSync,
  mkdirSync,
  chmodSync,
  rmSync,
  writeFileSync,
  existsSync,
  statSync,
} from 'node:fs';
import { join, isAbsolute, resolve, basename } from 'node:path';
import { parseArgs } from 'node:util';
import { createHash } from 'node:crypto';

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

export type TargetId = 'linux-x64' | 'linux-arm64' | 'windows-x64';

export interface Target {
  id: TargetId;
  /** The value for `bun build --compile --target=`. */
  bunTarget: string;
  /** What the compiled output must be. Checked, never assumed. */
  format: BinaryFormat;
  packaging: 'tar.gz' | 'zip';
  /** The name the binary has INSIDE the archive, so `tar -xzf` and
   *  `Expand-Archive` both drop a runnable `screepub` in the cwd — the same
   *  arrangement as the macOS tarballs app/release.sh produces. */
  binaryName: string;
  archiveName: string;
}

/** No darwin row, ever. See the file header. */
export const TARGETS: readonly Target[] = [
  {
    id: 'linux-x64',
    bunTarget: 'bun-linux-x64',
    format: 'elf-x86-64',
    packaging: 'tar.gz',
    binaryName: 'screepub',
    archiveName: 'screepub-cli-linux-x64.tar.gz',
  },
  {
    // Asahi, Raspberry Pi, ARM servers — and the machine this is developed
    // on, so it is the Linux target that gets exercised daily.
    id: 'linux-arm64',
    bunTarget: 'bun-linux-arm64',
    format: 'elf-aarch64',
    packaging: 'tar.gz',
    binaryName: 'screepub',
    archiveName: 'screepub-cli-linux-arm64.tar.gz',
  },
  {
    id: 'windows-x64',
    bunTarget: 'bun-windows-x64',
    format: 'pe-x86-64',
    packaging: 'zip',
    binaryName: 'screepub.exe',
    archiveName: 'screepub-cli-windows-x64.zip',
  },
];

/** Per-target build directory: all three would otherwise compile to the
 *  same `screepub` and overwrite each other. */
export function buildDir(target: Target, outDir: string): string {
  return join(outDir, target.id);
}

/** What we hand `--outfile`. Never carries `.exe`: bun appends it for the
 *  windows target, and passing it would produce `screepub.exe.exe`. */
export function compileOutfile(target: Target, outDir: string): string {
  return join(buildDir(target, outDir), 'screepub');
}

/** Where the compiled binary actually lands. */
export function binaryPath(target: Target, outDir: string): string {
  return join(buildDir(target, outDir), target.binaryName);
}

/** Archives sit flat in the output directory, so SHA256SUMS names them
 *  without a path. */
export function archivePath(target: Target, outDir: string): string {
  return join(outDir, target.archiveName);
}

/** Which target, if any, this machine can actually execute. Pure, so the
 *  mapping is tested rather than only observed on whatever host ran the
 *  suite. macOS answers `undefined` on purpose: this tool builds no macOS
 *  artifact, so a Mac has no host target here. */
export function targetIdForHost(platform: string, arch: string): TargetId | undefined {
  if (platform === 'linux' && arch === 'x64') return 'linux-x64';
  if (platform === 'linux' && arch === 'arm64') return 'linux-arm64';
  if (platform === 'win32' && arch === 'x64') return 'windows-x64';
  return undefined;
}

export function hostTarget(): Target | undefined {
  const id = targetIdForHost(process.platform, process.arch);
  return id ? TARGETS.find((t) => t.id === id) : undefined;
}

/** The repo root, from this file's location: the tool is run from anywhere
 *  and must still find package.json and src/cli.ts. */
export const REPO_DIR = join(import.meta.dir, '..');

const VERSION_RE = /^[0-9]+\.[0-9]+\.[0-9]+(-[A-Za-z0-9.]+)?$/;

export interface BuildArgs {
  version: string;
  outDir: string;
  only: TargetId[];
}

export function parseBuildArgs(argv: string[]): BuildArgs {
  const { values } = parseArgs({
    args: argv,
    options: {
      version: { type: 'string' },
      out: { type: 'string' },
      only: { type: 'string', multiple: true },
    },
    strict: true,
    allowPositionals: false,
  });

  const version = (values.version ?? '').replace(/^v/, '');
  if (!VERSION_RE.test(version)) {
    throw new Error(
      `build-cli: --version must be MAJOR.MINOR.PATCH (got ${values.version ?? '<missing>'})`,
    );
  }
  if (!values.out) {
    throw new Error(
      'build-cli: --out <dir> is required. There is no default: each artifact is 39-119 MB, ' +
        'and a default would write a quarter of a gigabyte somewhere you did not ask for.',
    );
  }

  const known = TARGETS.map((t) => t.id);
  const requested = (values.only ?? [])
    .flatMap((s) => s.split(','))
    .map((s) => s.trim())
    .filter(Boolean);
  for (const id of requested) {
    if (!known.includes(id as TargetId)) {
      throw new Error(`build-cli: unknown target "${id}"; known targets are ${known.join(', ')}`);
    }
  }

  return {
    version,
    outDir: isAbsolute(values.out) ? values.out : resolve(values.out),
    only: (requested.length ? requested : known) as TargetId[],
  };
}

/** `screepub --version` reports package.json's version, inlined at compile
 *  time; the --version flag changes nothing about the binary. So the flag's
 *  job is to be CHECKED. app/release.sh applies the same guard on the macOS
 *  side, and for the same reason: a binary that disagrees with its tag lies
 *  about itself in every bug report it ever appears in. */
export function assertPackageVersion(version: string, repoDir: string = REPO_DIR): void {
  const pkg = JSON.parse(readFileSync(join(repoDir, 'package.json'), 'utf8')) as {
    version?: string;
  };
  if (pkg.version !== version) {
    throw new Error(
      `build-cli: package.json says ${pkg.version} but --version says ${version}. ` +
        '`screepub --version` reports package.json inlined at compile time, so this binary ' +
        'would misreport itself. Bump package.json, or build the version it already names.',
    );
  }
}

export interface SpawnResult {
  exitCode: number;
  stderr: string;
}
export type Spawn = (argv: string[], cwd: string) => SpawnResult;

const realSpawn: Spawn = (argv, cwd) => {
  const proc = Bun.spawnSync(argv, { cwd, stdout: 'pipe', stderr: 'pipe' });
  return { exitCode: proc.exitCode ?? 1, stderr: proc.stderr.toString() };
};

/** The one invocation, as data, so it can be asserted element by element
 *  instead of reviewed by eye. */
export function compileArgv(target: Target, outDir: string): string[] {
  return [
    'bun',
    'build',
    '--compile',
    `--target=${target.bunTarget}`,
    'src/cli.ts',
    `--outfile=${compileOutfile(target, outDir)}`,
  ];
}

/** Returns the path bun actually WROTE — which is not the outfile it was
 *  given for the windows target, where bun appends `.exe`. */
export function compileTarget(
  target: Target,
  outDir: string,
  spawn: Spawn = realSpawn,
  repoDir: string = REPO_DIR,
): string {
  mkdirSync(buildDir(target, outDir), { recursive: true });
  const argv = compileArgv(target, outDir);
  const { exitCode, stderr } = spawn(argv, repoDir);
  if (exitCode !== 0) {
    throw new Error(
      `build-cli: ${target.id} failed to compile (exit ${exitCode})\n${stderr.trim()}`,
    );
  }
  return binaryPath(target, outDir);
}

export interface ArchiveEntry {
  name: string;
  size: number;
  /** Unix mode as recorded in the archive. 0 when the format carries none. */
  mode: number;
  data: Uint8Array;
}

function tarString(bytes: Uint8Array): string {
  return new TextDecoder().decode(bytes).replace(/\0[\s\S]*$/, '');
}

function tarOctal(bytes: Uint8Array): number {
  const text = tarString(bytes).trim();
  return text ? parseInt(text, 8) : 0;
}

/** Walk the tar ourselves. `tar -tzvf` answers in a listing format that
 *  differs between GNU tar and bsdtar; the header is 512 fixed bytes and
 *  gunzip is already in the runtime. */
export function tarGzEntries(archivePath: string): ArchiveEntry[] {
  const tar = Bun.gunzipSync(readFileSync(archivePath));
  const entries: ArchiveEntry[] = [];
  let off = 0;
  while (off + 512 <= tar.length) {
    const header = tar.subarray(off, off + 512);
    if (header.every((b) => b === 0)) break; // end-of-archive marker
    const name = tarString(header.subarray(0, 100));
    const mode = tarOctal(header.subarray(100, 108));
    const size = tarOctal(header.subarray(124, 136));
    const typeflag = String.fromCharCode(header[156] ?? 0);
    const start = off + 512;
    if (typeflag === '0' || typeflag === '\0') {
      entries.push({ name, size, mode, data: tar.subarray(start, start + size) });
    }
    off = start + Math.ceil(size / 512) * 512;
  }
  return entries;
}

export async function zipEntries(archivePath: string): Promise<ArchiveEntry[]> {
  const JSZip = (await import('jszip')).default;
  const zip = await JSZip.loadAsync(readFileSync(archivePath));
  const out: ArchiveEntry[] = [];
  for (const file of Object.values(zip.files)) {
    if (file.dir) continue;
    const data = await file.async('uint8array');
    const perms = (file as unknown as { unixPermissions: number | null }).unixPermissions;
    out.push({ name: file.name, size: data.length, mode: perms ?? 0, data });
  }
  return out;
}

export function archiveEntries(archivePath: string): Promise<ArchiveEntry[]> {
  if (archivePath.endsWith('.tar.gz')) return Promise.resolve(tarGzEntries(archivePath));
  if (archivePath.endsWith('.zip')) return zipEntries(archivePath);
  return Promise.reject(
    new Error(`build-cli: ${archivePath} is neither a .tar.gz nor a .zip`),
  );
}

/** tar.gz for Linux, zip for Windows: what each platform's users can open
 *  with nothing installed. The binary is named plainly inside both, so an
 *  unpack leaves a runnable file in the current directory — the same
 *  arrangement the macOS tarballs already have. */
export async function packageTarget(target: Target, outDir: string): Promise<string> {
  const bin = binaryPath(target, outDir);
  // Set, not inherited. On Linux this bit is the difference between a
  // download that runs and one that does not.
  chmodSync(bin, 0o755);

  const out = archivePath(target, outDir);
  rmSync(out, { force: true }); // tar -czf appends into an existing file

  if (target.packaging === 'tar.gz') {
    const proc = Bun.spawnSync(
      ['tar', '-czf', out, '-C', buildDir(target, outDir), target.binaryName],
      { stdout: 'pipe', stderr: 'pipe' },
    );
    if ((proc.exitCode ?? 1) !== 0) {
      throw new Error(`build-cli: tar failed for ${target.id}: ${proc.stderr.toString().trim()}`);
    }
  } else {
    const JSZip = (await import('jszip')).default;
    const zip = new JSZip();
    zip.file(target.binaryName, readFileSync(bin), { unixPermissions: 0o755 });
    const buf = await zip.generateAsync({
      type: 'nodebuffer',
      // UNIX, so the permission bits above are actually written into the
      // central directory rather than discarded.
      platform: 'UNIX',
      compression: 'DEFLATE',
    });
    writeFileSync(out, buf);
  }
  return out;
}

export interface Floors {
  binaryBytes: number;
  archiveBytes: number;
}

/** Every real artifact embeds a whole Bun runtime: 64-119 MB compiled,
 *  39 MB or so compressed. Anything an order of magnitude under that is a
 *  truncated write, not a lean build. */
export const RELEASE_FLOORS: Floors = { binaryBytes: 20_000_000, archiveBytes: 1_000_000 };

/** Check what was PRODUCED, not the compiler's exit code. `bun build` can
 *  exit 0 and leave a truncated file, and a mis-typed --target= exits 0
 *  while producing a perfectly valid binary for the wrong machine. */
export async function verifyArtifact(
  target: Target,
  outDir: string,
  floors: Floors = RELEASE_FLOORS,
): Promise<void> {
  const bin = binaryPath(target, outDir);
  if (!existsSync(bin)) throw new Error(`build-cli: ${target.id}: no binary at ${bin}`);

  const binBytes = statSync(bin).size;
  if (binBytes < floors.binaryBytes) {
    throw new Error(
      `build-cli: ${target.id}: binary is ${binBytes} bytes, under the ${floors.binaryBytes}-byte floor`,
    );
  }

  const binFormat = readBinaryFormat(bin);
  if (binFormat !== target.format) {
    throw new Error(
      `build-cli: ${target.id}: binary is ${binFormat}, expected ${target.format}`,
    );
  }

  const arc = archivePath(target, outDir);
  if (!existsSync(arc)) throw new Error(`build-cli: ${target.id}: no archive at ${arc}`);

  const arcBytes = statSync(arc).size;
  if (arcBytes < floors.archiveBytes) {
    throw new Error(
      `build-cli: ${target.id}: archive is ${arcBytes} bytes, under the ${floors.archiveBytes}-byte floor`,
    );
  }

  const entries = await archiveEntries(arc);
  const member = entries.find((e) => e.name === target.binaryName);
  if (!member) {
    const held = entries.map((e) => e.name).join(', ') || '<nothing>';
    throw new Error(
      `build-cli: ${target.id}: ${basename(arc)} does not contain ${target.binaryName} (it holds: ${held})`,
    );
  }
  if (member.size !== binBytes) {
    throw new Error(
      `build-cli: ${target.id}: ${target.binaryName} inside the archive is ${member.size} bytes, ` +
        `the binary on disk is ${binBytes}`,
    );
  }
  const memberFormat = detectBinaryFormat(member.data.subarray(0, HEAD_BYTES));
  if (memberFormat !== target.format) {
    throw new Error(
      `build-cli: ${target.id}: ${target.binaryName} inside the archive is ${memberFormat}, expected ${target.format}`,
    );
  }
  if ((member.mode & 0o111) === 0) {
    throw new Error(
      `build-cli: ${target.id}: ${target.binaryName} inside the archive is not executable ` +
        `(mode ${member.mode.toString(8)})`,
    );
  }
}

export function sha256File(path: string): string {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

/** The format `sha256sum -c` and `shasum -a 256 -c` both parse: lowercase
 *  hex, exactly two spaces, a bare filename, a trailing newline. Sorted, so
 *  two runs of the same build produce the same file. Returns the text as
 *  well as writing it, so callers can assert on it without re-reading. */
export function writeChecksums(outDir: string, archiveNames: string[]): string {
  const text = [...archiveNames]
    .sort()
    .map((name) => `${sha256File(join(outDir, name))}  ${name}\n`)
    .join('');
  writeFileSync(join(outDir, 'SHA256SUMS'), text);
  return text;
}

export function parseChecksums(text: string): Map<string, string> {
  const map = new Map<string, string>();
  for (const line of text.split('\n')) {
    const m = /^([0-9a-f]{64}) {2}(.+)$/.exec(line);
    if (m) map.set(m[2]!, m[1]!);
  }
  return map;
}

/** Compile, package and verify one target at a time, verifying BEFORE
 *  moving on: a broken target then fails at the target that broke, not at
 *  a checksum three minutes later. */
export async function buildAll(args: BuildArgs, floors: Floors = RELEASE_FLOORS): Promise<string[]> {
  assertPackageVersion(args.version);
  mkdirSync(args.outDir, { recursive: true });

  const targets = TARGETS.filter((t) => args.only.includes(t.id));
  const names: string[] = [];
  for (const target of targets) {
    console.log(`── ${target.id} (${target.bunTarget})`);
    compileTarget(target, args.outDir);
    await packageTarget(target, args.outDir);
    await verifyArtifact(target, args.outDir, floors);
    const bytes = statSync(archivePath(target, args.outDir)).size;
    console.log(`   ${target.archiveName}  ${bytes} bytes  ok`);
    names.push(target.archiveName);
  }

  writeChecksums(args.outDir, names);
  return names.map((n) => join(args.outDir, n));
}

if (import.meta.main) {
  try {
    const args = parseBuildArgs(Bun.argv.slice(2));
    const made = await buildAll(args);
    console.log(`\n${made.length} artifact(s) + SHA256SUMS in ${args.outDir}`);
  } catch (err) {
    console.error((err as Error).message);
    process.exit(1);
  }
}
