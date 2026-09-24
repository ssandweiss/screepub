// App-wide format defaults: the base every script starts from, one layer
// under Screepub's own shipped defaults and one layer above a script's own
// sidecar. Piece C's "use these settings for new scripts" (the owner's
// decision in docs/superpowers/specs/2026-09-23-app-settings-gear-design.md):
// explicit flags > the script's sidecar > these > DEFAULT_FORMAT_OPTIONS,
// through the one merge resolveFormatOptions already is.
//
// Task 3 (not this one) adds the verb that WRITES `formatDefaults` into the
// app settings file. This module only reads it.
import { appSettingsPath, readAppSettings } from './app';
import { DEFAULT_FORMAT_OPTIONS, resolveFormatOptions, type FormatOptions } from '../options';

/** `formatDefaults` off the app settings file, or undefined when there is
 * nothing usable there. A stored value that JSON allows but is not a plain
 * object (an array, a string, a number, null) is not something
 * resolveFormatOptions can read knobs off, so it reads as absent rather than
 * throwing or silently becoming `{}` in a way that would hide the
 * distinction from "never set". readAppSettings has already turned a
 * missing, unreadable or corrupt settings FILE into `{}`, so this only
 * needs to judge the one key. */
function storedFormatDefaults(settingsPath: string): Record<string, unknown> | undefined {
  const stored = readAppSettings(settingsPath).formatDefaults;
  if (typeof stored !== 'object' || stored === null || Array.isArray(stored)) return undefined;
  return stored as Record<string, unknown>;
}

/** The user's app-wide format defaults, as a FULL, resolved FormatOptions
 * object: every knob present and valid, whether or not the stored file
 * happens to have it. That is what lets a later release add a knob and
 * still have this resolve to something complete (the new knob falls back to
 * DEFAULT_FORMAT_OPTIONS), and what lets a stored value the engine no
 * longer accepts be clamped here rather than crash whatever reads it next.
 *
 * `settingsPath` defaults to the production app settings file
 * (`appSettingsPath()`, which itself honours SCREEPUB_CONFIG_DIR); a test
 * passes its own scratch path so it never touches a real one. */
export function appDefaultOptions(settingsPath: string = appSettingsPath()): FormatOptions {
  return resolveFormatOptions(storedFormatDefaults(settingsPath) ?? {}, DEFAULT_FORMAT_OPTIONS);
}

/** True once the user has moved the app defaults away from Screepub's own,
 * knob by knob. Every field here is a primitive (string, number or
 * boolean), so a shallow compare is the whole answer, the same reasoning
 * `src/settings/presets.ts`'s `matchingPreset` already relies on. */
export function appDefaultsCustomized(settingsPath: string = appSettingsPath()): boolean {
  const options = appDefaultOptions(settingsPath);
  const keys = Object.keys(DEFAULT_FORMAT_OPTIONS) as Array<keyof FormatOptions>;
  return keys.some((key) => options[key] !== DEFAULT_FORMAT_OPTIONS[key]);
}
