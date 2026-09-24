import { copyFileSync, rmSync } from 'node:fs';

/** Copy a file over whatever is at `destination`. Used by both the device
 * transfer paths and the export path, so the replace semantics can't drift
 * between them. */
export function replaceFile(source: string, destination: string): void {
  rmSync(destination, { force: true });
  copyFileSync(source, destination);
}
