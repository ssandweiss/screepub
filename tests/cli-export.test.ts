import { afterAll, describe, test, expect, beforeEach, afterEach } from 'bun:test';
import {
  mkdtempSync,
  mkdirSync,
  rmSync,
  writeFileSync,
  readFileSync,
  readdirSync,
  existsSync,
  statSync,
  utimesSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { exportCommand } from '../src/cli-export';
import { availableFormats, type FreshKindleArtifactOptions } from '../src/export/artifact';
import { isCalibreAvailable } from '../src/export/calibre';
import type { KfxStatus } from '../src/export/kfx';

const SCRATCH = mkdtempSync(join(tmpdir(), 'screepub-cli-export-'));
afterAll(() => rmSync(SCRATCH, { recursive: true, force: true }));

const kfxReadyStatus: KfxStatus = { calibre: true, previewer: true, pluginInstalled: true, ready: true };
const calibreOnlyStatus: KfxStatus = { calibre: true, previewer: false, pluginInstalled: false, ready: false };
const noToolchainStatus: KfxStatus = { calibre: false, previewer: false, pluginInstalled: false, ready: false };

let dir: string;
let epub: string;
let fountain: string;

beforeEach(async () => {
  dir = mkdtempSync(join(SCRATCH, 'export-'));
  epub = join(dir, 'Script.epub');
  fountain = join(dir, 'Script.fountain');
  writeFileSync(fountain, 'INT. ROOM - DAY\n\nMARGO\nHello.\n');
  // A real EPUB, produced by the engine, so the ladder has something honest
  // to work from rather than a stub that every branch would reject.
  Bun.spawnSync(['bun', 'src/cli.ts', fountain, '--json', '-o', epub]);
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe('exportCommand', () => {
  test('epub is always available and is returned as itself', async () => {
    const result = await exportCommand({ epub, for: 'epub' });
    expect(result.path).toBe(epub);
    expect(result.format).toBe('epub');
    expect(result.extension).toBe('epub');
    // The label is the user-facing sentence; asserting it catches a wrapper
    // that invented its own wording instead of using formats.ts'.
    expect(result.label).toContain('for emailing to Kindle');
    expect(result.available).toContain('epub');
  });

  // The `epub` rung does no ladder work at all — a wrapper that fabricates
  // a stage ("selecting epub…") for a format that never touches the ladder
  // would pass every other assertion here.
  test('epub format does no ladder work, so it reports no stages', async () => {
    const result = await exportCommand({ epub, for: 'epub' });
    expect(result.stages).toEqual([]);
  });

  // The wrapper must not invent or hardcode its own idea of what this
  // machine can produce — it has to be exactly what availableFormats says,
  // computed with the SAME real calibreAvailable this process sees. A
  // wrapper that always answered ['epub', 'kindle'] (or always just
  // ['epub']) regardless of the machine would fail this on whichever
  // environment disagrees with its hardcoded answer.
  test('available is exactly availableFormats for this machine, not a hardcoded list', async () => {
    const result = await exportCommand({ epub, for: 'epub' });
    expect(result.available).toEqual(availableFormats(epub, isCalibreAvailable()));
  });

  // --- Kindle rung selection, driven deterministically through the seam ---
  //
  // freshKindleArtifact's own staleness rules and toolchain-error mapping
  // are already covered by tests/export-artifact.test.ts. What belongs to
  // THIS wrapper is: does it probe the right things, thread the resulting
  // state INTO the ladder, and report the extension/label/stages that state
  // implies? Injecting calibreAvailable/kfxStatus lets every rung be
  // asserted on every machine, regardless of what's actually installed —
  // real Calibre on Linux checks fixed paths before PATH (calibreTool's
  // candidatePaths), so a genuine install can't be shadowed the way the
  // rest of the codebase shadows a missing one.

  test('kindle rung: KFX ready selects the KFX rung', async () => {
    const fakeKfx = join(dir, 'Script.kfx');
    writeFileSync(fakeKfx, 'fake-kfx-bytes');
    const seen: { opts?: FreshKindleArtifactOptions } = {};
    const result = await exportCommand(
      { epub, for: 'kindle', fountain },
      {
        calibreAvailable: () => true,
        kfxStatus: async () => kfxReadyStatus,
        freshKindleArtifact: async (opts) => {
          seen.opts = opts;
          opts.onStage?.('converting to KFX (Kindle Previewer can take ~20s to start)…');
          return fakeKfx;
        },
      },
    );
    // The ladder must be HANDED the ready state, not just told it exists —
    // a wrapper that forgot to thread kfxReady through picks a rung the
    // ladder never agreed to.
    expect(seen.opts?.kfxReady).toBe(true);
    expect(seen.opts?.calibreAvailable).toBe(true);
    expect(result.path).toBe(fakeKfx);
    expect(result.extension).toBe('kfx');
    expect(result.label).toContain('best quality');
    expect(result.stages.join(' ')).toContain('KFX');
  });

  test('kindle rung: Calibre present without KFX selects the AZW3 rung', async () => {
    const fakeAzw3 = join(dir, 'Script.azw3');
    writeFileSync(fakeAzw3, 'fake-azw3-bytes');
    const seen: { opts?: FreshKindleArtifactOptions } = {};
    const result = await exportCommand(
      { epub, for: 'kindle', fountain },
      {
        calibreAvailable: () => true,
        kfxStatus: async () => calibreOnlyStatus,
        freshKindleArtifact: async (opts) => {
          seen.opts = opts;
          opts.onStage?.('converting to AZW3 for Kindle…');
          return fakeAzw3;
        },
      },
    );
    expect(seen.opts?.kfxReady).toBe(false);
    expect(seen.opts?.calibreAvailable).toBe(true);
    expect(result.path).toBe(fakeAzw3);
    expect(result.extension).toBe('azw3');
    expect(result.label).not.toContain('best quality');
    expect(result.stages.join(' ')).toContain('AZW3');
  });

  test('kindle rung: neither Calibre nor KFX rebuilds a real MOBI from the .fountain', async () => {
    // The bottom rung needs no external toolchain at all — convertFountain
    // is the engine's own pure-TS code, not Calibre — so this runs through
    // the REAL ladder (no freshKindleArtifact fake) with only the PROBE
    // results forced via the seam, proving the wrapper's own detection
    // actually drives rung selection, not just its plumbing.
    const result = await exportCommand(
      { epub, for: 'kindle', fountain, optionsJson: '{"showSceneNumbers":true}' },
      { calibreAvailable: () => false, kfxStatus: async () => noToolchainStatus },
    );
    expect(result.extension).toBe('mobi');
    expect(result.path).toBe(join(dir, 'Script.mobi'));
    expect(existsSync(result.path)).toBe(true);
    expect(result.stages.join(' ')).toContain('rebuilding');
  });

  test('kindle rung: neither Calibre nor an existing .mobi refuses deterministically', async () => {
    let message = '';
    try {
      await exportCommand(
        { epub, for: 'kindle' }, // no fountain: the bottom rung cannot rebuild
        { calibreAvailable: () => false, kfxStatus: async () => noToolchainStatus },
      );
    } catch (err) {
      message = (err as Error).message;
    }
    expect(message).toMatch(/\.fountain/);
  });

  // Names the exact defect this piece is guarding against: a wrapper (or a
  // ladder call site) that reuses whatever sits beside the EPUB without
  // checking the staleness rule. Forced onto the MOBI rung via the seam, so
  // this asserts on every machine rather than self-skipping wherever real
  // Calibre happens to be installed.
  test('a stale .mobi beside the EPUB is rebuilt, not returned as-is', async () => {
    const mobiPath = join(dir, 'Script.mobi');
    writeFileSync(mobiPath, 'stale-placeholder');
    const past = new Date(Date.now() - 60_000);
    utimesSync(mobiPath, past, past); // older than the epub -> stale

    const result = await exportCommand(
      { epub, for: 'kindle', fountain },
      { calibreAvailable: () => false, kfxStatus: async () => noToolchainStatus },
    );
    expect(result.extension).toBe('mobi');
    expect(result.path).toBe(mobiPath);
    expect(readFileSync(result.path, 'utf8')).not.toBe('stale-placeholder');
    expect(result.stages.join(' ')).toContain('rebuilding');
  });

  // The inverse: a FRESH .mobi must be reused with NO stages at all — a
  // wrapper that fabricates a "reusing…" stage the ladder itself never
  // emits (freshKindleArtifact returns the cached path with no onStage
  // call) would fail this. Also forced deterministic via the seam.
  test('a fresh .mobi beside the EPUB is reused with no invented stages', async () => {
    const mobiPath = join(dir, 'Script.mobi');
    writeFileSync(mobiPath, 'already-built');
    const now = new Date();
    utimesSync(epub, new Date(now.getTime() - 10_000), new Date(now.getTime() - 10_000));
    utimesSync(mobiPath, now, now);

    const result = await exportCommand(
      { epub, for: 'kindle', fountain },
      { calibreAvailable: () => false, kfxStatus: async () => noToolchainStatus },
    );
    expect(result.extension).toBe('mobi');
    expect(result.path).toBe(mobiPath);
    expect(readFileSync(result.path, 'utf8')).toBe('already-built');
    expect(result.stages).toEqual([]);
  });

  // The one test in this file that genuinely cannot be made deterministic:
  // confirming the REAL, non-injected production path (real
  // isCalibreAvailable, real kfxStatus, real freshKindleArtifact) produces
  // a genuine file when a real toolchain is present requires that real
  // toolchain to actually run and emit bytes — no seam can substitute for
  // that without testing a fake instead of the real wiring it exists to
  // exercise. It never SKIPS — there is always an answer, either a real
  // file or a message naming Calibre/Kindle — it just can't pin which
  // branch runs, because that is a property of the machine, not the code.
  test('kindle rung on the real, non-injected toolchain: a real file, or a named reason', async () => {
    const result = await exportCommand({ epub, for: 'kindle', fountain }).catch((e) => e);
    if (result instanceof Error) {
      expect(result.message).toMatch(/Calibre|Kindle/);
    } else {
      expect(existsSync(result.path)).toBe(true);
      expect(['kfx', 'azw3', 'mobi']).toContain(result.extension);
    }
    // 2 minutes, not bun's default 5 seconds, and the difference is not
    // slack: where the toolchain is ABSENT this refuses in about a second,
    // but where it is PRESENT it really converts. Measured 2026-09-14 on an
    // M-series Mac with Calibre + the KFX plugin + Kindle Previewer: 21s to
    // a real .kfx, most of it Previewer's cold start, which Amazon ships
    // x86_64-only so it comes up under Rosetta. CI has no Calibre and takes
    // the fast refusal, so this budget costs nothing there -- it exists so
    // the suite is green on a developer machine that has the tools, rather
    // than punishing the only machines that can exercise this path at all.
  }, 120_000);

  test('a missing EPUB is unreadable, not a ladder failure', async () => {
    let code = '';
    try {
      await exportCommand({ epub: join(dir, 'nope.epub'), for: 'kindle' });
    } catch (err) {
      code = (err as { code: string }).code;
    }
    expect(code).toBe('unreadable');
  });

  // The file check has to run BEFORE any toolchain probe or ladder call:
  // an implementation that asked Calibre or the ladder first and only
  // mapped ENOENT afterward could still land on 'unreadable' by accident,
  // but it would also spend the ~1s Calibre probe on a plain typo. This
  // pins the message too, so a wrapper that got the right code from the
  // wrong path (e.g. re-threw the ladder's own ENOENT) still has to name
  // the file.
  test('a missing EPUB names the path, not a generic ladder complaint', async () => {
    const missing = join(dir, 'nope.epub');
    let message = '';
    try {
      await exportCommand({ epub: missing, for: 'kindle' });
    } catch (err) {
      message = (err as Error).message;
    }
    expect(message).toContain(missing);
  });

  test('an unknown --for is a usage error naming the two it accepts', async () => {
    let message = '';
    try {
      await exportCommand({ epub, for: 'pdf' });
    } catch (err) {
      message = (err as Error).message;
    }
    expect(message).toContain('epub');
    expect(message).toContain('kindle');
  });

  // Fix round 1: readFormat's own CliError('bad-options', …) was being
  // evaluated INSIDE the try that wraps the ladder call, so the catch's
  // unconditional `throw new CliError('export-failed', errorMessage(err))`
  // rewrapped it — right message, wrong code, and code is what a UI
  // branches on. Asserts the CODE, not just the message (a message-only
  // check passed against the bug), and proves the ladder is never even
  // reached: an injected fake that recorded a call would fail this if
  // readFormat's throw were still happening too late.
  test('malformed --options-json is bad-options, not export-failed', async () => {
    let ladderCalled = false;
    let error: unknown;
    try {
      await exportCommand(
        { epub, for: 'kindle', fountain, optionsJson: 'not json' },
        {
          calibreAvailable: () => true,
          kfxStatus: async () => calibreOnlyStatus,
          freshKindleArtifact: async () => {
            ladderCalled = true;
            return join(dir, 'Script.azw3');
          },
        },
      );
    } catch (err) {
      error = err;
    }
    expect((error as { code?: string } | undefined)?.code).toBe('bad-options');
    expect((error as Error | undefined)?.message).toContain('--options-json');
    expect(ladderCalled).toBe(false);
  });

  test('--options-json that parses but is not a JSON object is also bad-options', async () => {
    let code = '';
    try {
      await exportCommand({ epub, for: 'kindle', fountain, optionsJson: '[1,2,3]' });
    } catch (err) {
      code = (err as { code: string }).code;
    }
    expect(code).toBe('bad-options');
  });

  // The same rewrap could in principle swallow ANY CliError raised while a
  // kindle export is being resolved. 'unreadable' is thrown before the
  // toolchain is even probed, so it must win regardless of what else about
  // the request is also wrong — a malformed --options-json here must not
  // turn into 'bad-options' OR 'export-failed' ahead of the more
  // fundamental problem: there is no file to export at all.
  test('a missing EPUB is unreadable even when --options-json is also malformed', async () => {
    let code = '';
    try {
      await exportCommand({
        epub: join(dir, 'nope.epub'), for: 'kindle', optionsJson: 'not json',
      });
    } catch (err) {
      code = (err as { code: string }).code;
    }
    expect(code).toBe('unreadable');
  });
});

describe('screepub export (through the CLI)', () => {
  test('--json prints one object with the path and the available formats', () => {
    const proc = Bun.spawnSync(['bun', 'src/cli.ts', 'export', epub, '--for', 'epub', '--json']);
    const stdout = proc.stdout.toString();
    expect(stdout.trim().split('\n')).toHaveLength(1);
    const answer = JSON.parse(stdout);
    expect(answer.ok).toBe(true);
    expect(answer.path).toBe(epub);
    expect(answer.available).toContain('epub');
  });

  test('a failure is one JSON object with export-failed or unreadable', () => {
    const proc = Bun.spawnSync(['bun', 'src/cli.ts', 'export',
      join(dir, 'nope.epub'), '--for', 'kindle', '--json']);
    expect(proc.exitCode).toBe(1);
    const stdout = proc.stdout.toString();
    expect(stdout.trim().split('\n')).toHaveLength(1);
    const answer = JSON.parse(stdout);
    expect(answer.ok).toBe(false);
    expect(['unreadable', 'export-failed']).toContain(answer.error.code);
    // The exact contract shape: {code, message} and nothing stray riding
    // along that the app's decoder would choke on.
    expect(Object.keys(answer.error).sort()).toEqual(['code', 'message']);
    expect(typeof answer.error.message).toBe('string');
    expect(answer.error.message.length).toBeGreaterThan(0);
  });

  // The filename-shadowing rule (resolveCommand's, inherited by every verb):
  // a bare word is a verb only when no file of that name exists. Bare verb
  // word as argv[0], cwd pointing at the shadow file's directory — passing
  // an absolute path here would never match the verb string and silently
  // test nothing (the trap this piece has hit twice already).
  test('a file literally named `export` shadows the verb and is not converted', () => {
    const shadow = join(dir, 'export');
    writeFileSync(shadow, 'not a screenplay');
    const cliPath = join(process.cwd(), 'src', 'cli.ts');
    const proc = Bun.spawnSync(['bun', cliPath, 'export', '--json'], { cwd: dir });
    // Dispatched as `convert` on the shadow file, not the export verb: it
    // must NOT fail with export's usage error ("expected exactly one .epub").
    const stdout = proc.stdout.toString();
    const answer = JSON.parse(stdout);
    expect(answer.ok).toBe(false);
    expect(answer.error.code).not.toBe('usage');
  });
});

describe('--options-json validity does not depend on --for', () => {
  // The epub rung ignores the option VALUES — it converts nothing — but a
  // window sending malformed JSON must hear the same code either way.
  // Before this, `--for epub` returned before readFormat ran, so the same
  // argv was accepted on one rung and rejected on the other: a contract that
  // is valid or invalid depending on a second flag is one a UI cannot trust.
  test('malformed JSON is bad-options on the epub rung too', async () => {
    await expect(
      exportCommand({ epub, for: 'epub', optionsJson: '{oops' }),
    ).rejects.toMatchObject({ code: 'bad-options' });
  });

  test('malformed JSON is bad-options on the kindle rung', async () => {
    await expect(
      exportCommand(
        { epub, for: 'kindle', optionsJson: '{oops' },
        { calibreAvailable: () => false, kfxStatus: async () => noToolchainStatus },
      ),
    ).rejects.toMatchObject({ code: 'bad-options' });
  });
});

// --out: the window's save dialog raises the dialog and hands the engine an
// absolute path; the window never writes a file itself. This is the only
// place a copy of the artifact reaches a spot the user actually chose.
describe('exportCommand --out', () => {
  test('epub is copied to a new nested absolute path: parents created, bytes equal, answer path is out', async () => {
    const out = join(dir, 'nested', 'deeper', 'Saved.epub');
    const result = await exportCommand({ epub, for: 'epub', out });
    expect(result.path).toBe(out);
    expect(existsSync(out)).toBe(true);
    expect(readFileSync(out).equals(readFileSync(epub))).toBe(true);
  });

  test('a relative --out is refused on the epub rung, naming "absolute"', async () => {
    // Run with cwd inside SCRATCH: were the absolute check ever bypassed (a
    // regression, or a mutant), a relative path resolves against cwd and
    // would otherwise land in whatever directory happened to be current,
    // which must never be the repo itself.
    const before = process.cwd();
    process.chdir(dir);
    let error: unknown;
    try {
      await exportCommand({ epub, for: 'epub', out: 'relative.epub' });
    } catch (err) {
      error = err;
    } finally {
      process.chdir(before);
    }
    expect((error as { code?: string } | undefined)?.code).toBe('usage');
    expect((error as Error | undefined)?.message).toContain('absolute');
  });

  // The point of this one: the absolute check must fire before Calibre's
  // probe or the ladder ever runs, not merely before the ladder SUCCEEDS.
  // An injected ladder that records its own calls is the only way to prove
  // zero of them happened, rather than merely that the visible answer was
  // an error.
  test('a relative --out is refused before the kindle ladder runs, zero ladder calls', async () => {
    const before = process.cwd();
    process.chdir(dir); // see the note above: keep any stray write inside SCRATCH
    let ladderCalls = 0;
    let calibreCalls = 0;
    let error: unknown;
    try {
      await exportCommand(
        { epub, for: 'kindle', fountain, out: 'relative/path.mobi' },
        {
          calibreAvailable: () => {
            calibreCalls++;
            return false;
          },
          kfxStatus: async () => noToolchainStatus,
          freshKindleArtifact: async () => {
            ladderCalls++;
            return join(dir, 'Script.mobi');
          },
        },
      );
    } catch (err) {
      error = err;
    } finally {
      process.chdir(before);
    }
    expect((error as { code?: string } | undefined)?.code).toBe('usage');
    expect((error as Error | undefined)?.message).toContain('absolute');
    expect(calibreCalls).toBe(0);
    expect(ladderCalls).toBe(0);
  });

  test('the wrong extension for epub is refused before any copy, naming .epub', async () => {
    const out = join(dir, 'Saved.mobi');
    let error: unknown;
    try {
      await exportCommand({ epub, for: 'epub', out });
    } catch (err) {
      error = err;
    }
    expect((error as { code?: string } | undefined)?.code).toBe('usage');
    expect((error as Error | undefined)?.message).toContain('.epub');
    expect(existsSync(out)).toBe(false);
  });

  test('kindle rung: out ending in the produced extension (.azw3) copies', async () => {
    const fakeAzw3 = join(dir, 'Script.azw3');
    writeFileSync(fakeAzw3, 'fake-azw3-bytes');
    const out = join(dir, 'ForKindle.azw3');
    const result = await exportCommand(
      { epub, for: 'kindle', fountain, out },
      {
        calibreAvailable: () => true,
        kfxStatus: async () => calibreOnlyStatus,
        freshKindleArtifact: async () => fakeAzw3,
      },
    );
    expect(result.path).toBe(out);
    expect(readFileSync(out, 'utf8')).toBe('fake-azw3-bytes');
  });

  // The extension is only known once the ladder answers: this is a rung
  // that would have made an .azw3, refused a save name ending .kfx, naming
  // the extension it actually would have produced.
  test('kindle rung: out ending .kfx is refused naming .azw3, after the ladder ran', async () => {
    const fakeAzw3 = join(dir, 'Script.azw3');
    writeFileSync(fakeAzw3, 'fake-azw3-bytes');
    const out = join(dir, 'ForKindle.kfx');
    let ladderCalls = 0;
    let error: unknown;
    try {
      await exportCommand(
        { epub, for: 'kindle', fountain, out },
        {
          calibreAvailable: () => true,
          kfxStatus: async () => calibreOnlyStatus,
          freshKindleArtifact: async () => {
            ladderCalls++;
            return fakeAzw3;
          },
        },
      );
    } catch (err) {
      error = err;
    }
    expect((error as { code?: string } | undefined)?.code).toBe('usage');
    expect((error as Error | undefined)?.message).toContain('.azw3');
    // Unlike the relative-path check, the extension cannot be known until
    // the ladder has already run once: it fired exactly once, not zero.
    expect(ladderCalls).toBe(1);
    expect(existsSync(out)).toBe(false);
  });

  test('an existing file at out is replaced', async () => {
    const out = join(dir, 'Existing.epub');
    writeFileSync(out, 'stale-bytes-that-must-go');
    const result = await exportCommand({ epub, for: 'epub', out });
    expect(result.path).toBe(out);
    expect(readFileSync(out).equals(readFileSync(epub))).toBe(true);
  });

  test('no temp file is left beside the destination on success', async () => {
    const destDir = join(dir, 'clean-success');
    mkdirSync(destDir);
    const out = join(destDir, 'Saved.epub');
    await exportCommand({ epub, for: 'epub', out });
    expect(readdirSync(destDir)).toEqual(['Saved.epub']);
  });

  // Forces the copy's own rename to fail (a directory sits where the file
  // must go) so the catch-and-unlink path actually runs, not just the happy
  // path's implicit cleanup-by-rename.
  test('no temp file is left beside the destination on failure, and it answers export-failed', async () => {
    const destDir = join(dir, 'clean-failure');
    mkdirSync(destDir);
    const out = join(destDir, 'Saved.epub');
    mkdirSync(out);
    let error: unknown;
    try {
      await exportCommand({ epub, for: 'epub', out });
    } catch (err) {
      error = err;
    }
    expect((error as { code?: string } | undefined)?.code).toBe('export-failed');
    expect(readdirSync(destDir)).toEqual(['Saved.epub']);
  });

  test('out equal to the epub artifact\'s own path answers without copying', async () => {
    const past = new Date(Date.now() - 60_000);
    utimesSync(epub, past, past);
    const result = await exportCommand({ epub, for: 'epub', out: epub });
    expect(result.path).toBe(epub);
    // A copy-then-rename over itself would still succeed, but it would also
    // give the file a fresh mtime; this is the only way from outside to
    // tell "answered without touching it" from "copied it onto itself".
    expect(statSync(epub).mtime.getTime()).toBe(past.getTime());
  });

  test('kindle rung: out equal to the produced path answers without copying', async () => {
    const fakeAzw3 = join(dir, 'Script.azw3');
    writeFileSync(fakeAzw3, 'fake-azw3-bytes');
    const past = new Date(Date.now() - 60_000);
    utimesSync(fakeAzw3, past, past);
    const result = await exportCommand(
      { epub, for: 'kindle', fountain, out: fakeAzw3 },
      {
        calibreAvailable: () => true,
        kfxStatus: async () => calibreOnlyStatus,
        freshKindleArtifact: async () => fakeAzw3,
      },
    );
    expect(result.path).toBe(fakeAzw3);
    expect(statSync(fakeAzw3).mtime.getTime()).toBe(past.getTime());
  });

  // A behavioral test cannot easily force a mid-copy interruption, so this
  // pins the mechanism at the source: the copy goes through a temp name in
  // the destination folder and a rename, never a direct write onto `out`.
  // Mirrors how tests/cli-kfx.test.ts already pins its own branch's shape.
  test('the copy goes through a temp name and a rename, not a direct write', () => {
    const src = readFileSync(new URL('../src/cli-export.ts', import.meta.url), 'utf8');
    expect(src).toMatch(/\.tmp`\);/);
    expect(src).toMatch(/await rename\(tmp, destination\)/);
  });
});

describe('screepub export --out (through the CLI)', () => {
  test('epub to a new absolute path, through the spawned CLI', () => {
    const out = join(dir, 'cli-nested', 'Saved.epub');
    const proc = Bun.spawnSync(['bun', 'src/cli.ts', 'export', epub, '--for', 'epub', '--out', out, '--json']);
    const answer = JSON.parse(proc.stdout.toString());
    expect(answer.ok).toBe(true);
    expect(answer.path).toBe(out);
    expect(existsSync(out)).toBe(true);
  });

  test('export --help mentions --out', () => {
    const proc = Bun.spawnSync(['bun', 'src/cli.ts', 'export', '--help', '--json']);
    const answer = JSON.parse(proc.stdout.toString());
    expect(answer.ok).toBe(true);
    expect(answer.usage).toContain('--out');
  });
});

// Every OTHER verb must refuse --out, the same way every verb but export
// already refuses --for and --fountain. Task 6 adds `route`, which also
// accepts it; until then export is the only owner.
describe('every other verb refuses --out', () => {
  test('devices --out is a usage error naming export and route', () => {
    const proc = Bun.spawnSync(['bun', 'src/cli.ts', 'devices', '--out', '/tmp/x.epub', '--json']);
    const answer = JSON.parse(proc.stdout.toString());
    expect(answer.ok).toBe(false);
    expect(answer.error.code).toBe('usage');
    expect(answer.error.message).toContain('--out belongs to export and route');
  });

  test('send <file> --out is a usage error naming export and route', () => {
    const proc = Bun.spawnSync(['bun', 'src/cli.ts', 'send', epub, '--out', '/tmp/x.epub', '--json']);
    const answer = JSON.parse(proc.stdout.toString());
    expect(answer.ok).toBe(false);
    expect(answer.error.code).toBe('usage');
    expect(answer.error.message).toContain('--out belongs to export and route');
  });

  test('settings <file> --out is a usage error naming export and route', () => {
    const proc = Bun.spawnSync(['bun', 'src/cli.ts', 'settings', fountain, '--out', '/tmp/x.epub', '--json']);
    const answer = JSON.parse(proc.stdout.toString());
    expect(answer.ok).toBe(false);
    expect(answer.error.code).toBe('usage');
    expect(answer.error.message).toContain('--out belongs to export and route');
  });

  test('kfx-status --out is a usage error naming export and route', () => {
    const proc = Bun.spawnSync(['bun', 'src/cli.ts', 'kfx-status', '--out', '/tmp/x.epub', '--json']);
    const answer = JSON.parse(proc.stdout.toString());
    expect(answer.ok).toBe(false);
    expect(answer.error.code).toBe('usage');
    expect(answer.error.message).toContain('--out belongs to export and route');
  });

  // Safe to spawn: the refusal sits ahead of kfxInstallCommand() in cli.ts
  // (tests/cli-kfx.test.ts pins that order), so this exits on the usage
  // error before the installer ever touches the network or Calibre.
  test('kfx-install --out is a usage error naming export and route, before installing anything', () => {
    const proc = Bun.spawnSync(['bun', 'src/cli.ts', 'kfx-install', '--out', '/tmp/x.epub', '--json']);
    const answer = JSON.parse(proc.stdout.toString());
    expect(answer.ok).toBe(false);
    expect(answer.error.code).toBe('usage');
    expect(answer.error.message).toContain('--out belongs to export and route');
  });

  test('update-decision --out is a usage error naming export and route', () => {
    const proc = Bun.spawnSync([
      'bun', 'src/cli.ts', 'update-decision',
      '--offered', '0.7.0', '--current', '0.6.0', '--out', '/tmp/x.epub', '--json',
    ]);
    const answer = JSON.parse(proc.stdout.toString());
    expect(answer.ok).toBe(false);
    expect(answer.error.code).toBe('usage');
    expect(answer.error.message).toContain('--out belongs to export and route');
  });

  test('update-should-check --out is a usage error naming export and route', () => {
    const proc = Bun.spawnSync(['bun', 'src/cli.ts', 'update-should-check', '--out', '/tmp/x.epub', '--json']);
    const answer = JSON.parse(proc.stdout.toString());
    expect(answer.ok).toBe(false);
    expect(answer.error.code).toBe('usage');
    expect(answer.error.message).toContain('--out belongs to export and route');
  });
});
