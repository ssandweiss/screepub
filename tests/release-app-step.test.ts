// release-artifacts.test.ts proves the app-bundles and app-upload steps are
// TEXTUALLY present, needed by the right jobs, and in the right order. That
// is necessary but not sufficient: `toContain('smoke-bundle.ts')` would
// also pass if the loop globbed a directory nothing writes to, if the
// x86_64 guard matched the wrong triple, or if the checksums step accepted
// four bundles where five were built.
//
// A workflow cannot be run by `bun test` -- it needs a GitHub runner -- but
// these four `run:` blocks are just bash, so this file pulls the ACTUAL
// step text out of the committed release.yml and executes it against a
// scratch directory with stub executables on PATH. Every `${{ }}` in these
// steps sits in `env:`, not in the script, so the text executed here is
// byte-for-byte the text a runner executes.
//
// No cargo is ever spawned: the stub directory comes FIRST on PATH and
// holds a recorder named `bun`, so the step's own command line is captured
// rather than run. HOME points into the scratch tree, so nothing touches a
// real home directory.
import { describe, test, expect, afterAll } from 'bun:test';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { spawnSync } from 'node:child_process';

const WORK = mkdtempSync(join(tmpdir(), 'screepub-release-step-'));
// Resolved from THIS process's PATH before the scripts below replace it.
const BASH = Bun.which('bash');
if (!BASH) throw new Error('release-app-step: no bash on PATH');
// The real coreutils, for `rm`, `sha256sum`, `wc` and `cat`. Stubs are
// prepended, so a stubbed name still wins over anything found here.
const COREUTILS = dirname(Bun.which('sha256sum') ?? '/usr/bin/sha256sum');
afterAll(() => rmSync(WORK, { recursive: true, force: true }));

interface Step {
  name?: string;
  run?: string;
  shell?: string;
}
interface Workflow {
  jobs: Record<string, { steps?: Step[] }>;
}

const YML = join('.github', 'workflows', 'release.yml');
const release = Bun.YAML.parse(readFileSync(YML, 'utf8')) as Workflow;

function stepNamed(job: string, name: string): string {
  const found = (release.jobs[job]?.steps ?? []).find((s) => s.name === name);
  if (!found?.run) {
    throw new Error(`release.yml: ${job} has no step named ${JSON.stringify(name)} with a run block`);
  }
  return found.run;
}

const SIDECAR_STEP = stepNamed('app-bundles', 'Build the engine sidecar');
const BUILD_STEP = stepNamed('app-bundles', "Build and verify this platform's bundles");
const SMOKE_STEP = stepNamed('app-bundles', 'Run the engine out of each bundle');
const SUMS_STEP = stepNamed('app-upload', 'Rebuild the checksums from what arrived, then verify them');

/** A recorder script standing in for a real executable. It APPENDS one
 *  tab-joined line per invocation, so a loop's repeated calls are all
 *  visible rather than only the last. */
function stubDir(tag: string, names: string[]): { dir: string; lines: (n: string) => string[] } {
  const dir = mkdtempSync(join(WORK, `${tag}-`));
  const logPath = (n: string) => join(dir, `${n}.argv`);
  for (const n of names) {
    const script = join(dir, n);
    writeFileSync(
      script,
      `#!/bin/sh\nprintf '%s\\t' "$@" >> ${JSON.stringify(logPath(n))}\nprintf '\\n' >> ${JSON.stringify(logPath(n))}\nexit 0\n`,
    );
    chmodSync(script, 0o755);
  }
  return {
    dir,
    lines: (n) => {
      try {
        return readFileSync(logPath(n), 'utf8')
          .split('\n')
          .filter(Boolean)
          .map((l) => l.replace(/\t$/, ''));
      } catch {
        return [];
      }
    },
  };
}

const runStep = (script: string, dir: string, env: Record<string, string>) =>
  spawnSync(BASH, ['-c', script], {
    cwd: dir,
    env: { PATH: `${dir}:${COREUTILS}:/usr/bin:/bin`, HOME: dir, ...env },
    encoding: 'utf8',
  });

