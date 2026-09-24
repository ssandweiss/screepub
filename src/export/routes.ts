// The route catalog: every way a finished book can leave Screepub, best
// route first, and the rule that what you chose last time wins.
//
// Ported from the Swift Mac app's route catalog, whose order, wording and
// `preselected` rule this keeps (its checks are ported in
// tests/routes.test.ts; docs/superpowers/plans/2026-09-23-send-routes-engine.md
// names the Swift originals). The
// window draws this list and never ranks it: the order IS the interface, so
// it lives in one tested place rather than as conditionals in a view.
//
// Pure: no file system, no processes, no settings file. The facts arrive
// already probed (route-facts.ts), and the remembered route arrives as a
// string, so every platform's answer is checkable from any host.
//
// Order, strongest claim first (Swift's, unchanged):
//  1. A plugged-in device: the person physically connected it.
//  2. A docked reMarkable: same reasoning, but it never mounts.
//  3. Apple Books: instant, local, no account, and reaches an iPhone or iPad.
//  4. Send to Kindle: needs Amazon and a browser, best-looking Kindle result.
//  5. Email: works, but needs the approved-sender setup people forget.
//  6. Save the EPUB, then save a Kindle file: always works, the floor.
// Then every row that cannot fire right now, each carrying its fix as its
// detail: device kinds not connected, reMarkable not docked, Apple Books off
// a Mac, email without Apple Mail.
import { DEVICE_DISPLAY_NAMES, deviceId, type ConnectedDevice, type DeviceKind } from '../device/types';

/** What is remembered: a device by KIND, never its name or volume path. A
 *  Kindle is the same destination whatever it mounts as, and a remembered
 *  path would go stale the moment it was unplugged. */
export type RouteKey = string; // 'device:<kind>' | 'remarkable' | 'apple-books' | 'send-to-kindle' | 'email-to-kindle' | 'save-epub' | 'save-kindle'

/** Why a listed row cannot fire right now:
 *  - connect:  plug it in, dock it.
 *  - platform: not made for this system; nothing the person can change.
 *  - setup:    a setting would fix it (the default mail app). */
export type Unavailable = 'connect' | 'platform' | 'setup';

/** A connected device as a row carries it: DeviceSummary's shape, so `id`
 *  is exactly what `send --device` accepts. */
export interface RouteDevice {
  id: string;
  kind: DeviceKind;
  name: string;
  volume: string | null;
}

export interface Route {
  /** Row identity. A connected device appends its volume so two Kindles are
   *  two rows; keyed by kind alone, a send aimed at the second would land on
   *  the first one's volume. Every other row's id is its key. */
  id: string;
  key: RouteKey;
  title: string;
  /** The mechanism when available; the fix when not. */
  detail: string;
  /** Names exactly what fires, so the click is never a surprise. */
  button: string;
  available: boolean;
  /** Present exactly when `available` is false. */
  unavailable?: Unavailable;
  /** Present on rows for a connected device (a volume reader, or a docked
   *  reMarkable), so the window can hand its id to `send --device`. */
  device?: RouteDevice;
}

export interface RouteFacts {
  platform: string;
  /** listDevices(), a docked reMarkable included (kind 'remarkable'). */
  devices: ConnectedDevice[];
  booksApp: boolean;
  sendToKindleApp: boolean;
  appleMailDefault: boolean;
}

/** Every volume-mounted kind, read from types.ts, so a new kind gets its
 *  placeholder without anyone remembering this list exists. */
export const DEVICE_KINDS: readonly DeviceKind[] = (
  Object.keys(DEVICE_DISPLAY_NAMES) as DeviceKind[]
).filter((kind) => kind !== 'remarkable');

const DEVICE_DETAIL = 'over USB, offline, nothing leaves this computer';
const PLUG_IN = 'plug in over USB to send';
const TOLINO_ON_WINDOWS = 'cannot be found on Windows: a Windows drive carries no volume name';
const REMARKABLE = { title: 'reMarkable', button: 'Upload to reMarkable' } as const;
const APPLE_BOOKS = { title: 'Apple Books', button: 'Add to Apple Books' } as const;
const EMAIL = { title: 'Send to Kindle email', button: 'Send to Kindle email' } as const;

/** The name a connected device's row shows: its own, or its kind's when its
 *  own is blank (a drive with no label reads as '' on Windows). A blank
 *  title is not just an empty-looking row: the window refuses a list with a
 *  blank title in it WHOLE, save rows and all. A name that is not blank is
 *  kept exactly as the device gave it. */
function nameOf(device: ConnectedDevice): string {
  return device.name.trim() === '' ? DEVICE_DISPLAY_NAMES[device.kind] : device.name;
}

function summarize(device: ConnectedDevice): RouteDevice {
  return { id: deviceId(device), kind: device.kind, name: nameOf(device), volume: device.volume };
}

function row(key: RouteKey, title: string, detail: string, button: string): Route {
  return { id: key, key, title, detail, button, available: true };
}

function dimmed(
  key: RouteKey,
  title: string,
  detail: string,
  button: string,
  unavailable: Unavailable,
): Route {
  return { id: key, key, title, detail, button, available: false, unavailable };
}

