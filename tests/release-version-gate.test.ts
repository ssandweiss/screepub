// release-artifacts.test.ts proves the two new lines are TEXTUALLY present
// in release.yml's `checks` job. That is necessary but not sufficient: a
// string like `expect(text).toContain('desktop/src-tauri/Cargo.toml')`
// would also pass if the check were commented out, spelled with the wrong
// comparison operator, or wired to the wrong variable. Workflow YAML can't
// be run by `bun test` as a whole (it needs a tagged push on a GitHub
// runner), but the gate's `run:` block is just bash -- so this file pulls
// the ACTUAL step text out of the committed release.yml and executes it
// against a real, local-only git repository, exactly the way the checks
// job would: `git cat-file blob $GITHUB_SHA:<path>` against a real commit.
//
// This is the proof that the gate fires, not just that it exists.
import { describe, test, expect, afterAll } from 'bun:test';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const WORK = mkdtempSync(join(tmpdir(), 'screepub-release-gate-'));
afterAll(() => rmSync(WORK, { recursive: true, force: true }));

// --- Pull the real step text out of release.yml, the same way
// tests/release-artifacts.test.ts does (Bun.YAML.parse over the committed
// file), so this test exercises what actually ships, not a hand-copied
// stand-in that could drift from it. ---
interface Job {
  steps?: { name?: string; run?: string }[];
}
interface Workflow {
  jobs: Record<string, Job>;
}
const rel = Bun.YAML.parse(
  readFileSync(join('.github', 'workflows', 'release.yml'), 'utf8'),
) as Workflow;
const checkStep = rel.jobs['checks']?.steps?.find(
  (s) => s.name === 'Release notes and version are publishable',
);
if (!checkStep?.run) throw new Error('release.yml: the version-check step is missing or unnamed');
const FULL_SCRIPT = checkStep.run;

// Everything up to (not including) the main-ancestry check. That check
// needs a real `origin` remote and is exercised elsewhere in spirit by the
// YAML-structure tests; this file is about the version comparisons, which
// are self-contained given a commit and a $GITHUB_SHA.
const ANCESTRY_MARKER = '# The tagged commit must be ON main.';
const boundary = FULL_SCRIPT.indexOf(ANCESTRY_MARKER);
if (boundary < 0) throw new Error('release.yml: ancestry-check marker not found; did the step get reordered?');
const VERSION_GATE_SCRIPT = FULL_SCRIPT.slice(0, boundary);

// The three-file gate this task adds must be IN that slice (not, say, only
// reachable after the part we can't drive here).
if (!VERSION_GATE_SCRIPT.includes('desktop/src-tauri/Cargo.toml')) {
  throw new Error('release.yml: the Cargo.toml version check is not before the ancestry check');
}
if (!VERSION_GATE_SCRIPT.includes('desktop/src-tauri/tauri.conf.json')) {
  throw new Error('release.yml: the tauri.conf.json version check is not before the ancestry check');
}

type Versions = { pkg: string; cargo: string; conf: string };

/** A real, local-only git repo (never pushed, no network) with the four
 *  files the gate reads, committed once. Returns the commit's SHA -- the
 *  gate reads blobs at $GITHUB_SHA, never the working tree. */
function commitRepo(
  versions: Versions,
  tagVersion = '0.6.0', // the docs/releases/<tag>.md name; independent of package.json's own version
): { dir: string; sha: string; env: NodeJS.ProcessEnv } {
  const dir = mkdtempSync(join(WORK, 'repo-'));
  const home = mkdtempSync(join(WORK, 'home-')); // never the real $HOME
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    HOME: home,
    GIT_CONFIG_GLOBAL: '/dev/null',
    GIT_CONFIG_SYSTEM: '/dev/null',
  };
  const git = (...args: string[]) => {
    const r = spawnSync('git', args, { cwd: dir, env, encoding: 'utf8' });
    if (r.status !== 0) {
      throw new Error(`git ${args.join(' ')} failed: ${r.stderr}`);
    }
    return r;
  };

  git('init', '-q', '-b', 'main');
  git('config', 'user.email', 'gate-test@example.invalid');
  git('config', 'user.name', 'Gate Test');

  mkdirSync(join(dir, 'docs', 'releases'), { recursive: true });
  mkdirSync(join(dir, 'desktop', 'src-tauri'), { recursive: true });
  writeFileSync(join(dir, 'docs', 'releases', `${tagVersion}.md`), '# Notes\n\nBody.\n');
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ version: versions.pkg }));
  writeFileSync(
    join(dir, 'desktop', 'src-tauri', 'Cargo.toml'),
    `[package]\nname = "screepub-desktop"\nversion = "${versions.cargo}"\nedition = "2021"\n\n` +
      `[dependencies]\ntauri = "2"\n`,
  );
  writeFileSync(
    join(dir, 'desktop', 'src-tauri', 'tauri.conf.json'),
    JSON.stringify({ version: versions.conf }),
  );
  git('add', '-A');
  git('commit', '-q', '-m', 'gate fixture');
  const sha = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: dir, env, encoding: 'utf8' }).stdout.trim();
  return { dir, sha, env };
}

function runGate(dir: string, sha: string, env: NodeJS.ProcessEnv, tag: string) {
  return spawnSync('bash', ['-c', VERSION_GATE_SCRIPT], {
    cwd: dir,
    env: { ...env, TAG: tag, GITHUB_SHA: sha },
    encoding: 'utf8',
  });
}