describe("release.yml's sidecar step, executed as bash", () => {
  test('a matrix leg with a sidecar name cross-compiles for THAT triple', () => {
    const { dir, lines } = stubDir('sidecar-mac', ['bun']);
    const r = runStep(SIDECAR_STEP, dir, { SIDECAR: 'bun-darwin-x64' });
    expect(r.status).toBe(0);
    expect(lines('bun')).toEqual(['tools/build-sidecar.ts\t--target\tbun-darwin-x64']);
  });

  test('a leg with no sidecar name builds for the runner it is on', () => {
    // --host, never a guessed triple: the Linux and Windows legs bundle for
    // themselves, and build-sidecar.ts asks the runner's own rustc.
    const { dir, lines } = stubDir('sidecar-host', ['bun']);
    const r = runStep(SIDECAR_STEP, dir, { SIDECAR: '' });
    expect(r.status).toBe(0);
    expect(lines('bun')).toEqual(['tools/build-sidecar.ts\t--host']);
  });

  test('the two sidecar names it can be handed are ones build-sidecar.ts knows', () => {
    // A typo here compiles nothing and is not caught until the window opens
    // with no engine. Checked against the pinned table itself.
    const rows =
      ((Bun.YAML.parse(readFileSync(YML, 'utf8')) as unknown as {
        jobs: Record<string, { strategy?: { matrix?: { include?: Record<string, string>[] } } }>;
      }).jobs['app-bundles']?.strategy?.matrix?.include) ?? [];
    const named = rows.map((r) => r.sidecar).filter(Boolean);
    expect(named.length).toBe(2);
    const { SIDECAR_TARGETS } = require('../tools/sidecar-targets') as {
      SIDECAR_TARGETS: { bunTarget: string; rustTriple: string }[];
    };
    for (const row of rows.filter((r) => r.sidecar)) {
      const found = SIDECAR_TARGETS.find((t) => t.bunTarget === row.sidecar);
      expect(found).toBeDefined();
      // And the sidecar it builds is named for the SAME triple cargo is
      // told to build for -- externalBin resolves {name}-{triple}
      // verbatim, so a mismatch bundles a foreign engine silently.
      expect(found!.rustTriple).toBe(row.target);
    }
  });
});

describe("release.yml's bundle step, executed as bash", () => {
  test('the Linux and Windows legs pass no target and no overlay', () => {
    const { dir, lines } = stubDir('build-host', ['bun']);
    const r = runStep(BUILD_STEP, dir, { TAG: 'v0.6.0', TARGET: '' });
    expect(r.status).toBe(0);
    expect(lines('bun')).toEqual([
      'tools/build-app-bundle.ts\t--version\t0.6.0\t--out\tbundles',
    ]);
  });

  test('a macOS leg passes its triple AND the transition overlay', () => {
    const { dir, lines } = stubDir('build-mac', ['bun']);
    const r = runStep(BUILD_STEP, dir, { TAG: 'v0.6.0', TARGET: 'x86_64-apple-darwin' });
    expect(r.status).toBe(0);
    expect(lines('bun')).toEqual([
      'tools/build-app-bundle.ts\t--version\t0.6.0\t--out\tbundles\t--target\t' +
        'x86_64-apple-darwin\t--config\ttauri.transition.conf.json',
    ]);
  });

  test('the version is the TAG with its v stripped, prerelease suffix and all', () => {
    const { dir, lines } = stubDir('build-pre', ['bun']);
    expect(runStep(BUILD_STEP, dir, { TAG: 'v0.6.0-rc1', TARGET: '' }).status).toBe(0);
    expect(lines('bun')[0]).toContain('0.6.0-rc1');
    expect(lines('bun')[0]).not.toContain('v0.6.0');
  });
});

describe("release.yml's smoke step, executed as bash", () => {
  const withBundles = (tag: string, names: string[]) => {
    const { dir, lines } = stubDir(`smoke-${tag}`, ['bun']);
    mkdirSync(join(dir, 'bundles'), { recursive: true });
    for (const n of names) writeFileSync(join(dir, 'bundles', n), 'x');
    return { dir, lines };
  };

  test('every bundle in the directory is opened, one smoke-bundle call each', () => {
    const { dir, lines } = withBundles('linux', [
      'Screepub_0.6.0_amd64.deb',
      'Screepub-0.6.0-1.x86_64.rpm',
      'SHA256SUMS-app',
    ]);
    const r = runStep(SMOKE_STEP, dir, { TAG: 'v0.6.0', TARGET: '' });
    expect(r.status).toBe(0);
    expect(lines('bun')).toEqual([
      'tools/smoke-bundle.ts\t--bundle\tbundles/Screepub_0.6.0_amd64.deb\t--expect-version\t0.6.0',
      'tools/smoke-bundle.ts\t--bundle\tbundles/Screepub-0.6.0-1.x86_64.rpm\t--expect-version\t0.6.0',
    ]);
    // The checksums file beside them is not a bundle and was not smoked.
    expect(r.stdout).toContain('2 bundle(s)');
  });

  test('an empty bundles/ fails loudly instead of exiting 0 having checked nothing', () => {
    // The property smoke-bundle.ts defends one level down -- a check that
    // prints nothing and exits 0 is indistinguishable from a check that
    // ran. A glob matching no file must not silently satisfy this step.
    const { dir, lines } = withBundles('empty', []);
    const r = runStep(SMOKE_STEP, dir, { TAG: 'v0.6.0', TARGET: '' });
    expect(r.status).not.toBe(0);
    expect(r.stdout + r.stderr).toContain('NOTHING WAS CHECKED');
    expect(lines('bun')).toEqual([]);
  });

  test('the x86_64 macOS leg says it is not smoke-tested, and smokes nothing', () => {
    const { dir, lines } = withBundles('x86', ['Screepub-Desktop-macOS-x64.dmg']);
    const r = runStep(SMOKE_STEP, dir, { TAG: 'v0.6.0', TARGET: 'x86_64-apple-darwin' });
    expect(r.status).toBe(0);
    expect(r.stdout).toContain('::notice::');
    expect(r.stdout).toContain('NOT smoke-tested');
    expect(lines('bun')).toEqual([]);
  });

  test('the arm64 macOS leg is NOT skipped by that guard', () => {
    // A guard matching on "apple-darwin" rather than the exact triple would
    // skip the one Mac bundle a runner can actually execute.
    const { dir, lines } = withBundles('arm', ['Screepub-Desktop-macOS-arm64.dmg']);
    const r = runStep(SMOKE_STEP, dir, { TAG: 'v0.6.0', TARGET: 'aarch64-apple-darwin' });
    expect(r.status).toBe(0);
    expect(lines('bun')).toEqual([
      'tools/smoke-bundle.ts\t--bundle\tbundles/Screepub-Desktop-macOS-arm64.dmg' +
        '\t--expect-version\t0.6.0',
    ]);
  });

  test('a failing smoke-bundle stops the step rather than being swallowed by the loop', () => {
    const { dir } = withBundles('fail', ['Screepub_0.6.0_amd64.deb']);
    writeFileSync(join(dir, 'bun'), '#!/bin/sh\nexit 3\n');
    chmodSync(join(dir, 'bun'), 0o755);
    const r = runStep(SMOKE_STEP, dir, { TAG: 'v0.6.0', TARGET: '' });
    expect(r.status).not.toBe(0);
  });
});

