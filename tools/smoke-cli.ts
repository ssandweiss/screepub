// Run a built CLI binary and prove three things about it.
//
// Cross-compiling is not cross-testing: a Windows binary built on Linux has
// never executed. So each OS downloads its own artifact and runs this.
//
// A Bun script rather than one bash fragment and one PowerShell fragment,
// which would drift and neither of which could be tested. It imports
// nothing outside Node built-ins, so a Windows runner needs no install.
//
//   bun tools/smoke-cli.ts --binary ./screepub

import { existsSync, mkdtempSync, openSync, readSync, closeSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseArgs } from 'node:util';

export interface RunResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}
export type Runner = (argv: string[]) => RunResult;

/** The real runner, shared by every tool that takes a Runner seam. */
export const realRun: Runner = (argv) => {
  const proc = Bun.spawnSync(argv, { stdout: 'pipe', stderr: 'pipe' });
  return {
    exitCode: proc.exitCode ?? 1,
    stdout: proc.stdout.toString(),
    stderr: proc.stderr.toString(),
  };
};

/** The --json contract is ONE parseable object on stdout, at every exit.
 *  Checking only the first line would wave through a binary that printed a
 *  progress line and then a result. */
export function soleJson(stdout: string, what: string): Record<string, unknown> {
  const lines = stdout.split('\n').filter((l) => l.trim());
  if (lines.length !== 1) {
    throw new Error(
      `smoke: ${what} printed ${lines.length} lines on stdout under --json; the contract is exactly one`,
    );
  }
  try {
    return JSON.parse(lines[0]!) as Record<string, unknown>;
  } catch {
    throw new Error(`smoke: ${what} did not print parseable JSON: ${lines[0]!.slice(0, 200)}`);
  }
}

export function checkVersion(result: RunResult, expected: string): void {
  if (result.exitCode !== 0) {
    throw new Error(`smoke: --version exited ${result.exitCode}: ${result.stderr.trim().slice(0, 500)}`);
  }
  const line = result.stdout.trim();
  if (line !== `screepub ${expected}`) {
    throw new Error(`smoke: --version printed "${line}", expected "screepub ${expected}"`);
  }
}

export function checkConvertResult(result: RunResult, epubPath: string): void {
  if (result.exitCode !== 0) {
    throw new Error(`smoke: convert exited ${result.exitCode}: ${result.stderr.trim().slice(0, 500)}`);
  }
  const json = soleJson(result.stdout, 'convert');
  if (json.ok !== true) throw new Error(`smoke: convert reported ${JSON.stringify(json)}`);
  if (json.epubPath !== epubPath) {
    throw new Error(`smoke: convert wrote ${String(json.epubPath)}, expected ${epubPath}`);
  }
  if (typeof json.pages !== 'number' || json.pages <= 0) {
    throw new Error(`smoke: convert reported ${String(json.pages)} pages; an empty book is not a conversion`);
  }
}

/** An EPUB is a zip container. A CLI can report success and still have
 *  written nothing usable. */
export function checkEpubBytes(head: Uint8Array): void {
  const isZip = head[0] === 0x50 && head[1] === 0x4b && head[2] === 0x03 && head[3] === 0x04;
  if (!isZip) throw new Error('smoke: the output is not a zip container; no EPUB was written');
}

/** An empty list is a PASS: it proves the command ran on this OS, which is
 *  the whole point. No runner has an e-reader plugged into it. */
export function checkDevices(result: RunResult): void {
  if (result.exitCode !== 0) {
    throw new Error(
      `smoke: devices --json exited ${result.exitCode}: ${result.stderr.trim().slice(0, 500)}`,
    );
  }
  const json = soleJson(result.stdout, 'devices --json');
  if (json.ok !== true) throw new Error(`smoke: devices --json reported ${JSON.stringify(json)}`);
  if (!Array.isArray(json.devices)) {
    throw new Error('smoke: devices --json carried no devices array');
  }
}

export function smokeCli(
  binary: string,
  fixture: string,
  workDir: string,
  expectedVersion: string,
  run: Runner = realRun,
): void {
  if (!existsSync(binary)) throw new Error(`smoke: no binary at ${binary}`);
  if (!existsSync(fixture)) throw new Error(`smoke: no fixture at ${fixture}`);

  checkVersion(run([binary, '--version']), expectedVersion);

  const epub = join(workDir, 'smoke.epub');
  checkConvertResult(run([binary, fixture, '-o', epub, '--no-fountain', '--json']), epub);
  if (!existsSync(epub)) throw new Error(`smoke: convert reported success but ${epub} is not there`);
  const fd = openSync(epub, 'r');
  try {
    const head = new Uint8Array(8);
    const read = readSync(fd, head, 0, 8, 0);
    checkEpubBytes(head.subarray(0, read));
  } finally {
    closeSync(fd);
  }

  checkDevices(run([binary, 'devices', '--json']));
}

if (import.meta.main) {
  // exitCode, never process.exit(): exit() ends the process on the spot and
  // the finally that removes the work folder would never run.
  let work: string | undefined;
  try {
    const { values } = parseArgs({
      args: Bun.argv.slice(2),
      options: {
        binary: { type: 'string' },
        fixture: { type: 'string' },
      },
      strict: true,
      allowPositionals: false,
    });
    if (!values.binary) throw new Error('smoke: --binary <path> is required');
    const repo = join(import.meta.dir, '..');
    const fixture = values.fixture ?? join(repo, 'tests', 'fixtures', 'screenplay.pdf');
    const version = (
      JSON.parse(readFileSync(join(repo, 'package.json'), 'utf8')) as { version: string }
    ).version;
    work = mkdtempSync(join(tmpdir(), 'screepub-smoke-'));
    smokeCli(values.binary, fixture, work, version);
    console.log(`smoke: ${values.binary} converts, reports ${version}, and lists devices`);
  } catch (err) {
    console.error((err as Error).message);
    process.exitCode = 1;
  } finally {
    if (work) rmSync(work, { recursive: true, force: true });
  }
}
