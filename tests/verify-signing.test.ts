// The gate at step 3 of docs/superpowers/plans/2026-09-20-swift-to-tauri-handover.md.
//
// Signing has NEVER executed. Those secrets only reach a tagged release and
// no tag has ever built a Tauri app, so every claim this repository makes
// about the macOS signature is read off tauri-bundler's source. Step 3 is
// where that stops being a reading and becomes a fact, and the plan is
// explicit that a green workflow is not the same fact as a signature that
// satisfies the requirement the frozen updater pins.
//
// Which is why the requirement is not retyped. The plan's own shorthand,
//
//   =anchor apple generic and certificate leaf[subject.OU] = "XSRB3D643J"
//
// is WEAKER than what UpdateInstall.swift actually pins: it drops both
// Developer ID certificate-chain checks, and for the app it drops the
// bundle identifier. A DMG could satisfy the shorthand and be refused by
// the real installer, which is the exact failure step 3 exists to catch.
// So the strings live in one place, and the first test below is what keeps
// that place honest against the Swift the frozen app will actually run.
import { describe, test, expect } from 'bun:test';
import { readFileSync } from 'node:fs';
import {
  TEAM_ID,
  SWIFT_BUNDLE_ID,
  DMG_REQUIREMENT,
  CHAIN_CLAUSES,
  appRequirement,
  codesignVerifyArgv,
  codesignDisplayArgv,
  parseIdentifier,
  judgeSigning,
  describeVerdict,
  type Expectation,
} from '../tools/verify-signing';
import type { RunResult, Runner } from '../tools/smoke-cli';

const ok = (stdout = '', stderr = ''): RunResult => ({ exitCode: 0, stdout, stderr });
const bad = (stderr = 'not signed at all'): RunResult => ({ exitCode: 1, stdout: '', stderr });

describe('the pinned requirements are the frozen app’s, not a paraphrase', () => {
  const swift = readFileSync('app/Sources/ScreepubKit/UpdateInstall.swift', 'utf8');

  test('the team ID and bundle ID match UpdateInstaller’s own constants', () => {
    expect(swift).toContain(`public static let teamID = "${TEAM_ID}"`);
    expect(swift).toContain(`public static let bundleID = "${SWIFT_BUNDLE_ID}"`);
  });

  test('every clause of appRequirement appears in the Swift that builds it', () => {
    // Reconstructed clause by clause rather than as one string: the Swift
    // builds it with `+` across five lines and interpolates two constants,
    // so no single literal to compare against exists over there.
    const appReq = swift.slice(swift.indexOf('appRequirement'), swift.indexOf('dmgRequirement'));
    expect(appReq).toContain('anchor apple generic and identifier');
    expect(appReq).toContain('\\(bundleID)');
    for (const clause of CHAIN_CLAUSES) {
      // The Swift writes them without the leading " and ".
      expect(appReq).toContain(clause.replace(/^ and /, ''));
    }
    expect(appReq).toContain('certificate leaf[subject.OU] = \\"\\(teamID)\\"');
  });

  test('appRequirement is the DMG requirement plus exactly one identifier clause', () => {
    // Stated as a relationship rather than as a second literal, so the two
    // cannot drift apart: whatever the chain becomes, the app requirement
    // is that chain with an identifier bolted on.
    const req = appRequirement('com.example.thing');
    expect(req).toContain('identifier "com.example.thing"');
    for (const clause of CHAIN_CLAUSES) expect(req).toContain(clause);
    expect(req).toContain(TEAM_ID);
    expect(req.replace(' and identifier "com.example.thing"', '')).toBe(DMG_REQUIREMENT);
  });

  test('the DMG requirement pins the chain and the team but NOT an identifier', () => {
    // A codesigned DMG's identifier is its filename stem, not a bundle id.
    // Pinning one here would fail every DMG regardless of who signed it.
    expect(DMG_REQUIREMENT).not.toContain('identifier');
    expect(DMG_REQUIREMENT).toContain(TEAM_ID);
    for (const clause of CHAIN_CLAUSES) expect(DMG_REQUIREMENT).toContain(clause.trim());
    const dmgReq = swift.slice(swift.indexOf('dmgRequirement'));
    expect(dmgReq.slice(0, 400)).not.toContain('identifier');
  });

  test('the plan’s shorthand is a STRICT subset, which is why it is not used', () => {
    // Guards the reason this file exists. If the real requirement ever
    // became as weak as the shorthand, the extra checking here would be
    // theatre and this test says so out loud.
    const shorthand = `anchor apple generic and certificate leaf[subject.OU] = "${TEAM_ID}"`;
    expect(DMG_REQUIREMENT).not.toBe(shorthand);
    expect(DMG_REQUIREMENT.length).toBeGreaterThan(shorthand.length);
    expect(CHAIN_CLAUSES.length).toBe(2);
  });
});