/** The catalog for these facts: available rows in Swift's order, then every
 *  row that cannot fire right now with its fix. Never empty: both save rows
 *  are always there. */
export function routes(facts: RouteFacts): Route[] {
  const onMac = facts.platform === 'darwin';
  const list: Route[] = [];

  const volumeDevices = facts.devices.filter((d) => d.kind !== 'remarkable');
  const remarkable = facts.devices.find((d) => d.kind === 'remarkable');

  for (const device of volumeDevices) {
    const key = `device:${device.kind}`;
    const name = nameOf(device);
    list.push({
      ...row(key, name, DEVICE_DETAIL, `Copy to ${name}`),
      id: `${key}#${device.volume ?? deviceId(device)}`,
      device: summarize(device),
    });
  }
  if (remarkable) {
    // The window uploads the EPUB (it has no original PDF to hand over).
    list.push({
      ...row('remarkable', REMARKABLE.title, 'the EPUB, over its USB connection', REMARKABLE.button),
      device: summarize(remarkable),
    });
  }
  if (onMac && facts.booksApp) {
    list.push(row('apple-books', APPLE_BOOKS.title, 'syncs to your iPhone and iPad', APPLE_BOOKS.button));
  }
  // The label follows what will open: Amazon's app when installed (a Mac
  // app), else its web uploader. Windows gets the web route.
  const sendToKindle = onMac && facts.sendToKindleApp ? 'Send to Kindle app' : 'Send to Kindle web';
  list.push(row('send-to-kindle', sendToKindle, 'via Amazon, the best-looking Kindle result', sendToKindle));
  const canEmail = onMac && facts.appleMailDefault;
  if (canEmail) {
    list.push(row('email-to-kindle', EMAIL.title, 'a Mail message with the book attached', EMAIL.button));
  }
  // Named by purpose: the file you email is not the file you sideload.
  list.push(row('save-epub', 'Save the EPUB', 'for email, Apple Books and most e-readers', 'Save the EPUB…'));
  list.push(row('save-kindle', 'Save a Kindle file', 'for copying to a Kindle by hand', 'Save a Kindle file…'));

  // Anything fixable stays listed, dimmed, with its fix: absent hardware or a
  // non-Apple-Mail default is a state, not a missing feature. A connected
  // kind never also gets a placeholder.
  const connectedKinds = new Set(volumeDevices.map((d) => d.kind));
  for (const kind of DEVICE_KINDS) {
    if (connectedKinds.has(kind)) continue;
    const name = DEVICE_DISPLAY_NAMES[kind];
    // Plugging a tolino into Windows would not help: it is identified by its
    // volume name, which a Windows drive does not carry.
    const cannotFind = kind === 'tolino' && facts.platform === 'win32';
    list.push(
      dimmed(
        `device:${kind}`,
        name,
        cannotFind ? TOLINO_ON_WINDOWS : PLUG_IN,
        `Copy to ${name}`,
        cannotFind ? 'platform' : 'connect',
      ),
    );
  }
  if (!remarkable) {
    list.push(dimmed('remarkable', REMARKABLE.title, 'dock over USB to send', REMARKABLE.button, 'connect'));
  }
  // On a Mac with no Books.app the row is hidden, as the Swift app hid it:
  // structural absence on the one platform that has it is not a fix a person
  // can make. Everywhere else it is listed, as a Mac-only route.
  if (!onMac) {
    list.push(dimmed('apple-books', APPLE_BOOKS.title, 'on a Mac only', APPLE_BOOKS.button, 'platform'));
  }
  if (!canEmail) {
    list.push(
      onMac
        ? dimmed(
            'email-to-kindle',
            EMAIL.title,
            'needs Apple Mail as the default mail app, the one mail app the attachment survives',
            EMAIL.button,
            'setup',
          )
        : dimmed(
            'email-to-kindle',
            EMAIL.title,
            'on a Mac only; save the EPUB and attach it yourself',
            EMAIL.button,
            'platform',
          ),
    );
  }
  return list;
}

/** The row to choose first. What the person chose last time wins whenever
 *  it is listed and could work here, even while unavailable: an unplugged
 *  Kindle (connect) or a changed mail app (setup) stays chosen and its
 *  button waits. A remembered choice beats any ordering; the order is the
 *  fallback for a first run, not a policy about what people ought to want.
 *
 *  A remembered row that is unavailable for `platform` can never work on
 *  this system, so it is treated like a route that is not listed at all
 *  (Swift: "a structurally absent remembered route falls back instead of
 *  stranding the user"). Then, as with nothing remembered, the first
 *  available row, so a first run never guesses at hardware that is not
 *  there. */
export function preselected(list: Route[], lastRoute: string | undefined): Route {
  if (lastRoute !== undefined) {
    const remembered = list.find((r) => r.key === lastRoute);
    if (remembered && remembered.unavailable !== 'platform') return remembered;
  }
  const chosen = list.find((r) => r.available) ?? list[0];
  if (!chosen) throw new Error('preselected needs at least one route');
  return chosen;
}
