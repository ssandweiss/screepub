import { describe, test, expect, afterAll } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  arMembers,
  bundleEntries,
  cpioEntries,
  debEntries,
  findEntry,
  rpmEntries,
  rpmPayload,
} from '../tools/bundle-archive';
import { tarEntries, type ArchiveEntry } from '../tools/build-cli';

const OUT = mkdtempSync(join(tmpdir(), 'screepub-archive-'));
afterAll(() => rmSync(OUT, { recursive: true, force: true }));

const enc = (s: string) => new TextEncoder().encode(s);
const dec = (b: Uint8Array) => new TextDecoder().decode(b);

// Uint8Array<ArrayBuffer>, not plain Uint8Array: Bun.gzipSync only accepts a
// view backed by a real ArrayBuffer, and a bare Uint8Array could be a view on
// a SharedArrayBuffer as far as the types are concerned.
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

/** A tar member, built by hand: 512-byte header, octal size, data padded
 *  to 512. Enough for these tests; not a general tar writer. */
function tarMember(name: string, data: Uint8Array, mode = 0o755): Uint8Array {
  const header = new Uint8Array(512);
  header.set(enc(name), 0);
  header.set(enc(mode.toString(8).padStart(7, '0') + '\0'), 100);
  header.set(enc(data.length.toString(8).padStart(11, '0') + '\0'), 124);
  header[156] = 0x30; // typeflag '0', a regular file
  // The checksum field must be spaces while a checksum is computed, and GNU
  // tar rejects a wrong one -- but tarEntries never reads it, so these stay
  // spaces and the test stays honest about what it exercises.
  header.set(enc('        '), 148);
  const pad = new Uint8Array((512 - (data.length % 512)) % 512);
  return concat([header, data, pad]);
}

function arMember(name: string, data: Uint8Array): Uint8Array {
  const header = new Uint8Array(60).fill(0x20); // ar space-pads every field
  header.set(enc(name), 0);
  header.set(enc(String(data.length)), 48);
  header[58] = 0x60; // the two-byte end magic, 0x60 0x0a
  header[59] = 0x0a;
  const pad = data.length % 2 ? new Uint8Array([0x0a]) : new Uint8Array(0);
  return concat([header, data, pad]);
}

