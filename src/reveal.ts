// The `reveal` verb's performer: opens the system's file manager on a file.
// This is the ONE place that spawns anything for this verb, so a test can
// hand it a fake Opener and never open a real Finder/Explorer window during
// a run. src/cli-reveal.ts is the handler: it checks the path is absolute
// and exists BEFORE this ever runs, so revealFile itself does neither check.
import { posix, win32 } from 'node:path';
import { CliError, errorMessage } from './cli-errors';

/** One child process, run to completion, with its exit code and stderr
 *  captured. Piece B's performer (src/export/route-perform.ts, on a
 *  different branch) uses the same one-line shape for the same reason: the
 *  two "open something in the system" verbs should agree on what running an
 *  opener means, without importing across the parity split. */
export type Opener = (argv: string[]) => Promise<{ code: number; stderr: string }>;

/** The real thing, via Bun.spawn. Kept tiny on purpose: it is the only part
 *  of this file no test ever runs, because running it is exactly the real
 *  reveal every test is forbidden from causing. */
export const spawnOpener: Opener = async (argv) => {
  const proc = Bun.spawn(argv, { stdout: 'ignore', stderr: 'pipe' });
  const [code, stderr] = await Promise.all([proc.exited, new Response(proc.stderr).text()]);
  return { code, stderr };
};

/** Show `path` in the system's file manager.
 *
 * darwin: `open -R <path>` selects the file itself in Finder.
 *
 * win32: `explorer <folder>`, opening the CONTAINING folder rather than
 * selecting the file with `explorer /select,<path>`. That flag's argument
 * parsing breaks on a path that has both a space and a comma in it (the
 * comma reads as ending the argument), which is common enough in a folder
 * or script name that it is not a corner case. Piece B's performer learned
 * the same lesson for the same reason; opening the folder sidesteps the
 * quoting problem entirely instead of trying to escape around it.
 * explorer also exits 1 on plenty of perfectly successful runs, so its exit
 * code is not trustworthy and is ignored outright.
 *
 * Everything else: `xdg-open <folder>`. There is no "select this file"
 * convention to rely on across Linux file managers, so this opens the
 * folder too, the same as win32.
 */
export async function revealFile(
  path: string,
  platform: NodeJS.Platform = process.platform,
  open: Opener = spawnOpener,
): Promise<void> {
  const argv =
    platform === 'darwin'
      ? ['open', '-R', path]
      : platform === 'win32'
        ? ['explorer', win32.dirname(path)]
        : ['xdg-open', posix.dirname(path)];

  let result: { code: number; stderr: string };
  try {
    result = await open(argv);
  } catch (err) {
    // The tool itself could not be started at all (most commonly ENOENT:
    // no Finder, Explorer or xdg-open on this machine). This is the one
    // failure explorer's "ignore the exit code" rule above does not cover,
    // because there is no exit code at all to ignore.
    throw new CliError(
      'reveal-failed',
      `the file manager could not be opened to show ${path}: ${errorMessage(err)}`,
    );
  }

  // explorer exits 1 on plenty of ordinary, successful runs, so its code is
  // never checked; every other opener's non-zero exit is a real failure.
  if (platform === 'win32') return;
  if (result.code !== 0) {
    const detail = result.stderr.trim();
    throw new CliError(
      'reveal-failed',
      `could not show ${path} in the file manager${detail ? `: ${detail}` : ''}`,
    );
  }
}
