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

/** The real thing, via Bun.spawn. Kept tiny on purpose: revealFile's own
 *  tests all pass a fake in its place, and never a real Finder/Explorer
 *  argv, so this is the only code path a real reveal ever runs through.
 *  Tested directly in tests/cli-reveal.test.ts against a throwaway bun
 *  subprocess (never `open`, `explorer` or `xdg-open`) for the exit-code
 *  and stderr-capture plumbing, and against a program name that cannot
 *  exist for the ENOENT path. `stdin: 'ignore'` is explicit, matching piece
 *  B's performer: none of these tools read from stdin, and Bun 1.3.14
 *  already gives a spawned child no input by default. Spelling it out here
 *  changes nothing today; it only stops that guarantee from depending on
 *  the default instead of being written down. */
export const spawnOpener: Opener = async (argv) => {
  const proc = Bun.spawn(argv, { stdout: 'ignore', stderr: 'pipe', stdin: 'ignore' });
  const [code, stderr] = await Promise.all([proc.exited, new Response(proc.stderr).text()]);
  return { code, stderr };
};

/** Show `path` in the system's file manager.
 *
 * darwin: `open -R <path>` selects the file itself in Finder.
 *
 * win32: `explorer <folder>`, opening the CONTAINING folder rather than
 * selecting the file with `explorer /select,<path>`. That flag breaks on a
 * folder or script name with a SPACE in it alone (the spawn layer quotes
 * the whole argv element for the child process, and explorer then reads
 * the quotes as part of the path instead of as `/select,` followed by one)
 * or a COMMA in it alone (explorer reads the first comma it finds as the
 * end of the `/select,` token, wherever that actually falls). Piece B's
 * performer learned the same lesson for the same reason; opening the
 * folder sidesteps the quoting problem entirely instead of trying to
 * escape around it. explorer also exits 1 on plenty of perfectly
 * successful runs, so its exit code is not trustworthy and is ignored
 * outright.
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
  // win32.resolve runs BEFORE win32.dirname: a path like `C:\x\a.exe\.`
  // (a trailing "\." segment, meaning "this same file") is not normalised
  // by dirname on its own, which strips only the LAST segment and returns
  // `C:\x\a.exe` right back: the file itself, not its folder. resolve
  // collapses the trailing "\." away first, through Windows' own path
  // normalisation rules, not a shell's, so dirname always sees an
  // already-normalised path to strip a real filename off.
  const argv =
    platform === 'darwin'
      ? ['open', '-R', path]
      : platform === 'win32'
        ? ['explorer', win32.dirname(win32.resolve(path))]
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
