// USB-mounted Kindle detection and transfer. Older Kindles mount as a mass-
// storage volume with a `documents/` folder (newer firmware is MTP and never
// appears as a volume at all — those use the email/web routes).
import { mkdirSync, statSync } from 'node:fs';
import { basename, join } from 'node:path';
import { replaceFile } from '../replace-file';

function isDirectory(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

function exists(path: string): boolean {
  try {
    statSync(path);
    return true;
  } catch {
    return false;
  }
}

/** A mounted volume looks like a Kindle when it has a `documents/` folder and
 * either a Kindle-ish volume name or a `system/` folder. */
export function isKindleVolume(volume: string): boolean {
  if (!isDirectory(join(volume, 'documents'))) return false;
  if (basename(volume).toLowerCase().includes('kindle')) return true;
  return exists(join(volume, 'system'));
}

export function kindleVolumeName(volume: string): string {
  return basename(volume);
}

/** Copy a book into the device's documents folder, replacing any previous
 * copy. Returns the destination path. */
export function copyToKindleVolume(file: string, volume: string): string {
  const destDir = join(volume, 'documents');
  mkdirSync(destDir, { recursive: true });
  const dest = join(destDir, basename(file));
  replaceFile(file, dest);
  return dest;
}
