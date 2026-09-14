// The `settings` verb: a script's own formatting, read and written through
// the sidecar `src/settings/sidecar.ts` already owns. Like the device
// handlers, this RETURNS a result and never prints — cli.ts owns stdout.
import { statSync } from 'node:fs';
import { CliError } from './cli-errors';
import { DEFAULT_FORMAT_OPTIONS, resolveFormatOptions, type FormatOptions } from './options';
import {
  DEVICE_PRESETS,
  matchingPreset,
  type DevicePresetId,
} from './settings/presets';
import { loadScriptSettings, saveScriptSettings, sidecarPath } from './settings/sidecar';

export interface SettingsResult {
  settings: FormatOptions;
  defaults: FormatOptions;
  preset: DevicePresetId | null;
  presets: { id: DevicePresetId; displayName: string; settings: FormatOptions }[];
  sidecar: string;
}

export interface SettingsOptions {
  /** The script's .fountain — the sidecar is named after it. */
  fountain: string;
  /** A PARTIAL FormatOptions as JSON. Overlaid on what is stored, never
   * replacing it, so a window that sends one moved knob moves one knob. */
  set?: string;
}

export function settingsCommand(options: SettingsOptions): SettingsResult {
  let isFile = false;
  try {
    isFile = statSync(options.fountain).isFile();
  } catch {
    isFile = false;
  }
  if (!isFile) {
    throw new CliError('unreadable', `cannot read the script: ${options.fountain}`);
  }

  let settings = loadScriptSettings(options.fountain, DEFAULT_FORMAT_OPTIONS);

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
    // Overlaid on the CURRENT settings, not on the defaults: one moved knob
    // must not silently reset the other seventeen. Clamping is
    // resolveFormatOptions', not a second copy of it.
    settings = resolveFormatOptions(parsed as Record<string, unknown>, settings);
    saveScriptSettings(settings, options.fountain);
  }

  const ids = Object.keys(DEVICE_PRESETS) as DevicePresetId[];
  return {
    settings,
    defaults: DEFAULT_FORMAT_OPTIONS,
    preset: matchingPreset(settings),
    presets: ids.map((id) => ({
      id,
      displayName: DEVICE_PRESETS[id].displayName,
      settings: DEVICE_PRESETS[id].settings,
    })),
    sidecar: sidecarPath(options.fountain),
  };
}
