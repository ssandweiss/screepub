// The two path predicates every device module needs. They live here because
// they had drifted: `isDirectory` was byte-identical in three files, and the
// Windows drive-root regex was written twice with DIFFERENT case handling —
// exactly the two-copies-diverge failure the registry's shared-discriminator
// rule (#5b, #18) exists to forbid.
import { statSync } from 'node:fs';

export function isDirectory(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

/** A bare Windows drive root, e.g. "D:\" or "d:\". Case-INSENSITIVE on the
 * drive letter: Windows itself accepts either case, so the stricter [A-Z]
 * form would silently fail to recognise a lowercase root and hand the caller
 * an empty volume name. Pure string matching, independent of the host
 * platform, so it is exercised the same way in tests everywhere — callers
 * that also care about the host (volumes.ts) check the platform themselves. */
export function isWindowsDriveRoot(path: string): boolean {
  return /^[A-Za-z]:\\$/.test(path);
}
