import { describe, test, expect, afterAll } from 'bun:test';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  checkEngineVersion,
  extractArchiveEngine,
  extractDmgEngine,
  extractExeEngine,
  platformRefusal,
  smokeBundle,
  smokeBuiltBundles,
} from '../tools/smoke-bundle';
import { kindsForOs } from '../tools/build-app-bundle';
import type { RunResult } from '../tools/smoke-cli';

const REPO = join(import.meta.dir, '..');
const OUT = mkdtempSync(join(tmpdir(), 'screepub-smokebundle-'));
afterAll(() => rmSync(OUT, { recursive: true, force: true }));

const ok = (stdout: string): RunResult => ({ exitCode: 0, stdout, stderr: '' });
const enc = (s: string) => new TextEncoder().encode(s);

function concat(parts: Uint8Array[]): Uint8Array<ArrayBuffer> {
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let off = 0;
  for (const p of parts) {
    out.set(p, off);
    off += p.length;
  }
  return out;
}

function arMember(name: string, data: Uint8Array): Uint8Array<ArrayBuffer> {
  const h = new Uint8Array(60).fill(0x20);
  h.set(enc(name), 0);
  h.set(enc(String(data.length)), 48);
  h[58] = 0x60;
  h[59] = 0x0a;
  return concat([h, data, data.length % 2 ? new Uint8Array([0x0a]) : new Uint8Array(0)]);
}

function tarFile(name: string, contents: string): Uint8Array<ArrayBuffer> {
  const header = new Uint8Array(512);
  header.set(enc(name), 0);
  header.set(enc('0000755\0'), 100);
  header.set(enc(contents.length.toString(8).padStart(11, '0') + '\0'), 124);
  header[156] = 0x30;
  header.set(enc('        '), 148);
  const body = enc(contents);
  return concat([header, body, new Uint8Array((512 - (body.length % 512)) % 512)]);
}

/** The same hand-built containers Task 3's tests use, reduced to what this
 *  file needs: one .deb holding one named executable file. */
function fakeDeb(path: string, name: string, contents: string): void {
  const tar = concat([tarFile(name, contents), new Uint8Array(1024)]);
  writeFileSync(
    path,
    concat([
      enc('!<arch>\n'),
      arMember('debian-binary/  ', enc('2.0\n')),
      arMember('control.tar.gz/ ', Bun.gzipSync(new Uint8Array(1024))),
      arMember('data.tar.gz/    ', Bun.gzipSync(tar)),
    ]),
  );
}

/** A work directory no earlier test has written into. Every check below
 *  asserts on a file appearing; a shared directory with leftovers in it
 *  would let a reader that produced nothing still pass. */
const fresh = (tag: string) => mkdtempSync(join(OUT, `${tag}-`));

describe('the version assertion', () => {
  test('the version the engine reports must equal the version being shipped', () => {
    expect(() =>
      checkEngineVersion(ok('{"ok":true,"version":"0.6.0"}\n'), '0.6.0'),
    ).not.toThrow();
  });

  test('a 0.5.4 engine inside a 0.6.0 bundle is refused, naming both numbers', () => {
    // The exact defect the design found inside a real artifact.
    let message = '';
    try {
      checkEngineVersion(ok('{"ok":true,"version":"0.5.4"}\n'), '0.6.0');
    } catch (err) {
      message = (err as Error).message;
    }
    expect(message).toContain('0.5.4');
    expect(message).toContain('0.6.0');
  });

  test('an engine that reports failure is refused even with the right version', () => {
    expect(() =>
      checkEngineVersion(ok('{"ok":false,"version":"0.6.0","error":"broken"}\n'), '0.6.0'),
    ).toThrow(/ok/);
  });

  test('two lines on stdout is refused: the --json contract is exactly one object', () => {
    // A progress line before the result would otherwise pass a first-line
    // check while breaking every caller that parses the whole stream.
    expect(() =>
      checkEngineVersion(ok('starting\n{"ok":true,"version":"0.6.0"}\n'), '0.6.0'),
    ).toThrow(/one/);
  });

  test('a non-zero exit is refused and the stderr is forwarded', () => {
    expect(() =>
      checkEngineVersion(
        { exitCode: 127, stdout: '', stderr: 'cannot execute binary file' },
        '0.6.0',
      ),
    ).toThrow(/cannot execute binary file/);
  });

  test('unparseable output is refused rather than coerced', () => {
    expect(() => checkEngineVersion(ok('not json at all\n'), '0.6.0')).toThrow(/JSON/i);
  });

  test('a bundle with no version field at all is refused', () => {
    // `{"ok":true}` must not read as "version matched".
    expect(() => checkEngineVersion(ok('{"ok":true}\n'), '0.6.0')).toThrow(/0\.6\.0/);
  });

  test('a version that is a prefix of the expected one is refused', () => {
    // "0.6" must not read as "0.6.0".
    expect(() => checkEngineVersion(ok('{"ok":true,"version":"0.6"}\n'), '0.6.0')).toThrow(
      /0\.6\.0/,
    );
  });
});

