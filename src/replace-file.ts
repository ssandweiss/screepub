import { createHash } from 'node:crypto';
import { copyFileSync, renameSync, rmSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { errorMessage } from './cli-errors';

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
 * The error that reaches the caller names the book, never the partial: the
 * send's failure line shows it to the reader as it is (cli-devices.ts), and
 * a hidden file they never chose is no help there. See namingTheBook(). */
export function replaceFile(source: string, destination: string): void {
  const partial = partialPathFor(destination);
  try {
    copyFileSync(source, partial);
    renameSync(partial, destination);
  } catch (error) {
    try {
      rmSync(partial, { force: true });
    } catch {
      // Left behind, and written over by this book's next send (see
      // partialPathFor). Why the copy failed is the error worth reporting;
      // a clean-up that failed as well must not take its place.
    }
    throw namingTheBook(error, partial, destination);
  }
}

/** The hidden file a copy to `destination` goes through: same folder, and
 * a SHORT name of fixed length. It used to be the book's own name with 18
 * characters added, so a book named with 238 to 255 characters, which
 * copied fine before, failed on a reader: FAT32 and exFAT stop a name at
 * 255. The eight hex characters come from the book's name, so a partial
 * left by a send that was killed outright is the same file the next send of
 * that book writes over, instead of one more piling up on the reader. The
 * leading dot keeps Finder and the reader's library scan blind to it, and
 * `.partial` is not an extension any reader opens. */
export function partialPathFor(destination: string): string {
  const mark = createHash('sha256').update(basename(destination)).digest('hex').slice(0, 8);
  return join(dirname(destination), `.screepub-${mark}.partial`);
}

/** The system's error, with the book where the partial was. Node and Bun
 * say `CODE: what, syscall 'from' -> 'to'`: the code and the sentence are
 * kept, `code` rides along for callers that test it, and a rename's
 * `'<partial>' -> '<book>'` collapses to the book alone. */
function namingTheBook(error: unknown, partial: string, destination: string): Error {
  const message = errorMessage(error)
    .split(`'${partial}' -> '${destination}'`).join(`'${destination}'`)
    .split(partial).join(destination);
  const named: NodeJS.ErrnoException = new Error(message);
  const code = (error as NodeJS.ErrnoException | null)?.code;
  if (typeof code === 'string') named.code = code;
  return named;
}
