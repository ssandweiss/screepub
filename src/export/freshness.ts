import { statSync } from 'node:fs';

function modifiedAt(path: string, ifUnknown: number): number {
  try {
    return statSync(path).mtimeMs;
  } catch {
    return ifUnknown;
  }
}

/** True when `artifact` is missing, or no newer than the EPUB it derives
 * from. What it catches is a run that rewrote the EPUB but produced no new
 * artifact beside it.
 *
 * Ties count as stale: copyItem, `rsync -t`, Time Machine restores and
 * archive extraction can all reproduce identical mtimes.
 *
 * The two fallbacks are deliberately asymmetric. The artifact side fails
 * closed toward "regenerate" via -Infinity; the EPUB side must fail closed
 * the OTHER way, via +Infinity, or an unreadable EPUB (deleted, unmounted,
 * no permission) would compare as older than everything and a stale artifact
 * would be reported fresh. */
export function needsRegeneration(artifact: string, freshRelativeTo: string): boolean {
  const artifactDate = modifiedAt(artifact, -Infinity);
  if (artifactDate === -Infinity) return true;
  const epubDate = modifiedAt(freshRelativeTo, Infinity);
  return artifactDate <= epubDate;
}
