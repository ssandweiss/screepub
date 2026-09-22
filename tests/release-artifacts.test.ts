import { describe, test, expect } from 'bun:test';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { TARGETS } from '../tools/build-cli';
import {
  BUNDLE_KINDS,
  kindsForOs,
  type BundleArch,
  type BundleOs,
} from '../tools/build-app-bundle';

const WORKFLOWS = '.github/workflows';
const read = (p: string) => readFileSync(p, 'utf8');

const MACOS_ASSETS = [
  'Screepub-macOS.dmg',
  'screepub-cli-macos-arm64.tar.gz',
  'screepub-cli-macos-x64.tar.gz',
];

describe('the macOS release path is untouched by the cross-platform builder', () => {
  test('the cross builder emits no macOS artifact, by name or by target', () => {
    // app/release.sh signs and NOTARIZES the macOS binaries, which needs
    // Apple's toolchain on a Mac. A cross-compiled Mach-O could not be
    // notarized, so an added darwin row here would quietly replace a
    // Gatekeeper-clean download with a warning screen.
    for (const t of TARGETS) {
      expect(t.bunTarget).not.toContain('darwin');
      expect(t.format.startsWith('macho')).toBe(false);
      expect(t.archiveName.toLowerCase()).not.toContain('macos');
      expect(t.archiveName.toLowerCase()).not.toContain('darwin');
    }
    for (const name of MACOS_ASSETS) {
      expect(TARGETS.some((t) => t.archiveName === name)).toBe(false);
    }
  });

  test('app/release.sh still produces the two tarballs and the DMG', () => {
    const sh = read('app/release.sh');
    expect(sh).toContain('screepub-cli-macos-$ARCH.tar.gz');
    expect(sh).toContain('Screepub-macOS.dmg');
    expect(sh).toContain('notarytool submit');
  });

  test('tools/bump-tap.sh still names exactly the macOS assets, and nothing else', () => {
    // The Homebrew tap serves the macOS CLI. It must not learn about the
    // Linux or Windows artifacts: brew has no business installing either,
    // and tap-freshness.yml would go red on a formula it cannot audit.
    const sh = read('tools/bump-tap.sh');
    for (const name of MACOS_ASSETS) expect(sh).toContain(name);
    expect(sh.toLowerCase()).not.toContain('linux');
    expect(sh.toLowerCase()).not.toContain('windows');
    for (const t of TARGETS) expect(sh).not.toContain(t.archiveName);
  });
});