function cpioMember(name: string, data: Uint8Array, mode = 0o100755): Uint8Array {
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

function cpioTrailer(): Uint8Array {
  return cpioMember('TRAILER!!!', new Uint8Array(0), 0);
}

/** An RPM is a 96-byte lead, then a signature header padded to 8 bytes,
 *  then a header, then the payload. Each header is 16 bytes of preamble
 *  plus nindex*16 index entries plus hsize bytes of store. */
function rpmHeader(nindex: number, hsize: number): Uint8Array {
  const h = new Uint8Array(16 + nindex * 16 + hsize);
  h.set([0x8e, 0xad, 0xe8, 0x01, 0, 0, 0, 0], 0);
  const view = new DataView(h.buffer);
  view.setUint32(8, nindex, false);
  view.setUint32(12, hsize, false);
  return h;
}

function fakeRpm(payload: Uint8Array): Uint8Array {
  const lead = new Uint8Array(96);
  lead.set([0xed, 0xab, 0xee, 0xdb, 0x03, 0x00, 0x00, 0x00], 0);
  // nindex=2, hsize=5 => 16 + 32 + 5 = 53 bytes, which is NOT a multiple of
  // 8, so the signature header's pad is exercised rather than skipped.
  const sig = rpmHeader(2, 5);
  const pad = new Uint8Array((8 - (sig.length % 8)) % 8);
  const hdr = rpmHeader(1, 3); // 16 + 16 + 3 = 35, never padded
  return concat([lead, sig, pad, hdr, payload]);
}

/** Archives produced by the REAL tools and frozen here as base64.
 *
 *  A reader tested only against the writer in this file proves the two
 *  agree, not that either is right. These bytes came out of GNU ar 2.46,
 *  GNU cpio 2.15 and GNU tar 1.35 on 2026-09-14; the command that made each
 *  is above it. They are frozen rather than rebuilt at test time so the
 *  suite cannot silently skip on a runner that lacks the tool -- which is
 *  the same reason tools/bundle-archive.ts exists at all. */
const REAL = {
  // printf '2.0\n' >debian-binary; printf abc >odd.txt; printf TAIL >after.txt
  // ar rc real.a debian-binary odd.txt after.txt
  ar:
    'ITxhcmNoPgpkZWJpYW4tYmluYXJ5LyAgMCAgICAgICAgICAgMCAgICAgMCAgICAgNjQ0ICAgICA0ICAgICAgICAgYAoyLjAK' +
    'b2RkLnR4dC8gICAgICAgIDAgICAgICAgICAgIDAgICAgIDAgICAgIDY0NCAgICAgMyAgICAgICAgIGAKYWJjCmFmdGVyLnR4' +
    'dC8gICAgICAwICAgICAgICAgICAwICAgICAwICAgICA2NDQgICAgIDQgICAgICAgICBgClRBSUw=',
  // printf FIFTEEN >abcdefghijklmno; printf SIXTEEN >abcdefghijklmnop
  // ar rc boundary.a abcdefghijklmno abcdefghijklmnop
  // 15 chars + the '/' terminator fills the 16-byte name field exactly, with
  // no space left to trim; 16 chars does not fit and GNU ar spills it into
  // the '//' long-name table, referenced as '/0'.
  arBoundary:
    'ITxhcmNoPgovLyAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAxOCAgICAgICAgYAphYmNk' +
    'ZWZnaGlqa2xtbm9wLwphYmNkZWZnaGlqa2xtbm8vMCAgICAgICAgICAgMCAgICAgMCAgICAgNjQ0ICAgICA3ICAgICAgICAg' +
    'YApGSUZURUVOCi8wICAgICAgICAgICAgICAwICAgICAgICAgICAwICAgICAwICAgICA2NDQgICAgIDcgICAgICAgICBgClNJ' +
    'WFRFRU4K',
  // cd tree && find . | sort | cpio -o -H newc --quiet > ../real.cpio
  // tree holds usr/bin/screepub-engine (0755, "ENGINE"),
  // usr/lib/Screepub/LICENSE (0644, "AGPL") and usr/lib/Screepub/odd3
  // (0644, "XY" -- two bytes, so the 4-byte data pad is exercised), plus the
  // five directories leading to them. Stored gzipped, which is also how an
  // .rpm carries its payload. GNU cpio normalises the leading './' away.
  cpioGnuGz:
    'H4sIAAAAAAACA+2RQQuCQBCF96/4A8rZdXP1uOomgkhoh7qaEkJYKP7/tBJ0SdyEoEPvMg9m4Hu8AQYMMABQ4dndBIqF100w' +
    'hD2arTM5Z1vsMHgr4sLEojdrBEMemeHRhTzam6auEBozjRkmWci0Bkw9LUqZaz6OprlY4ppqXCxz9fpU5fmtSVd5eS7KvM0h' +
    'Ij+IhJSHfunXozyXIpV72Hynf4wlrp68epD47PkHThX/QBX59hRfDwNXREnbP/d34SiL9WEWopjFnMxyzTIDHY6DTlSkeifL' +
    '6c0+5kEoYk3T0F8/pTtV2H2LAAYAAA==',
  // bsdtar -c --format newc -f bsd.cpio -C tree ./usr, gzipped. Same tree,
  // but bsdtar KEEPS the './' prefix that GNU cpio drops -- the same
  // asymmetry the real .deb (no prefix) and real .rpm (prefix) show, here
  // from two tools rather than from one writer in this file.
  cpioBsdGz:
    'H4sIAAAAAAACA7WQXQuCMBSG91f8AbUzZ84uJYYIIqFd1KXLFUJYKP7/tA9pfuSKem/O4WzwPLzAgAEBAEumSxOahci0mUDl' +
    'Upn1k50k7EAEg8GY++E72M9ljquyQPDKtCaY9EtmojDxKRMql05wzd9wRZar3FsXzjiXdLi2Hpf0ubjcF1JeKjGT+THLJeKh' +
    '54ccqT6L//RAaK9/HD98EOo4OPdOEkuzE1PTwRl3wOc0pbXHdtdxYR+6WJou4o1L4K94GPOmF9dbB62PTnT/ddP6bCLXD3hk' +
    'GEbDvwIJZTsxEAQAAA==',
  // tar --owner=0 --group=0 --mtime=@0 -czf data.tar.gz -C tree ./usr
  // tar --owner=0 --group=0 --mtime=@0 -czf control.tar.gz control
  // ar rc real.deb debian-binary control.tar.gz data.tar.gz
  deb:
    'ITxhcmNoPgpkZWJpYW4tYmluYXJ5LyAgMCAgICAgICAgICAgMCAgICAgMCAgICAgNjQ0ICAgICA0ICAgICAgICAgYAoyLjAK' +
    'Y29udHJvbC50YXIuZ3ovIDAgICAgICAgICAgIDAgICAgIDAgICAgIDY0NCAgICAgMTI4ICAgICAgIGAKH4sIAAAAAAAAA+3O' +
    'sQmAMBCF4dROkRFiEAuncIUYgoViJMb9jSIIFmojIvxf8467K571Qwy+F29SSVkUWybnVErrY173eaKFVK+22s1TNEFKEbyP' +
    'V39395+qje1M6yo52eDcODfZ140AAAAAAAAAAAAAAAAAAE8sEsVJgQAoAABkYXRhLnRhci5nei8gICAgMCAgICAgICAgICAg' +
    'MCAgICAgMCAgICAgNjQ0ICAgICAyNTggICAgICAgYAofiwgAAAAAAAAD7dfZCoJAFAZgH2VeoBydGbuOkBBCAm/qskVCCA2X' +
    '9y81EKZFglmK/u/mCApz4J8z6tRtqtJ1tKI3MyG6eiPXx2uP8oA5ROhtq9dU9a4kxCmLon733Nj9HzXt8j9ne4174PP8PZ95' +
    'yN+EIf/kUKbppdGwET7Pn1GK/I14kn9xPDKla7ShBpy/yd+X8xdcOIQq7eKFP89/s7XdAdj0ZP5X0SKMk1DdGuPzz6X5523B' +
    '/BswX65XtnsAe/r532f5t33/4//PiCH/6n7+T9L8lOWpwjXG8w/k899nOP+NCONlFCt81wMAAAAAAAAAAADAd7gCxWk7VgAo' +
    'AAA=',
} as const;

const real = (b64: string): Uint8Array<ArrayBuffer> =>
  new Uint8Array(Buffer.from(b64, 'base64'));

describe('the ar container a .deb is', () => {
  test('names its three members and hands back their exact bytes', () => {
    const deb = concat([
      enc('!<arch>\n'),
      arMember('debian-binary/  ', enc('2.0\n')),
      arMember('control.tar.gz/ ', enc('CONTROL')),
      arMember('data.tar.gz/    ', enc('DATA')),
    ]);
    const members = arMembers(deb);
    expect([...members.keys()]).toEqual(['debian-binary', 'control.tar.gz', 'data.tar.gz']);
    expect(dec(members.get('data.tar.gz')!)).toBe('DATA');
  });

  test('an odd-sized member does not shift the one after it', () => {
    // ar pads odd-length data to an even offset with a single \n. Get this
    // wrong and the NEXT member's header is read one byte late, which
    // yields a garbage name rather than an error -- so a reader that
    // ignored padding would still "work" on this project's real .deb,
    // where debian-binary happens to be 4 bytes.
    const deb = concat([
      enc('!<arch>\n'),
      arMember('odd/            ', enc('abc')), // 3 bytes, padded
      arMember('after/          ', enc('TAIL')),
    ]);
    const members = arMembers(deb);
    expect([...members.keys()]).toEqual(['odd', 'after']);
    expect(dec(members.get('after')!)).toBe('TAIL');
  });

  test('GNU ar built the same shape, odd member and all', () => {
    // Built by /usr/bin/ar, not by arMember above.
    const members = arMembers(real(REAL.ar));
    expect([...members.keys()]).toEqual(['debian-binary', 'odd.txt', 'after.txt']);
    expect(dec(members.get('debian-binary')!)).toBe('2.0\n');
    expect(dec(members.get('odd.txt')!)).toBe('abc'); // 3 bytes, \n-padded by ar
    expect(dec(members.get('after.txt')!)).toBe('TAIL');
  });

  test('a 15-byte name fills the field exactly and a longer one comes out of the // table', () => {
    // Also built by /usr/bin/ar. 'abcdefghijklmno/' is 16 bytes, so there is
    // no trailing space to trim -- a reader that trimmed only spaces keeps
    // the '/', and one that always dropped the last byte loses the 'o'.
    // 'abcdefghijklmnop' does not fit and ar spills it into the '//'
    // long-name table as '/0'; a reader that did not resolve that returns a
    // member literally called '/0'.
    const members = arMembers(real(REAL.arBoundary));
    expect([...members.keys()]).toEqual(['abcdefghijklmno', 'abcdefghijklmnop']);
    // Seven bytes each, so ar's \n pad to an even offset is in play twice.
    expect(dec(members.get('abcdefghijklmno')!)).toBe('FIFTEEN');
    expect(dec(members.get('abcdefghijklmnop')!)).toBe('SIXTEEN');
  });

  test('it refuses something that is not an ar archive at all', () => {
    expect(() => arMembers(enc('not an archive'))).toThrow(/!<arch>/);
  });

  test('a member that runs off the end of the file is an error, not short bytes', () => {
    const truncated = concat([enc('!<arch>\n'), arMember('data.tar.gz/    ', enc('DATA'))]).subarray(
      0,
      8 + 60 + 2,
    );
    expect(() => arMembers(truncated)).toThrow(/truncat/i);
  });

  test('debEntries reads a whole .deb off disk', () => {
    const tar = concat([
      tarMember('usr/bin/screepub-engine', enc('ENGINE'), 0o755),
      new Uint8Array(1024), // end-of-archive
    ]);
    const deb = concat([
      enc('!<arch>\n'),
      arMember('debian-binary/  ', enc('2.0\n')),
      arMember('control.tar.gz/ ', Bun.gzipSync(new Uint8Array(1024))),
      arMember('data.tar.gz/    ', Bun.gzipSync(tar)),
    ]);
    const path = join(OUT, 'fake.deb');
    writeFileSync(path, deb);
    const entries = debEntries(path);
    expect(entries.map((e) => e.name)).toEqual(['usr/bin/screepub-engine']);
    expect(dec(entries[0]!.data)).toBe('ENGINE');
    expect(entries[0]!.mode & 0o111).not.toBe(0);
  });

  test('debEntries reads a .deb whose members GNU ar and GNU tar wrote', () => {
    const path = join(OUT, 'real.deb');
    writeFileSync(path, real(REAL.deb));
    const entries = bundleEntries(path);
    // GNU tar was handed './usr', so these names DO carry the prefix the
    // real tauri-bundler .deb omits -- which is exactly why findEntry
    // normalises it rather than matching either spelling literally.
    expect(entries.map((e) => e.name).sort()).toEqual([
      './usr/bin/screepub-engine',
      './usr/lib/Screepub/LICENSE',
      './usr/lib/Screepub/odd3',
    ]);
    expect(dec(findEntry(entries, 'usr/bin/screepub-engine').data)).toBe('ENGINE');
    expect(findEntry(entries, 'usr/bin/screepub-engine').mode & 0o111).not.toBe(0);
    expect(findEntry(entries, 'usr/lib/Screepub/LICENSE').mode & 0o111).toBe(0);
    expect(dec(findEntry(entries, 'usr/lib/Screepub/odd3').data)).toBe('XY');
  });

  test('a .deb with no data.tar.gz says so instead of returning nothing', () => {
    const deb = concat([enc('!<arch>\n'), arMember('debian-binary/  ', enc('2.0\n'))]);
    const path = join(OUT, 'empty.deb');
    writeFileSync(path, deb);
    expect(() => debEntries(path)).toThrow(/data\.tar\.gz/);
  });
});

describe('the cpio payload an .rpm carries', () => {
  test('it reads names, modes and bytes, and stops at the trailer', () => {
    const cpio = concat([
      cpioMember('./usr/bin/screepub-engine', enc('ENGINE'), 0o100755),
      cpioMember('./usr/lib/Screepub/LICENSE', enc('AGPL'), 0o100644),
      cpioTrailer(),
    ]);
    const entries = cpioEntries(cpio);
    expect(entries.map((e) => e.name)).toEqual([
      './usr/bin/screepub-engine',
      './usr/lib/Screepub/LICENSE',
    ]);
    expect(dec(entries[0]!.data)).toBe('ENGINE');
    expect(entries[0]!.mode & 0o111).not.toBe(0);
    // The second file is NOT executable. Without this, mode could be a
    // hardcoded 0o755 and every assertion above would still pass.
    expect(entries[1]!.mode & 0o111).toBe(0);
  });

  test('a name whose length is not a multiple of four does not shift the data', () => {
    // The header+name run is padded to 4 bytes and the data is padded
    // separately. These three names land on different sides of that rule.
    for (const name of ['./a', './abcd', './abcde']) {
      const entries = cpioEntries(concat([cpioMember(name, enc('XY')), cpioTrailer()]));
      expect(entries.map((e) => e.name)).toEqual([name]);
      expect(dec(entries[0]!.data)).toBe('XY');
    }
  });

  test('GNU cpio wrote directories among the files, and only the files come back', () => {
    // Built by /usr/bin/cpio -H newc, gzipped, exactly as an .rpm carries it.
    // The archive holds '.', 'usr', 'usr/bin', 'usr/lib' and
    // 'usr/lib/Screepub' as directory entries; a reader that did not test
    // S_IFREG would return five phantom zero-byte "files", two of which
    // ('usr/bin', 'usr/lib/Screepub') share a prefix with real ones.
    const entries = cpioEntries(Bun.gunzipSync(real(REAL.cpioGnuGz)));
    expect(entries.map((e) => e.name).sort()).toEqual([
      'usr/bin/screepub-engine',
      'usr/lib/Screepub/LICENSE',
      'usr/lib/Screepub/odd3',
    ]);
    expect(dec(findEntry(entries, 'usr/bin/screepub-engine').data)).toBe('ENGINE');
    expect(findEntry(entries, 'usr/bin/screepub-engine').mode & 0o111).not.toBe(0);
    expect(findEntry(entries, 'usr/lib/Screepub/LICENSE').mode & 0o111).toBe(0);
    // Two bytes, so the next header sits three bytes past the data.
    expect(dec(findEntry(entries, 'usr/lib/Screepub/odd3').data)).toBe('XY');
    expect(findEntry(entries, 'usr/lib/Screepub/odd3').size).toBe(2);
  });

  test('bsdtar wrote the same tree with the ./ prefix, and that reads too', () => {
    // The real .rpm's names carry './'; this is a real tool writing them
    // that way, so the reader is not only ever fed the spelling GNU cpio
    // happens to produce.
    const entries = cpioEntries(Bun.gunzipSync(real(REAL.cpioBsdGz)));
    expect(entries.map((e) => e.name).sort()).toEqual([
      './usr/bin/screepub-engine',
      './usr/lib/Screepub/LICENSE',
      './usr/lib/Screepub/odd3',
    ]);
    expect(dec(findEntry(entries, 'usr/lib/Screepub/odd3').data)).toBe('XY');
    expect(dec(findEntry(entries, './usr/lib/Screepub/LICENSE').data)).toBe('AGPL');
  });

  test('it refuses a payload that is not cpio', () => {
    expect(() => cpioEntries(enc('nope nope nope nope nope nope nope nope nope nope nope nope'))).toThrow(
      /07070/,
    );
  });

  test('a cpio that just stops, with no trailer, is an error', () => {
    // A truncated download decompresses fine and would otherwise come back
    // as a short but plausible file list.
    const cpio = concat([cpioMember('./usr/bin/screepub-engine', enc('ENGINE'))]);
    expect(() => cpioEntries(cpio)).toThrow(/TRAILER/);
  });

  test('rpmPayload skips the lead and both headers, padding included', () => {
    const payload = enc('PAYLOAD-BYTES');
    expect(dec(rpmPayload(fakeRpm(payload)))).toBe('PAYLOAD-BYTES');
  });

  test('rpmPayload refuses a file that is not an rpm', () => {
    expect(() => rpmPayload(new Uint8Array(200))).toThrow(/rpm/i);
  });

  test('rpmEntries reads a whole .rpm off disk', () => {
    const cpio = concat([cpioMember('./usr/bin/screepub-engine', enc('ENGINE')), cpioTrailer()]);
    const path = join(OUT, 'fake.rpm');
    writeFileSync(path, fakeRpm(Bun.gzipSync(cpio)));
    const entries = rpmEntries(path);
    expect(entries.map((e) => e.name)).toEqual(['./usr/bin/screepub-engine']);
    expect(dec(entries[0]!.data)).toBe('ENGINE');
  });

  test('rpmEntries reads a payload a real tool wrote', () => {
    const path = join(OUT, 'real-payload.rpm');
    writeFileSync(path, fakeRpm(real(REAL.cpioBsdGz)));
    expect(bundleEntries(path).map((e) => e.name).sort()).toEqual([
      './usr/bin/screepub-engine',
      './usr/lib/Screepub/LICENSE',
      './usr/lib/Screepub/odd3',
    ]);
  });

  test('a payload compressed with something other than gzip names the problem', () => {
    // tauri-bundler wrote gzip on 2026-09-14; zstd or xz would land here.
    const path = join(OUT, 'zstd.rpm');
    writeFileSync(path, fakeRpm(enc('(\xb5/\xfd not gzip at all')));
    expect(() => rpmEntries(path)).toThrow(/PAYLOADCOMPRESSOR/);
  });
});

describe('finding one file inside either container', () => {
  const entries: ArchiveEntry[] = [
    { name: 'usr/bin/screepub-desktop', size: 3, mode: 0o755, data: enc('abc') },
    { name: './usr/bin/screepub-engine', size: 6, mode: 0o755, data: enc('ENGINE') },
  ];

  test('it matches across the ./ prefix the two formats disagree about', () => {
    // The .deb's tar names have no ./ and the .rpm's cpio names do. Both
    // were observed in real bundles on 2026-09-14.
    expect(findEntry(entries, 'usr/bin/screepub-engine').size).toBe(6);
    expect(findEntry(entries, './usr/bin/screepub-desktop').size).toBe(3);
  });

  test('it does not match a longer name that merely ends the same way', () => {
    const decoys: ArchiveEntry[] = [
      { name: 'usr/bin/not-screepub-engine', size: 1, mode: 0, data: enc('x') },
    ];
    expect(() => findEntry(decoys, 'usr/bin/screepub-engine')).toThrow(/not-screepub-engine/);
  });

  test('nor a name that merely starts the same way', () => {
    const decoys: ArchiveEntry[] = [
      { name: './usr/bin/screepub-engine.bak', size: 1, mode: 0, data: enc('x') },
    ];
    expect(() => findEntry(decoys, 'usr/bin/screepub-engine')).toThrow(/engine\.bak/);
  });

  test('a miss names what it did find, so the failure is diagnosable', () => {
    expect(() => findEntry(entries, 'usr/bin/nothing')).toThrow(/screepub-desktop/);
  });
});

describe('bundleEntries dispatches on the extension', () => {
  test('it refuses a container it has no reader for', () => {
    expect(() => bundleEntries('/tmp/Screepub.dmg')).toThrow(/\.deb|\.rpm/);
    expect(() => bundleEntries('/tmp/Screepub-setup.exe')).toThrow(/\.deb|\.rpm/);
  });

  test('tarEntries still walks a plain tar, which both readers lean on', () => {
    const tar = concat([tarMember('a', enc('one')), tarMember('b', enc('two')), new Uint8Array(1024)]);
    expect(tarEntries(tar).map((e) => e.name)).toEqual(['a', 'b']);
  });

  test('tarEntries returns only regular files, with a directory in the way', () => {
    // GNU tar writes the directory before the files under it; typeflag '5'
    // carries no data but a reader that pushed it would report a zero-byte
    // "file" named like the directory.
    const dir = new Uint8Array(512);
    dir.set(enc('usr/bin/'), 0);
    dir.set(enc('0000755\0'), 100);
    dir.set(enc('00000000000\0'), 124);
    dir[156] = 0x35; // typeflag '5'
    const tar = concat([dir, tarMember('usr/bin/screepub-engine', enc('ENGINE')), new Uint8Array(1024)]);
    expect(tarEntries(tar).map((e) => e.name)).toEqual(['usr/bin/screepub-engine']);
  });
});
