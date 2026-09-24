// Open a built bundle WITHOUT installing it, and run the engine from
// inside.
//
//   bun tools/smoke-bundle.ts --bundle dist/Screepub_0.6.0_arm64.deb \
//     --expect-version 0.6.0
//
// The cheapest check that catches a broken bundle before a user does, and
// the one that would have caught a 0.6.0 installer whose engine answers
// 0.5.4. It is deliberately NOT "launch the app and look at it": no CI
// runner has a display, the GUI half of the bundle cannot be exercised
// anywhere, and the part that silently breaks during bundling is the
// sidecar -- which is exactly what AppImage's linuxdeploy pass broke.
//
// --expect-version is required rather than read from package.json, unlike
// smoke-cli.ts. A bundle's NAME comes from tauri.conf.json and the engine
// inside it is built from package.json; catching those two disagreeing is
// the entire point, so the number to compare against comes from outside.
//
// WHAT THIS EXERCISES, PER PLATFORM. A .deb and an .rpm are opened in
// TypeScript and their engine is executed, so on Linux this is a real end
// to end check. A .dmg needs hdiutil and an NSIS .exe needs 7z, and both
// produce a binary for a foreign OS; neither can be opened, let alone run,
// anywhere but on macOS and Windows respectively. So this tool REFUSES
// those two off their own OS (see platformRefusal) rather than returning
// quietly. A check that prints nothing on two of three platforms and exits
// 0 is indistinguishable from a check that ran, which is how a bundle with
// no working sidecar reaches a user.