describe('every workflow action is pinned to a commit', () => {
  test('no `uses:` rides a mutable tag', () => {
    const offenders: string[] = [];
    for (const file of readdirSync(WORKFLOWS).filter((f) => f.endsWith('.yml'))) {
      for (const line of read(join(WORKFLOWS, file)).split('\n')) {
        const m = /^\s*-?\s*uses:\s*(\S+)/.exec(line);
        if (!m) continue;
        if (!/@[0-9a-f]{40}$/.test(m[1]!)) offenders.push(`${file}: ${m[1]}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});

interface Job {
  'runs-on'?: string;
  needs?: string | string[];
  strategy?: { matrix?: { include?: Record<string, string>[] } };
  permissions?: Record<string, string>;
  steps?: { name?: string; uses?: string; run?: string; shell?: string; with?: Record<string, unknown> }[];
}
interface Workflow {
  jobs: Record<string, Job>;
}

const workflow = (file: string): Workflow =>
  Bun.YAML.parse(read(join(WORKFLOWS, file))) as Workflow;

const runText = (job: Job): string => (job.steps ?? []).map((s) => s.run ?? '').join('\n');

describe('ci.yml cross-compiles on every push', () => {
  const ci = workflow('ci.yml');

  test('a cross-cli job builds every target on a free runner', () => {
    const job = ci.jobs['cross-cli'];
    expect(job).toBeDefined();
    expect(job!['runs-on']).toBe('ubuntu-latest');
    const text = runText(job!);
    expect(text).toContain('tools/build-cli.ts');
    // No --only: the point is that ALL THREE targets keep compiling.
    expect(text).not.toContain('--only');
  });

  test('it runs the linux-x64 artifact rather than only building it', () => {
    const text = runText(ci.jobs['cross-cli']!);
    expect(text).toContain('screepub-cli-linux-x64.tar.gz');
    expect(text).toContain('tools/smoke-cli.ts');
  });

  test('the macOS artifact job is untouched and still runs epubcheck', () => {
    // The compiled-binary + epubcheck gate predates this piece and is not
    // replaced by the cheap Linux one.
    const artifact = ci.jobs['artifact'];
    expect(artifact!['runs-on']).toBe('macos-15');
    expect(runText(artifact!)).toContain('epubcheck');
  });
});

describe('release.yml ships the cross-platform artifacts', () => {
  const rel = workflow('release.yml');
  const needs = (name: string): string[] => {
    const n = rel.jobs[name]?.needs;
    return Array.isArray(n) ? n : n ? [n] : [];
  };

  test('the four existing jobs are still there, in their existing shape', () => {
    expect(Object.keys(rel.jobs)).toEqual(
      expect.arrayContaining(['checks', 'release', 'tap', 'tap-check']),
    );
    expect(rel.jobs['release']!['runs-on']).toBe('macos-15');
    expect(needs('release')).toEqual(['checks']);
    expect(needs('tap')).toEqual(['release']);
    expect(needs('tap-check')).toEqual(['tap']);
  });

  test('the macOS release job still builds, signs and uploads exactly its three assets', () => {
    const text = runText(rel.jobs['release']!);
    expect(text).toContain('app/release.sh');
    for (const name of MACOS_ASSETS) expect(text).toContain(`app/dist/${name}`);
    // And it has NOT quietly become responsible for the new ones.
    for (const t of TARGETS) expect(text).not.toContain(t.archiveName);
  });

  test('the checks job fails a tag whose three version files disagree', () => {
    const text = runText(rel.jobs['checks']!);
    // package.json was already checked. These two are new, and between them
    // they name the bundle filename, the Info.plist, the deb Version: field
    // and the NSIS product version.
    expect(text).toContain('desktop/src-tauri/Cargo.toml');
    expect(text).toContain('desktop/src-tauri/tauri.conf.json');
    // Read from the TAGGED COMMIT, like every other assertion in that step,
    // not from the working tree: a checkout is not proof of what was tagged.
    expect(text).toMatch(/git cat-file blob "\$GITHUB_SHA:desktop\/src-tauri\/tauri\.conf\.json"/);
    expect(text).toMatch(/git cat-file blob "\$GITHUB_SHA:desktop\/src-tauri\/Cargo\.toml"/);
  });

  test('those two assertions run before any certificate is imported', () => {
    // The whole value of putting them in `checks` is that a mismatched
    // version costs twenty seconds instead of failing after notarization,
    // with a DMG already built. `release` needs `checks`, so the ordering
    // is structural rather than a matter of step order.
    expect(needs('release')).toEqual(['checks']);
    const release = runText(rel.jobs['release']!);
    expect(release).toContain('app/release.sh');
    // And the version check is NOT duplicated into the signing job.
    expect(release).not.toContain('desktop/src-tauri/tauri.conf.json');
  });

  test('cross-cli builds every artifact once, after the checks pass', () => {
    const job = rel.jobs['cross-cli'];
    expect(job).toBeDefined();
    expect(job!['runs-on']).toBe('ubuntu-latest');
    expect(needs('cross-cli')).toEqual(['checks']);
    const text = runText(job!);
    expect(text).toContain('tools/build-cli.ts');
    expect(text).not.toContain('--only');
    // The version comes from the TAG, so a mis-set package.json fails the
    // build instead of shipping a binary that misreports itself.
    expect(text).toContain('${TAG#v}');
    const upload = (job!.steps ?? []).find((s) => (s.uses ?? '').includes('upload-artifact'));
    expect(upload).toBeDefined();
    expect(String(upload!.with?.['if-no-files-found'])).toBe('error');
  });

  test('each smoke job downloads its own artifact and runs it on its own OS', () => {
    expect(rel.jobs['smoke-linux-x64']!['runs-on']).toBe('ubuntu-latest');
    expect(rel.jobs['smoke-windows-x64']!['runs-on']).toBe('windows-latest');
    for (const name of ['smoke-linux-x64', 'smoke-windows-x64']) {
      expect(needs(name)).toEqual(['cross-cli']);
      const job = rel.jobs[name]!;
      expect((job.steps ?? []).some((s) => (s.uses ?? '').includes('download-artifact'))).toBe(true);
      expect(runText(job)).toContain('tools/smoke-cli.ts');
    }
    expect(runText(rel.jobs['smoke-linux-x64']!)).toContain('screepub-cli-linux-x64.tar.gz');
    const win = rel.jobs['smoke-windows-x64']!;
    expect(runText(win)).toContain('screepub-cli-windows-x64.zip');
    expect((win.steps ?? []).some((s) => s.shell === 'pwsh')).toBe(true);
  });

  test('nothing is uploaded until both smoke jobs have passed', () => {
    // The Windows binary has never executed anywhere before that job. If
    // the upload did not wait for it, the smoke test would be decoration.
    expect(needs('cross-upload').sort()).toEqual(
      ['release', 'smoke-linux-x64', 'smoke-windows-x64'],
    );
    expect(rel.jobs['cross-upload']!.permissions?.contents).toBe('write');
  });

  test('cross-upload attaches all three archives and the checksums', () => {
    const text = runText(rel.jobs['cross-upload']!);
    for (const t of TARGETS) expect(text).toContain(t.archiveName);
    expect(text).toContain('SHA256SUMS');
    expect(text).toContain('--clobber');
    // No checkout in that job, so gh must be told the repository.
    const env = JSON.stringify(rel.jobs['cross-upload']!.steps ?? []);
    expect(env).toContain('GH_REPO');
    // It must not touch the macOS assets the release job already uploaded.
    for (const name of MACOS_ASSETS) expect(text).not.toContain(name);
  });

  test('the checksums are re-verified after the artifact round trip, before the upload', () => {
    // The files are verified and hashed in cross-cli's $RUNNER_TEMP, then
    // cross a job boundary through upload-artifact/download-artifact. The
    // smoke jobs open only their own copies and only two of the three, so
    // without this step screepub-cli-linux-arm64.tar.gz is never touched
    // again and SHA256SUMS is never checked against what it names.
    const steps = rel.jobs['cross-upload']!.steps ?? [];
    const verify = steps.findIndex((s) => /sha256sum -c SHA256SUMS/.test(s.run ?? ''));
    const upload = steps.findIndex((s) => /gh release upload/.test(s.run ?? ''));
    expect(verify).toBeGreaterThanOrEqual(0);
    expect(upload).toBeGreaterThanOrEqual(0);
    // Order is the whole point: verifying after the upload is decoration.
    expect(verify).toBeLessThan(upload);
    // SHA256SUMS names BARE filenames, so -c only resolves them with the
    // download directory as cwd.
    expect(steps[verify]!.run).toMatch(/cd cli/);
  });

  test('linux-arm64 is built and shipped but never smoke-tested', () => {
    // Stated, not hidden: no arm64 runner is assumed available, so this
    // artifact ships untested and the release notes say so. If an arm64
    // runner is ever added, this assertion is the one to delete.
    const jobs = Object.keys(rel.jobs);
    expect(jobs).not.toContain('smoke-linux-arm64');
    expect(runText(rel.jobs['cross-upload']!)).toContain('screepub-cli-linux-arm64.tar.gz');
  });

  // ---- the app bundles -------------------------------------------------
  // These are the STRUCTURAL pins: which jobs exist, what they need, what
  // their steps say. What the four bash blocks actually DO is executed,
  // with stub executables, in tests/release-app-step.test.ts.

  test('app-bundles builds on all three runners, after the checks pass', () => {
    const job = rel.jobs['app-bundles'];
    expect(job).toBeDefined();
    expect(needs('app-bundles')).toEqual(['checks']);
    // The matrix, not the file: `toContain(os)` against the whole YAML
    // would pass on the strength of some OTHER job's runner.
    const runners = (job!.strategy?.matrix?.include ?? []).map((r) => r.os);
    expect(runners.sort()).toEqual(['macos-15', 'ubuntu-latest', 'windows-latest']);
    const text = runText(job!);
    expect(text).toContain('tools/build-app-bundle.ts');
    // The TAG, so a version mismatch fails the build rather than shipping a
    // bundle that misreports itself.
    expect(text).toContain('${TAG#v}');
    const upload = (job!.steps ?? []).find((s) => (s.uses ?? '').includes('upload-artifact'));
    expect(upload).toBeDefined();
    expect(String(upload!.with?.['if-no-files-found'])).toBe('error');
  });

  test('the macOS leg builds ONE universal DMG, never a per-arch pair', () => {
    // INVERTED 2026-09-20, deliberately: this test used to assert the
    // opposite, and the reason it did has been removed. A universal bundle
    // needs a third, lipo'd sidecar, and `build-sidecar.ts --universal` now
    // makes one -- compiling both darwin slices and fusing them under the
    // name externalBin resolves for universal-apple-darwin.
    //
    // It matters far beyond packaging tidiness. The frozen Swift updater
    // takes the FIRST .dmg asset on a release and has no architecture
    // logic, so a per-arch pair is what made an automatic migration off
    // the Swift app impossible: roughly half of all users would have been
    // handed an app that cannot open. One artifact makes "the first .dmg"
    // unambiguous. See docs/adr/2026-09-20-swift-app-migrates-itself.md.
    const rows = rel.jobs['app-bundles']!.strategy?.matrix?.include ?? [];
    const macs = rows.filter((r) => r.os === 'macos-15');
    expect(macs.length).toBe(1);
    expect(macs[0]!.arch).toBe('universal');
    // The per-arch SIDECAR names must be gone from the file, not merely
    // unused by this row: a leftover row or step naming one is how a
    // second .dmg finds its way back onto the release page. The two
    // darwin TRIPLES do still appear, in exactly one place -- `rustup
    // target add`, which installs both because the lipo needs two real
    // cargo builds. Anywhere else is a per-arch build coming back.
    const yml = read(join(WORKFLOWS, 'release.yml'));
    expect(yml).not.toContain('bun-darwin-arm64');
    expect(yml).not.toContain('bun-darwin-x64');
    const triples = (yml.match(/(?:aarch64|x86_64)-apple-darwin/g) ?? []).length;
    expect(triples).toBe(2);
    expect(yml).toContain('rustup target add x86_64-apple-darwin aarch64-apple-darwin');
  });

  test('the cargo triple is named in the tool, not restated in the YAML', () => {
    // universal-apple-darwin is derived from `--arch universal` inside
    // tools/build-app-bundle.ts, which is also where the rule lives that a
    // universal arch must not carry a per-arch target. Restating the
    // triple here would be a second place for it to drift, and the drift
    // would be silent: a thin bundle wearing a universal name.
    // Scoped to the text that EXECUTES: comments explaining where the
    // triple went are the opposite of restating it, so they come out
    // first. What must not survive is the triple reaching a command line.
    const commands = runText(rel.jobs['app-bundles']!)
      .split('\n')
      .filter((l) => !l.trim().startsWith('#'))
      .join('\n');
    expect(commands).not.toContain('universal-apple-darwin');
    expect(commands).not.toContain('--target');
    expect(commands).toContain('--arch universal');
  });

  test('the universal leg installs BOTH darwin rust targets before it builds', () => {
    // The lipo needs two real cargo builds. The runner's own architecture
    // is installed already and the other is not -- and naming only one
    // means the build fails on whichever architecture GitHub's macos-15
    // image is not. Naming both costs nothing and survives that changing.
    const steps = rel.jobs['app-bundles']!.steps ?? [];
    const rustup = steps.findIndex((s) => /rustup target add/.test(s.run ?? ''));
    const sidecar = steps.findIndex((s) => /build-sidecar\.ts/.test(s.run ?? ''));
    expect(rustup).toBeGreaterThanOrEqual(0);
    expect(rustup).toBeLessThan(sidecar);
    expect(steps[rustup]!.run).toContain('x86_64-apple-darwin');
    // universal-apple-darwin is tauri's name for the fused output, not a
    // rustup target. Asking rustup for it by name fails the step.
    expect(steps[rustup]!.run).not.toContain('rustup target add universal-apple-darwin');
  });

  test('the macOS leg passes the transition overlay, and only the macOS leg', () => {
    const text = runText(rel.jobs['app-bundles']!);
    expect(text).toContain('tauri.transition.conf.json');
    // It must not reach the Linux or Windows legs, whose $ARCH is x64:
    // the overlay renames the product for macOS only.
    expect(text).toMatch(/if \[ "\$ARCH" = universal \][\s\S]*tauri\.transition\.conf\.json/);
  });

  test('the macOS leg signs and notarizes from secrets the repo already has', () => {
    const yml = read(join(WORKFLOWS, 'release.yml'));
    // tauri-bundler reads its OWN variable names; these are the translation.
    for (const v of [
      'APPLE_CERTIFICATE',
      'APPLE_CERTIFICATE_PASSWORD',
      'APPLE_SIGNING_IDENTITY',
      'APPLE_API_KEY',
      'APPLE_API_ISSUER',
      'APPLE_API_KEY_PATH',
    ]) {
      expect(yml).toContain(v);
    }
    // And no NEW secret was invented for it.
    // [A-Z0-9_], with the digits: without them P12 and P8 truncate to
    // "secrets.DEVELOPER_ID_CERT_P" and the list below can never match.
    const declared = yml.match(/secrets\.[A-Z0-9_]+/g) ?? [];
    expect([...new Set(declared)].sort()).toEqual([
      'secrets.AC_API_ISSUER_ID',
      'secrets.AC_API_KEY_ID',
      'secrets.AC_API_KEY_P8_BASE64',
      'secrets.CERT_PASSWORD',
      'secrets.DEVELOPER_ID_CERT_P12_BASE64',
      'secrets.KEYCHAIN_PASSWORD',
      'secrets.TAP_TOKEN',
      // The updater's signing key and its password (docs/release-secrets.md
      // §4). Added 2026-09-21 for piece A; the ONLY two added since the
      // list above was written.
      'secrets.TAURI_SIGNING_PRIVATE_KEY',
      'secrets.TAURI_SIGNING_PRIVATE_KEY_PASSWORD',
    ]);
  });

  // ---- the updater ------------------------------------------------------
  // Piece A's transport half: the signed archive, the manifest, and the
  // alarm. docs/superpowers/plans/2026-09-21-updater-transport.md.

  test('the checks job refuses a tag whose app trusts no real updater key', () => {
    // From the TAGGED commit, like every other assertion in that job. A
    // tag with an empty pubkey ships an updater that can never accept a
    // release, which is what ADR 2026-09-21 says v0.6.1 must not do. This
    // is a tag-time gate and not a bun test on purpose: the key does not
    // exist yet, and a test that fails until the owner acts is a red main
    // for nobody's fault.
    const text = runText(rel.jobs['checks']!);
    expect(text).toContain('tools/update-signature.ts --pubkey-from-config');
    expect(text).toMatch(/git cat-file blob "\$GITHUB_SHA:desktop\/src-tauri\/tauri\.conf\.json"[^\n]*>/);
    // After bun is set up, since it is a bun tool; still before any
    // certificate is imported, since `release` needs `checks`.
    const steps = rel.jobs['checks']!.steps ?? [];
    const bun = steps.findIndex((s) => (s.uses ?? '').includes('setup-bun'));
    const gate = steps.findIndex((s) => /pubkey-from-config/.test(s.run ?? ''));
    expect(gate).toBeGreaterThan(bun);
  });

  test('the macOS leg asks for the updater archive and carries the signing key, macOS only', () => {
    const yml = read(join(WORKFLOWS, 'release.yml'));
    const text = runText(rel.jobs['app-bundles']!);
    // --updater inside the universal branch, beside the transition overlay.
    expect(text).toMatch(/if \[ "\$ARCH" = universal \][\s\S]*--updater/);
    // The two secrets reach tauri-cli under its OWN variable names, and
    // only on macOS, in exactly the shape the APPLE_* ones already use.
    expect(yml).toMatch(/TAURI_SIGNING_PRIVATE_KEY: \$\{\{ runner\.os == 'macOS' && secrets\.TAURI_SIGNING_PRIVATE_KEY \|\| '' \}\}/);
    expect(yml).toMatch(/TAURI_SIGNING_PRIVATE_KEY_PASSWORD: \$\{\{ runner\.os == 'macOS' && secrets\.TAURI_SIGNING_PRIVATE_KEY_PASSWORD \|\| '' \}\}/);
    // And desktop.yml, the push path, knows nothing of either.
    const desktop = read(join(WORKFLOWS, 'desktop.yml'));
    expect(desktop).not.toContain('TAURI_SIGNING');
    expect(desktop).not.toContain('--updater');
  });

  test('app-upload builds latest.json from what arrived, LAST, and uploads archive, signature and manifest', () => {
    const job = rel.jobs['app-upload']!;
    const steps = job.steps ?? [];
    // It needs a checkout and bun now, because the manifest is built by a
    // tool rather than by YAML. The download therefore cannot land under
    // the old name, which in a checkout is the Swift app's source directory.
    expect(steps.some((s) => (s.uses ?? '').includes('actions/checkout'))).toBe(true);
    expect(steps.some((s) => (s.uses ?? '').includes('setup-bun'))).toBe(true);
    const download = steps.find((s) => (s.uses ?? '').includes('download-artifact'));
    expect(download?.with?.path).toBe('arrivals');
    const text = runText(job);
    expect(text).not.toMatch(/cd app\b/);
    expect(text).toContain('tools/build-update-manifest.ts --dir arrivals');
    expect(text).toContain('--out arrivals/latest.json');
    // The installers, the archive and its signature go up first; the
    // manifest that points at them goes up LAST, so nothing it names is
    // ever missing when it is read.
    const upload = steps.findIndex((s) => /gh release upload[\s\S]*\*\.app\.tar\.gz\.sig/.test(s.run ?? ''));
    const manifest = steps.findIndex((s) => /build-update-manifest\.ts/.test(s.run ?? ''));
    expect(upload).toBeGreaterThanOrEqual(0);
    expect(manifest).toBeGreaterThan(upload);
    expect(steps[manifest]!.run).toContain('latest.json');
    expect(steps[manifest]!.run).toMatch(/gh release upload/);
    // A prerelease gets no manifest: releases/latest never points at one.
    expect(steps[manifest]!.run).toMatch(/\*-\*/);
  });

  test('latest-check reads the manifest back from GitHub after the upload, per release', () => {
    // The tap-check pattern: a job INSIDE the release run, because a
    // `release: published` trigger elsewhere never fires for a release
    // created with the default token. A red job here means the release
    // published and the updater cannot use it.
    const job = rel.jobs['latest-check'];
    expect(job).toBeDefined();
    expect(needs('latest-check')).toEqual(['app-upload']);
    expect(runText(job!)).toContain('tools/check-latest.ts');
    // No --version: the question is whether the ENDPOINT serves the newest
    // release, which is what the app asks and is the right question even
    // when an old tag is being re-run.
    expect(runText(job!)).not.toContain('--version');
    expect(JSON.stringify(job)).toContain("!contains(github.ref_name, '-')");
  });

  test('the weekly freshness workflow checks the manifest as well as the tap', () => {
    const weekly = workflow('tap-freshness.yml');
    const jobs = Object.values(weekly.jobs);
    expect(jobs.some((j) => runText(j).includes('tools/check-tap.sh'))).toBe(true);
    expect(jobs.some((j) => runText(j).includes('tools/check-latest.ts'))).toBe(true);
  });

  test('the Windows leg is deliberately unsigned', () => {
    // Authenticode is a procurement problem, not an engineering one. This
    // assertion is what keeps that a decision rather than a drift.
    const yml = read(join(WORKFLOWS, 'release.yml'));
    expect(yml).not.toContain('WINDOWS_CERTIFICATE');
    expect(yml).not.toContain('signtool');
  });

  test('every bundle is smoked on the OS that built it, before any upload', () => {
    const steps = rel.jobs['app-bundles']!.steps ?? [];
    const build = steps.findIndex((s) => /build-app-bundle\.ts/.test(s.run ?? ''));
    const smoke = steps.findIndex((s) => /smoke-bundle\.ts/.test(s.run ?? ''));
    const upload = steps.findIndex((s) => (s.uses ?? '').includes('upload-artifact'));
    expect(build).toBeGreaterThanOrEqual(0);
    expect(smoke).toBeGreaterThan(build);
    expect(upload).toBeGreaterThan(smoke);
    // The upload job waits for BOTH the release job and every bundle leg.
    // If it did not wait for the smoke, the smoke would be decoration.
    expect(needs('app-upload').sort()).toEqual(['app-bundles', 'release']);
    expect(rel.jobs['app-upload']!.permissions?.contents).toBe('write');
  });

  test('the universal DMG is smoked, and says which slice went untested', () => {
    // There is no longer a bundle that skips the smoke entirely: the
    // universal DMG has a slice the runner can execute, so it is opened
    // and its engine run like every other. What a green tick still must
    // not imply is that BOTH slices were exercised, so the notice stays --
    // now describing half an artifact rather than a whole one.
    const smoke = (rel.jobs['app-bundles']!.steps ?? []).find((s) =>
      /smoke-bundle\.ts/.test(s.run ?? ''),
    )!.run!;
    expect(smoke).toMatch(/::notice::/);
    // No early exit: the old step RETURNED before the loop on the x86_64
    // leg. Nothing may skip the loop now. Matched as a command on its own
    // line, since the step's own comments talk about exiting 0.
    expect(smoke.split('\n').some((l) => l.trim() === 'exit 0')).toBe(false);
    // And the step still fails, rather than exiting 0, if the glob on any
    // leg matches nothing at all.
    expect(smoke).toContain('NOTHING WAS CHECKED');
  });

  test('every bash step in the two new jobs declares `shell: bash`', () => {
    // Without it, a `run:` block on windows-latest is executed by
    // PowerShell, where `set -euo pipefail` and `ARGS=(...)` are syntax
    // errors -- and the Windows leg is the one nobody here can try first.
    for (const step of rel.jobs['app-bundles']!.steps ?? []) {
      if (!step.run) continue;
      // The two Linux/macOS-only steps are guarded by `if:` and never
      // reach a Windows runner.
      if (/apt-get|base64 --decode/.test(step.run)) continue;
      if (/^\s*(rustup|cargo|bun install)/.test(step.run.trim())) continue;
      expect(step.shell).toBe('bash');
    }
  });

  test('the checksums are re-verified after the artifact round trip', () => {
    // Same blind spot cross-upload already names: the files are hashed in
    // one job's workspace and then cross a job boundary.
    const steps = rel.jobs['app-upload']!.steps ?? [];
    const verify = steps.findIndex((s) => /sha256sum -c SHA256SUMS-app/.test(s.run ?? ''));
    const upload = steps.findIndex((s) => /gh release upload/.test(s.run ?? ''));
    expect(verify).toBeGreaterThanOrEqual(0);
    expect(verify).toBeLessThan(upload);
    // `arrivals`, since 2026-09-21: the job checks the repository out now,
    // and the old download directory name collides with the Swift app's
    // source directory in a checkout.
    expect(steps[verify]!.run).toMatch(/cd arrivals/);
  });

  test('the app checksums file does not overwrite the CLI one', () => {
    // cross-upload publishes SHA256SUMS to the same release page. One
    // clobbering the other leaves downloads silently uncheckable.
    const text = runText(rel.jobs['app-upload']!);
    expect(text).toContain('SHA256SUMS-app');
    expect(text).not.toMatch(/SHA256SUMS(?!-app)/);
  });

  test('the SwiftUI release path is untouched', () => {
    const release = runText(rel.jobs['release']!);
    expect(release).toContain('app/release.sh');
    for (const name of MACOS_ASSETS) expect(release).toContain(`app/dist/${name}`);
    // The new jobs must not touch the Swift artifacts or the tap.
    for (const jobName of ['app-bundles', 'app-upload']) {
      const text = runText(rel.jobs[jobName]!);
      expect(text).not.toContain('app/release.sh');
      expect(text).not.toContain('bump-tap');
      for (const name of MACOS_ASSETS) expect(text).not.toContain(name);
    }
    expect(needs('tap')).toEqual(['release']);
    expect(needs('tap-check')).toEqual(['tap']);
    // And nothing that already existed learned to wait on the new jobs: a
    // failing bundle leg must not be able to strand the release in draft.
    for (const jobName of ['release', 'tap', 'tap-check', 'cross-cli', 'cross-upload']) {
      expect(needs(jobName)).not.toContain('app-bundles');
      expect(needs(jobName)).not.toContain('app-upload');
    }
  });

  test('the Linux leg ships both a .deb and an .rpm', () => {
    const text = runText(rel.jobs['app-upload']!);
    expect(text).toContain('.deb');
    expect(text).toContain('.rpm');
  });
});

describe('desktop.yml bundles and smokes on every push', () => {
  // These are the STRUCTURAL pins -- which steps exist, in which order, on
  // which runners. What the two bash blocks actually DO is executed, with
  // stub executables, in tests/desktop-bundle-step.test.ts.
  const desktop = workflow('desktop.yml');
  const job = desktop.jobs['build']!;
  const steps = job.steps ?? [];
  const stepIndex = (re: RegExp): number => steps.findIndex((s) => re.test(s.run ?? ''));

  test('it still compiles on all three platforms', () => {
    // The matrix predates this piece and is not replaced by it.
    expect(JSON.stringify(job)).toContain('cargo build --locked');
    const yml = read(join(WORKFLOWS, 'desktop.yml'));
    for (const os of ['ubuntu-latest', 'macos-15', 'windows-latest']) {
      expect(yml).toContain(os);
    }
  });

  test('the generated-files diff runs BEFORE anything that rewrites Cargo.toml', () => {
    // `cargo tauri build` rewrites desktop/src-tauri/Cargo.toml with the
    // feature lists it derives from tauri.conf.json. The committed spelling
    // makes that a no-op today, but a future tauri.conf.json option would
    // make it rewrite again -- and a `git diff --exit-code` running after
    // the bundle step would then go red for a reason nobody could read.
    const diff = stepIndex(/git diff --exit-code/);
    const bundle = stepIndex(/cargo tauri build/);
    expect(diff).toBeGreaterThanOrEqual(0);
    expect(bundle).toBeGreaterThanOrEqual(0);
    expect(diff).toBeLessThan(bundle);
  });

  test('the bundle list is pinned and never the per-OS default', () => {
    // The Linux default is deb, rpm AND appimage, and the AppImage step
    // corrupts the Bun-compiled engine and fails the whole run.
    const text = runText(job);
    expect(text).toContain('--bundles');
    expect(text).not.toContain('appimage');
  });

  test('it runs smoke-bundle after building, not instead of it', () => {
    const bundle = stepIndex(/cargo tauri build/);
    const smoke = stepIndex(/tools\/smoke-bundle\.ts/);
    expect(smoke).toBeGreaterThan(bundle);
    expect(steps[smoke]!.run).toContain('--built');
  });

  test('both bash steps run under bash on every runner, Windows included', () => {
    // Without `shell: bash` a `run:` block on windows-latest is executed by
    // PowerShell, where `case ... esac` and `set -euo pipefail` are syntax
    // errors -- and the Windows leg is the one nobody here can try first.
    for (const re of [/cargo tauri build/, /tools\/smoke-bundle\.ts/]) {
      expect(steps[stepIndex(re)]!.shell).toBe('bash');
    }
  });

  test('cargo-tauri is installed at a pinned version and cached', () => {
    const yml = read(join(WORKFLOWS, 'desktop.yml'));
    // An unpinned `cargo install tauri-cli` is a four-minute build against
    // whatever crates.io served that morning.
    expect(yml).toMatch(/cargo install tauri-cli --version [0-9]/);
    expect(yml).toContain('--locked');
    expect(yml).toContain('~/.cargo/bin/cargo-tauri');
    // The cache key must name the SAME version that gets installed, or a
    // version bump is served the old binary out of the cache forever.
    const installed = /cargo install tauri-cli --version ([0-9][^ ]*) /.exec(yml)?.[1];
    expect(installed).toBeDefined();
    expect(yml).toContain(`key: tauri-cli-${installed}-`);
  });

  test('the push path imports no Developer ID certificate', () => {
    // Signing on every push is slow and exposes the secret far more widely
    // than a release does. The push bundle is unsigned on purpose.
    const yml = read(join(WORKFLOWS, 'desktop.yml'));
    for (const secret of ['APPLE_CERTIFICATE', 'DEVELOPER_ID_CERT_P12_BASE64', 'APPLE_API_KEY']) {
      expect(yml).not.toContain(secret);
    }
  });

  test('an edit to any tool this workflow runs triggers it', () => {
    // The bundle and smoke steps run code that lives outside desktop/. A
    // path filter that did not list it would let smoke-bundle.ts change
    // without the only workflow that executes it ever running.
    const yml = read(join(WORKFLOWS, 'desktop.yml'));
    const filters = yml.split('\n').filter((l) => l.trim().startsWith('paths:'));
    expect(filters.length).toBe(2);
    for (const line of filters) {
      for (const path of [
        'tools/smoke-bundle.ts',
        'tools/build-app-bundle.ts',
        'tools/bundle-archive.ts',
        'package.json',
      ]) {
        expect(line).toContain(`'${path}'`);
      }
    }
  });

  test('the workflow says, where a reader meets it, what it does not prove', () => {
    // The two admissions that must not quietly disappear: nothing here
    // launches the GUI, and build-app-bundle.ts's renaming half is not
    // exercised on the push path at all.
    const yml = read(join(WORKFLOWS, 'desktop.yml'));
    expect(yml).toContain('no runner has a display');
    expect(yml).toMatch(/build-app-bundle\.ts/);
  });
});

describe('the two limits are stated where a reader meets them', () => {
  const readme = read('README.md');

  test('the README says the Windows download is unsigned', () => {
    const lower = readme.toLowerCase();
    expect(lower).toContain('windows');
    expect(lower).toContain('smartscreen');
    expect(/not signed|unsigned/.test(lower)).toBe(true);
  });

  test('the README names each Linux and Windows artifact it tells people to download', () => {
    for (const t of TARGETS) expect(readme).toContain(t.archiveName);
  });

  test('the README says which release these downloads start appearing in', () => {
    // package.json deliberately stays at 0.5.4 through this branch, and
    // GitHub renders README.md from main the moment it merges. Without a
    // version qualifier, "latest release" points at v0.5.4, which carries
    // the DMG and two macOS tarballs and none of the three files the table
    // above names -- an empty-handed download with no error to explain it.
    const section = readme.slice(readme.indexOf('### Linux and Windows'));
    expect(section).toContain('releases/latest');
    // The qualifier has to sit in the same breath as the link, not in some
    // other part of the page a downloader never reaches.
    const around = section.slice(0, section.indexOf('| Machine |'));
    expect(around).toContain('0.6.0');
  });

  test('the README says device support off macOS is unproven, and names the tolino case', () => {
    const lower = readme.toLowerCase();
    expect(lower).toContain('tolino');
    // The specific, checkable claim: on Windows a tolino cannot be detected
    // at all, because it is identified by volume name and a Windows drive
    // root carries none.
    expect(/tolino[^.]*windows|windows[^.]*tolino/s.test(lower)).toBe(true);
  });

  test('the 0.6.0 notes carry both limits', () => {
    const notes = read('docs/releases/0.6.0.md').toLowerCase();
    expect(notes).toContain('windows');
    expect(/not signed|unsigned/.test(notes)).toBe(true);
    expect(notes).toContain('tolino');
  });
});

describe('the app downloads are described where a reader meets them', () => {
  const readme = read('README.md');
  const notes = read('docs/releases/0.6.0.md');
  const site = read('site/index.html');
  const rel = workflow('release.yml');
  const VERSION = '0.6.0';

  // The names are DERIVED, not restated: release.yml's matrix says which
  // OS/arch legs run, and BUNDLE_KINDS says what each leg is named. So a
  // renamed artifact, a dropped leg or an ADDED leg (an arm64 Linux runner,
  // say) fails a documentation test rather than leaving these three pages
  // naming a file the release does not carry -- or silently omitting one it
  // does. Restating the filenames in the test would catch neither.
  const published = new Set<string>();
  const unpublished = new Set<string>();
  for (const row of rel.jobs['app-bundles']!.strategy?.matrix?.include ?? []) {
    const os: BundleOs = row.os!.startsWith('ubuntu')
      ? 'linux'
      : row.os!.startsWith('macos')
        ? 'macos'
        : 'windows';
    for (const kind of kindsForOs(os)) {
      published.add(kind.releasedName(VERSION, row.arch as BundleArch));
    }
  }
  for (const kind of BUNDLE_KINDS) {
    for (const arch of ['x64', 'arm64'] as const) {
      const name = kind.releasedName(VERSION, arch);
      if (!published.has(name)) unpublished.add(name);
    }
  }

  const NUMBER_WORD = ['no', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight'];

  test('the derivation found the four files the release actually uploads', () => {
    // Guards every loop below: a matrix this parse did not understand would
    // make them all vacuously true. Four is what app-upload's own line-count
    // check demands: one .deb, one .rpm, ONE .dmg, one .exe.
    expect([...published].sort()).toEqual([
      'Screepub-0.6.0-1.x86_64.rpm',
      'Screepub-0.6.0-setup.exe',
      'Screepub-Desktop-macOS-universal.dmg',
      'Screepub_0.6.0_amd64.deb',
    ]);
    // And the ones no leg builds, which no page may offer. The two
    // per-arch DMGs joined this list on 2026-09-20: a page still naming
    // one sends a Mac user to a download the release does not carry, and
    // the point of the universal build is that there is exactly one.
    expect([...unpublished].sort()).toEqual([
      'Screepub-0.6.0-1.aarch64.rpm',
      'Screepub-Desktop-macOS-arm64.dmg',
      'Screepub-Desktop-macOS-x64.dmg',
      'Screepub_0.6.0_arm64.deb',
    ]);
  });

  test('the README names every file it tells people to download', () => {
    for (const name of published) expect(readme).toContain(name);
  });

  test('no page offers a bundle the release does not carry', () => {
    // The Linux arm64 .deb and .rpm build by hand and are in no matrix row.
    // Naming one is an empty-handed download with no error to explain it.
    for (const text of [readme, notes, site]) {
      for (const name of unpublished) expect(text).not.toContain(name);
    }
  });

  test('the README says how many files the app checksums cover', () => {
    // Spelled out, so adding a leg without touching this sentence fails
    // here rather than publishing a checksums file covering more than the
    // page admits to.
    expect(readme).toContain(`covers these ${NUMBER_WORD[published.size]} files`);
  });

  test('the README says the Windows installer is unsigned, in the same words as the CLI note', () => {
    // Scoped to the INSTALLER's own section: E1's CLI paragraph already
    // puts "SmartScreen" on the page, so an unscoped search would pass with
    // nothing said about the installer at all.
    const section = readme.slice(readme.indexOf('### Desktop app')).toLowerCase();
    expect(section).toContain('smartscreen');
    expect(/not signed|unsigned/.test(section)).toBe(true);
    // E1 already wrote this paragraph for the CLI. Two differently-worded
    // warnings on one page read as two different problems, so both say
    // More info and Run anyway, and both are still there.
    const cli = readme
      .slice(readme.indexOf('### Linux and Windows'), readme.indexOf('### Desktop app'))
      .toLowerCase();
    for (const phrase of ['smartscreen', 'more info', 'run anyway']) {
      expect(cli).toContain(phrase);
      expect(section).toContain(phrase);
    }
  });

  test('the README does not claim the installer works fully offline', () => {
    // NSIS's default webviewInstallMode downloads the WebView2 bootstrapper
    // when the machine has none. Windows 11 ships it; Windows 10 may not.
    // The APP still makes no network requests and that claim stands -- but
    // the INSTALLER sentence has to be precise enough not to be caught out.
    const section = readme.slice(readme.indexOf('### Desktop app'));
    expect(section.toLowerCase()).toContain('webview2');
    // And the standing "works fully offline" promise, which sits in another
    // section entirely, carries the same qualifier where it is made. A
    // reader who stops at the privacy section never reaches the other note.
    const privacy = readme.slice(readme.indexOf('## Your script stays on your machine'));
    expect(privacy.slice(0, privacy.indexOf('## For developers')).toLowerCase()).toContain(
      'webview2',
    );
  });

  test('the README says which of these artifacts CI actually executed', () => {
    const lower = readme.toLowerCase();
    // What is unexercised is no longer a whole download but HALF of one.
    // The Mac DMG is universal, CI runs its ARM slice out of the mounted
    // image, and the Intel slice ships built, signed and executed nowhere.
    // Saying so is the difference between a limitation and a surprise.
    expect(/intel|x86_64|x64/.test(lower)).toBe(true);
    expect(lower).toContain('slice');
    // And the bundles nobody has installed are still named as such.
    expect(lower).toContain('never been installed');
  });

  test('the README claims macOS for the window, and still withholds Windows', () => {
    // UPDATED 2026-09-20. This test used to read "does not claim the window
    // has been run off Linux", and that was right when it was written. Gate
    // 1b has since passed on a real Mac: the universal DMG was mounted,
    // dragged to /Applications, launched past Gatekeeper and used to
    // convert two real feature scripts. Under-claiming is its own kind of
    // wrong, so the page must now say so.
    //
    // Windows is gate 1c and is DEFERRED INDEFINITELY, so the withholding
    // sentence survives, scoped to the platform that has not earned its
    // removal. desktop/README.md's ledger is the list this tracks.
    const section = readme.slice(readme.indexOf('### Desktop app'));
    expect(section).toContain('Windows');
    expect(/never been (started|run|opened)|nobody has (started|run|opened)/.test(section)).toBe(
      true,
    );
    // The claim macOS earned, stated rather than implied: a person, on a
    // Mac, with a real script.
    expect(/\/Applications/.test(section)).toBe(true);
    // And the superseded sentence is gone rather than merely contradicted.
    expect(section.toLowerCase()).not.toContain('only ever been started on linux');
  });

  test('the 0.6.0 notes carry the same three limits', () => {
    const lower = notes.toLowerCase();
    expect(/not signed|unsigned/.test(lower)).toBe(true);
    expect(lower).toContain('smartscreen');
    expect(lower).toContain('never been installed');
    // E1's limits are still there and were not overwritten.
    expect(lower).toContain('tolino');
  });

  test('the notes name the app downloads too, not only the CLI ones', () => {
    for (const name of published) expect(notes).toContain(name);
  });

  test('the download page carries the unsigned-Windows warning', () => {
    // site/index.html offered only the macOS DMG before this piece, so this
    // is a new section rather than an edited one.
    const lower = site.toLowerCase();
    expect(lower).toContain('smartscreen');
    expect(/not signed|unsigned/.test(lower)).toBe(true);
  });

  test('the site still offers the SwiftUI DMG as the supported Mac download', () => {
    // Two Mac downloads on one page will confuse somebody. The mitigation
    // is that the page says which one is supported; piece F is the real fix.
    expect(site).toContain('Screepub-macOS.dmg');
    expect(site.toLowerCase()).toContain('supported');
    // And the page's own three buttons still point at it, so the new
    // section cannot have quietly redirected the call to action.
    expect((site.match(/releases\/latest\/download\/Screepub-macOS\.dmg/g) ?? []).length).toBe(3);
  });

  test('nothing anywhere promises an AppImage, a cask, winget or the AUR', () => {
    // All four are out of scope, three of them deferred with reasons and
    // one ruled out on merits. A promise in prose is a promise.
    for (const text of [readme, notes, site]) {
      const lower = text.toLowerCase();
      expect(lower).not.toContain('appimage');
      expect(lower).not.toContain('winget');
      expect(lower).not.toContain('aur ');
    }
    // The Homebrew tap is still named -- it serves the SwiftUI app and the
    // macOS CLI, and that is unchanged -- but never beside the Tauri app.
    const around = readme.slice(readme.indexOf('### Desktop app'));
    expect(around.toLowerCase()).not.toContain('brew install');
  });
});

describe('desktop/README.md keeps the ledger of who verified what', () => {
  const doc = read('desktop/README.md');

  test('it has all three headings, in order: a person, CI, nobody', () => {
    const person = doc.indexOf('Verified on a real machine, by a person');
    const ci = doc.indexOf('Verified only by CI');
    const nobody = doc.indexOf('Verified by nobody');
    expect(person).toBeGreaterThan(0);
    expect(ci).toBeGreaterThan(person);
    expect(nobody).toBeGreaterThan(ci);
  });

  test('the "by a person" list claims only the architecture that was built here', () => {
    // The .deb and .rpm a person opened and launched are aarch64. The
    // release publishes amd64 and x86_64, which nobody has built. Saying
    // "the Linux bundles" without the architecture is exactly the
    // overstatement this ledger exists to prevent.
    const person = doc.slice(
      doc.indexOf('Verified on a real machine, by a person'),
      doc.indexOf('Verified only by CI'),
    );
    expect(person).toContain('Screepub_0.6.0_arm64.deb');
    expect(person).toContain('Screepub-0.6.0-1.aarch64.rpm');
    expect(person).not.toContain('amd64');
    // The Mac half of this list is new: gate 1b, a universal DMG built
    // here, mounted, installed and used to convert real scripts. The
    // architecture caveat is the same one -- it is the ARM slice that was
    // executed, so the list may not say "the Mac app" unqualified.
    expect(person).toContain('/Applications');
    expect(/universal/i.test(person)).toBe(true);
  });

  test('gate 1b moved the Mac DMG off the "nobody" list, and only the Mac DMG', () => {
    // The ledger's own rule: nothing moves up it without someone doing the
    // thing. Someone did, on 2026-09-20, and leaving "no .dmg has been
    // installed on a real machine" in place would make this file lie in
    // the safe direction -- which is still lying, and would send the next
    // reader looking for work that is done.
    const nobody = doc.slice(doc.indexOf('Verified by nobody'));
    expect(nobody).not.toMatch(/No `\.deb`, `\.rpm`, `\.dmg` or `\.exe` has been\s+installed/);
    // The Windows installer and the Linux packages have not moved.
    expect(nobody).toContain('.exe');
    // And the Intel half of the universal DMG is the thing that now has
    // nobody's name against it, in place of a whole per-arch download.
    expect(/slice/i.test(nobody)).toBe(true);
    expect(nobody).not.toContain('x86_64-apple-darwin');
  });

  test('the ledger still says release.yml has never run', () => {
    // Signing has never executed. No tag has ever built a Tauri app, and
    // every macOS signing claim in this repository is read off
    // tauri-bundler's source until one does.
    const ci = doc.slice(doc.indexOf('Verified only by CI'), doc.indexOf('Verified by nobody'));
    expect(ci).toContain('release.yml');
    expect(/never run|never been run|has not run|never executed/.test(ci)).toBe(true);
  });

  test('nothing in this file still calls bundling future work', () => {
    // It said "bundling and installers are piece E2" and "once a later
    // piece wires that job up". Both landed in this piece; a reader who
    // believes either goes looking for work that is already done.
    expect(doc).not.toContain('installers are piece E2');
    expect(doc).not.toContain('once a later piece wires that job up');
  });
});