describe('what this machine can and cannot smoke', () => {
  // The failure this guard exists for: a step that exits 0 on two of three
  // platforms having opened nothing, and reads in a log exactly like a step
  // that ran.
  test('a Linux package is smokeable on Linux and refused loudly anywhere else', () => {
    expect(platformRefusal('/x/Screepub_0.6.0_arm64.deb', 'linux')).toBeUndefined();
    expect(platformRefusal('/x/Screepub-0.6.0-1.aarch64.rpm', 'linux')).toBeUndefined();
    expect(platformRefusal('/x/Screepub_0.6.0_arm64.deb', 'darwin')).toMatch(/NOTHING WAS CHECKED/);
  });

  test('a .dmg is refused off macOS and a .exe off Windows, each naming its OS', () => {
    expect(platformRefusal('/x/Screepub.dmg', 'linux')).toMatch(/macOS/);
    expect(platformRefusal('/x/Screepub.dmg', 'darwin')).toBeUndefined();
    expect(platformRefusal('/x/setup.exe', 'linux')).toMatch(/Windows/);
    expect(platformRefusal('/x/setup.exe', 'win32')).toBeUndefined();
  });

  test('an unrecognised extension is refused rather than waved through', () => {
    expect(platformRefusal('/x/Screepub.AppImage', 'linux')).toMatch(/not a \.deb/);
  });
});

describe('opening a .deb without installing it', () => {
  test('the engine comes out with its bytes and an executable bit', () => {
    const deb = join(OUT, 'one.deb');
    fakeDeb(deb, 'usr/bin/screepub-engine', '#!/bin/sh\necho engine\n');
    const work = fresh('work');
    const enginePath = extractArchiveEngine(deb, work);
    expect(enginePath.startsWith(work)).toBe(true);
    expect(readFileSync(enginePath, 'utf8')).toBe('#!/bin/sh\necho engine\n');
    expect(statSync(enginePath).size).toBe('#!/bin/sh\necho engine\n'.length);
    // Written to disk from an archive, the mode does NOT come along for
    // free. Without this the extracted engine cannot be run at all, and the
    // failure is a bare EACCES naming nothing.
    expect(statSync(enginePath).mode & 0o111).not.toBe(0);
  });

  test('a bundle with no engine inside says so and lists what it held', () => {
    const deb = join(OUT, 'noengine.deb');
    // Same builder, different member name.
    const tar = concat([tarFile('usr/bin/screepub-desktop', ''), new Uint8Array(1024)]);
    writeFileSync(
      deb,
      concat([enc('!<arch>\n'), arMember('data.tar.gz/    ', Bun.gzipSync(tar))]),
    );
    expect(() => extractArchiveEngine(deb, fresh('work'))).toThrow(/screepub-desktop/);
  });

  test('a near-miss name is not accepted as the engine', () => {
    // `endsWith('screepub-engine')` would answer yes to this one.
    const deb = join(OUT, 'nearmiss.deb');
    fakeDeb(deb, 'usr/bin/not-screepub-engine', 'X');
    expect(() => extractArchiveEngine(deb, fresh('work'))).toThrow(/not-screepub-engine/);
  });
});