import {
  chmodSync,
  closeSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readdirSync,
  readSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { parseArgs } from 'node:util';
import { bundleEntries, findEntry } from './bundle-archive';
import { mountDmgApp } from './dmg';
import {
  bundleDirFor,
  discoverArtifact,
  kindsForOs,
  osForPlatform,
  verifyBundleFile,
  type BundleOs,
} from './build-app-bundle';
import {
  checkConvertResult,
  checkEpubBytes,
  realRun,
  soleJson,
  type RunResult,
  type Runner,
} from './smoke-cli';

/** The engine's own `--version --json`, checked against the version the
 *  bundle claims to be. soleJson enforces the one-object contract, so a
 *  progress line before the answer fails here rather than downstream. */
export function checkEngineVersion(result: RunResult, expected: string): void {
  if (result.exitCode !== 0) {
    throw new Error(
      `smoke-bundle: the engine inside the bundle exited ${result.exitCode}: ` +
        result.stderr.trim().slice(0, 500),
    );
  }
  const json = soleJson(result.stdout, 'the bundled engine');
  if (json.ok !== true) {
    throw new Error(`smoke-bundle: the bundled engine reported ${JSON.stringify(json)}`);
  }
  if (json.version !== expected) {
    throw new Error(
      `smoke-bundle: the engine inside this bundle says ${JSON.stringify(json.version)} but the ` +
        `bundle is ${expected}. An installer whose About line contradicts its own filename ` +
        'lies about itself in every bug report it appears in.',
    );
  }
}

/** The engine's path inside an installed tree, per container. */
const ENGINE_IN_ARCHIVE = 'usr/bin/screepub-engine';
const ENGINE_IN_APP = join('Contents', 'MacOS', 'screepub-engine');
const ENGINE_IN_EXE = 'screepub-engine.exe';

/** Which bundles this machine can actually open and run, and why not.
 *
 *  Deliberately NOT a silent skip. The .deb and .rpm readers are pure
 *  TypeScript and run anywhere, but the binary inside one is for the host
 *  OS, so the run half is real only on Linux; hdiutil exists only on macOS
 *  and an NSIS payload is a Windows executable. Returning a refusal string
 *  rather than `false` means the CLI can say which platform this had to be
 *  run on, instead of exiting 0 having done nothing. */
export function platformRefusal(bundlePath: string, platform: string): string | undefined {
  const wrongOs = (os: string, tool: string): string =>
    `smoke-bundle: ${bundlePath} can only be opened (${tool}) and its engine run on ${os}, and ` +
    `this machine is ${platform}. NOTHING WAS CHECKED -- run this step on a ${os} runner. ` +
    'Reporting success here would mean reporting success for a sidecar no one has executed.';

  if (bundlePath.endsWith('.deb') || bundlePath.endsWith('.rpm')) {
    // The readers are pure TypeScript and run anywhere; the ELF inside does
    // not.
    return platform === 'linux' ? undefined : wrongOs('Linux', 'no external tool');
  }
  if (bundlePath.endsWith('.dmg')) {
    return platform === 'darwin' ? undefined : wrongOs('macOS', 'hdiutil');
  }
  if (bundlePath.endsWith('.exe')) {
    return platform === 'win32' ? undefined : wrongOs('Windows', '7z');
  }
  return `smoke-bundle: ${bundlePath} is not a .deb, .rpm, .dmg or .exe`;
}

/** A .deb or an .rpm, opened in TypeScript -- no dpkg-deb, no rpm2cpio, no
 *  7z, nothing to apt-get on a runner.
 *
 *  Only the engine is pulled out, and deliberately so. An earlier note here
 *  said the deb and the rpm hold different files; that was measured on a
 *  STALE pair and did not reproduce -- see verifyBundleFile's comment in
 *  tools/build-app-bundle.ts. The durable reason stands without it: nothing
 *  makes two different bundlers stay in step, so a shared file manifest
 *  would be pinning a coincidence. What must be true of both is that the
 *  sidecar is in it and works. */
export function extractArchiveEngine(bundlePath: string, workDir: string): string {
  const entry = findEntry(bundleEntries(bundlePath), ENGINE_IN_ARCHIVE);
  const dest = join(workDir, ENGINE_IN_ARCHIVE);
  mkdirSync(dirname(dest), { recursive: true });
  writeFileSync(dest, entry.data);
  // The archive records the mode; writeFileSync does not honour it. Without
  // this the run below fails with a bare EACCES naming no file.
  chmodSync(dest, 0o755);
  return dest;
}

/** A .dmg, via hdiutil (tools/dmg.ts). macOS only; nothing else has
 *  hdiutil. Returns a `detach` the caller must run in a finally. */
export function extractDmgEngine(
  bundlePath: string,
  workDir: string,
  run: Runner = realRun,
): { enginePath: string; detach: () => void } {
  const { appPath, detach } = mountDmgApp(bundlePath, workDir, run, 'smoke-bundle');
  return { enginePath: join(appPath, ENGINE_IN_APP), detach };
}

/** An NSIS installer, via 7z, which is present on GitHub's Windows image.
 *  Extracting rather than installing keeps the runner clean and, more to
 *  the point, proves the payload without needing a machine to install on. */
export function extractExeEngine(
  bundlePath: string,
  workDir: string,
  run: Runner = realRun,
): string {
  const result = run(['7z', 'x', bundlePath, `-o${workDir}`, '-y']);
  if (result.exitCode !== 0) {
    throw new Error(
      `smoke-bundle: 7z could not unpack ${bundlePath}: ${result.stderr.trim().slice(0, 500)}`,
    );
  }
  const dest = join(workDir, ENGINE_IN_EXE);
  if (!existsSync(dest)) {
    throw new Error(
      `smoke-bundle: no ${ENGINE_IN_EXE} under ${workDir} after unpacking ${bundlePath} ` +
        `(it holds: ${readdirSync(workDir).join(', ') || '<nothing>'})`,
    );
  }
  return dest;
}

/** Two runs of the engine that came out of the bundle: its own version, and
 *  a real conversion of the committed fixture. The second is smoke-cli.ts's
 *  assertion applied to a bundled engine rather than a downloaded one, and
 *  it imports checkConvertResult rather than restating it.
 *
 *  The EPUB's bytes are then read back. checkConvertResult only reads what
 *  the engine SAID; a sidecar that prints a success object and writes
 *  nothing -- or writes a truncated file -- passes every string check and
 *  fails the first reader. */
export function smokeBundle(
  bundlePath: string,
  fixture: string,
  workDir: string,
  expectedVersion: string,
  run: Runner = realRun,
): void {
  if (!existsSync(bundlePath)) throw new Error(`smoke-bundle: no bundle at ${bundlePath}`);
  if (!existsSync(fixture)) throw new Error(`smoke-bundle: no fixture at ${fixture}`);

  let enginePath: string;
  let detach: (() => void) | undefined;
  if (bundlePath.endsWith('.deb') || bundlePath.endsWith('.rpm')) {
    enginePath = extractArchiveEngine(bundlePath, workDir);
  } else if (bundlePath.endsWith('.dmg')) {
    ({ enginePath, detach } = extractDmgEngine(bundlePath, workDir, run));
  } else if (bundlePath.endsWith('.exe')) {
    enginePath = extractExeEngine(bundlePath, workDir, run);
  } else {
    throw new Error(`smoke-bundle: ${bundlePath} is not a .deb, .rpm, .dmg or .exe`);
  }

  try {
    checkEngineVersion(run([enginePath, '--version', '--json']), expectedVersion);
    const epub = join(workDir, 'smoke.epub');
    checkConvertResult(run([enginePath, fixture, '-o', epub, '--no-fountain', '--json']), epub);
    if (!existsSync(epub)) {
      throw new Error(
        `smoke-bundle: the bundled engine reported a successful conversion but ${epub} is not ` +
          'there. A success object is not a book.',
      );
    }
    const fd = openSync(epub, 'r');
    try {
      const head = new Uint8Array(8);
      const read = readSync(fd, head, 0, 8, 0);
      checkEpubBytes(head.subarray(0, read));
    } finally {
      closeSync(fd);
    }
  } finally {
    detach?.();
  }
}

/** Verify and smoke every bundle this runner just built.
 *
 *  The affordance CI needs, in TypeScript rather than in YAML: a workflow
 *  step that loops over bundle kinds in shell is a step that can only be
 *  tested by pushing. It deliberately does NOT call build-app-bundle.ts --
 *  that tool refuses to run while package.json, Cargo.toml and
 *  tauri.conf.json disagree, which they do on every working branch by
 *  design. The renaming and checksum half of build-app-bundle.ts is
 *  therefore exercised by its unit tests and by the release run, and not
 *  here. */
export function smokeBuiltBundles(
  os: BundleOs,
  expectedVersion: string,
  fixture: string,
  workRoot: string,
  run: Runner = realRun,
  // A parameter and not only the constant, for the same reason
  // build-app-bundle.ts's BundleDirs is one: without it this loop could
  // only ever be exercised against the repo's own target/ tree, which on a
  // clean checkout and in CI is empty -- so the multi-kind path would be
  // covered by nothing.
  desktopDir?: string,
  // The HOST this is running on, as distinct from the OS whose bundles we
  // were asked to smoke. A parameter for the same reason `run` and
  // `desktopDir` are: in production the two always agree, because the only
  // real caller derives the target from `process.platform` -- so hardcoding
  // the host here made the discover/verify/version logic untestable
  // anywhere except a Linux runner, and a suite that can only be green on
  // one OS teaches people to stop reading it. The REFUSAL itself is still
  // tested against real platform strings; this seam moves the host, never
  // the rule.
  hostPlatform: string = process.platform,
): string[] {
  const kinds = kindsForOs(os);
  // An OS with no kinds would smoke nothing and exit 0, which is the exact
  // silent-green outcome this whole tool exists to refuse.
  if (kinds.length === 0) {
    throw new Error(`smoke-bundle: no bundle kinds are defined for ${os}. NOTHING WAS CHECKED.`);
  }
  const smoked: string[] = [];
  for (const kind of kinds) {
    // Throws, naming the directory, when the bundler produced nothing --
    // rather than returning an empty list, which would make a step that
    // checked nothing look green.
    const path = discoverArtifact(bundleDirFor(kind, undefined, desktopDir), kind);
    verifyBundleFile(path, kind);
    // The container readers are pure TypeScript and run anywhere, but the
    // binary inside one is for a single OS. Asked for another OS's bundles,
    // say which machine this had to run on rather than executing a foreign
    // binary and reporting whatever came back.
    const refusal = platformRefusal(path, hostPlatform);
    if (refusal) throw new Error(refusal);
    const work = join(workRoot, kind.id);
    mkdirSync(work, { recursive: true });
    smokeBundle(path, fixture, work, expectedVersion, run);
    console.log(`smoke-bundle: ${kind.id} ok -- ${path}`);
    smoked.push(path);
  }
  return smoked;
}

if (import.meta.main) {
  // exitCode, never process.exit(): exit() ends the process on the spot and
  // the finally that removes the work folder would never run.
  let work: string | undefined;
  try {
    const { values } = parseArgs({
      args: Bun.argv.slice(2),
      options: {
        bundle: { type: 'string' },
        built: { type: 'boolean', default: false },
        'expect-version': { type: 'string' },
        fixture: { type: 'string' },
      },
      strict: true,
      allowPositionals: false,
    });
    const expected = (values['expect-version'] ?? '').replace(/^v/, '');
    if (!expected) throw new Error('smoke-bundle: --expect-version <version> is required');
    const repo = join(import.meta.dir, '..');
    const fixture = values.fixture ?? join(repo, 'tests', 'fixtures', 'screenplay.pdf');
    work = mkdtempSync(join(tmpdir(), 'screepub-bundle-smoke-'));

    if (values.built) {
      // --built is what CI runs: whatever this runner's own `cargo tauri
      // build` just produced, every kind of it, found rather than named.
      const smoked = smokeBuiltBundles(osForPlatform(process.platform), expected, fixture, work);
      console.log(
        `smoke-bundle: ${smoked.length} bundle(s) report ${expected} and convert the fixture`,
      );
    } else {
      if (!values.bundle) throw new Error('smoke-bundle: pass --bundle <path> or --built');
      const refusal = platformRefusal(values.bundle, process.platform);
      if (refusal) throw new Error(refusal);
      smokeBundle(values.bundle, fixture, work, expected);
      console.log(
        `smoke-bundle: the engine inside ${values.bundle} reports ${expected} and converts the fixture`,
      );
    }
  } catch (err) {
    console.error((err as Error).message);
    process.exitCode = 1;
  } finally {
    if (work) rmSync(work, { recursive: true, force: true });
  }
}
