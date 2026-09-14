// Verb dispatch and the device command handlers. Handlers RETURN result
// objects and never print: cli.ts owns stdout, so these are testable in
// process. Dispatch lives here rather than in cli.ts because cli.ts runs
// main() on import and cannot be imported by a test.
import { existsSync, statSync } from 'node:fs';
import { extname } from 'node:path';
import { CliError, errorMessage } from './cli-errors';
import { listDevices, type ListDevicesOptions } from './device/list';
import { deviceId, type ConnectedDevice, type DeviceKind } from './device/types';
import { copyToDevice } from './device/transfer';
import { remarkableAccepts, uploadToRemarkable } from './device/remarkable';

export const VERBS = ['devices', 'send', 'settings'] as const;
export type Verb = (typeof VERBS)[number];

export type Command = { kind: 'verb'; verb: Verb; args: string[] } | { kind: 'convert' };

/** Decide whether argv opens with a subcommand.
 *
 * The rule, and the whole compatibility surface of this piece: the FIRST
 * argument is a verb only when it matches a known verb exactly AND no file of
 * that name exists. `screepub devices` lists; `screepub ./devices` and
 * `screepub devices.pdf` convert; and a real file named `devices` wins,
 * because a user can always write `./devices` to get the file, while a stolen
 * filename would be unconvertible with no way out.
 *
 * Only argv[0] is considered. A verb after a flag would be indistinguishable
 * from a flag's value (`--title send`). */
export function resolveCommand(
  argv: string[],
  exists: (path: string) => boolean = existsSync,
): Command {
  const first = argv[0];
  if (first === undefined) return { kind: 'convert' };
  if (!(VERBS as readonly string[]).includes(first)) return { kind: 'convert' };
  if (exists(first)) return { kind: 'convert' };
  return { kind: 'verb', verb: first as Verb, args: argv.slice(1) };
}

/** One device as the CLI and the Tauri shell see it. `id` is what
 * `send --device` accepts: the volume path, or the kind for reMarkable. */
export interface DeviceSummary {
  id: string;
  kind: DeviceKind;
  name: string;
  volume: string | null;
}

export interface DevicesResult {
  devices: DeviceSummary[];
}

function summarize(device: ConnectedDevice): DeviceSummary {
  return { id: deviceId(device), kind: device.kind, name: device.name, volume: device.volume };
}

/** Everything plugged in. An empty list is an answer, not an error. */
export async function devicesCommand(options: ListDevicesOptions = {}): Promise<DevicesResult> {
  return { devices: (await listDevices(options)).map(summarize) };
}

/** Which device gets the book.
 *
 * Precedence is deliberate and tested on inputs where the orders disagree:
 *   1. Nothing connected -> no-devices, EVEN IF --device was given. The
 *      actionable fact is that nothing is plugged in; "no device matches
 *      /run/media/sam/Kindle" would send the user hunting for a typo.
 *   2. --device given -> exact id match, or unknown-device. It wins over the
 *      ambiguity check: the user has already answered that question.
 *   3. Exactly one connected -> that one.
 *   4. Several -> ambiguous-device, listing the ids. Never a guess: sending a
 *      book to the wrong reader is annoying to undo by hand. */
export function selectDevice(devices: ConnectedDevice[], requestedId?: string): ConnectedDevice {
  const ids = devices.map(deviceId);

  if (devices.length === 0) {
    throw new CliError('no-devices', 'no reader is connected — plug one in over USB and try again');
  }

  if (requestedId !== undefined) {
    const index = ids.indexOf(requestedId);
    if (index === -1) {
      throw new CliError(
        'unknown-device',
        `no connected reader has the id "${requestedId}" — connected: ${ids.join(', ')}`,
      );
    }
    return devices[index];
  }

  if (devices.length === 1) return devices[0];

  throw new CliError(
    'ambiguous-device',
    `several readers are connected — pick one with --device: ${ids.join(', ')}`,
  );
}

export interface SendOptions extends ListDevicesOptions {
  /** An EXISTING file. `send` never converts — see the design spec. */
  file: string;
  /** The id `devices` reports. Omitted: the single connected device. */
  deviceId?: string;
}

export interface SendResult {
  device: { id: string; kind: DeviceKind; name: string };
  /** Where the file landed. Absent for reMarkable, which has no path. */
  destination?: string;
  /** True for reMarkable, which reports no destination. */
  uploaded?: boolean;
}

/** Send an existing file to a connected reader.
 *
 * The file is checked FIRST, before the device list is built: a typo in the
 * filename must not be reported as "no devices", and must not pay the
 * reMarkable probe's timeout to find that out. */
export async function sendCommand(options: SendOptions): Promise<SendResult> {
  let isFile = false;
  try {
    isFile = statSync(options.file).isFile();
  } catch {
    isFile = false;
  }
  if (!isFile) {
    throw new CliError('unreadable', `cannot read the file to send: ${options.file}`);
  }

  const devices = await listDevices(options);
  const device = selectDevice(devices, options.deviceId);
  const identity = { id: deviceId(device), kind: device.kind, name: device.name };

  if (device.kind === 'remarkable') {
    // Asked before the upload, not inferred from its error: cli-errors.ts's
    // rule is that detection is typed, never a substring of a message.
    if (!remarkableAccepts(options.file)) {
      // The SAME sentence uploadToRemarkable would have thrown, because
      // `send-failed` passes library text through verbatim and a user must not
      // read two wordings for one fact. Unified toward the library, which is
      // held byte-identical to RemarkableDevice.swift — see the note there.
      const ext = extname(options.file).replace(/^\./, '').toLowerCase();
      throw new CliError('unsupported-file', `reMarkable accepts PDF and EPUB, not .${ext}.`);
    }
    try {
      await uploadToRemarkable(options.file, options.remarkableEndpoint);
    } catch (err) {
      throw new CliError('send-failed', errorMessage(err));
    }
    return { device: identity, uploaded: true };
  }

  try {
    return { device: identity, destination: copyToDevice(options.file, device) };
  } catch (err) {
    throw new CliError('send-failed', errorMessage(err));
  }
}
