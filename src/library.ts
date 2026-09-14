// The library: where a converted script's files live when the caller did not
// say. A window has no business inventing this path — the engine owns it, so
// the CLI, the Tauri shell and anything later all land in the same place and
// `screepub settings` can still find a sidecar it wrote.
//
// The CLI's own default is unchanged: without --library a conversion still
// writes beside its input, which is what a command-line tool is expected to
// do and what existing scripts already rely on.
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, extname, join, posix, resolve, win32 } from 'node:path';

/** Names this folder's script, so a second PDF with the same stem cannot
 * quietly overwrite the first one's book. One file per script folder. */
const SOURCE_FILE = 'source.json';

type Env = Record<string, string | undefined>;

/** Where the library lives, per platform.
 *
 * SCREEPUB_LIBRARY wins everywhere. It is the seam the tests use: no test
 * may write into a real home directory, and without an override there is no
 * way to exercise this at all.
 *
 * A relative XDG_DATA_HOME or APPDATA is IGNORED rather than resolved
 * against the process's cwd — the XDG spec says so, and "relative to
 * wherever the app was launched from" is a library that moves. */
export function libraryRoot(
  platform: NodeJS.Platform = process.platform,
  env: Env = process.env,
): string {
  const override = (env.SCREEPUB_LIBRARY ?? '').trim();
  if (override !== '') return resolve(override);

  // The PLATFORM's own path rules, not the host's: `isAbsolute` on a POSIX
  // build says "C:\\Users\\Ada" is relative, so a host-flavoured check would
  // throw away a perfectly good %APPDATA% — and would do it only when the
  // answer is computed for a platform other than the one asking, which is
  // exactly the case a test can reach and a user cannot.
  const path = platform === 'win32' ? win32 : posix;
  const home = env.HOME || env.USERPROFILE || homedir();
  if (platform === 'darwin') {
    return path.join(home, 'Library', 'Application Support', 'Screepub');
  }
  if (platform === 'win32') {
    const appData = env.APPDATA ?? '';
    return path.join(
      path.isAbsolute(appData) ? appData : path.join(home, 'AppData', 'Roaming'),
      'Screepub',
    );
  }
  const xdg = env.XDG_DATA_HOME ?? '';
  return path.join(path.isAbsolute(xdg) ? xdg : path.join(home, '.local', 'share'), 'screepub');
}

/** The folder name a script would like: its own, undecorated. */
function stemOf(input: string): string {
  const stem = basename(input, extname(input)).trim();
  // basename can hand back "." or ".." for a path that is all dots, and ""
  // for a trailing slash. None of those may become a directory name.
  return stem === '' || stem === '.' || stem === '..' ? 'script' : stem;
}

/** The absolute path recorded in a folder's source.json, or null if the
 * folder is not a script folder this engine made. */
function recordedSource(folder: string): string | null {
  try {
    const parsed: unknown = JSON.parse(readFileSync(join(folder, SOURCE_FILE), 'utf8'));
    const source = (parsed as { source?: unknown })?.source;
    return typeof source === 'string' ? source : null;
  } catch {
    return null;
  }
}

/** The folder this input owns inside `root`, created and marked.
 *
 * Two different PDFs are very often called the same thing — Draft.pdf in one
 * producer's folder and Draft.pdf in another's. Sharing one library folder
 * would overwrite the first book with the second and neither the engine nor
 * the window would say a word, so the second script gets its own folder,
 * named for the hash of its absolute path: `Draft-1a2b3c4d`.
 *
 * Which folder an input owns is therefore decided by what is ON DISK, not by
 * the name alone — and it is stable, because the same input path always
 * re-recognises its own source.json and gets the same folder back. */
function scriptFolder(input: string, root: string): string {
  const source = resolve(input);
  const stem = stemOf(source);
  const plain = join(root, stem);
  const recorded = recordedSource(plain);
  // Not ours and not free: a folder with no source.json (one the user made,
  // or an older layout) is left alone rather than written into.
  const folder = !existsSync(plain) || recorded === source
    ? plain
    : join(root, `${stem}-${createHash('sha256').update(source).digest('hex').slice(0, 8)}`);

  mkdirSync(folder, { recursive: true });
  if (recordedSource(folder) !== source) {
    writeFileSync(join(folder, SOURCE_FILE), `${JSON.stringify({ source }, null, 2)}\n`);
  }
  return folder;
}

/** Where this input's outputs go, as the path PREFIX the CLI already builds
 * every companion file from: `<library>/<folder>/<stem>`, so the book, its
 * .fountain and its sidecar are one folder holding one script.
 *
 * The folder is created here — on demand, on the conversion that needs it,
 * not at startup: an engine run that only prints --version has no business
 * making directories in someone's home. A failure (read-only home, no
 * permission) throws, and the CLI turns it into its one JSON object. */
export function libraryOutput(input: string, root: string = libraryRoot()): string {
  return join(scriptFolder(input, root), stemOf(input));
}

/** A script converted beside its PDF before the library existed has its
 * tuning in a sidecar there. Carry it in on the first library conversion,
 * rather than silently handing the reader a script whose knobs have all
 * snapped back to the defaults.
 *
 * Copied, not moved: the old file is the user's, and a copy means an older
 * build reading the old location still finds what it expects. A sidecar
 * already in the library always wins — this never overwrites tuning. */
export function adoptSidecar(input: string, output: string): boolean {
  const source = resolve(input);
  const existing = join(dirname(source), `${stemOf(source)}.screepub.json`);
  const landing = `${output}.screepub.json`;
  if (existsSync(landing) || !existsSync(existing)) return false;
  copyFileSync(existing, landing);
  return true;
}
