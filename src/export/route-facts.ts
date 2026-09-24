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
import { homedir } from 'node:os';
import { posix } from 'node:path';
import { listDevices, type ListDevicesOptions } from '../device/list';
import type { ConnectedDevice } from '../device/types';
import type { RouteFacts } from './routes';

/** What `mailtoHandler()` can answer:
 *  - a bundle id string: that app is the mailto: handler.
 *  - null: no mailto entry in Launch Services at all, which is what an
 *    unmodified Mac reads as (Apple Mail is the system default with nothing
 *    registered). That includes `defaults` saying LSHandlers itself does
 *    not exist, which is a Mac where nobody has changed any default app.
 *  - undefined: the probe could not tell (spawn failed, any other non-zero
 *    exit). NEVER treated as Apple Mail: offering a mail compose when the
 *    real handler is unknown risks a compose that has no attachment support
 *    and silently drops the file. */
export type MailtoHandlerResult = string | null | undefined;

/** How one finished command went: its exit code and both streams. */
export interface CommandResult {
  code: number;
  stdout: string;
  stderr: string;
}

/** Runs one argv to completion. May throw when the program is not there. */
export type CommandRunner = (argv: string[]) => Promise<CommandResult>;

type Env = Record<string, string | undefined>;

export interface RouteProbes {
  /** default: listDevices(deviceOptions) */
  devices?: () => Promise<ConnectedDevice[]>;
  /** default: existsSync */
  exists?: (path: string) => boolean;
  /** default: `defaults read com.apple.LaunchServices/...`, run through `run` */
  mailtoHandler?: () => Promise<MailtoHandlerResult>;
  /** What the default mailtoHandler spawns `defaults` with.
   *  default: Bun.spawn */
  run?: CommandRunner;
  /** Where the home folder is read from (HOME, then USERPROFILE), for the
   *  Send to Kindle app in ~/Applications. default: process.env */
  env?: Env;
  /** default: process.platform */
  platform?: string;
}

const BOOKS_APP_PATHS = ['/System/Applications/Books.app', '/Applications/Books.app'];
const SEND_TO_KINDLE_APP = 'Send to Kindle.app';

/** Where Amazon's app can be: the Mac's Applications folder, or the home
 *  folder's own (where an installer puts it for a person without admin
 *  rights, and `open -a` finds it there all the same). Home is found the
 *  way the settings file finds it (src/settings/app.ts). Mac paths, so
 *  POSIX joins whatever the host. */
function sendToKindleAppPaths(env: Env): string[] {
  const home = env.HOME || env.USERPROFILE || homedir();
  return [
    posix.join('/Applications', SEND_TO_KINDLE_APP),
    posix.join(home, 'Applications', SEND_TO_KINDLE_APP),
  ];
}

/** The one question asked of Launch Services. */
const MAILTO_HANDLER_ARGV = [
  'defaults',
  'read',
  'com.apple.LaunchServices/com.apple.launchservices.secure',
  'LSHandlers',
];

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

/** The real runner: Bun.spawn, both streams read. Throws only when the
 *  program cannot be started at all; the caller reads that as "could not
 *  tell". */
const realRun: CommandRunner = async (argv) => {
  const proc = Bun.spawn(argv, { stdin: 'ignore', stdout: 'pipe', stderr: 'pipe' });
  const [code, stdout, stderr] = await Promise.all([
    proc.exited,
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);
  return { code, stdout, stderr };
};

/** The real probe: asks Launch Services who owns `mailto:` links. Run only
 * when actually called (routeFacts skips it off darwin).
 *
 * `defaults` exits 1 when LSHandlers is not there at all, saying the
 * "domain/default pair ... does not exist" (measured 2026-09-23). That is a
 * Mac where nobody has changed any default app, so the system default,
 * Apple Mail: no entry (null). Every other non-zero exit, and a runner that
 * cannot start `defaults`, is "could not tell" (undefined). Those two must
 * stay distinguishable, so a read failure is never offered as Apple Mail and
 * an untouched Mac is not told to change a setting it already has. */
async function mailtoHandlerVia(run: CommandRunner): Promise<MailtoHandlerResult> {
  let result: CommandResult;
  try {
    result = await run(MAILTO_HANDLER_ARGV);
  } catch {
    return undefined;
  }
  if (result.code === 0) return parseMailtoHandler(result.stdout);
  if (`${result.stderr}\n${result.stdout}`.includes('does not exist')) return null;
  return undefined;
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
    const mailtoHandler = probes.mailtoHandler ?? (() => mailtoHandlerVia(probes.run ?? realRun));

    booksApp = BOOKS_APP_PATHS.some((path) => exists(path));
    sendToKindleApp = sendToKindleAppPaths(probes.env ?? process.env).some((path) => exists(path));

    const handler = await mailtoHandler();
    // null: no mailto entry, which is the system default (Apple Mail).
    // A string: Apple Mail only when it is literally com.apple.mail.
    // undefined: could not tell, so never Apple Mail (see MailtoHandlerResult).
    appleMailDefault = handler === null || (typeof handler === 'string' && handler.toLowerCase() === 'com.apple.mail');
  }

  const devices = await devicesPromise;

  return { platform, devices, booksApp, sendToKindleApp, appleMailDefault };
}