describe('opening a .dmg', () => {
  const app = 'Screepub Desktop.app';

  /** Stands in for hdiutil: `attach` creates the mount tree the real one
   *  would have created, `detach` records that it was called. */
  const fakeHdiutil = (mountRoot: string) => {
    const calls: string[][] = [];
    const run = (argv: string[]): RunResult => {
      calls.push(argv);
      if (argv[1] === 'attach') {
        const mount = argv[argv.indexOf('-mountpoint') + 1]!;
        mkdirSync(join(mount, app, 'Contents', 'MacOS'), { recursive: true });
        writeFileSync(join(mount, app, 'Contents', 'MacOS', 'screepub-engine'), 'ENGINE');
        return ok('');
      }
      return ok('');
    };
    return { calls, run, mountRoot };
  };

  test('it attaches read-only, finds the app, and points at the engine inside it', () => {
    const work = fresh('dmg');
    const h = fakeHdiutil(work);
    const { enginePath, detach } = extractDmgEngine(join(OUT, 'x.dmg'), work, h.run);
    expect(enginePath).toContain(join(app, 'Contents', 'MacOS', 'screepub-engine'));
    // -readonly and -nobrowse both matter: a writable attach can modify the
    // artifact being verified, and a browsable one leaves a volume on the
    // runner's desktop that the next job inherits.
    expect(h.calls[0]).toContain('-readonly');
    expect(h.calls[0]).toContain('-nobrowse');
    detach();
    expect(h.calls.some((c) => c[1] === 'detach')).toBe(true);
  });

  test('it finds the .app by suffix rather than by a hardcoded name', () => {
    // The macOS transition overlay renames the product to "Screepub
    // Desktop"; piece F renames it back to "Screepub". A hardcoded name
    // here would break on exactly the commit that deletes the overlay.
    const work = fresh('dmg2');
    const run = (argv: string[]): RunResult => {
      if (argv[1] === 'attach') {
        const mount = argv[argv.indexOf('-mountpoint') + 1]!;
        mkdirSync(join(mount, 'Screepub.app', 'Contents', 'MacOS'), { recursive: true });
        writeFileSync(join(mount, 'Screepub.app', 'Contents', 'MacOS', 'screepub-engine'), 'E');
      }
      return ok('');
    };
    expect(extractDmgEngine(join(OUT, 'y.dmg'), work, run).enginePath).toContain('Screepub.app');
  });

  test('a mount holding two .app bundles is an error, not a coin flip', () => {
    const work = fresh('dmg3');
    const run = (argv: string[]): RunResult => {
      if (argv[1] === 'attach') {
        const mount = argv[argv.indexOf('-mountpoint') + 1]!;
        for (const name of ['A.app', 'B.app']) {
          mkdirSync(join(mount, name, 'Contents', 'MacOS'), { recursive: true });
        }
      }
      return ok('');
    };
    expect(() => extractDmgEngine(join(OUT, 'z.dmg'), work, run)).toThrow(/A\.app.*B\.app/s);
  });

  test('an image with no .app on it is detached before the error is thrown', () => {
    // An attached image that outlives the failure leaves a busy mount point
    // the next job inherits.
    const work = fresh('dmg5');
    const calls: string[][] = [];
    const run = (argv: string[]): RunResult => {
      calls.push(argv);
      if (argv[1] === 'attach') mkdirSync(join(work, 'mnt'), { recursive: true });
      return ok('');
    };
    expect(() => extractDmgEngine(join(OUT, 'empty.dmg'), work, run)).toThrow(/found 0/);
    expect(calls.some((c) => c[1] === 'detach')).toBe(true);
  });

  test('a failed attach is reported with hdiutil’s own stderr', () => {
    const run = (): RunResult => ({ exitCode: 1, stdout: '', stderr: 'no mountable file systems' });
    expect(() => extractDmgEngine(join(OUT, 'bad.dmg'), fresh('dmg4'), run)).toThrow(
      /no mountable file systems/,
    );
  });
});

