import { describe, test, expect } from 'bun:test';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { TARGETS } from '../tools/build-cli';

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
    expect(runners.sort()).toEqual(['macos-15', 'macos-15', 'ubuntu-latest', 'windows-latest']);
    const text = runText(job!);
    expect(text).toContain('tools/build-app-bundle.ts');
    // The TAG, so a version mismatch fails the build rather than shipping a
    // bundle that misreports itself.
    expect(text).toContain('${TAG#v}');
    const upload = (job!.steps ?? []).find((s) => (s.uses ?? '').includes('upload-artifact'));
    expect(upload).toBeDefined();
    expect(String(upload!.with?.['if-no-files-found'])).toBe('error');
  });

  test('the macOS leg builds two per-arch DMGs and never a universal one', () => {
    // A universal bundle would need a third, lipo'd sidecar that
    // tools/build-sidecar.ts cannot make: externalBin resolves
    // {name}-{target_triple} verbatim, with no special case for
    // universal-apple-darwin.
    const rows = rel.jobs['app-bundles']!.strategy?.matrix?.include ?? [];
    const macs = rows.filter((r) => r.os === 'macos-15');
    expect(macs.map((r) => r.target).sort()).toEqual([
      'aarch64-apple-darwin',
      'x86_64-apple-darwin',
    ]);
    // Each names the sidecar for ITS OWN triple, not the runner's. Getting
    // this wrong bundles an arm64 engine inside the Intel DMG and nothing
    // fails until a user opens the window.
    expect(macs.map((r) => r.sidecar).sort()).toEqual(['bun-darwin-arm64', 'bun-darwin-x64']);
    expect(read(join(WORKFLOWS, 'release.yml'))).not.toContain('universal-apple-darwin');
  });

  test('the macOS leg passes the transition overlay so the two Mac apps coexist', () => {
    const text = runText(rel.jobs['app-bundles']!);
    expect(text).toContain('tauri.transition.conf.json');
    // It must not reach the Linux or Windows legs, whose $TARGET is empty:
    // the overlay renames the product for macOS only.
    expect(text).toMatch(/if \[ -n "\$TARGET" \][\s\S]*tauri\.transition\.conf\.json/);
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
    ]);
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

  test('the x86_64 DMG says it is not smoke-tested instead of passing silently', () => {
    // The one bundle whose engine no runner can execute. A bare `exit 0`
    // there is indistinguishable from a check that ran.
    const smoke = (rel.jobs['app-bundles']!.steps ?? []).find((s) =>
      /smoke-bundle\.ts/.test(s.run ?? ''),
    )!.run!;
    expect(smoke).toMatch(/::notice::/);
    expect(smoke).toContain('x86_64-apple-darwin');
    expect(smoke).toMatch(/NOT smoke-tested/);
    // And the step still fails, rather than exiting 0, if the glob on every
    // OTHER leg matches nothing at all.
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
    expect(steps[verify]!.run).toMatch(/cd app/);
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