describe("release.yml's checksum step, executed as bash", () => {
  const withArrivals = (tag: string, names: string[]) => {
    const dir = mkdtempSync(join(WORK, `sums-${tag}-`));
    mkdirSync(join(dir, 'app'), { recursive: true });
    for (const n of names) writeFileSync(join(dir, 'app', n), `contents of ${n}`);
    return dir;
  };

  const FIVE = [
    'Screepub_0.6.0_amd64.deb',
    'Screepub-0.6.0-1.x86_64.rpm',
    'Screepub-Desktop-macOS-arm64.dmg',
    'Screepub-Desktop-macOS-x64.dmg',
    'Screepub-0.6.0-setup.exe',
  ];

  test('it rebuilds SHA256SUMS-app over everything that arrived, and verifies it', () => {
    // Including over a stale per-leg file: each leg uploaded its own,
    // covering only its own bundles, and merge-multiple keeps one of them.
    const dir = withArrivals('ok', [...FIVE, 'SHA256SUMS-app']);
    const r = runStep(SUMS_STEP, dir, {});
    expect(r.status).toBe(0);
    const sums = readFileSync(join(dir, 'app', 'SHA256SUMS-app'), 'utf8');
    for (const n of FIVE) expect(sums).toContain(n);
    // Bare filenames, so anyone downloading into their own directory can
    // run `sha256sum -c` against it.
    expect(sums).not.toContain('/');
    expect(sums.trim().split('\n').length).toBe(5);
  });

  test('a leg that failed to upload fails this step instead of publishing a short list', () => {
    // fail-fast is false, so three green legs and one red one is a real
    // shape. Without the count, the four remaining files would hash
    // cleanly and verify perfectly against themselves.
    const dir = withArrivals('short', FIVE.filter((n) => !n.endsWith('.exe')));
    const r = runStep(SUMS_STEP, dir, {});
    expect(r.status).not.toBe(0);
    // An extension nothing matched leaves the glob literal, so sha256sum
    // itself refuses before the count is ever reached.
    expect(r.stdout + r.stderr).toContain('.exe');
  });

  test('only ONE DMG arriving is caught too, though every extension is present', () => {
    // The subtle version, and the one the count exists for: every glob
    // matches, sha256sum succeeds, and the published file would describe
    // four bundles while claiming to describe the release.
    const dir = withArrivals('onedmg', FIVE.filter((n) => !n.endsWith('-x64.dmg')));
    const r = runStep(SUMS_STEP, dir, {});
    expect(r.status).not.toBe(0);
    expect(r.stdout + r.stderr).toContain('expected 5 app bundles');
  });

  test('a file corrupted in transit fails the -c pass', () => {
    // Proof the verification is not a tautology. The checksums are written
    // from the files, so the only way to exercise -c is to change a file
    // between the two -- which is exactly what a truncated artifact round
    // trip does, one job earlier.
    const dir = withArrivals('corrupt', FIVE);
    const script = SUMS_STEP.replace(
      'sha256sum -c SHA256SUMS-app',
      'echo tampered > Screepub-0.6.0-setup.exe\n          sha256sum -c SHA256SUMS-app',
    );
    expect(script).toContain('echo tampered');
    const r = runStep(script, dir, {});
    expect(r.status).not.toBe(0);
    expect(r.stdout + r.stderr).toContain('FAILED');
  });
});
