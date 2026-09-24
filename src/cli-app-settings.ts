// The `app-settings` verb: where books land, and what new scripts start
// from. Reads and writes the two keys of the app settings file that belong
// to piece C, `libraryPath` and `formatDefaults`. `lastRoute` (piece B) is
// not writable from here. Like the other verb handlers, this RETURNS a
// result and never prints; cli.ts owns stdout.
import { accessSync, constants, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { posix, win32 } from 'node:path';
import { CliError, errorMessage } from './cli-errors';
import { chosenLibraryPath, libraryRoot, platformLibraryDefault } from './library';
import { DEFAULT_FORMAT_OPTIONS, resolveFormatOptions, type FormatOptions } from './options';
import { appSettingsPath, writeAppSettings, type AppSettings } from './settings/app';
import { appDefaultOptions, appDefaultsCustomized } from './settings/app-defaults';

type Env = Record<string, string | undefined>;

// The only two keys this verb may write. Anything else, most notably
// `lastRoute` (piece B's key in the same file), is refused before anything
// is touched, so this verb can never step on a setting it does not own.
const WRITABLE_KEYS = ['libraryPath', 'formatDefaults'] as const;

export interface AppSettingsOptions {
  /** A JSON object with `libraryPath` and/or `formatDefaults`; either may be
   * `null` to reset it. Omitted: a plain read. */
  set?: string;
}

export interface AppSettingsDeps {
  /** Where the app settings file lives. Defaults to the production path
   * (`appSettingsPath(platform, env)`); a test points this at a scratch
   * file so it never touches a real one. */
  settingsPath?: string;
  platform?: NodeJS.Platform;
  env?: Env;
}

export interface AppSettingsLibraryInfo {
  /** The folder conversions will actually use. */
  path: string;
  /** The stored choice, resolved, or null: absent, or a value libraryRoot
   * would not honour anyway (relative, not a string), so this never names a
   * folder the engine ignores. */
  chosen: string | null;
  /** The folder with no choice and no SCREEPUB_LIBRARY. */
  platformDefault: string;
  /** True when SCREEPUB_LIBRARY (trimmed) is set: it is overriding `path`
   * regardless of what `chosen` says. */
  fromEnv: boolean;
}

export interface AppSettingsResult {
  file: string;
  library: AppSettingsLibraryInfo;
  /** The user's home folder as the engine sees it, so the window can show
   * the library as `~/...` without inventing the substitution itself. */
  home: string;
  formatDefaults: FormatOptions;
  shippedDefaults: FormatOptions;
  customized: boolean;
}

/** Node's fs error codes, translated to a sentence fragment a person who has
 * never seen an errno can act on. Falls back to the raw message for
 * anything not covered, so a code this list has not met yet is still
 * reported rather than swallowed. */
function plainReason(err: unknown): string {
  const code = (err as NodeJS.ErrnoException)?.code;
  if (code === 'EACCES' || code === 'EPERM') return 'permission denied';
  if (code === 'ENOTDIR') return 'part of that path is not a folder';
  if (code === 'EROFS') return 'that location is read-only';
  if (code === 'ENOSPC') return 'no space left on the disk';
  if (code === 'ENAMETOOLONG') return 'that path is too long';
  return errorMessage(err);
}

/** `libraryPath` from a validated `--set` patch: `undefined` to remove the
 * key (writeAppSettings' own convention for a reset), or the resolved,
 * created, checked-writable folder. Throws `bad-settings` for anything else,
 * BEFORE any settings file write: the folder made here is the check, not a
 * side effect to undo on failure. */
function validatedLibraryPath(value: unknown, platform: NodeJS.Platform): string | undefined {
  if (value === null) return undefined;
  if (typeof value !== 'string') {
    throw new CliError('bad-settings', 'libraryPath must be a full path or null');
  }
  // The PLATFORM's own rule, same reasoning as libraryRoot and
  // chosenLibraryPath: a relative-looking path must be refused even when it
  // happens to look absolute on the machine running this process.
  const path = platform === 'win32' ? win32 : posix;
  if (!path.isAbsolute(value)) {
    throw new CliError('bad-settings', 'the library folder must be a full path');
  }
  const resolved = path.resolve(value);
  try {
    mkdirSync(resolved, { recursive: true });
    accessSync(resolved, constants.W_OK);
  } catch (err) {
    throw new CliError('bad-settings', `cannot use ${resolved} as the library: ${plainReason(err)}`);
  }
  return resolved;
}

/** `formatDefaults` from a validated `--set` patch: `undefined` to remove
 * the key, or the FULL resolved object (every knob present and clamped),
 * never the partial the caller sent. */
function validatedFormatDefaults(value: unknown): FormatOptions | undefined {
  if (value === null) return undefined;
  if (typeof value !== 'object' || Array.isArray(value)) {
    throw new CliError('bad-settings', 'formatDefaults must be an object or null');
  }
  return resolveFormatOptions(value as Record<string, unknown>, DEFAULT_FORMAT_OPTIONS);
}

function buildAnswer(file: string, platform: NodeJS.Platform, env: Env): AppSettingsResult {
  const home = env.HOME || env.USERPROFILE || homedir();
  return {
    file,
    library: {
      path: libraryRoot(platform, env, file),
      chosen: chosenLibraryPath(platform, env, file),
      platformDefault: platformLibraryDefault(platform, env),
      fromEnv: (env.SCREEPUB_LIBRARY ?? '').trim() !== '',
    },
    home,
    formatDefaults: appDefaultOptions(file),
    shippedDefaults: DEFAULT_FORMAT_OPTIONS,
    customized: appDefaultsCustomized(file),
  };
}

export function appSettingsCommand(
  options: AppSettingsOptions,
  deps: AppSettingsDeps = {},
): AppSettingsResult {
  const platform = deps.platform ?? process.platform;
  const env = deps.env ?? process.env;
  const file = deps.settingsPath ?? appSettingsPath(platform, env);

  if (options.set !== undefined) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(options.set);
    } catch {
      throw new CliError('bad-settings', '--set is not valid JSON');
    }
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      throw new CliError('bad-settings', '--set must be a JSON object');
    }
    const patch = parsed as Record<string, unknown>;

    // Every key is checked BEFORE anything is validated or written: an
    // unknown key (most importantly `lastRoute`, which belongs to piece B)
    // must refuse the whole call, not just the key it does not recognise.
    for (const key of Object.keys(patch)) {
      if (!(WRITABLE_KEYS as readonly string[]).includes(key)) {
        throw new CliError(
          'usage',
          `app-settings --set takes only libraryPath and formatDefaults, not "${key}"`,
        );
      }
    }

    // Both knobs are validated in full BEFORE writeAppSettings is called
    // once: a good formatDefaults alongside a bad libraryPath must store
    // neither, not the one that happened to validate first.
    const write: Partial<AppSettings> = {};
    if ('libraryPath' in patch) write.libraryPath = validatedLibraryPath(patch.libraryPath, platform);
    if ('formatDefaults' in patch) write.formatDefaults = validatedFormatDefaults(patch.formatDefaults);

    writeAppSettings(write, file);
  }

  return buildAnswer(file, platform, env);
}