describe('opening an NSIS installer', () => {
  test('it unpacks with 7z and looks for the .exe-suffixed engine', () => {
    const work = fresh('exe');
    const calls: string[][] = [];
    const run = (argv: string[]): RunResult => {
      calls.push(argv);
      writeFileSync(join(work, 'screepub-engine.exe'), 'ENGINE');
      return ok('');
    };
    const enginePath = extractExeEngine(join(OUT, 'setup.exe'), work, run);
    expect(enginePath).toBe(join(work, 'screepub-engine.exe'));
    expect(calls[0]![0]).toBe('7z');
    expect(calls[0]).toContain('x');
    expect(calls[0]).toContain(`-o${work}`);
  });

  test('an unpack that produces no engine names the directory it searched', () => {
    const work = fresh('exe2');
    const run = (): RunResult => ok('');
    expect(() => extractExeEngine(join(OUT, 'setup.exe'), work, run)).toThrow(/screepub-engine/);
  });

  test('a failing 7z is reported rather than swallowed', () => {
    const run = (): RunResult => ({ exitCode: 2, stdout: '', stderr: 'Cannot open the file' });
    expect(() => extractExeEngine(join(OUT, 'setup.exe'), fresh('exe3'), run)).toThrow(
      /Cannot open the file/,
    );
  });
});

describe('a whole smoke run over a .deb', () => {
  const fixture = join(REPO, 'tests', 'fixtures', 'screenplay.pdf');
  const ZIP = new Uint8Array([0x50, 0x4b, 0x03, 0x04]);

  test('it runs --version and then a real conversion through the same engine', () => {
    const deb = join(OUT, 'full.deb');
    fakeDeb(deb, 'usr/bin/screepub-engine', 'ENGINE');
    const work = fresh('full');
    const calls: string[][] = [];
    const run = (argv: string[]): RunResult => {
      calls.push(argv);
      if (argv.includes('--version')) return ok('{"ok":true,"version":"0.6.0"}\n');
      const epub = argv[argv.indexOf('-o') + 1]!;
      writeFileSync(epub, ZIP);
      return ok(`{"ok":true,"epubPath":${JSON.stringify(epub)},"pages":12}\n`);
    };
    smokeBundle(deb, fixture, work, '0.6.0', run);

    // Both runs used the EXTRACTED engine, not some engine on PATH. Without
    // this the whole check could pass against a developer's installed copy.
    expect(calls.length).toBe(2);
    for (const call of calls) expect(call[0]!.startsWith(work)).toBe(true);
    expect(calls[0]).toEqual([join(work, 'usr', 'bin', 'screepub-engine'), '--version', '--json']);
    expect(calls[1]).toContain(fixture);
    expect(calls[1]).toContain('--json');
    // The conversion wrote into the work directory, never beside the
    // committed fixture.
    expect(existsSync(join(work, 'smoke.epub'))).toBe(true);
  });

  test('a wrong version fails the run before any conversion is attempted', () => {
    const deb = join(OUT, 'wrongver.deb');
    fakeDeb(deb, 'usr/bin/screepub-engine', 'ENGINE');
    const calls: string[][] = [];
    const run = (argv: string[]): RunResult => {
      calls.push(argv);
      return ok('{"ok":true,"version":"0.5.4"}\n');
    };
    expect(() => smokeBundle(deb, fixture, fresh('wv'), '0.6.0', run)).toThrow(/0\.5\.4/);
    expect(calls.length).toBe(1);
  });

  test('a conversion that reports zero pages is a failure, not a success', () => {
    // An empty book is not a conversion. checkConvertResult, shared with
    // smoke-cli.ts, is what says so; this proves the sharing is wired up.
    const deb = join(OUT, 'zeropages.deb');
    fakeDeb(deb, 'usr/bin/screepub-engine', 'ENGINE');
    const work = fresh('zp');
    const run = (argv: string[]): RunResult => {
      if (argv.includes('--version')) return ok('{"ok":true,"version":"0.6.0"}\n');
      const epub = argv[argv.indexOf('-o') + 1]!;
      writeFileSync(epub, ZIP);
      return ok(`{"ok":true,"epubPath":${JSON.stringify(epub)},"pages":0}\n`);
    };
    expect(() => smokeBundle(deb, fixture, work, '0.6.0', run)).toThrow(/pages/);
  });

  test('a conversion that reports success and writes nothing is a failure', () => {
    // checkConvertResult only reads what the engine SAID. A sidecar that
    // prints a success object and produces no file passes every string
    // check in it.
    const deb = join(OUT, 'nofile.deb');
    fakeDeb(deb, 'usr/bin/screepub-engine', 'ENGINE');
    const work = fresh('nofile');
    const run = (argv: string[]): RunResult => {
      if (argv.includes('--version')) return ok('{"ok":true,"version":"0.6.0"}\n');
      const epub = argv[argv.indexOf('-o') + 1]!;
      return ok(`{"ok":true,"epubPath":${JSON.stringify(epub)},"pages":12}\n`);
    };
    expect(() => smokeBundle(deb, fixture, work, '0.6.0', run)).toThrow(/is not there/);
  });

  test('an output that is not a zip container is a failure', () => {
    const deb = join(OUT, 'notzip.deb');
    fakeDeb(deb, 'usr/bin/screepub-engine', 'ENGINE');
    const work = fresh('notzip');
    const run = (argv: string[]): RunResult => {
      if (argv.includes('--version')) return ok('{"ok":true,"version":"0.6.0"}\n');
      const epub = argv[argv.indexOf('-o') + 1]!;
      writeFileSync(epub, 'this is not an epub');
      return ok(`{"ok":true,"epubPath":${JSON.stringify(epub)},"pages":12}\n`);
    };
    expect(() => smokeBundle(deb, fixture, work, '0.6.0', run)).toThrow(/zip container/);
  });

  test('a missing bundle says which path, before anything is spawned', () => {
    const calls: string[][] = [];
    expect(() =>
      smokeBundle(join(OUT, 'nope.deb'), fixture, fresh('missing'), '0.6.0', (a) => {
        calls.push(a);
        return ok('');
      }),
    ).toThrow(/nope\.deb/);
    expect(calls.length).toBe(0);
  });
});

