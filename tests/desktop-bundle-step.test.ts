// release-artifacts.test.ts proves desktop.yml's bundle and smoke steps are
// TEXTUALLY present and in the right order. That is necessary but not
// sufficient: a `toContain('--bundles')` would also pass if the case
// statement picked the wrong list, named a bundle kind that does not exist,
// or fell through on one of the three runners and left BUNDLES unset. A
// workflow cannot be run by `bun test` -- it needs a GitHub runner -- but
// these two `run:` blocks are just bash, so this file pulls the ACTUAL step
// text out of the committed desktop.yml, substitutes the one `${{ }}`
// expression a runner would substitute, and executes it against a scratch
// directory with stub executables on PATH.
//
// The stubs are why no real cargo is ever spawned here: PATH is replaced
// outright with a directory holding a recorder script named `cargo`, so the
// step's own command line is captured rather than run. This is the proof
// that the steps DO the right thing, not merely that they say it.
import { describe, test, expect, afterAll, beforeAll } from 'bun:test';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { spawnSync } from 'node:child_process';

const WORK = mkdtempSync(join(tmpdir(), 'screepub-desktop-step-'));
// Resolved from THIS process's PATH, because the scripts below run with a
// PATH that holds only stub executables -- so `bash` itself has to be found
// before that PATH is replaced.
const BASH = Bun.which('bash');
if (!BASH) throw new Error('desktop-bundle-step: no bash on PATH');
afterAll(() => rmSync(WORK, { recursive: true, force: true }));

interface Job {
  steps?: { name?: string; run?: string; shell?: string; 'working-directory'?: string }[];
}
interface Workflow {
  jobs: Record<string, Job>;
}

const YML = join('.github', 'workflows', 'desktop.yml');
const desktop = Bun.YAML.parse(readFileSync(YML, 'utf8')) as Workflow;
const steps = desktop.jobs['build']?.steps ?? [];

function stepNamed(name: string): { name?: string; run?: string; shell?: string } {
  const found = steps.find((s) => s.name === name);
  if (!found?.run) throw new Error(`desktop.yml: no step named ${JSON.stringify(name)} with a run block`);
  return found;
}

const BUNDLE_STEP = stepNamed("Bundle this runner's installers").run!;
const SMOKE_STEP = stepNamed('Run the engine out of each bundle').run!;

/** A directory of recorder scripts standing in for real executables. Each
 *  writes its argv to a file and exits 0, so the step's command line is
 *  captured rather than executed. */
function stubDir(tag: string, names: string[]): { dir: string; log: (n: string) => string } {
  const dir = mkdtempSync(join(WORK, `${tag}-`));
  const logPath = (n: string) => join(dir, `${n}.argv`);
  for (const n of names) {
    const script = join(dir, n);
    writeFileSync(script, `#!/bin/sh\nprintf '%s\\n' "$@" > ${JSON.stringify(logPath(n))}\nexit 0\n`);
    chmodSync(script, 0o755);
  }
  return { dir, log: logPath };
}

const readArgv = (path: string): string[] => {
  try {
    return readFileSync(path, 'utf8').trimEnd().split('\n');
  } catch {
    return [];
  }
};

