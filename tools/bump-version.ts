// bun tools/bump-version.ts <version> [--check] [--repo <dir>]
//
// The release commit's version bump: the version in all four files that
// carry it, and desktop/ui/notes.js regenerated from
// docs/releases/<version>.md, which must already be written. The /release
// skill calls this on `ship`; it lives here, not in the skill, because the
// skill is not versioned and this is logic that has to stay right.
//
// Why four files: package.json is what the engine reports, Cargo.toml names
// the crate, Cargo.lock repeats the crate's version in its screepub-desktop
// entry (a bump that misses it leaves a lockfile that disagrees with its
// own manifest), and tauri.conf.json names the bundle file, the Info.plist,
// the deb Version: field and the NSIS product version. release.yml's
// `checks` job refuses a tag where the first, second and fourth disagree.
//
// All or nothing: the notes are parsed the way the window will read them,
// and every file's new text is worked out, before anything is written. So
// notes the window cannot show (a second paragraph before the first
// heading, say, which is where a pre-lede line on its own line lands) stop
// it with every file as it was. A write that fails part-way, or the
// version gate that runs on the result, puts every file back before the
// error is reported. --check does only that parse, for the draft, and
// writes nothing.
//
// Exit codes: 0 done (prints each file it wrote). 1 refused, nothing
// written, and the reason on stderr.

import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { assertBundleVersions, cargoPackageVersion } from './build-app-bundle';
import { REPO_DIR } from './build-cli';
import { parseReleaseNotes, renderNotesModule } from './build-desktop-notes';

export const VERSION_FILES = [
  'package.json',
  'desktop/src-tauri/Cargo.toml',
  'desktop/src-tauri/Cargo.lock',
  'desktop/src-tauri/tauri.conf.json',
] as const;

export const NOTES_MODULE = 'desktop/ui/notes.js';

/** release.yml's own test of a tag, with the leading v already gone. */
const VERSION = /^[0-9]+\.[0-9]+\.[0-9]+(-[A-Za-z0-9.]+)?$/;

/** The top-level "version" of a JSON file written the way this repo writes
 *  them (two spaces, a newline at the end). A file in any other shape is
 *  refused rather than quietly reformatted in a release commit. */
export function setJsonVersion(text: string, version: string, file: string): string {
  const data = JSON.parse(text) as Record<string, unknown>;
  if (typeof data.version !== 'string') throw new Error(`${file} has no top-level "version" to set`);
  if (`${JSON.stringify(data, null, 2)}\n` !== text) {
    throw new Error(`${file} is not in two-space JSON with a final newline, so setting its version would reformat it`);
  }
  return `${JSON.stringify({ ...data, version }, null, 2)}\n`;
}

/** The `version` line of Cargo.toml's [package] table, and no other. */
export function setCargoTomlVersion(text: string, version: string): string {
  const header = /^[ \t]*\[package\][ \t]*\r?$/m.exec(text);
  if (!header || cargoPackageVersion(text) === undefined) {
    throw new Error('desktop/src-tauri/Cargo.toml has no version in its [package] table');
  }
  const start = header.index + header[0].length;
  const rest = text.slice(start);
  const next = /^[ \t]*\[/m.exec(rest);
  const table = next ? rest.slice(0, next.index) : rest;
  const bumped = table.replace(/^([ \t]*version[ \t]*=[ \t]*)"[^"]*"/m, `$1"${version}"`);
  return text.slice(0, start) + bumped + rest.slice(table.length);
}

/** The screepub-desktop entry of Cargo.lock, which must appear once. */
export function setCargoLockVersion(text: string, version: string): string {
  const entry = /^(\[\[package\]\]\r?\nname = "screepub-desktop"\r?\nversion = )"[^"]*"/gm;
  const found = text.match(entry) ?? [];
  if (found.length !== 1) {
    throw new Error(
      `desktop/src-tauri/Cargo.lock has ${found.length} screepub-desktop entries; it should have exactly one`,
    );
  }
  return text.replace(entry, `$1"${version}"`);
}

/** Set `version` everywhere and regenerate the window's notes; returns the
 *  files written, in a fixed order. With `check`, only reads the notes. */
export function bumpVersion(repoDir: string, version: string, opts: { check?: boolean } = {}): string[] {
  if (!VERSION.test(version)) {
    throw new Error(`"${version}" is not a version release.yml accepts: MAJOR.MINOR.PATCH, no leading v`);
  }
  const notesFile = `docs/releases/${version}.md`;
  let markdown: string;
  try {
    markdown = readFileSync(join(repoDir, notesFile), 'utf8');
  } catch {
    throw new Error(`${notesFile} does not exist. Write the notes first; the window's copy is made from them.`);
  }
  const notesModule = renderNotesModule(parseReleaseNotes(version, markdown));
  if (opts.check) return [];

  const read = (file: string) => readFileSync(join(repoDir, file), 'utf8');
  const next: [string, string][] = [
    ['package.json', setJsonVersion(read('package.json'), version, 'package.json')],
    ['desktop/src-tauri/Cargo.toml', setCargoTomlVersion(read('desktop/src-tauri/Cargo.toml'), version)],
    ['desktop/src-tauri/Cargo.lock', setCargoLockVersion(read('desktop/src-tauri/Cargo.lock'), version)],
    [
      'desktop/src-tauri/tauri.conf.json',
      setJsonVersion(read('desktop/src-tauri/tauri.conf.json'), version, 'desktop/src-tauri/tauri.conf.json'),
    ],
    [NOTES_MODULE, notesModule],
  ];
  // Everything is read before anything is written, so a write that fails
  // part-way (or the gate after it) can put every file back as it was.
  const original = next.map(([file]) => [file, read(file)] as const);
  try {
    for (const [file, text] of next) writeFileSync(join(repoDir, file), text);
    // The bundler's own gate, run on what was just written.
    assertBundleVersions(version, repoDir);
  } catch (e) {
    const stuck: string[] = [];
    for (const [file, text] of original) {
      try {
        writeFileSync(join(repoDir, file), text);
      } catch {
        stuck.push(file);
      }
    }
    if (stuck.length > 0) {
      throw new Error(
        `${e instanceof Error ? e.message : String(e)}. Could not put back: ${stuck.join(', ')}. ` +
          'Restore them with git checkout before trying again.',
      );
    }
    throw e;
  }
  return next.map(([file]) => file);
}

if (import.meta.main) {
  const { values, positionals } = parseArgs({
    args: Bun.argv.slice(2),
    options: { check: { type: 'boolean' }, repo: { type: 'string' } },
    allowPositionals: true,
  });
  try {
    if (positionals.length !== 1) throw new Error('usage: bun tools/bump-version.ts <version> [--check]');
    const version = positionals[0]!;
    const written = bumpVersion(values.repo ?? REPO_DIR, version, { check: values.check });
    if (values.check) console.log(`docs/releases/${version}.md is in the shape the window can show.`);
    else for (const file of written) console.log(`wrote  ${file}`);
  } catch (e) {
    console.error(`bump-version: ${e instanceof Error ? e.message : String(e)}`);
    process.exit(1);
  }
}
