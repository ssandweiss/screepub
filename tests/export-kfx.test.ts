import { afterAll, describe, test, expect } from 'bun:test';
import { mkdtempSync, writeFileSync, readFileSync, chmodSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, delimiter } from 'node:path';
import { platform } from 'node:process';
import {
  installKfxPlugin,
  previewerPath,
  kfxStatus,
  toKfx,
  kfxSibling,
  kfxScratchPath,
  computeReady,
  KfxToolchainNotReadyError,
} from '../src/export/kfx';
import { calibreTool, CALIBRE_FORMAT_GUARDS } from '../src/export/calibre';

const SCRATCH = mkdtempSync(join(tmpdir(), 'screepub-export-kfx-'));
afterAll(() => rmSync(SCRATCH, { recursive: true, force: true }));

test('Kindle Previewer is never found on Linux — Amazon ships no build', () => {
  if (platform === 'linux') expect(previewerPath()).toBeNull();
});

test('status.ready requires all three pieces', async () => {
  const status = await kfxStatus();
  expect(status.ready).toBe(status.calibre && status.previewer && status.pluginInstalled);
});

// computeReady: the AND behind `ready`, tested directly with synthetic
// booleans. This is what makes the conjunction provable on Linux, where
// `previewer` can never actually be true (Amazon ships no build) so the
// test above can never distinguish a correct three-way AND from a buggy
// two-way one. Each single-false case pins one term; a mutant dropping any
// one term from the AND fails at least one of these.
test('computeReady is true only when calibre, previewer, and pluginInstalled are all true', () => {
  expect(computeReady({ calibre: true, previewer: true, pluginInstalled: true })).toBe(true);
});

test('computeReady is false when calibre is false', () => {
  expect(computeReady({ calibre: false, previewer: true, pluginInstalled: true })).toBe(false);
});

test('computeReady is false when previewer is false', () => {
  expect(computeReady({ calibre: true, previewer: false, pluginInstalled: true })).toBe(false);
});

test('computeReady is false when pluginInstalled is false', () => {
  expect(computeReady({ calibre: true, previewer: true, pluginInstalled: false })).toBe(false);
});

test('status.calibre agrees with Calibre discovery', async () => {
  const status = await kfxStatus();
  expect(status.calibre).toBe(calibreTool('calibre-customize') !== null);
});

test('pluginInstalled is false whenever Calibre is absent', async () => {
  // The plugin lives inside Calibre, so it cannot be installed without it.
  const status = await kfxStatus();
  if (!status.calibre) expect(status.pluginInstalled).toBe(false);
});

test('on Linux the KFX rung is never ready, so the ladder degrades', async () => {
  if (platform === 'linux') expect((await kfxStatus()).ready).toBe(false);
});

test('toKfx refuses outright when Calibre is absent', async () => {
  // The conversion itself cannot be exercised without Kindle Previewer, which
  // Amazon ships for macOS and Windows only — that path is covered by the
  // hardware pass in piece C. What IS testable everywhere is that it fails
  // honestly rather than reporting success with no file.
  if (calibreTool('ebook-convert')) return;
  await expect(toKfx(join(SCRATCH, 'nonexistent.epub'))).rejects.toThrow(
    'ebook-convert was not found',
  );
});

// --- kfxSibling: exported per the controller ruling so a later task (the
// export ladder) imports this derivation instead of repeating the regex.
// Mirrors Export.swift's mobiSibling(for:) precedent.

test('kfxSibling derives same directory, same stem, .kfx extension', () => {
  expect(kfxSibling('/tmp/book.epub')).toBe('/tmp/book.kfx');
});

test('kfxSibling matches the extension case-insensitively', () => {
  expect(kfxSibling('/tmp/Book.EPUB')).toBe('/tmp/Book.kfx');
});

