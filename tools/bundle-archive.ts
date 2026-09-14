// Open a .deb or an .rpm and read the files inside it, with no external
// tool, on any platform.
//
// The design sketched `ar x` for the .deb and `rpm2cpio | cpio -id` for the
// .rpm. Neither is safe to assume: rpm2cpio, dpkg-deb and 7z are all absent
// on this development machine, and none of them -- nor bsdtar -- is
// guaranteed on GitHub's ubuntu image. A check that shells out to a missing
// tool is a check that skips, which is the one failure mode worth spending
// a hundred lines to avoid. Both containers are fixed ASCII headers around
// a gzip stream Bun already decompresses, so the readers below are shorter
// than the CI step that would install the tools -- and they behave
// identically on Linux, macOS and Windows runners.
//
// Same reasoning tools/build-cli.ts already recorded for walking a tar
// itself rather than parsing `tar -tzvf` output.

import { readFileSync } from 'node:fs';
import { tarEntries, type ArchiveEntry } from './build-cli';

const AR_MAGIC = '!<arch>\n';

/** Bun.gunzipSync will not take a plain Uint8Array, whose buffer could be a
 *  SharedArrayBuffer as far as the types know. Everything here is a view on
 *  bytes readFileSync produced, so the assertion is safe and the alternative
 *  is copying 44 MB to change nothing. */
function gunzip(bytes: Uint8Array): Uint8Array {
  return Bun.gunzipSync(bytes as Uint8Array<ArrayBuffer>);
}

function ascii(bytes: Uint8Array): string {
  return new TextDecoder('latin1').decode(bytes);
}

/** The members of an `ar` archive, in order, by name.
 *
 *  Each member is a 60-byte header -- name(16) mtime(12) uid(6) gid(6)
 *  mode(8) size(10) magic(2) -- with every field space-padded, followed by
 *  the data padded to an EVEN offset with a single \n. GNU ar terminates
 *  the name with '/'; a name too long for the 16-byte field goes into a
 *  leading '//' member and is referenced as '/<offset>'. A .deb never needs
 *  that (its three names are short), but resolving it costs four lines and
 *  the alternative is a member called '/0'.
 *
 *  Not handled: the BSD '#1/<len>' long-name spelling, which GNU ar and
 *  dpkg never write. It would surface as a member literally named '#1/13'
 *  and debEntries' "holds no data.tar.gz" error would name it. */
export function arMembers(bytes: Uint8Array): Map<string, Uint8Array> {
  if (ascii(bytes.subarray(0, 8)) !== AR_MAGIC) {
    throw new Error(
      `bundle-archive: not an ar archive (expected the ${JSON.stringify(AR_MAGIC)} magic, ` +
        `got ${JSON.stringify(ascii(bytes.subarray(0, 8)))})`,
    );
  }
  const members = new Map<string, Uint8Array>();
  let longNames = '';
  let off = 8;
  while (off + 60 <= bytes.length) {
    const header = bytes.subarray(off, off + 60);
    if (header[58] !== 0x60 || header[59] !== 0x0a) {
      throw new Error(`bundle-archive: ar member header at offset ${off} has no 0x60 0x0a magic`);
    }
    const rawName = ascii(header.subarray(0, 16)).trim();
    const size = parseInt(ascii(header.subarray(48, 58)).trim(), 10);
    if (!Number.isFinite(size) || size < 0) {
      throw new Error(`bundle-archive: ar member "${rawName}" declares an unreadable size`);
    }
    const start = off + 60;
    if (start + size > bytes.length) {
      throw new Error(
        `bundle-archive: ar member "${rawName}" claims ${size} bytes but the archive is ` +
          `truncated ${start + size - bytes.length} bytes short`,
      );
    }
    const data = bytes.subarray(start, start + size);
    if (rawName === '//') {
      longNames = ascii(data); // the long-name table, not a member
    } else if (rawName !== '/' && rawName !== '/SYM64/') {
      // '/' and '/SYM64/' are the archive symbol table, not a member either.
      let name = rawName;
      const ref = /^\/(\d+)$/.exec(rawName);
      if (ref) {
        const at = Number(ref[1]);
        const end = longNames.indexOf('/\n', at);
        if (end < 0) {
          throw new Error(
            `bundle-archive: ar member "${rawName}" points outside the // long-name table`,
          );
        }
        name = longNames.slice(at, end);
      }
      members.set(name.replace(/\/$/, ''), data);
    }
    off = start + size + (size % 2); // the \n pad to an even offset
  }
  // A member header is 60 bytes; fewer than that left over means the archive
  // was cut inside one. Without this the loop just exits and returns a
  // PLAUSIBLE SHORT LIST, and the caller blames the wrong thing ("holds no
  // data.tar.gz") instead of saying the file is truncated. This is the guard
  // cpio already has for its missing TRAILER!!!; ar never got the equivalent.
  if (off !== bytes.length) {
    throw new Error(
      `bundle-archive: ar archive is truncated -- ${bytes.length - off} bytes left over ` +
        'after the last complete member, too few for a 60-byte header',
    );
  }
  return members;
}

