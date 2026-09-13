// The pure vendor predicate: given a mounted volume's path, which e-reader
// family is it? All device knowledge lives here, so it is testable with temp
// directories on every platform. Enumerating what is actually mounted is
// volumes.ts's job and is the only part that cannot be unit-tested.
import { statSync } from 'node:fs';
import { basename, join } from 'node:path';
import { isKindleVolume } from './kindle';
import type { DeviceKind } from './types';

export function volumeName(volume: string): string {
  return basename(volume);
}

function isDirectory(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

/** Vendor signature of a mounted volume, or null for a plain drive. Kobo
 * firmware maintains a `.kobo` folder at the root; tolino mounts under its
 * brand name; Kindle keeps the documents/ check. */
export function classify(volume: string): DeviceKind | null {
  if (isKindleVolume(volume)) return 'kindle';
  if (isDirectory(join(volume, '.kobo'))) return 'kobo';
  if (volumeName(volume).toLowerCase().includes('tolino')) return 'tolino';
  return null;
}