// --- toKfx driven for real against a fake ebook-convert. The tool and the
// status probe are injected rather than PATH-shadowed, because this machine
// (and any machine with Calibre installed) resolves ebook-convert from a
// fixed install path before PATH, and because `ready` can never be true on
// Linux. Everything else — argv, the scratch file, the rename — is real.

function fakeEbookConvert(): { tool: string; argvLog: string; workDir: string } {
  const toolDir = mkdtempSync(join(SCRATCH, 'kfx-fake-'));
  const name = platform === 'win32' ? 'ebook-convert.exe' : 'ebook-convert';
  const tool = join(toolDir, name);
  const argvLog = join(toolDir, 'argv.log');
  // Logs argv one entry per line, then touches the output path it was told
  // to write — mimicking ebook-convert's own file creation.
  writeFileSync(tool, `#!/bin/sh\nfor a in "$@"; do echo "$a"; done > "${argvLog}"\ntouch "$2"\n`);
  chmodSync(tool, 0o755);
  const workDir = mkdtempSync(join(SCRATCH, 'kfx-work-'));
  return { tool, argvLog, workDir };
}

const READY: Awaited<ReturnType<typeof kfxStatus>> = {
  calibre: true,
  previewer: true,
  pluginInstalled: true,
  ready: true,
};

test('toKfx writes to a .kfx scratch path and renames it onto kfxSibling', async () => {
  // Regression pin for the defect that made toKfx unrunnable: the scratch
  // path ended in `.tmp`, and ebook-convert picks its OUTPUT FORMAT from the
  // extension ("ValueError: No plugin to handle output format: tmp").
  // Verified against Calibre 8.7.0. This is the third time in this branch
  // that Calibre's extension rule has bitten, hence a test and not a comment.
  if (platform === 'win32') return; // the fake tool is a /bin/sh script
  const { tool, argvLog, workDir } = fakeEbookConvert();
  const epub = join(workDir, 'book.epub');
  writeFileSync(epub, 'fake epub bytes');

  const out = await toKfx(epub, undefined, { tool: () => tool, status: async () => READY });

  expect(out).toBe(kfxSibling(epub));
  const argv = readFileSync(argvLog, 'utf8').split('\n').filter(Boolean);
  expect(argv[0]).toBe(epub);
  expect(argv[1].endsWith('.kfx')).toBe(true);
  expect(argv[1]).toBe(kfxScratchPath(epub));
  expect(argv.slice(2)).toEqual([...CALIBRE_FORMAT_GUARDS]);
  expect(existsSync(kfxScratchPath(epub))).toBe(false); // renamed away
  expect(existsSync(out)).toBe(true);
});

test('the scratch path is hidden, same-directory, and keeps the .kfx extension', () => {
  expect(kfxScratchPath('/tmp/dir/Book.EPUB')).toBe('/tmp/dir/.Book.partial.kfx');
});

test('toKfx refuses when the toolchain is not ready, naming what is missing', async () => {
  if (platform === 'win32') return;
  const { tool, workDir } = fakeEbookConvert();
  const epub = join(workDir, 'book.epub');
  writeFileSync(epub, 'fake epub bytes');
  const notReady = { calibre: true, previewer: false, pluginInstalled: false, ready: false };

  const attempt = toKfx(epub, undefined, { tool: () => tool, status: async () => notReady });

  await expect(attempt).rejects.toThrow(KfxToolchainNotReadyError);
  await expect(attempt).rejects.toThrow('KFX conversion needs Kindle Previewer and the KFX plugin.');
  expect(existsSync(kfxSibling(epub))).toBe(false); // and nothing was written
});