describe('finding and smoking whatever this runner just built', () => {
  const fixture = join(REPO, 'tests', 'fixtures', 'screenplay.pdf');
  const ZIP = new Uint8Array([0x50, 0x4b, 0x03, 0x04]);

  /** Every bundle kind has a 10 MB floor, because every real one carries the
   *  ~102 MB engine. A fixture under it fails on its size before its content
   *  is ever read, so these fakes are padded to clear it: the .deb with an
   *  extra ar member, the .rpm with an extra cpio file of RANDOM bytes --
   *  zeros would gzip away to nothing and leave the file small. */
  const PAD = 11_000_000;
  function randomBytes(n: number): Uint8Array<ArrayBuffer> {
    const out = new Uint8Array(n);
    for (let off = 0; off < n; off += 65536) {
      crypto.getRandomValues(out.subarray(off, Math.min(off + 65536, n)));
    }
    return out;
  }

  function bigDeb(path: string, contents: string): void {
    const tar = concat([tarFile('usr/bin/screepub-engine', contents), new Uint8Array(1024)]);
    writeFileSync(
      path,
      concat([
        enc('!<arch>\n'),
        arMember('debian-binary/  ', enc('2.0\n')),
        arMember('control.tar.gz/ ', Bun.gzipSync(new Uint8Array(1024))),
        arMember('data.tar.gz/    ', Bun.gzipSync(tar)),
        // Ignored by the reader, which looks members up by name; here only
        // to put the file over the container floor.
        arMember('_padding/       ', new Uint8Array(PAD)),
      ]),
    );
  }

  /** newc cpio + the 96-byte lead and two headers an .rpm puts in front of
   *  it. Copied in the same spirit as tests/bundle-archive.test.ts's
   *  builders: this file needs a whole .rpm, not a payload. */
  function cpioMember(name: string, data: Uint8Array, mode = 0o100755): Uint8Array<ArrayBuffer> {
    const nameBytes = concat([enc(name), new Uint8Array([0])]);
    const hex = (n: number) => n.toString(16).padStart(8, '0');
    const header = enc(
      '070701' +
        hex(1) + hex(mode) + hex(0) + hex(0) + hex(1) + hex(0) +
        hex(data.length) + hex(0) + hex(0) + hex(0) + hex(0) +
        hex(nameBytes.length) + hex(0),
    );
    const namePad = new Uint8Array((4 - ((header.length + nameBytes.length) % 4)) % 4);
    const dataPad = new Uint8Array((4 - (data.length % 4)) % 4);
    return concat([header, nameBytes, namePad, data, dataPad]);
  }

  function rpmHeader(nindex: number, hsize: number): Uint8Array<ArrayBuffer> {
    const h = new Uint8Array(16 + nindex * 16 + hsize);
    h.set([0x8e, 0xad, 0xe8, 0x01, 0, 0, 0, 0], 0);
    const view = new DataView(h.buffer);
    view.setUint32(8, nindex, false);
    view.setUint32(12, hsize, false);
    return h;
  }

  function bigRpm(path: string, contents: string): void {
    const cpio = concat([
      cpioMember('./usr/bin/screepub-engine', enc(contents)),
      cpioMember('./usr/lib/Screepub/_padding', randomBytes(PAD), 0o100644),
      cpioMember('TRAILER!!!', new Uint8Array(0), 0),
    ]);
    const lead = new Uint8Array(96);
    lead.set([0xed, 0xab, 0xee, 0xdb, 0x03, 0x00, 0x00, 0x00], 0);
    const sig = rpmHeader(2, 5);
    const pad = new Uint8Array((8 - (sig.length % 8)) % 8);
    const hdr = rpmHeader(1, 3);
    writeFileSync(path, concat([lead, sig, pad, hdr, Bun.gzipSync(cpio)]));
  }

  /** A stand-in for `desktop/src-tauri`, so this can drive the loop without
   *  writing fakes into the repo's own target/ -- where the NEXT run, and
   *  the gated real-bundle test at the bottom of this file, would find
   *  them. Returns the directory each named kind's bundle goes in. */
  function desktopTree(kinds: ('deb' | 'rpm')[], tag: string): string {
    const root = fresh(tag);
    for (const kind of kinds) {
      const dir = join(root, 'target', 'release', 'bundle', kind);
      mkdirSync(dir, { recursive: true });
      const path = join(dir, kind === 'deb' ? 'Screepub_0.6.0_arm64.deb' : 'Screepub-0.6.0-1.aarch64.rpm');
      if (kind === 'deb') bigDeb(path, 'ENGINE');
      else bigRpm(path, 'ENGINE');
    }
    return root;
  }

  const engineRun = (calls: string[][]) => (argv: string[]): RunResult => {
    calls.push(argv);
    if (argv.includes('--version')) return ok('{"ok":true,"version":"0.6.0"}\n');
    const epub = argv[argv.indexOf('-o') + 1]!;
    writeFileSync(epub, ZIP);
    return ok(`{"ok":true,"epubPath":${JSON.stringify(epub)},"pages":12}\n`);
  };

  test('it refuses an OS whose bundles are not on disk, naming the directory', () => {
    // On a machine that has not run `cargo tauri build`, the failure must
    // say where it looked -- not return an empty list, which would make a
    // CI step that checked nothing look green.
    expect(() =>
      smokeBuiltBundles('windows', '0.6.0', fixture, OUT, () => ok(''), desktopTree([], 'nonsis'), 'win32'),
    ).toThrow(/bundle[/\\]nsis|nsis/);
  });

  test('it smokes EVERY kind the OS defines, each with its own engine run', () => {
    // Linux defines two kinds. A run that found only the .deb and reported
    // success would ship an unchecked .rpm; the spec's whole argument for
    // per-push bundling is that an unchecked artifact is the failure mode.
    expect(kindsForOs('linux').length).toBe(2);
    const root = desktopTree(['deb', 'rpm'], 'both');
    const calls: string[][] = [];
    const smoked = smokeBuiltBundles('linux', '0.6.0', fixture, fresh('bothwork'), engineRun(calls), root, 'linux');
    expect(smoked.length).toBe(2);
    expect(smoked.some((s) => s.endsWith('.deb'))).toBe(true);
    expect(smoked.some((s) => s.endsWith('.rpm'))).toBe(true);
    // Two runs per bundle: --version, then a real conversion. Four in all,
    // so neither kind was discovered and then quietly skipped.
    expect(calls.length).toBe(4);
    expect(calls.filter((c) => c.includes('--version')).length).toBe(2);
  });

  test('one kind missing fails the run, even though the other one smoked clean', () => {
    // The silent-green failure this exists to prevent: the .deb is there
    // and perfect, the .rpm was never produced, and a loop that reported
    // what it found would exit 0 having shipped an unopened package.
    const root = desktopTree(['deb'], 'debonly');
    const calls: string[][] = [];
    expect(() =>
      smokeBuiltBundles('linux', '0.6.0', fixture, fresh('debonlywork'), engineRun(calls), root, 'linux'),
    ).toThrow(/rpm/);
    // The .deb WAS smoked first -- proof the throw is about the missing
    // second kind and not about failing to start.
    expect(calls.length).toBe(2);
  });

  test('the container is verified before any engine inside it is run', () => {
    const root = desktopTree([], 'wrongmagic');
    const dir = join(root, 'target', 'release', 'bundle', 'deb');
    mkdirSync(dir, { recursive: true });
    // Right name, right size, wrong container -- a copy step that put the
    // wrong file behind the right name.
    writeFileSync(join(dir, 'Screepub_0.6.0_arm64.deb'), randomBytes(11_000_000));
    const calls: string[][] = [];
    expect(() =>
      smokeBuiltBundles('linux', '0.6.0', fixture, fresh('wmwork'), engineRun(calls), root, 'linux'),
    ).toThrow(/magic/);
    expect(calls.length).toBe(0);
  });

  test('a bundle under the size floor is refused rather than smoked', () => {
    const root = desktopTree([], 'tiny');
    const dir = join(root, 'target', 'release', 'bundle', 'deb');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'Screepub_0.6.0_arm64.deb'), enc('!<arch>\n'));
    expect(() =>
      smokeBuiltBundles('linux', '0.6.0', fixture, fresh('tinywork'), () => ok(''), root, 'linux'),
    ).toThrow(/floor/);
  });

  test('a wrong-version engine inside a built bundle fails the whole run', () => {
    // The check the workflow step exists for, end to end through the
    // discover-verify-smoke path rather than through smokeBundle alone.
    const root = desktopTree(['deb', 'rpm'], 'badver');
    expect(() =>
      smokeBuiltBundles('linux', '0.6.0', fixture, fresh('badverwork'), () =>
        ok('{"ok":true,"version":"0.5.4"}\n'), root, 'linux'),
    ).toThrow(/0\.5\.4/);
  });
});

