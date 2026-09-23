import { afterAll, test, expect } from 'bun:test';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { platform } from 'node:process';
import { volumeRoots, enumerateVolumes, mountedDevices, rootIsItselfAVolume } from '../src/device/volumes';

const SCRATCH = mkdtempSync(join(tmpdir(), 'screepub-device-volumes-'));
afterAll(() => rmSync(SCRATCH, { recursive: true, force: true }));

/** A fake mount root holding several "volumes", so enumeration is tested by
 * injection and never against whatever is really plugged into this machine. */
function mountRoot(volumes: Record<string, string[]>): string {
  const root = mkdtempSync(join(SCRATCH, 'mounts-'));
  for (const [name, subdirs] of Object.entries(volumes)) {
    mkdirSync(join(root, name), { recursive: true });
    for (const sub of subdirs) mkdirSync(join(root, name, sub), { recursive: true });
  }
  return root;
}

test('enumerate lists the directories under an injected root', () => {
  const root = mountRoot({ Kindle: ['documents'], KOBOeReader: ['.kobo'], 'USB STICK': [] });
  expect(enumerateVolumes([root]).map((p) => basename(p)).sort())
    .toEqual(['KOBOeReader', 'Kindle', 'USB STICK'].sort());
});

test('enumerate ignores files and missing roots', () => {
  const root = mountRoot({ Kindle: ['documents'] });
  writeFileSync(join(root, 'loose-file.txt'), 'x');
  const found = enumerateVolumes([root, join(SCRATCH, 'no-such-root')]);
  expect(found.map((p) => basename(p))).toEqual(['Kindle']);
});

test('mountedDevices classifies what it finds and drops plain drives', () => {
  const root = mountRoot({ Kindle: ['documents'], KOBOeReader: ['.kobo'], 'USB STICK': ['documents'] });
  const devices = mountedDevices([root]);
  expect(devices.map((d) => d.kind).sort()).toEqual(['kindle', 'kobo']);
  expect(devices.find((d) => d.kind === 'kobo')?.name).toBe('KOBOeReader');
  expect(devices.every((d) => d.volume !== null)).toBe(true);
});

test('mountedDevices on an empty root finds nothing', () => {
  expect(mountedDevices([mountRoot({})])).toEqual([]);
});

test('the default roots are the right ones for this platform', () => {
  const roots = volumeRoots();
  if (platform === 'darwin') expect(roots).toEqual(['/Volumes']);
  if (platform === 'linux') {
    expect(roots.some((r) => r.startsWith('/run/media'))).toBe(true);
    expect(roots).toContain('/media');
  }
  if (platform === 'win32') expect(roots.some((r) => /^[A-Z]:\\$/.test(r))).toBe(true);
});

// rootIsItselfAVolume drives the "a root IS a volume on Windows" branch in
// enumerateVolumes. It is gated on the real platform, so without an
// OS-injectable predicate that branch is unreachable — and untested — on any
// machine other than actual Windows. Injecting `os` lets it be exercised for
// every platform right here.
test('a drive root is itself a volume only on win32', () => {
  expect(rootIsItselfAVolume('D:\\', 'win32')).toBe(true);
});

test('a lowercase drive root is recognised too', () => {
  // The predicate is shared with classify.ts (src/device/paths.ts) precisely
  // because the two copies had drifted: this file's regex was [A-Z] only,
  // which would have failed to recognise a lowercase root and handed the
  // caller an empty volume name. Windows accepts either case.
  expect(rootIsItselfAVolume('d:\\', 'win32')).toBe(true);
});

test('a drive-root-shaped string is not itself a volume off Windows', () => {
  expect(rootIsItselfAVolume('D:\\', 'linux')).toBe(false);
});

test('a non-drive-root path is never itself a volume, even on win32', () => {
  expect(rootIsItselfAVolume('/Volumes', 'darwin')).toBe(false);
  expect(rootIsItselfAVolume('/Volumes', 'win32')).toBe(false);
});