// --- Kindle Previewer's leftovers. The plugin hands the conversion to
// Kindle Previewer, and Previewer writes a <uuid>/ folder into $TMPDIR on
// every run (conv_out/, conversionLog.csv, an intermediate .mobi, about
// 250 KB) and never removes it. Measured 2026-09-22 against Calibre, the
// KFX Output plugin and Kindle Previewer 3: one real conversion, one new
// folder, and 189 of them had piled up on the machine that measured it.
// Previewer honours TMPDIR, so the fix is a temp folder per conversion
// that toKfx owns and removes. This fake does what Previewer does to
// whatever $TMPDIR it is handed, and writes down which folder that was.
function leakyEbookConvert(exitCode: number) {
  const toolDir = mkdtempSync(join(SCRATCH, 'kfx-leaky-'));
  const tool = join(toolDir, 'ebook-convert');
  const seen = join(toolDir, 'tmpdir.txt');
  const leftover = crypto.randomUUID();
  writeFileSync(tool, [
    '#!/bin/sh',
    'dir="${TMPDIR:-/tmp}"',
    `printf '%s' "$dir" > "${seen}"`,
    `mkdir -p "$dir/${leftover}/conv_out"`,
    `echo '"Type","Description"' > "$dir/${leftover}/conversionLog.csv"`,
    exitCode === 0 ? 'touch "$2"' : `echo 'Kindle Previewer failed' >&2; exit ${exitCode}`,
    '',
  ].join('\n'));
  chmodSync(tool, 0o755);
  const workDir = mkdtempSync(join(SCRATCH, 'kfx-work-'));
  const epub = join(workDir, 'book.epub');
  writeFileSync(epub, 'fake epub bytes');
  return {
    tool,
    epub,
    /** The temp folder the tool was given, and whether Previewer's folder
     *  is still in it. Removes that one folder if it is, so a failing run
     *  of this test does not add to the pile it is about. */
    after: () => {
      const dir = readFileSync(seen, 'utf8');
      const left = join(dir, leftover);
      const stillThere = { tmp: existsSync(dir), leftover: existsSync(left) };
      rmSync(left, { recursive: true, force: true });
      return stillThere;
    },
  };
}

test('toKfx gives Kindle Previewer its own temp folder and removes it, leftovers and all', async () => {
  if (platform === 'win32') return; // the fake tool is a /bin/sh script
  const fake = leakyEbookConvert(0);

  const out = await toKfx(fake.epub, undefined, { tool: () => fake.tool, status: async () => READY });

  expect(existsSync(out)).toBe(true); // the conversion itself still lands
  expect(fake.after()).toEqual({ tmp: false, leftover: false });
});

test('a failed conversion removes Kindle Previewer’s temp folder too', async () => {
  if (platform === 'win32') return;
  const fake = leakyEbookConvert(1);

  const attempt = toKfx(fake.epub, undefined, { tool: () => fake.tool, status: async () => READY });

  await expect(attempt).rejects.toThrow('Kindle Previewer failed');
  expect(fake.after()).toEqual({ tmp: false, leftover: false });
});

// --- pluginInstalled: exercised directly against a fake calibre-customize
// so the "KFX Output" substring check is actually proven, not just assumed.
// Without these, a mutant that hardcodes pluginInstalled to `calibre`
// (always true when Calibre is present) or to `false` (always, regardless
// of what calibre-customize reports) would both still pass every test above
// on this Linux dev machine, because calibre itself is absent here.

const describesPathScan = platform !== 'darwin';

function withFakeCustomize(pluginListing: string, run: (dir: string) => Promise<void>) {
  return async () => {
    if (!describesPathScan) return;
    if (calibreTool('calibre-customize')) return; // never shadow a real install
    const dir = mkdtempSync(join(SCRATCH, 'kfx-customize-'));
    const name = platform === 'win32' ? 'calibre-customize.exe' : 'calibre-customize';
    const fake = join(dir, name);
    writeFileSync(fake, `#!/bin/sh\ncat <<'EOF'\n${pluginListing}\nEOF\n`);
    chmodSync(fake, 0o755);
    const originalPath = process.env.PATH;
    process.env.PATH = `${dir}${delimiter}${originalPath ?? ''}`;
    try {
      await run(dir);
    } finally {
      process.env.PATH = originalPath;
    }
  };
}

