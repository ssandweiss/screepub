// The ONLY part of the device layer that cannot be unit-tested against
// reality: what is actually mounted depends on what is physically plugged in.
// Kept deliberately dumb, with injectable roots, so that all the real device
// knowledge lives in classify.ts where it can be tested everywhere.
import { readdirSync, statSync } from 'node:fs';
import { userInfo } from 'node:os';
import { join } from 'node:path';
import { platform } from 'node:process';
import { classify, volumeName } from './classify';
import type { ConnectedDevice } from './types';

/** Where this OS mounts removable media. On Windows these are drive roots
 * rather than a parent directory, so enumerateVolumes treats a root that is
 * itself a volume correctly by listing its PARENT's children — see below. */
export function volumeRoots(): string[] {
  if (platform === 'darwin') return ['/Volumes'];
  if (platform === 'win32') {
    // Drive letters are themselves volumes, so each is returned as a root
    // whose single child is itself. C: is skipped: it is the system disk.
    return 'DEFGHIJKLMNOPQRSTUVWXYZ'.split('').map((letter) => `${letter}:\\`);
  }
  const user = userInfo().username;
  return [`/run/media/${user}`, `/media/${user}`, '/media'];
}

function isDirectory(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

/** Every mounted volume path under the given roots (default: this platform's).
 * On Windows a root IS a volume; elsewhere a root CONTAINS volumes. */
export function enumerateVolumes(roots: string[] = volumeRoots()): string[] {
  const found: string[] = [];
  for (const root of roots) {
    if (!isDirectory(root)) continue;
    if (platform === 'win32' && /^[A-Z]:\\$/.test(root)) {
      found.push(root);
      continue;
    }
    let entries: string[];
    try {
      entries = readdirSync(root);
    } catch {
      continue;
    }
    for (const entry of entries) {
      const path = join(root, entry);
      if (isDirectory(path)) found.push(path);
    }
  }
  return found;
}

/** All recognized devices among currently mounted volumes. */
export function mountedDevices(roots?: string[]): ConnectedDevice[] {
  const devices: ConnectedDevice[] = [];
  for (const volume of enumerateVolumes(roots)) {
    const kind = classify(volume);
    if (!kind) continue;
    devices.push({ kind, name: volumeName(volume), volume });
  }
  return devices;
}