/** Every regular file in a `newc`/`crc` cpio stream.
 *
 *  110-byte header of 8-hex-digit fields, then the NUL-terminated name,
 *  then the data. The header+name run is padded to 4 bytes and the data is
 *  padded to 4 bytes SEPARATELY. The stream ends at the TRAILER!!! entry,
 *  and its absence means the stream was cut short. */
export function cpioEntries(bytes: Uint8Array): ArchiveEntry[] {
  const entries: ArchiveEntry[] = [];
  let off = 0;
  for (;;) {
    // The magic is checked before the length, so bytes that are not cpio at
    // all are named as such rather than reported as a truncated cpio.
    const magic = ascii(bytes.subarray(off, off + 6));
    if (magic !== '070701' && magic !== '070702') {
      throw new Error(
        `bundle-archive: cpio entry at offset ${off} has magic ${JSON.stringify(magic)}, ` +
          'expected 070701 or 070702',
      );
    }
    if (off + 110 > bytes.length) {
      throw new Error(`bundle-archive: cpio header at offset ${off} is cut off mid-header`);
    }
    const field = (i: number): number =>
      parseInt(ascii(bytes.subarray(off + 6 + i * 8, off + 6 + i * 8 + 8)), 16);
    const mode = field(1);
    const fileSize = field(6);
    const nameSize = field(11);
    // `mode` is guarded too: parseInt('ZZZZZZZZ', 16) is NaN, NaN & 0o170000
    // is 0, and the entry would then be silently classified as not-a-regular
    // file -- a corrupt payload returning an EMPTY list instead of an error.
    if (
      !Number.isFinite(fileSize) ||
      !Number.isFinite(nameSize) ||
      !Number.isFinite(mode) ||
      nameSize < 1
    ) {
      throw new Error(`bundle-archive: cpio entry at offset ${off} has unreadable size fields`);
    }
    const nameStart = off + 110;
    const name = ascii(bytes.subarray(nameStart, nameStart + nameSize - 1)); // drop the NUL
    if (name === 'TRAILER!!!') return entries;
    const dataStart = nameStart + nameSize + ((4 - ((110 + nameSize) % 4)) % 4);
    if (dataStart + fileSize > bytes.length) {
      throw new Error(
        `bundle-archive: cpio entry "${name}" claims ${fileSize} bytes but the payload ends first`,
      );
    }
    // S_IFREG is 0o100000. Directories and symlinks carry no bytes worth
    // returning and would collide by name with the files under them.
    if ((mode & 0o170000) === 0o100000) {
      entries.push({
        name,
        size: fileSize,
        mode: mode & 0o7777,
        data: bytes.subarray(dataStart, dataStart + fileSize),
      });
    }
    off = dataStart + fileSize + ((4 - (fileSize % 4)) % 4);
    if (off >= bytes.length) {
      throw new Error(
        `bundle-archive: the cpio payload ended after ${entries.length} files with no ` +
          'TRAILER!!! entry, so it is truncated and this file list is incomplete',
      );
    }
  }
}