test(
  'pluginInstalled is true when calibre-customize lists KFX Output',
  withFakeCustomize('Plugin: KFX Output (2, 17, 1) by jhowell', async () => {
    const status = await kfxStatus();
    expect(status.calibre).toBe(true);
    expect(status.pluginInstalled).toBe(true);
  }),
);

test(
  'pluginInstalled is false when calibre-customize lists other plugins but not KFX Output',
  withFakeCustomize('Plugin: Quality Check (1, 0, 0) by someone\nPlugin: Kobo Utilities (1, 0, 0) by someone', async () => {
    const status = await kfxStatus();
    expect(status.calibre).toBe(true);
    expect(status.pluginInstalled).toBe(false);
  }),
);

// ── installing jhowell's plugin without shipping a copy of it ────────
//
// The old Swift app carried a 485 KB GPL-3 zip of the KFX Output plugin and
// installed it with `calibre-customize -a`. That copy was pinned at 2.12.0
// AND was a fork, so the thing we shipped was already eight minor versions
// behind the plugin it claimed to be. Vendoring it also meant redistributing
// someone else's GPL-3 binary and keeping THIRD-PARTY-NOTICES honest about
// it.
//
// We do not ship it now. Calibre's own plugin index is the upstream, and
// Calibre's own `add_plugin` is the installer, so the newest version is
// whatever Calibre says it is on the day the user asks. Our part is one
// `calibre-debug -c` call and reading one JSON line back.
//
// This is a WRITE to the user's Calibre and it fetches third-party code over
// the network, so it is never automatic: something has to ask for it.
describe('installKfxPlugin', () => {
  const okLine = (v: string) =>
    `some calibre chatter\nSCREEPUB_RESULT ${JSON.stringify({ ok: true, version: v })}\n`;

  // Every test here injects `run`, so none of them wants Calibre to be
  // FOUND. But installKfxPlugin's second parameter defaults to
  // `calibreTool('calibre-debug')`, real discovery against real paths, and
  // when that answers null the function returns before the injected runner
  // is ever called. So these passed on a machine with Calibre installed and
  // failed on every runner without it, which is what left ci.yml red on
  // main from 2026-09-18 onward: six failures that were entirely about the
  // author's /Applications folder.
  //
  // Worse than the six, and the reason this is a fake PATH rather than a
  // self-skip: 'output with no result line is refused' asserts only that
  // ok is false, which a missing Calibre also produces. It passed on CI
  // while testing nothing at all. A test that cannot tell the difference
  // between the thing working and the thing being absent is the failure
  // mode a skip would have preserved.
  //
  // Not null either. null takes the no-Calibre branch, which is exactly
  // what the 'no Calibre is a named reason' test below is for.
  const TOOL = '/nowhere/calibre-debug';

  test('reports the version Calibre actually installed', async () => {
    const r = await installKfxPlugin(
      async () => ({ code: 0, stdout: okLine('2.20.1'), stderr: '' }),
      TOOL,
    );
    expect(r.ok).toBe(true);
    expect(r.version).toBe('2.20.1');
  });

  test('a conflicting KFX fork is removed, and named in the result', async () => {
    // Found the hard way on a real machine. The old Swift app's vendored
    // copy installs under the name "KFX Output (Fix Traditional Chinese)",
    // a fork. Installing the official plugin ALONGSIDE it does not
    // supersede it: both register the same internal Python package
    // (calibre_plugins.kfx_output), so the new plugin's code imports the
    // OLD fork's kfxlib and KFX conversion dies outright with
    // "cannot import name 'JobLog'". Every unit test passed and the
    // toolchain still reported ready; only converting a real book showed it.
    //
    // So the install has to clear variants, not just add. Leaving the
    // conflict is strictly worse than not installing at all.
    const r = await installKfxPlugin(async () => ({
      code: 0,
      stdout: `SCREEPUB_RESULT ${JSON.stringify({
        ok: true,
        version: '2.20.1',
        removed: ['KFX Output (Fix Traditional Chinese)'],
      })}\n`,
      stderr: '',
    }), TOOL);
    expect(r.ok).toBe(true);
    expect(r.removed).toEqual(['KFX Output (Fix Traditional Chinese)']);
  });

  test('the companion metadata writer is never removed', async () => {
    // The bug in my first cut of the guard, caught by running it for real.
    // "Set KFX metadata (from KFX Output)" ships INSIDE the same zip and is
    // a metadata writer, not a conversion output, so it cannot collide for
    // the .kfx slot. A name-only test matched it and deleted it; it only
    // survived because add_plugin put it straight back. The snippet now
    // asks calibre which plugins are conversion outputs rather than
    // guessing from the name.
    const r = await installKfxPlugin(async () => ({
      code: 0,
      stdout: `SCREEPUB_RESULT ${JSON.stringify({ ok: true, version: '2.20.1', removed: [] })}\n`,
      stderr: '',
    }), TOOL);
    expect(r.removed).not.toContain('Set KFX metadata (from KFX Output)');
  });

  test('a plain upgrade removes nothing', async () => {
    // "KFX Output" replacing "KFX Output" is calibre's own upgrade path and
    // must not be mistaken for a conflict.
    const r = await installKfxPlugin(async () => ({
      code: 0,
      stdout: `SCREEPUB_RESULT ${JSON.stringify({ ok: true, version: '2.20.1', removed: [] })}\n`,
      stderr: '',
    }), TOOL);
    expect(r.ok).toBe(true);
    expect(r.removed).toEqual([]);
  });

  test('no Calibre is a named reason, not a throw', async () => {
    // The ladder still works without KFX — it degrades to AZW3 then MOBI —
    // so a missing toolchain must never take the caller down with it.
    const r = await installKfxPlugin(async () => ({ code: 127, stdout: '', stderr: '' }), null);
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/calibre/i);
  });

  test('a failed install carries Calibre’s own words', async () => {
    const r = await installKfxPlugin(async () => ({
      code: 1, stdout: '', stderr: 'urlopen error timed out',
    }), TOOL);
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/timed out/);
  });

  test('output with no result line is refused rather than read as success', async () => {
    // exit 0 proves calibre-debug ran, not that the plugin landed.
    const r = await installKfxPlugin(
      async () => ({ code: 0, stdout: 'hello\n', stderr: '' }),
      TOOL,
    );
    expect(r.ok).toBe(false);
  });

  test('a result line saying failure is honoured over the exit code', async () => {
    const r = await installKfxPlugin(async () => ({
      code: 0,
      stdout: `SCREEPUB_RESULT ${JSON.stringify({ ok: false, error: 'size mismatch' })}\n`,
      stderr: '',
    }), TOOL);
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/size mismatch/);
  });

  // The most likely reason either network fetch (the index, or the zip
  // itself) fails is the user being offline, and unwrapped that arrives as
  // raw urllib/http exception text: no user should have to parse
  // "<urlopen error [Errno 8] nodename nor servname provided>". The snippet
  // marks both fetches and tags the result 'offline': true; this is the
  // friendly sentence installKfxPlugin reports instead.
  test("an unreachable plugin index gets a friendly sentence, not urlopen's own text", async () => {
    const r = await installKfxPlugin(async () => ({
      code: 0,
      stdout: `SCREEPUB_RESULT ${JSON.stringify({
        ok: false,
        error: '<urlopen error [Errno 8] nodename nor servname provided>',
        offline: true,
      })}\n`,
      stderr: '',
    }), TOOL);
    expect(r.ok).toBe(false);
    // Its own sentence, because cli-kfx.ts puts "could not install the KFX
    // plugin: " in front of it: a reason that also began "could not reach"
    // read as a stutter.
    expect(r.reason).toBe(
      "Calibre's plugin index could not be reached. Check the internet connection, then try again.",
    );
    expect(r.reason).not.toContain('urlopen');
  });

  // Pinning the PYTHON shape: nothing here runs the snippet (it needs a real
  // calibre-debug), so the only way to catch an except clause ordered wrong
  // is to read the source. Python tries except clauses top to bottom, and
  // Unreachable IS an Exception, so if the generic `except Exception as e:`
  // came first it would swallow every offline failure silently and 'offline'
  // would never reach installKfxPlugin's parsing above.
  test('INSTALL_SNIPPET catches Unreachable before the generic exception', async () => {
    const src = await Bun.file(join(import.meta.dir, '..', 'src', 'export', 'kfx.ts')).text();
    const unreachableCatch = src.indexOf('except Unreachable as e:');
    // The LAST `except Exception as e:` is the outer, catch-all clause; the
    // two earlier ones belong to the fetches themselves, which re-raise as
    // Unreachable rather than print.
    const genericCatch = src.lastIndexOf('except Exception as e:');
    expect(unreachableCatch).toBeGreaterThan(-1);
    expect(genericCatch).toBeGreaterThan(-1);
    expect(unreachableCatch).toBeLessThan(genericCatch);
    expect(src).toContain("'offline': True");
  });

  async function installSnippetText(): Promise<string> {
    const src = await Bun.file(join(import.meta.dir, '..', 'src', 'export', 'kfx.ts')).text();
    const start = src.indexOf('const INSTALL_SNIPPET');
    const end = src.indexOf('`;', start) + '`;'.length;
    return src.slice(start, end);
  }

  // `class Unreachable` has to be defined OUTSIDE the try, before it, not as
  // the first thing inside it (the first cut's mistake). If anything raises
  // before that line would have run -- one of the `from calibre...` imports,
  // say, on some future calibre that moves INDEX_URL -- Python evaluates
  // `except Unreachable as e:` against a name that was never bound: a
  // NameError while handling the original exception, no SCREEPUB_RESULT
  // line at all, and a raw traceback instead of the JSON contract every
  // caller of installKfxPlugin relies on. Defining it at module level, ahead
  // of the try, means it exists no matter what fails or when.
  test('class Unreachable is defined before the snippet’s first try:, not inside it', async () => {
    const snippet = await installSnippetText();
    const classIdx = snippet.indexOf('class Unreachable');
    const tryIdx = snippet.indexOf('try:');
    expect(classIdx).toBeGreaterThan(-1);
    expect(tryIdx).toBeGreaterThan(-1);
    expect(classIdx).toBeLessThan(tryIdx);
  });

  // The fork-clearing block used to run BEFORE the network fetches. Offline,
  // that meant a user upgrading from the Swift app's vendored fork got their
  // working fork removed with nothing installed in its place: KFX conversion
  // breaks outright, worse than doing nothing. So every fetch and every
  // check on what it returned (the index, `meta is None`, the zip, the size
  // check, the `__init__.py` check) has to pass before `remove_plugin` runs,
  // and that has to happen before `add_plugin` installs the replacement.
  test('forks are cleared only after the download and its checks pass, not before', async () => {
    const snippet = await installSnippetText();
    const urlopenIdx = snippet.indexOf('urlopen(');
    const initCheckIdx = snippet.indexOf("'__init__.py' not in");
    const removeIdx = snippet.indexOf('remove_plugin(p)');
    const addPluginIdx = snippet.indexOf('add_plugin(path)');
    expect(urlopenIdx).toBeGreaterThan(-1);
    expect(initCheckIdx).toBeGreaterThan(-1);
    expect(removeIdx).toBeGreaterThan(-1);
    expect(addPluginIdx).toBeGreaterThan(-1);
    expect(removeIdx).toBeGreaterThan(urlopenIdx);
    expect(removeIdx).toBeGreaterThan(initCheckIdx);
    expect(removeIdx).toBeLessThan(addPluginIdx);
  });
});