describe('the codesign invocations, asserted element by element', () => {
  // Data, not a spawned process: only a Mac with a real signed artifact
  // could run these, and the argv is where the mistakes live.
  test('verify passes --deep --strict and an = -prefixed requirement', () => {
    expect(codesignVerifyArgv('/V/Screepub.app', 'anchor apple generic')).toEqual([
      'codesign',
      '--verify',
      '--deep',
      '--strict',
      '--test-requirement',
      '=anchor apple generic',
      '/V/Screepub.app',
    ]);
  });

  test('the = prefix is present, because without it codesign reads a FILE', () => {
    // `--test-requirement <text>` without the leading = is a path to a
    // requirement file. The frozen installer writes `"=\(requirement)"`
    // and so must this, or the check fails for the wrong reason.
    const argv = codesignVerifyArgv('/x.app', DMG_REQUIREMENT);
    expect(argv[5]!.startsWith('=')).toBe(true);
  });

  test('display asks for verbose=4, which is what prints Identifier=', () => {
    expect(codesignDisplayArgv('/V/Screepub.app')).toEqual([
      'codesign',
      '-dv',
      '--verbose=4',
      '/V/Screepub.app',
    ]);
  });
});

describe('reading the identifier back off codesign', () => {
  // codesign -dv writes to STDERR, which is the detail that makes a naive
  // implementation report "no identifier" on a perfectly signed bundle.
  const SAMPLE = [
    'Executable=/Volumes/Screepub/Screepub Desktop.app/Contents/MacOS/Screepub',
    'Identifier=com.darkwell.screepub.desktop',
    'Format=app bundle with Mach-O universal (x86_64 arm64)',
    'TeamIdentifier=XSRB3D643J',
  ].join('\n');

  test('it is read from stderr', () => {
    expect(parseIdentifier(ok('', SAMPLE))).toBe('com.darkwell.screepub.desktop');
  });

  test('stdout is read too, so a future codesign that moves it still works', () => {
    expect(parseIdentifier(ok(SAMPLE, ''))).toBe('com.darkwell.screepub.desktop');
  });

  test('output with no Identifier line answers undefined rather than guessing', () => {
    expect(parseIdentifier(ok('', 'code object is not signed at all'))).toBeUndefined();
  });
});

