// USB-mounted Kindle detection and transfer. Older Kindles mount as a mass-
// storage volume with a `documents/` folder (newer firmware is MTP and never
// appears as a volume at all — those use the email/web routes).
import { existsSync, mkdirSync } from 'node:fs';
import { basename, join } from 'node:path';
import { replaceFile } from '../replace-file';
import { isDirectory } from './paths';

/** A mounted volume looks like a Kindle when it has a `documents/` folder and
 * either a Kindle-ish volume name or a `system/` entry.
 *
 * Swift ORs two names — the volume's `.volumeNameKey` and its last path
 * component — but on every platform this runs on, a removable volume is
 * mounted at a directory named after the volume, so the two are the same
 * string and the OR collapses to this one basename check. (classify.ts
 * documents the same collapse for its own name test.)
 *
 * `system` is tested with existsSync, not isDirectory, matching Swift's
 * `fileExists` with no directory flag: the check is "the firmware left its
 * marker here", and narrowing it to a directory would reject a Kindle whose
 * marker is of another type. `documents` is the one that must be a real
 * directory — we copy INTO it. */
export function isKindleVolume(volume: string): boolean {
  if (!isDirectory(join(volume, 'documents'))) return false;
  if (basename(volume).toLowerCase().includes('kindle')) return true;
  return existsSync(join(volume, 'system'));
}

/** Copy a book into the device's documents folder, replacing any previous
 * copy. Returns the destination path. */
export function copyToKindleVolume(file: string, volume: string): string {
  const destDir = join(volume, 'documents');
  // DIVERGENCE from KindleDevice.copy(_:to:), deliberately: Swift creates no
  // directory. isKindleVolume guarantees `documents/` upstream, so this is a
  // no-op on any real device; it makes the function honest when called with a
  // bare path (a test volume, a hand-typed destination) instead of failing
  // deep inside the copy.
  mkdirSync(destDir, { recursive: true });
  const dest = join(destDir, basename(file));
  replaceFile(file, dest);
  return dest;
}
