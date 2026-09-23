// The probes behind the route catalog (routes.ts): what is actually true on
// this machine right now, gathered here so routes.ts can stay pure and the
// probing can stay entirely injectable (see
// docs/superpowers/plans/2026-09-23-send-routes-engine.md, Task 3).
//
// Every probe has a default that touches the real machine, and every default
// can be overridden, which is the whole point: a test never spawns
// `defaults read`, never opens Books, and never reads the real disk for
// Send to Kindle.app.
import { existsSync } from 'node:fs';
import { listDevices, type ListDevicesOptions } from '../device/list';
import type { ConnectedDevice } from '../device/types';
import type { RouteFacts } from './routes';

/** What `mailtoHandler()` can answer:
 *  - a bundle id string: that app is the mailto: handler.
 *  - null: no mailto entry in Launch Services at all, which is what an
 *    unmodified Mac reads as (Apple Mail is the system default with nothing
 *    registered).
 *  - undefined: the probe could not tell (spawn failed, non-zero exit,
 *    unparsable output). NEVER treated as Apple Mail: offering a mail
 *    compose when the real handler is unknown risks a compose that has no
 *    attachment support and silently drops the file. */
export type MailtoHandlerResult = string | null | undefined;

export interface RouteProbes {
  /** default: listDevices(deviceOptions) */
  devices?: () => Promise<ConnectedDevice[]>;
  /** default: existsSync */
  exists?: (path: string) => boolean;
  /** default: `defaults read com.apple.LaunchServices/...` via Bun.spawn */
  mailtoHandler?: () => Promise<MailtoHandlerResult>;
  /** default: process.platform */
  platform?: string;
}

const BOOKS_APP_PATHS = ['/System/Applications/Books.app', '/Applications/Books.app'];
const SEND_TO_KINDLE_APP_PATH = '/Applications/Send to Kindle.app';

/** True when `dict` (one `{ ... }` entry, braces included) holds `key = value;`
 * at its OWN top level, never inside a nested `{ ... }` block. Tracked by
 * brace depth rather than a single regex because the one shape this parser
 * exists to get right is exactly a nested dict repeating the same key
 * (`LSHandlerPreferredVersions = { LSHandlerRoleAll = "-"; };` sits beside a
 * top-level `LSHandlerRoleAll` with the real answer), and a regex has no
 * notion of depth. Depth 1 is "directly inside this dict's own braces";
 * anything deeper is inside some nested value and does not count. */
function topLevelValue(dict: string, key: string): string | null {
  let depth = 0;
  for (let i = 0; i < dict.length; i++) {
    const ch = dict[i]!;
    if (ch === '{') {
      depth++;
      continue;
    }
    if (ch === '}') {
      depth--;
      continue;
    }
    if (depth !== 1) continue;
    if (!dict.startsWith(key, i)) continue;
    const before = dict[i - 1];
    if (before !== undefined && /[A-Za-z0-9_]/.test(before)) continue; // mid-identifier match
    const rest = dict.slice(i + key.length);
    const match = rest.match(/^\s*=\s*(?:"([^"]*)"|([^;{}]+?))\s*;/);
    if (!match) continue;
    const value = match[1] !== undefined ? match[1] : match[2]!.trim();
    return value;
  }
  return null;
}

/** Every `{ ... }` entry that sits directly inside the outermost `( ... )`
 * array, matched by brace depth so a nested dict (LSHandlerPreferredVersions)
 * never gets mistaken for one of these. */
function topLevelDicts(text: string): string[] {
  const dicts: string[] = [];
  let depth = 0;
  let start = -1;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '{') {
      if (depth === 0) start = i;
      depth++;
    } else if (ch === '}') {
      depth--;
      if (depth === 0 && start !== -1) {
        dicts.push(text.slice(start, i + 1));
        start = -1;
      }
    }
  }
  return dicts;
}

/** Pure: the `defaults read
 * com.apple.LaunchServices/com.apple.launchservices.secure LSHandlers`
 * output is an old-style plist array of dicts. Finds the dict whose
 * `LSHandlerURLScheme` is `mailto` and returns ITS OWN `LSHandlerRoleAll`
 * (quoted or bare), never one nested inside a `LSHandlerPreferredVersions`
 * sub-dict. No mailto dict, or unparsable input, reads as null rather than
 * throwing: this only ever feeds a fact-gathering probe, never something
 * that should abort a conversion. */
export function parseMailtoHandler(defaultsOutput: string): string | null {
  for (const dict of topLevelDicts(defaultsOutput)) {
    const scheme = topLevelValue(dict, 'LSHandlerURLScheme');
    if (scheme === null || scheme.toLowerCase() !== 'mailto') continue;
    return topLevelValue(dict, 'LSHandlerRoleAll');
  }
  return null;
}

/** The real probe: asks Launch Services who owns `mailto:` links. Spawned
 * only when actually called (routeFacts skips it off darwin). A non-zero
 * exit or a spawn error is "could not tell" (undefined), never "no entry"
 * (null): those two must stay distinguishable so a read failure is never
 * offered as Apple Mail. */
async function realMailtoHandler(): Promise<MailtoHandlerResult> {
  try {
    const proc = Bun.spawn(
      ['defaults', 'read', 'com.apple.LaunchServices/com.apple.launchservices.secure', 'LSHandlers'],
      { stdout: 'pipe', stderr: 'pipe' },
    );
    const [code, stdout] = await Promise.all([proc.exited, new Response(proc.stdout).text()]);
    if (code !== 0) return undefined;
    return parseMailtoHandler(stdout);
  } catch {
    return undefined;
  }
}

/** Gathers RouteFacts for routes.ts. Every probe is injectable; the defaults
 * are the only place in this module that touch the real machine, and the
 * Books/Send to Kindle/mail probes are skipped entirely off darwin (they
 * would never answer anything but "no" there, and a test counting their
 * calls holds this promise). */
export async function routeFacts(
  probes: RouteProbes = {},
  deviceOptions?: ListDevicesOptions,
): Promise<RouteFacts> {
  const platform = probes.platform ?? process.platform;
  const devicesProbe = probes.devices ?? (() => listDevices(deviceOptions));
  const onMac = platform === 'darwin';

  const devicesPromise = devicesProbe();

  let booksApp = false;
  let sendToKindleApp = false;
  let appleMailDefault = false;

  if (onMac) {
    const exists = probes.exists ?? existsSync;
    const mailtoHandler = probes.mailtoHandler ?? realMailtoHandler;

    booksApp = BOOKS_APP_PATHS.some((path) => exists(path));
    sendToKindleApp = exists(SEND_TO_KINDLE_APP_PATH);

    const handler = await mailtoHandler();
    // null: no mailto entry, which is the system default (Apple Mail).
    // A string: Apple Mail only when it is literally com.apple.mail.
    // undefined: could not tell, so never Apple Mail (see MailtoHandlerResult).
    appleMailDefault = handler === null || (typeof handler === 'string' && handler.toLowerCase() === 'com.apple.mail');
  }

  const devices = await devicesPromise;

  return { platform, devices, booksApp, sendToKindleApp, appleMailDefault };
}