describe('the real release.yml version gate, driven against a local git repo', () => {
  test('a tag whose three files agree passes clean', () => {
    const { dir, sha, env } = commitRepo({ pkg: '0.6.0', cargo: '0.6.0', conf: '0.6.0' });
    const r = runGate(dir, sha, env, 'v0.6.0');
    expect(r.status).toBe(0);
  });

  test('a mismatched Cargo.toml -- the split this task exists to catch -- fails the gate', () => {
    // The exact defect described in the task: package.json (0.5.4, checked
    // already) can pass while the crate and the bundle still say 0.6.0.
    // Here the tag is 0.6.0 and Cargo.toml is the one that lags.
    const { dir, sha, env } = commitRepo({ pkg: '0.6.0', cargo: '0.5.4', conf: '0.6.0' });
    const r = runGate(dir, sha, env, 'v0.6.0');
    expect(r.status).not.toBe(0);
    expect(r.stdout + r.stderr).toContain('desktop/src-tauri/Cargo.toml');
    expect(r.stdout + r.stderr).toContain("says '0.5.4' but the tag says 0.6.0");
  });

  test('a mismatched tauri.conf.json -- the bundle filename/Info.plist/deb Version/NSIS source -- fails the gate', () => {
    const { dir, sha, env } = commitRepo({ pkg: '0.6.0', cargo: '0.6.0', conf: '0.5.4' });
    const r = runGate(dir, sha, env, 'v0.6.0');
    expect(r.status).not.toBe(0);
    expect(r.stdout + r.stderr).toContain('desktop/src-tauri/tauri.conf.json');
    expect(r.stdout + r.stderr).toContain('says 0.5.4 but the tag says 0.6.0');
  });

  test('the exact bug that motivated this task: a 0.6.0 tag over a 0.5.4 engine', () => {
    // package.json (the ENGINE version) trails; Cargo.toml and
    // tauri.conf.json already read 0.6.0. This is the real state of this
    // very working tree, and it is what would have shipped without this
    // gate -- caught by the package.json check that already existed, so
    // this is a regression guard on the OLD check plus proof the new ones
    // don't accidentally paper over it.
    const { dir, sha, env } = commitRepo({ pkg: '0.5.4', cargo: '0.6.0', conf: '0.6.0' });
    const r = runGate(dir, sha, env, 'v0.6.0');
    expect(r.status).not.toBe(0);
    expect(r.stdout + r.stderr).toContain('package.json says 0.5.4 but the tag says 0.6.0');
  });

  test('the gate reads the TAGGED COMMIT, not a dirty working tree', () => {
    // All three files agree at the commit the gate is pointed at ($GITHUB_SHA).
    const { dir, sha, env } = commitRepo({ pkg: '0.6.0', cargo: '0.6.0', conf: '0.6.0' });
    // Now corrupt the working tree WITHOUT committing -- exactly what a
    // stray local edit, a bad rebase, or a compromised checkout step would
    // look like. If the gate is reading the working tree instead of the
    // blob at $GITHUB_SHA, this would now fail; a `git checkout` in a real
    // runner wouldn't even reach this state, which is the whole point of
    // reading the blob rather than trusting a checkout.
    writeFileSync(
      join(dir, 'desktop', 'src-tauri', 'Cargo.toml'),
      '[package]\nname = "screepub-desktop"\nversion = "9.9.9"\n',
    );
    writeFileSync(join(dir, 'desktop', 'src-tauri', 'tauri.conf.json'), JSON.stringify({ version: '9.9.9' }));
    const r = runGate(dir, sha, env, 'v0.6.0');
    expect(r.status).toBe(0);
  });

  test('the crate-version regex is not fooled by a `version` key inside [dependencies] preceding [package]', () => {
    // Mirrors the brief's own trap file: a dependency's `version = "9.9.9"`
    // appears in the file before the real [package] version. A naive
    // `grep -m1` or an un-anchored regex would read the wrong one; the
    // committed extractor is anchored on the [package] header.
    const dir = mkdtempSync(join(WORK, 'trap-'));
    const home = mkdtempSync(join(WORK, 'trap-home-'));
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      HOME: home,
      GIT_CONFIG_GLOBAL: '/dev/null',
      GIT_CONFIG_SYSTEM: '/dev/null',
    };
    const git = (...args: string[]) => {
      const r = spawnSync('git', args, { cwd: dir, env, encoding: 'utf8' });
      if (r.status !== 0) throw new Error(`git ${args.join(' ')} failed: ${r.stderr}`);
      return r;
    };
    git('init', '-q', '-b', 'main');
    git('config', 'user.email', 'gate-test@example.invalid');
    git('config', 'user.name', 'Gate Test');
    mkdirSync(join(dir, 'docs', 'releases'), { recursive: true });
    mkdirSync(join(dir, 'desktop', 'src-tauri'), { recursive: true });
    writeFileSync(join(dir, 'docs', 'releases', '0.6.0.md'), '# Notes\n\nBody.\n');
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ version: '0.6.0' }));
    writeFileSync(
      join(dir, 'desktop', 'src-tauri', 'Cargo.toml'),
      '[dependencies]\nfoo = { version = "9.9.9" }\n\n[package]\nname = "x"\nversion = "0.6.0"\n',
    );
    writeFileSync(join(dir, 'desktop', 'src-tauri', 'tauri.conf.json'), JSON.stringify({ version: '0.6.0' }));
    git('add', '-A');
    git('commit', '-q', '-m', 'trap fixture');
    const sha = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: dir, env, encoding: 'utf8' }).stdout.trim();
    const r = runGate(dir, sha, env, 'v0.6.0');
    expect(r.status).toBe(0);
  });
});
