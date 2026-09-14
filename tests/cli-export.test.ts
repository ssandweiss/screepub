import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync, utimesSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { exportCommand } from '../src/cli-export';
import { availableFormats } from '../src/export/artifact';
import { isCalibreAvailable } from '../src/export/calibre';

let dir: string;
let epub: string;
let fountain: string;

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), 'screepub-export-'));
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

  test('kindle with no Calibre and no .mobi says what is missing, not "failed"', async () => {
    const result = await exportCommand({ epub, for: 'kindle', fountain }).catch((e) => e);
    if (result instanceof Error) {
      expect(result.message).toMatch(/Calibre|Kindle/);
    } else {
      // On a machine that CAN build one, it must be a real file beside the EPUB.
      expect(existsSync(result.path)).toBe(true);
      expect(['kfx', 'azw3', 'mobi']).toContain(result.extension);
    }
  });

  test('kindle without Calibre rebuilds a MOBI from the .fountain', async () => {
    // The bottom rung, which needs no external toolchain and so is the one
    // branch that is deterministic on every machine this runs on.
    const result = await exportCommand({
      epub, for: 'kindle', fountain,
      optionsJson: '{"showSceneNumbers":true}',
    });
    if (result.extension !== 'mobi') return; // Calibre present: covered above
    expect(existsSync(result.path)).toBe(true);
    expect(result.path).toBe(join(dir, 'Script.mobi'));
    expect(result.stages.join(' ')).toContain('rebuilding');
  });

  // Names the exact defect this piece is guarding against: a wrapper that
  // reuses whatever sits beside the EPUB without checking the ladder's own
  // staleness rule. Only exercised on a machine with no Calibre (where the
  // MOBI rung is reachable at all) — self-skips elsewhere, same as the test
  // above.
  test('a stale .mobi beside the EPUB is rebuilt, not returned as-is', async () => {
    const mobiPath = join(dir, 'Script.mobi');
    writeFileSync(mobiPath, 'stale-placeholder');
    const past = new Date(Date.now() - 60_000);
    utimesSync(mobiPath, past, past); // older than the epub -> stale

    const result = await exportCommand({ epub, for: 'kindle', fountain });
    if (result.extension !== 'mobi') return; // Calibre present: azw3 rung instead
    expect(result.path).toBe(mobiPath);
    expect(readFileSync(result.path, 'utf8')).not.toBe('stale-placeholder');
    expect(result.stages.join(' ')).toContain('rebuilding');
  });

  // The inverse: a FRESH .mobi must be reused with NO stages at all — a
  // wrapper that fabricates a "reusing…" stage the ladder itself never
  // emits (freshKindleArtifact returns the cached path with no onStage
  // call) would fail this.
  test('a fresh .mobi beside the EPUB is reused with no invented stages', async () => {
    const mobiPath = join(dir, 'Script.mobi');
    writeFileSync(mobiPath, 'already-built');
    const now = new Date();
    utimesSync(epub, new Date(now.getTime() - 10_000), new Date(now.getTime() - 10_000));
    utimesSync(mobiPath, now, now);

    const result = await exportCommand({ epub, for: 'kindle', fountain });
    if (result.extension !== 'mobi') return; // Calibre present: azw3 rung instead
    expect(result.path).toBe(mobiPath);
    expect(readFileSync(result.path, 'utf8')).toBe('already-built');
    expect(result.stages).toEqual([]);
  });

  test('kindle with no .fountain and no Calibre refuses with a reason', async () => {
    let message = '';
    try {
      await exportCommand({ epub, for: 'kindle' });
    } catch (err) {
      message = (err as Error).message;
    }
    // Either rung may answer depending on the machine; both must name a cause.
    expect(message === '' || /\.fountain|Calibre|Kindle/.test(message)).toBe(true);
  });

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