describe('a real bundle, if one has already been built', () => {
  // Gated on an artifact already on disk: building one takes ~50 seconds and
  // `bun test` may never spawn cargo. So this covers the extract-and-execute
  // path ONLY on a machine that has run `cargo tauri build` -- in CI, and on
  // a clean checkout, it does not run at all, and the fakes above are what
  // stand behind the logic.
  const bundleDir = join(REPO, 'desktop', 'src-tauri', 'target', 'release', 'bundle');
  const real = (['deb', 'rpm'] as const)
    .map((kind) => {
      const dir = join(bundleDir, kind);
      if (!existsSync(dir)) return undefined;
      const name = readdirSync(dir).find((n) => n.endsWith(`.${kind}`));
      return name ? join(dir, name) : undefined;
    })
    .filter((p): p is string => p !== undefined);

  const version = (
    JSON.parse(readFileSync(join(REPO, 'package.json'), 'utf8')) as { version: string }
  ).version;

  test.skipIf(real.length === 0 || process.platform !== 'linux')(
    'every built Linux package runs its own engine and converts the fixture',
    () => {
      expect(real.length).toBeGreaterThan(0);
      for (const bundle of real) {
        const work = fresh('real');
        smokeBundle(bundle, join(REPO, 'tests', 'fixtures', 'screenplay.pdf'), work, version);
        expect(existsSync(join(work, 'smoke.epub'))).toBe(true);
      }
    },
  );
});
