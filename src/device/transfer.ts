import { mkdirSync } from 'node:fs';
import { join, basename } from 'node:path';
import type { ConnectedDevice } from './types';
import { copyToKindleVolume } from './kindle';
import { replaceFile } from '../replace-file';

export class TransferError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TransferError';
  }
}

/** Copy a book to its vendor's expected location: Kindle → documents/,
 * Kobo → volume root, tolino → Books/ at the root (subfolders of it
 * aren't reliably indexed; the folder is created if missing).
 * Replaces any previous copy. Returns the destination path.
 * Throws if the device has no mounted volume, or if it's a reMarkable
 * (which never mounts and is reached over its USB web interface instead). */
export function copyToVolume(file: string, device: ConnectedDevice): string {
  if (!device.volume) {
    throw new TransferError('Device has no mounted volume.');
  }

  const volume = device.volume;

  switch (device.kind) {
    case 'kindle':
      return copyToKindleVolume(file, volume);

    case 'kobo': {
      const destDir = volume;
      mkdirSync(destDir, { recursive: true });
      const dest = join(destDir, basename(file));
      replaceFile(file, dest);
      return dest;
    }

    case 'tolino': {
      const destDir = join(volume, 'Books');
      mkdirSync(destDir, { recursive: true });
      const dest = join(destDir, basename(file));
      replaceFile(file, dest);
      return dest;
    }

    case 'remarkable':
      throw new TransferError('Device has no mounted volume.');

    default:
      const _exhaustive: never = device.kind;
      return _exhaustive;
  }
}