describe("desktop.yml's bundle step, executed as bash", () => {
  const runFor = (runnerOs: string) => {
    const { dir, log } = stubDir(`bundle-${runnerOs}`, ['cargo']);
    const script = BUNDLE_STEP.replaceAll('${{ runner.os }}', runnerOs);
    // PATH is ONLY the stub directory: the real cargo lives elsewhere and
    // must be unreachable, and the step needs no other executable.
    const r = spawnSync(BASH, ['-c', script], {
      cwd: dir,
      env: { PATH: dir, HOME: dir },
      encoding: 'utf8',
    });
    return { status: r.status, stderr: r.stderr, argv: readArgv(log('cargo')) };
  };

  test('Linux asks for deb and rpm, and never for the appimage that corrupts the engine', () => {
    const { status, argv } = runFor('Linux');
    expect(status).toBe(0);
    expect(argv).toEqual(['tauri', 'build', '--bundles', 'deb,rpm']);
    expect(argv.join(' ')).not.toContain('appimage');
  });

  test('macOS asks for app and dmg', () => {
    const { status, argv } = runFor('macOS');
    expect(status).toBe(0);
    expect(argv).toEqual(['tauri', 'build', '--bundles', 'app,dmg']);
  });

  test('Windows asks for nsis', () => {
    const { status, argv } = runFor('Windows');
    expect(status).toBe(0);
    expect(argv).toEqual(['tauri', 'build', '--bundles', 'nsis']);
  });

  test('a runner this step does not know fails loudly instead of bundling nothing', () => {
    // Without the catch-all arm, `set -u` would abort with "BUNDLES:
    // unbound variable" -- still a failure, but one that reads like a bash
    // bug rather than an unhandled platform. Either way it must NOT reach
    // cargo with an empty --bundles, which is the per-OS default this whole
    // case statement exists to avoid.
    const { status, argv, stderr } = runFor('FreeBSD');
    expect(status).not.toBe(0);
    expect(argv).toEqual([]);
    expect(stderr).toContain('FreeBSD');
  });

  test('the three arms cover exactly the three matrix runners', () => {
    // A matrix that gained a platform whose bundle list nobody chose would
    // otherwise fall into the catch-all on its first ever run.
    const yml = readFileSync(YML, 'utf8');
    const osToRunnerOs: Record<string, string> = {
      'ubuntu-latest': 'Linux',
      'macos-15': 'macOS',
      'windows-latest': 'Windows',
    };
    const matrix = /os: \[([^\]]+)\]/.exec(yml)?.[1]?.split(',').map((s) => s.trim()) ?? [];
    expect(matrix.length).toBe(3);
    for (const os of matrix) {
      const runnerOs = osToRunnerOs[os];
      expect(runnerOs).toBeDefined();
      expect(runFor(runnerOs!).status).toBe(0);
    }
  });
});

describe("desktop.yml's smoke step, executed as bash", () => {
  const NODE_DIR = dirname(spawnSync(BASH, ['-c', 'command -v node'], { encoding: 'utf8' }).stdout.trim());

  let dir = '';
  let log: (n: string) => string;
  beforeAll(() => {
    ({ dir, log } = stubDir('smoke', ['bun']));
    // The step reads the version out of package.json with real node, so
    // this scratch repo carries one that is nothing like the real version:
    // a step that hardcoded a number would pass against the real file.
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ version: '9.8.7' }));
    mkdirSync(join(dir, 'tools'), { recursive: true });
  });

  const run = () =>
    spawnSync(BASH, ['-c', SMOKE_STEP], {
      cwd: dir,
      // Real node (the step uses it to read package.json), stubbed bun.
      env: { PATH: `${dir}:${NODE_DIR}`, HOME: dir },
      encoding: 'utf8',
    });

  test("it hands smoke-bundle.ts --built and package.json's own version", () => {
    const r = run();
    expect(r.status).toBe(0);
    expect(readArgv(log('bun'))).toEqual([
      'tools/smoke-bundle.ts',
      '--built',
      '--expect-version',
      '9.8.7',
    ]);
  });

  test('a package.json with no version stops the step rather than smoking against "undefined"', () => {
    // `node -p` prints the string "undefined" and exits 0 for a missing
    // key, so the naive line would hand smoke-bundle.ts an expectation that
    // came from nowhere and report whatever came back.
    rmSync(log('bun'), { force: true });
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'x' }));
    try {
      const r = run();
      expect(r.status).not.toBe(0);
      expect(r.stderr).toContain('no version');
      // And nothing was smoked: the step stopped before bun.
      expect(readArgv(log('bun'))).toEqual([]);
    } finally {
      writeFileSync(join(dir, 'package.json'), JSON.stringify({ version: '9.8.7' }));
    }
  });
});
