// The pure vendor predicate: given a mounted volume's path, which e-reader
// family is it? All device knowledge lives here, so it is testable with temp
// directories on every platform. Enumerating what is actually mounted is
// volumes.ts's job and is the only part that cannot be unit-tested.
import { basename, join } from 'node:path';
import { isKindleVolume } from './kindle';
import { isDirectory, isWindowsDriveRoot } from './paths';
import type { DeviceKind } from './types';

/** A bare Windows drive root has no basename component (path.basename
 * returns '' for it on win32), so it is special-cased to the drive
 * designator instead — "D:\" -> "D:" — rather than surfacing an empty
 * device name. The predicate itself lives in paths.ts, shared with
 * volumes.ts, because the two copies had already drifted on letter case. */
export function volumeName(volume: string): string {
  if (isWindowsDriveRoot(volume)) return volume.slice(0, -1);
  return basename(volume);
}

/** Vendor signature of a mounted volume, or null for a plain drive. Kobo
 * firmware maintains a `.kobo` folder at the root; tolino mounts under its
 * brand name; Kindle keeps the documents/ check.
 *
 * Name-based detection (tolino) cannot work on a Windows drive root: a drive
 * letter like "D:" carries no vendor information, so tolino is simply not
 * detectable there without a separate volume-label lookup, which this layer
 * deliberately does not perform (enumeration must stay a pure directory
 * listing — see volumes.ts). Kindle and Kobo are unaffected because both are
 * detected by on-disk signature (`documents/`, `.kobo`) rather than by name. */
export function classify(volume: string): DeviceKind | null {
  if (isKindleVolume(volume)) return 'kindle';
  if (isDirectory(join(volume, '.kobo'))) return 'kobo';
  if (volumeName(volume).toLowerCase().includes('tolino')) return 'tolino';
  return null;
}
