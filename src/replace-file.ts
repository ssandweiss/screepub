import { copyFileSync, renameSync, rmSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';

/** Copy a file over whatever is at `destination`, which on a USB send is the
 * reader's previous copy of the book. Used by every device transfer path
 * (kindle.ts, transfer.ts), so the replace semantics cannot drift between
 * them. cli-export.ts's copyArtifactAtomic is the same rule, async, for a
 * save to a path the person chose.
 *
 * The copy goes to a hidden file in the destination's own folder and is then
 * renamed over the destination. It used to delete the destination first and
 * copy second, so a copy that failed part way (a nearly full reader, a cable
 * pulled mid-write) left the reader with no copy at all. Now a failure
 * leaves the old copy exactly as it was: the partial file is removed and the
 * error goes to the caller. Same folder means same volume, so the rename is
 * one step and never a second copy; rename replaces an existing file on
 * every platform this runs on (Node's renameSync does on Windows too), which
 * artifact.ts's writeFileAtomic already relies on.
 *
 * The cost: while the copy is in flight the reader holds both copies, so a
 * reader with room for only one refuses the send and keeps the old book,
 * where it used to trade the old book for a chance at the new one.
 *
 * The partial file's name is fixed per book rather than per process, so one
 * left by a send that was killed outright is written over by the next send
 * of that book instead of piling up on the reader. The leading dot keeps
 * Finder and the reader's library scan blind to it, and its extension is not
 * one any reader opens. */
export function replaceFile(source: string, destination: string): void {
  const partial = join(dirname(destination), `.${basename(destination)}.screepub-partial`);
  try {
    copyFileSync(source, partial);
    renameSync(partial, destination);
  } catch (error) {
    rmSync(partial, { force: true });
    throw error;
  }
}
