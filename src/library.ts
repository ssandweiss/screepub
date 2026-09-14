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
 * quietly overwrite the first one's book. One file per script folder.
 *
 * Exported because it is the one name a Library listing has to know: every
 * other entry in a script folder is the script's, and this one is the
 * engine's bookkeeping. Skip it when listing — or read it, to show where a
 * book came from. */
export const SOURCE_FILE = 'source.json';

type Env = Record<string, string | undefined>;

/** The user's Documents folder on a freedesktop system.
 *
 * XDG_DOCUMENTS_DIR is where this lives — but it is almost never in a
 * process's environment: xdg-user-dirs writes it to `user-dirs.dirs`, which
 * only a login shell sources. Reading that file is therefore the difference
 * between honouring a Documents folder the user renamed or moved and
 * ignoring it, and it is the one place a non-English name can be checked.
 *
 * Anything unreadable, unparseable or relative falls through to ~/Documents,
 * which is what the file would have said anyway on a default install. */
function xdgDocuments(home: string, env: Env): string | null {
  const fromEnv = (env.XDG_DOCUMENTS_DIR ?? '').trim();
  if (posix.isAbsolute(fromEnv)) return fromEnv;

  const configHome = (env.XDG_CONFIG_HOME ?? '').trim();
  const config = posix.isAbsolute(configHome) ? configHome : posix.join(home, '.config');
  let text: string;
  try {
    text = readFileSync(posix.join(config, 'user-dirs.dirs'), 'utf8');
  } catch {
    return null;
  }
  // The file's own format: shell assignments, one per line, `$HOME`-relative
  // by convention. Comments and every other XDG_*_DIR are ignored.
  const line = text.split('\n').find((l) => l.trimStart().startsWith('XDG_DOCUMENTS_DIR='));
  if (line === undefined) return null;
  const value = line.slice(line.indexOf('=') + 1).trim().replace(/^"(.*)"$/, '$1');
  const expanded = value.startsWith('$HOME') ? posix.join(home, value.slice('$HOME'.length)) : value;
  // A bare `XDG_DOCUMENTS_DIR="$HOME/"` means "no Documents folder, use the
  // home directory itself" — which is not somewhere a library may be made.
  const documents = posix.isAbsolute(expanded) ? posix.resolve(expanded) : '';
  return documents !== '' && documents !== posix.resolve(home) ? documents : null;
}

/** Where the library lives, per platform.
 *
 * Under Documents, NOT under the platform's application-state directory. A
 * converted .epub and .fountain are the user's documents — things they open,
 * copy to a reader, email and back up — not our state, and ~/.local/share is
 * for what a user is not expected to browse. It also matches the SwiftUI app
 * this window replaces (~/Documents/Screepub), so a Mac user running both
 * does not silently accumulate two libraries in two places.
 *
 * SCREEPUB_LIBRARY wins everywhere. It is the seam the tests use — no test
 * may write into a real home directory, and without an override there is no
 * way to exercise this at all — and it is the escape hatch for anyone who
 * keeps their scripts somewhere else. */
export function libraryRoot(
  platform: NodeJS.Platform = process.platform,
  env: Env = process.env,
): string {
  const override = (env.SCREEPUB_LIBRARY ?? '').trim();
  if (override !== '') return resolve(override);

  // The PLATFORM's own path rules, not the host's: `isAbsolute` on a POSIX
  // build says "C:\\Users\\Ada" is relative, so a host-flavoured check would
  // throw away a perfectly good path — and would do it only when the answer
  // is computed for a platform other than the one asking, which is exactly
  // the case a test can reach and a user cannot.
  const path = platform === 'win32' ? win32 : posix;
  const home = env.HOME || env.USERPROFILE || homedir();
  // macOS and Windows both keep Documents at a fixed path under the home
  // directory. macOS localizes only the DISPLAY name, so ~/Documents is
  // right in every language. Windows lets the folder be relocated (OneDrive
  // moves it), but the authority for that is the registry, which the engine
  // cannot read without shelling out — SCREEPUB_LIBRARY covers the user who
  // moved it.
  const documents = platform === 'darwin' || platform === 'win32'
    ? path.join(home, 'Documents')
    : xdgDocuments(home, env) ?? path.join(home, 'Documents');
  return path.join(documents, 'Screepub');
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
