// Verify a PUBLISHED macOS DMG against the requirements the frozen Swift
// updater actually pins.
//
//   bun tools/verify-signing.ts --dmg Screepub-Desktop-macOS-universal.dmg \
//     --expect coexist     # v0.6.0: signed, and the old app must REFUSE it
//   bun tools/verify-signing.ts --dmg <path> --expect handover
//                            # v0.6.1: signed, and the old app must TAKE it
//
// Step 3 of docs/superpowers/plans/2026-09-20-swift-to-tauri-handover.md.
// Signing has never executed: those secrets only reach a tagged release
// and no tag has ever built a Tauri app, so everything this repository
// says about the macOS signature is currently read off tauri-bundler's
// source rather than off an artifact. This is the tool that ends that, and
// it runs against a DOWNLOADED release asset, never against a local build,
// because the thing being tested is what CI produced and published.
//
// Why it is not the three commands the plan writes out. The plan's
// shorthand requirement is
//
//   =anchor apple generic and certificate leaf[subject.OU] = "XSRB3D643J"
//
// and that is strictly WEAKER than UpdateInstall.swift's: it drops both
// Developer ID certificate-chain clauses, and for the app it drops the
// bundle identifier. An artifact can satisfy the shorthand and still be
// refused by the installer, which is precisely the gap step 3 exists to
// close. tests/verify-signing.test.ts pins the strings below against the
// Swift that builds them.
//
// It also answers step 4 without anyone installing anything. The two
// releases differ in exactly one variable, the identifier, so "would the
// frozen updater install this?" is a question codesign can be asked
// directly: at v0.6.0 the answer must be NO and at v0.6.1 it must be YES.
// Finding out on a Mac with a working app on it is the expensive way.

import { mkdirSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import type { RunResult, Runner } from './smoke-cli';

/** UpdateInstaller.teamID. */
export const TEAM_ID = 'XSRB3D643J';
/** UpdateInstaller.bundleID: the identifier the Tauri app TAKES at v0.6.1. */
export const SWIFT_BUNDLE_ID = 'com.darkwell.screepub';

/** The two Developer ID chain clauses, shared by both requirements.
 *  `...6.2.6` is the Developer ID intermediate CA; `...6.1.13` is a
 *  Developer ID Application leaf. Together they are what stops an
 *  ad-hoc or self-signed artifact satisfying "anchor apple generic". */
export const CHAIN_CLAUSES = [
  ' and certificate 1[field.1.2.840.113635.100.6.2.6] exists',
  ' and certificate leaf[field.1.2.840.113635.100.6.1.13] exists',
] as const;

const TEAM_CLAUSE = ` and certificate leaf[subject.OU] = "${TEAM_ID}"`;

/** UpdateInstaller.appRequirement, for whichever identifier is being
 *  asked about. The parameter is the whole point: the frozen app always
 *  asks about SWIFT_BUNDLE_ID, and asking about the Tauri app's own
 *  identifier is how the chain is checked separately from the refusal. */
export function appRequirement(bundleID: string): string {
  return (
    `anchor apple generic and identifier "${bundleID}"` + CHAIN_CLAUSES.join('') + TEAM_CLAUSE
  );
}

/** UpdateInstaller.dmgRequirement. No identifier: a codesigned DMG's
 *  identifier is its filename stem, not a bundle id, so pinning one would
 *  fail every image no matter who signed it. */
export const DMG_REQUIREMENT = 'anchor apple generic' + CHAIN_CLAUSES.join('') + TEAM_CLAUSE;

/** Exactly UpdateInstaller.verify's invocation. The `=` prefix is
 *  load-bearing: without it codesign reads the argument as a PATH to a
 *  requirement file and fails for a reason that has nothing to do with
 *  the signature. */
export function codesignVerifyArgv(target: string, requirement: string): string[] {
  return ['codesign', '--verify', '--deep', '--strict', '--test-requirement', `=${requirement}`, target];
}

export function codesignDisplayArgv(target: string): string[] {
  return ['codesign', '-dv', '--verbose=4', target];
}

/** codesign -dv writes to STDERR. Reading only stdout reports "unsigned"
 *  for a perfectly signed bundle, so both are searched. */
export function parseIdentifier(result: RunResult): string | undefined {
  return /^Identifier=(.+)$/m.exec(`${result.stderr}\n${result.stdout}`)?.[1]?.trim();
}

export interface SigningVerdict {
  /** The container satisfies the requirement the installer checks first. */
  dmgSigned: boolean;
  /** The .app satisfies the Developer ID chain and team, ignoring which
   *  identifier it carries. Separated from the identifier so a signing
   *  failure and a deliberate identifier difference cannot be confused. */
  appChainSigned: boolean;
  appIdentifier: string | undefined;
  /** The one that matters: the .app satisfies the FULL requirement the
   *  frozen UpdateInstaller pins, identifier included. */
  updaterWouldInstall: boolean;
}

export function judgeSigning(dmgPath: string, appPath: string, run: Runner): SigningVerdict {
  const passes = (target: string, requirement: string): boolean =>
    run(codesignVerifyArgv(target, requirement)).exitCode === 0;

  const appIdentifier = parseIdentifier(run(codesignDisplayArgv(appPath)));
  return {
    dmgSigned: passes(dmgPath, DMG_REQUIREMENT),
    // Asked about the app's OWN identifier, so this isolates the chain.
    appChainSigned: appIdentifier ? passes(appPath, appRequirement(appIdentifier)) : false,
    appIdentifier,
    updaterWouldInstall: passes(appPath, appRequirement(SWIFT_BUNDLE_ID)),
  };
}

/** Which release is being verified, and therefore what "correct" means.
 *  `coexist` is v0.6.0: prove signing while the identifier still differs,
 *  so nobody's app is touched. `handover` is v0.6.1: the identifier has
 *  been taken and existing installs are meant to upgrade themselves. */
export type Expectation = 'coexist' | 'handover';

export function describeVerdict(
  v: SigningVerdict,
  expectation: Expectation,
): { ok: boolean; lines: string[] } {
  const lines: string[] = [];
  let ok = true;
  const fail = (line: string): void => {
    ok = false;
    lines.push(`FAIL  ${line}`);
  };
  const pass = (line: string): void => {
    lines.push(`ok    ${line}`);
  };

  if (v.dmgSigned) pass(`the DMG satisfies the Developer ID chain and team ${TEAM_ID}`);
  else
    fail(
      `the DMG does NOT satisfy the requirement the installer checks first: ` +
        `Developer ID chain, team ${TEAM_ID}. Signing did not work. Stop here.`,
    );

  if (v.appChainSigned)
    pass(`the .app satisfies the Developer ID chain and team ${TEAM_ID}`);
  else
    fail(
      `the .app does NOT satisfy the Developer ID chain and team ${TEAM_ID}` +
        `${v.appIdentifier ? '' : ', and carries no identifier at all (is it signed?)'}. Stop here.`,
    );

  lines.push(`      the .app's identifier is ${v.appIdentifier ?? '<none>'}`);

  if (expectation === 'coexist') {
    if (!v.updaterWouldInstall) {
      pass(
        `an installed Swift app would DOWNLOAD this and then refuse it: the identifier ` +
          `is not ${SWIFT_BUNDLE_ID}. That is the intended v0.6.0 behaviour, and nobody's ` +
          `app is replaced.`,
      );
    } else {
      fail(
        `an installed Swift app WOULD install this. At v0.6.0 the identifier is supposed ` +
          `to still differ, so the pin makes that impossible. Something has already taken ` +
          `${SWIFT_BUNDLE_ID} early. Do not ship: this is v0.6.1 behaviour arriving a ` +
          `release too soon, with signing unproven.`,
      );
    }
  } else {
    if (v.updaterWouldInstall) {
      pass(
        `an installed Swift app would download, verify and install this. That is the ` +
          `handover working.`,
      );
    } else {
      fail(
        `an installed Swift app would download this and then REFUSE it. At v0.6.1 the ` +
          `identifier must be ${SWIFT_BUNDLE_ID}; it is ${v.appIdentifier ?? '<none>'}. ` +
          `Every existing install would see a failing update, forever.`,
      );
    }
  }

  return { ok, lines };
}

const realRun: Runner = (argv) => {
  const proc = Bun.spawnSync(argv, { stdout: 'pipe', stderr: 'pipe' });
  return {
    exitCode: proc.exitCode ?? 1,
    stdout: proc.stdout.toString(),
    stderr: proc.stderr.toString(),
  };
};

/** Mount read-only and nobrowse, and find the one .app by SUFFIX: the
 *  transition overlay ships "Screepub Desktop.app" and the handover
 *  renames it to "Screepub.app". Same rule, same reason, as
 *  smoke-bundle.ts's extractDmgEngine. */
export function mountDmg(
  dmgPath: string,
  workDir: string,
  run: Runner = realRun,
): { appPath: string; detach: () => void } {
  const mount = join(workDir, 'mnt');
  mkdirSync(mount, { recursive: true });
  const attach = run(['hdiutil', 'attach', dmgPath, '-readonly', '-nobrowse', '-mountpoint', mount]);
  if (attach.exitCode !== 0) {
    throw new Error(`verify-signing: hdiutil attach failed on ${dmgPath}: ${attach.stderr.trim().slice(0, 500)}`);
  }
  const detach = (): void => {
    run(['hdiutil', 'detach', mount, '-force']);
  };
  try {
    const apps = readdirSync(mount)
      .filter((n) => n.endsWith('.app'))
      .sort();
    if (apps.length !== 1) {
      throw new Error(
        `verify-signing: expected exactly one .app on the mounted image, found ` +
          `${apps.length}${apps.length ? ` (${apps.join(', ')})` : ''}`,
      );
    }
    return { appPath: join(mount, apps[0]!), detach };
  } catch (err) {
    detach();
    throw err;
  }
}

if (import.meta.main) {
  const { values } = parseArgs({
    args: Bun.argv.slice(2),
    options: { dmg: { type: 'string' }, expect: { type: 'string' } },
    strict: true,
    allowPositionals: false,
  });
  const dmg = values.dmg;
  const expectation = values.expect;
  if (!dmg || (expectation !== 'coexist' && expectation !== 'handover')) {
    console.error(
      'verify-signing: --dmg <downloaded .dmg> --expect coexist|handover\n' +
        '  coexist  = v0.6.0: signed, and an installed Swift app must REFUSE it\n' +
        '  handover = v0.6.1: signed, and an installed Swift app must INSTALL it\n' +
        'Run it against the asset DOWNLOADED from the release, never a local build.',
    );
    process.exit(2);
  }
  if (process.platform !== 'darwin') {
    console.error(`verify-signing: needs codesign and hdiutil, which are macOS-only (this is ${process.platform}).`);
    process.exit(2);
  }
  const work = mkdtempSync(join(tmpdir(), 'screepub-verify-signing-'));
  let detach: (() => void) | undefined;
  try {
    let appPath: string;
    ({ appPath, detach } = mountDmg(dmg, work));
    const verdict = judgeSigning(dmg, appPath, realRun);
    const { ok, lines } = describeVerdict(verdict, expectation);
    console.log(`verify-signing: ${dmg} (--expect ${expectation})`);
    for (const line of lines) console.log(`  ${line}`);
    if (!ok) {
      console.error('\nverify-signing: the artifact does not match what this release is meant to be.');
      process.exit(1);
    }
    console.log('\nverify-signing: all checks passed.');
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  } finally {
    detach?.();
    rmSync(work, { recursive: true, force: true });
  }
}