describe('the verdict: what the frozen updater would do with this artifact', () => {
  /** A runner that answers by what is being asked, so a test states the
   *  artifact's real properties once and every codesign call agrees. */
  function artifact(opts: {
    dmgSigned: boolean;
    appSigned: boolean;
    identifier: string;
  }): Runner {
    return (argv) => {
      const target = argv[argv.length - 1]!;
      const isDmg = target.endsWith('.dmg');
      if (argv[1] === '-dv') {
        return opts.appSigned || isDmg
          ? ok('', `Identifier=${isDmg ? 'Screepub-Desktop-macOS-universal' : opts.identifier}\n`)
          : bad();
      }
      const requirement = argv[5]!;
      if (isDmg) return opts.dmgSigned ? ok() : bad();
      if (!opts.appSigned) return bad();
      // The only thing that can fail a signed app here is the identifier
      // clause, which is exactly the variable the two releases differ on.
      const wants = /identifier "([^"]+)"/.exec(requirement)?.[1];
      return !wants || wants === opts.identifier ? ok() : bad('does not satisfy its designated Requirement');
    };
  }

  const v060 = () =>
    judgeSigning(
      '/tmp/Screepub-Desktop-macOS-universal.dmg',
      '/V/Screepub Desktop.app',
      artifact({ dmgSigned: true, appSigned: true, identifier: 'com.darkwell.screepub.desktop' }),
    );

  const v061 = () =>
    judgeSigning(
      '/tmp/Screepub-Desktop-macOS-universal.dmg',
      '/V/Screepub.app',
      artifact({ dmgSigned: true, appSigned: true, identifier: SWIFT_BUNDLE_ID }),
    );

  test('a correctly signed 0.6.0 artifact: signed, and the updater REFUSES it', () => {
    // The whole shape of the two-release plan, as one assertion. v0.6.0
    // proves signing while the identifier still differs, so an existing
    // Swift install downloads the DMG and then declines to install it.
    const v = v060();
    expect(v.dmgSigned).toBe(true);
    expect(v.appChainSigned).toBe(true);
    expect(v.appIdentifier).toBe('com.darkwell.screepub.desktop');
    expect(v.updaterWouldInstall).toBe(false);
  });

  test('a correctly signed 0.6.1 artifact: signed, and the updater ACCEPTS it', () => {
    const v = v061();
    expect(v.dmgSigned).toBe(true);
    expect(v.appChainSigned).toBe(true);
    expect(v.appIdentifier).toBe(SWIFT_BUNDLE_ID);
    expect(v.updaterWouldInstall).toBe(true);
  });

  test('an unsigned DMG is caught even when the app inside is fine', () => {
    // The container and the bundle are signed by separate steps and the
    // installer verifies both. Checking only the .app would pass an image
    // the updater refuses before it ever reaches the app.
    const v = judgeSigning(
      '/tmp/x.dmg',
      '/V/Screepub.app',
      artifact({ dmgSigned: false, appSigned: true, identifier: SWIFT_BUNDLE_ID }),
    );
    expect(v.dmgSigned).toBe(false);
    expect(v.updaterWouldInstall).toBe(true);
    // ... and the expectation below is what turns that into a failure.
  });
});

describe('the expectation each release is held to', () => {
  const signed060 = {
    dmgSigned: true,
    appChainSigned: true,
    appIdentifier: 'com.darkwell.screepub.desktop',
    updaterWouldInstall: false,
  };

  const judge = (v: typeof signed060, e: Expectation) => describeVerdict(v, e);

  test('coexist passes when signing works and the identifier still differs', () => {
    const r = judge(signed060, 'coexist');
    expect(r.ok).toBe(true);
    expect(r.lines.join(' ')).toContain('refuse');
  });

  test('coexist FAILS if the updater would install it: that is step 4’s alarm', () => {
    // The plan: "If it OFFERS the Tauri build, stop and find out why -- the
    // pin is supposed to make that impossible." Caught here, before anyone
    // installs anything, rather than on a Mac with a working app on it.
    const r = judge({ ...signed060, appIdentifier: SWIFT_BUNDLE_ID, updaterWouldInstall: true }, 'coexist');
    expect(r.ok).toBe(false);
    expect(r.lines.join(' ')).toContain('v0.6.1');
  });

  test('coexist FAILS on an unsigned DMG, which is the point of the whole step', () => {
    const r = judge({ ...signed060, dmgSigned: false }, 'coexist');
    expect(r.ok).toBe(false);
  });

  test('coexist FAILS on an unsigned app even if the DMG is signed', () => {
    const r = judge({ ...signed060, appChainSigned: false }, 'coexist');
    expect(r.ok).toBe(false);
  });

  test('handover passes only when the updater would actually install it', () => {
    const taken = {
      dmgSigned: true,
      appChainSigned: true,
      appIdentifier: SWIFT_BUNDLE_ID,
      updaterWouldInstall: true,
    };
    expect(judge(taken, 'handover').ok).toBe(true);
    expect(judge(signed060, 'handover').ok).toBe(false);
  });

  test('every failure says which artifact and which requirement, never just "failed"', () => {
    const r = judge({ ...signed060, dmgSigned: false, appChainSigned: false }, 'coexist');
    expect(r.ok).toBe(false);
    const text = r.lines.join('\n');
    expect(text).toContain('DMG');
    expect(text).toContain('.app');
    expect(text).toContain(TEAM_ID);
  });
});