/** The compressed payload of an .rpm: everything after the 96-byte lead,
 *  the signature header (padded to an 8-byte boundary) and the header
 *  (not padded). Each header is 16 bytes of preamble, then nindex 16-byte
 *  index entries, then hsize bytes of store. */
export function rpmPayload(bytes: Uint8Array): Uint8Array {
  if (bytes[0] !== 0xed || bytes[1] !== 0xab || bytes[2] !== 0xee || bytes[3] !== 0xdb) {
    throw new Error('bundle-archive: not an rpm (the ed ab ee db lead magic is missing)');
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const headerEnd = (start: number): number => {
    if (start + 16 > bytes.length) {
      throw new Error(`bundle-archive: rpm ends before the header at offset ${start} begins`);
    }
    if (bytes[start] !== 0x8e || bytes[start + 1] !== 0xad || bytes[start + 2] !== 0xe8) {
      throw new Error(`bundle-archive: rpm header at offset ${start} has no 8e ad e8 magic`);
    }
    const nindex = view.getUint32(start + 8, false);
    const hsize = view.getUint32(start + 12, false);
    const end = start + 16 + nindex * 16 + hsize;
    if (end > bytes.length) {
      throw new Error(
        `bundle-archive: rpm header at offset ${start} declares ${end - start} bytes, past the ` +
          `end of a ${bytes.length}-byte file`,
      );
    }
    return end;
  };
  const sigEnd = headerEnd(96);
  const hdrStart = sigEnd + ((8 - (sigEnd % 8)) % 8); // only the SIGNATURE header is padded
  return bytes.subarray(headerEnd(hdrStart));
}

export function debEntries(path: string): ArchiveEntry[] {
  const members = arMembers(readFileSync(path));
  const data = members.get('data.tar.gz');
  if (!data) {
    throw new Error(
      `bundle-archive: ${path} holds no data.tar.gz (it holds: ` +
        `${[...members.keys()].join(', ') || '<nothing>'})`,
    );
  }
  return tarEntries(gunzip(data));
}

export function rpmEntries(path: string): ArchiveEntry[] {
  // Observed 2026-09-14: tauri-bundler's rpm carries PAYLOADFORMAT cpio and
  // PAYLOADCOMPRESSOR gzip. If that ever becomes zstd or xz, gunzipSync
  // throws here and the message below is the first thing anyone reads.
  const payload = rpmPayload(readFileSync(path));
  let cpio: Uint8Array;
  try {
    cpio = gunzip(payload);
  } catch (err) {
    throw new Error(
      `bundle-archive: ${path}'s payload did not gunzip (${
        err instanceof Error ? err.message : String(err)
      }). tauri-bundler wrote a gzip cpio payload when this reader was written; a different ` +
        'PAYLOADCOMPRESSOR (zstd, xz) needs a new branch here.',
    );
  }
  return cpioEntries(cpio);
}

export function bundleEntries(path: string): ArchiveEntry[] {
  if (path.endsWith('.deb')) return debEntries(path);
  if (path.endsWith('.rpm')) return rpmEntries(path);
  throw new Error(
    `bundle-archive: ${path} is neither a .deb nor an .rpm. A .dmg needs hdiutil and ` +
      'an NSIS .exe needs 7z; those are opened on the OS that has them.',
  );
}

/** One entry by path, tolerating the ./ prefix the two formats disagree
 *  about: a .deb's tar names it `usr/bin/screepub-engine` and an .rpm's
 *  cpio names it `./usr/bin/screepub-engine`. A bare `endsWith` would also
 *  answer `usr/bin/not-screepub-engine`, so the prefix is normalised on
 *  both sides rather than ignored. */
export function findEntry(entries: ArchiveEntry[], suffix: string): ArchiveEntry {
  const strip = (p: string) => p.replace(/^\.?\//, '');
  const want = strip(suffix);
  const found = entries.find((e) => strip(e.name) === want);
  if (!found) {
    const held = entries.map((e) => e.name).join(', ') || '<nothing>';
    throw new Error(`bundle-archive: no ${suffix} inside the bundle (it holds: ${held})`);
  }
  return found;
}
