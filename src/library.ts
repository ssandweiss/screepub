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
import { appSettingsPath, readAppSettings } from './settings/app';

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
  // BOTH branches go through this. They used not to: the environment branch
  // took its value raw, so `$HOME`, `$HOME/` and `/` all became libraries and
  // a value the user had quoted was thrown away — while the file branch,
  // reading the same variable from the same authority, rejected all four.
  const asDocuments = (raw: string): string | null => {
    const value = raw.trim().replace(/^"(.*)"$/, '$1');
    // The file's own convention. The variable is usually copied out of it, so
    // it can arrive with `$HOME` still in front.
    const expanded = value.startsWith('$HOME') ? posix.join(home, value.slice('$HOME'.length)) : value;
    if (!posix.isAbsolute(expanded)) return null;
    const documents = posix.resolve(expanded);
    // `$HOME/` is what xdg-user-dirs writes for "this user has no such
    // folder", and `/` is not one either. Neither may hold a library.
    return documents === posix.resolve(home) || documents === '/' ? null : documents;
  };

  const fromEnv = asDocuments(env.XDG_DOCUMENTS_DIR ?? '');
  if (fromEnv !== null) return fromEnv;

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
  return line === undefined ? null : asDocuments(line.slice(line.indexOf('=') + 1));
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
 * keeps their scripts somewhere else.
 *
 * Next in line is the folder the user chose in the app (piece C), read from
 * the app settings file's `libraryPath`. It loses to SCREEPUB_LIBRARY on
 * purpose: the env var is the one override a test or a script author can
 * always reach, and it would be a strange escape hatch if a saved app
 * setting could override it back. `settingsPath` lets a test point that
 * read at a scratch file instead of the real one; production leaves it
 * unset, and the default read is `appSettingsPath(platform, env)`, so a
 * SCREEPUB_CONFIG_DIR in the caller's own env is honoured there too. */
/** The stored `libraryPath`, resolved, but ONLY when it is one `libraryRoot`
 * itself would honour: an absolute path for the given platform. Anything
 * else (relative, not a string, missing file) reads as `null`, so a caller
 * such as `app-settings` can report "the chosen folder" without ever naming
 * one the engine would actually ignore.
 *
 * Split out of `libraryRoot` rather than re-read by its callers, so the two
 * can never disagree on what counts as a usable choice: the same reasoning
 * `src/parser/cue.ts`'s shared discriminator exists for. */
export function chosenLibraryPath(
  platform: NodeJS.Platform = process.platform,
  env: Env = process.env,
  settingsPath?: string,
): string | null {
  // The PLATFORM's own path rules, not the host's: `isAbsolute` on a POSIX
  // build says "C:\\Users\\Ada" is relative, so a host-flavoured check would
  // throw away a perfectly good path — and would do it only when the answer
  // is computed for a platform other than the one asking, which is exactly
  // the case a test can reach and a user cannot.
  const path = platform === 'win32' ? win32 : posix;

  // A relative path, an empty or whitespace-only string, or a value that is
  // not a string at all (readAppSettings already turns a missing file,
  // unreadable file or corrupt JSON into `{}`, so `chosen` is simply
  // `undefined` in all of those cases) all fall through rather than being
  // honoured halfway. Absolute is judged by the PLATFORM's own rule, same
  // reasoning as `path` above: a stored `C:\Books` is a real folder on
  // win32 and gibberish on posix.
  const chosen = readAppSettings(settingsPath ?? appSettingsPath(platform, env)).libraryPath;
  return typeof chosen === 'string' && path.isAbsolute(chosen) ? path.resolve(chosen) : null;
}

/** The library's location with no chosen folder and no `SCREEPUB_LIBRARY`
 * override: the platform default alone. Exported so `app-settings` can
 * report it (the window's Reset target) through this one function rather
 * than a second copy of the rules below, which is how the two would drift. */
export function platformLibraryDefault(
  platform: NodeJS.Platform = process.platform,
  env: Env = process.env,
): string {
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

export function libraryRoot(
  platform: NodeJS.Platform = process.platform,
  env: Env = process.env,
  settingsPath?: string,
): string {
  const override = (env.SCREEPUB_LIBRARY ?? '').trim();
  if (override !== '') return resolve(override);

  // The chosen folder wins over the platform default, but only when it is
  // usable: chosenLibraryPath is the one place that decides "usable".
  const chosen = chosenLibraryPath(platform, env, settingsPath);
  if (chosen !== null) return chosen;

  return platformLibraryDefault(platform, env);
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
function folderFor(source: string, root: string): string {
  const stem = stemOf(source);
  const hash = createHash('sha256').update(source).digest('hex');
  // Free, or already ours. A folder with no source.json (one the user made,
  // or an older layout) is neither, and is left alone rather than written
  // into — and so is one that belongs to a DIFFERENT script, which the
  // hashed name is not immune to: a script actually called `Draft-5a47cba7`
  // owns `Draft-5a47cba7/` by its plain name, and handing that folder to
  // some other Draft.pdf would overwrite its marker and orphan it from its
  // own .epub.
  const ours = (folder: string) => !existsSync(folder) || recordedSource(folder) === source;

  let folder = join(root, stem);
  for (let attempt = 0; !ours(folder); attempt += 1) {
    // Widening the hash rather than counting keeps the name a function of
    // the path alone. 32 hex characters in, two different paths sharing a
    // name is not a case worth more code than a clear failure.
    const mark = attempt === 0 ? hash.slice(0, 8) : hash.slice(0, 8 + attempt * 4);
    if (mark.length > 32) {
      throw new Error(`too many scripts already claim the name "${stem}" in the library`);
    }
    folder = join(root, `${stem}-${mark}`);
  }

  return folder;
}

/** The same folder, created and marked as this script's. */
function scriptFolder(source: string, root: string): string {
  const folder = folderFor(source, root);
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
  // Resolved ONCE, and both halves built from the same string: `stemOf(input)`
  // and `stemOf(resolve(input))` disagree for an input like "." — one folder
  // name, one file stem, one source of truth.
  const source = resolve(input);
  return join(scriptFolder(source, root), stemOf(source));
}

/** This input's output prefix in `root` IF the library already holds the
 * script's folder — and null otherwise. Creates nothing and writes nothing.
 *
 * libraryOutput's read-only twin, for the one question that has to be asked
 * BEFORE a conversion runs: what has this script already been tuned to?
 * Asking it with libraryOutput would make a folder for every typo'd path and
 * every file that turns out not to be a screenplay, which is exactly the
 * defect that moved the library resolution below the conversion. */
export function existingLibraryOutput(input: string, root: string = libraryRoot()): string | null {
  const source = resolve(input);
  const folder = folderFor(source, root);
  return existsSync(folder) ? join(folder, stemOf(source)) : null;
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
