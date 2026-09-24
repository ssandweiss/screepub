// Send: every way the book can leave, and the file each one should get.
//
// The window knows nothing about devices or routes. `screepub routes` lists
// every way out in its own order (what is plugged in among them) and which
// one was used last, `screepub export` says which file a Kindle should get
// (KFX → AZW3 → MOBI, the best rung this machine can reach), `screepub send`
// moves it to a reader, and `screepub route` performs the rest: it opens
// Apple Books, Amazon or Mail, or writes a copy where the Save box said.
// Each of those is tested TypeScript shared with the CLI; this file draws
// their answers and never re-decides them. If anything here starts to look
// like it knows what a Kindle is, it belongs in src/device/.
//
// The file is in two halves, the way convert.js, read.js and tune.js are.
// Everything this surface DECIDES — which devices are offerable, which
// rung applies, what a refusal means, what "sent" is allowed to claim, and
// what is honest to say about hardware nobody here has ever plugged in — is
// a pure exported function above the line, tested directly by
// tests/desktop-ui.test.ts. Below the line is drawing, which holds no rule
// of its own and rides on the live run.
import { runEngine, argv, saveDialog } from './app.js';
import { settingsFrom } from './tune.js';
import { el, clear, text } from './dom.js';
import { canFocus } from './focus.js';
import {
  HEADING, mountKfx, kfxShown, kfxHidden, kfxDevicesChanged, kfxRedraw, kfxInstalling,
} from './kfx.js';

// ---------------------------------------------------------------- decisions

/** The project's own stated limit, on the surface rather than buried in a
 *  README: one Kindle, on one Mac, is the whole of what has ever been
 *  plugged in. Everything else — every other vendor, and the same Kindle on
 *  Linux or Windows — is built and code-tested and nothing more. Saying so
 *  is the difference between a promise and a claim. */
export const UNPROVEN = 'never been tested on real hardware';

/** Short form, for the standing list of readers. Same fact, column width. */
export const UNPROVEN_SHORT = 'Never run on real hardware';
export const PROVEN_LABEL = 'Verified on hardware';

/** The one combination anyone has actually run. Not a set of kinds: the
 *  platform is half of it. Windows drive enumeration has never met a real
 *  reader either, so a Kindle on Windows is exactly as unproven as a Kobo. */
export const PROVEN = { kind: 'kindle', platform: 'mac' };

export const KINDS = ['kindle', 'kobo', 'tolino', 'remarkable'];

/** Something a person could read: a string with more than spaces in it. */
const isText = (value) => typeof value === 'string' && value.trim() !== '';

/** Every reader Screepub can reach, and how — shown whether or not one is
 *  connected, because with nothing plugged in this list IS the surface. The
 *  route is stated in full: "a Kindle gets an EPUB" would be wrong in a way
 *  a reader could not discover until the book failed to appear. */
export const READERS = [
  {
    kind: 'kindle',
    name: 'Kindle',
    // The ladder in its own order, best rung first: KFX, then AZW3, then the
    // engine's MOBI. Listing it any other way would read as a preference the
    // engine does not hold.
    route: 'Over USB. Kindles never index a sideloaded EPUB, so Screepub builds a KFX, '
      + 'an AZW3 or its own MOBI — whichever is the best this computer can make — and copies '
      + 'that across instead.',
  },
  {
    kind: 'kobo',
    name: 'Kobo',
    route: 'Over USB. The EPUB, copied to the volume, where the reader indexes it when you '
      + 'eject.',
  },
  {
    kind: 'tolino',
    name: 'tolino',
    route: 'Over USB. The EPUB, into the Books folder at the root of the volume.',
  },
  {
    kind: 'remarkable',
    name: 'reMarkable',
    route: 'Over the tablet’s own USB web interface, which is why it never turns up as '
      + 'a drive. The EPUB, into the root folder.',
  },
];

/** Which of the three this window is standing on. navigator.userAgentData is
 *  absent on WebKitGTK and navigator.platform is deprecated, so both can be
 *  undefined in the same window; an unknown platform is not a Mac, which is
 *  the safe way round — it under-claims rather than over-claims. */
export function platformOf(hint) {
  const said = String(hint ?? '');
  if (/mac/i.test(said)) return 'mac';
  if (/win/i.test(said)) return 'windows';
  if (/linux|x11|bsd/i.test(said)) return 'linux';
  // Not 'linux': under-claiming hardware support is right, but naming the
  // wrong operating system is not. A window that could not tell would
  // otherwise print "never tested from Linux" on a Mac.
  return 'unknown';
}

/** What the standing list says in its third column. */
export function readerStatus(kind, platform) {
  const proven = kind === PROVEN.kind && platformOf(platform) === PROVEN.platform;
  return { proven, text: proven ? PROVEN_LABEL : UNPROVEN_SHORT };
}

/** The one line under the standing list. Without it, four identical red
 *  statuses in a column read as a warning wall; with it they read as a
 *  statement, which is what they are. It also carries the fact the statuses
 *  alone cannot: WHERE the one proven route was proven. */
export function provenNote(platform) {
  const where = platformOf(platform);
  if (where === PROVEN.platform) {
    return 'A Kindle over USB, on a Mac, is the one route anyone has actually run. The others '
      + 'are built and code-tested, and that is all — they are listed because Screepub will '
      + 'try, not because anyone can promise.';
  }
  // Named only when it is known. An absent navigator.platform must not be
  // reported as some particular operating system.
  const named = where === 'windows' ? 'from Windows'
    : where === 'linux' ? 'from Linux'
      : 'on this computer’s platform';
  return `Sending has ${UNPROVEN} ${named} — the one route anyone has run was a Kindle `
    + 'over USB, on a Mac. The code is the same on all three platforms; the confidence is not.';
}

/** A reader Screepub could not find even if it were plugged in. tolino is
 *  identified by the NAME of its volume and a Windows drive root carries
 *  none, so on Windows it is not undetected-so-far, it is undetectable — and
 *  a person hunting for a missing row deserves to be told that rather than
 *  left to conclude their cable is bad. Null everywhere else. */
export function undetectable(platform) {
  if (platformOf(platform) !== 'windows') return null;
  return 'A tolino cannot be found on Windows at all: it is identified by the name of its '
    + 'volume, and a Windows drive root carries none. Windows drive detection as a whole has '
    + `${UNPROVEN}.`;
}

/** The sentence beside a device that is actually connected right now, or
 *  null when there is nothing to warn about. Kind AND platform, for the same
 *  reason PROVEN carries both. */
export function caveatFor(device, platform) {
  const where = platformOf(platform);
  const name = typeof device?.name === 'string' && device.name.trim() !== ''
    ? device.name.trim()
    : 'this reader';
  if (device?.kind === PROVEN.kind) {
    if (where === PROVEN.platform) return null;
    return `Sending to a Kindle has ${UNPROVEN} on this computer’s platform — only on a Mac.`;
  }
  return `Sending to a ${name} has ${UNPROVEN}. It is built and code-tested; nobody has `
    + 'plugged one in.';
}

/** Which rung of `screepub export` this device is asking for. A Kindle never
 *  indexes a sideloaded EPUB, so handing it the EPUB would be a known-broken
 *  path dressed up as success; everything else takes the book as built.
 *  Which FILE the Kindle rung then produces is the engine's ladder to walk,
 *  not this window's. */
export function forFormat(device) {
  return device?.kind === 'kindle' ? 'kindle' : 'epub';
}

/** Where the file will land, in words. The volume path is the useful fact
 *  for anything that mounts; a reMarkable has no path because it never
 *  mounts, and printing its kind there would read as a shrug. */
export function whereLine(device) {
  if (typeof device?.volume === 'string' && device.volume.trim() !== '') return device.volume;
  return 'reached over USB, without mounting as a drive';
}

/** Why nothing can be sent for this script yet, or null when it can. The
 *  library artifact is the source of truth: it is what Read previewed and
 *  what Tune rebuilds, and it is the only file this surface is willing to
 *  hand to a transfer. */
export function blockedReason(script) {
  if (script === null || script === undefined) return 'Convert a script first.';
  const epub = typeof script.epubPath === 'string' ? script.epubPath.trim() : '';
  if (epub === '') {
    return 'Screepub has no book on disk for this script, so there is nothing to copy across. '
      + 'Converting it again puts one in the library.';
  }
  return null;
}

/** This script's own tuning, as the engine takes it — never the defaults. A
 *  rebuild with the defaults would silently hand over a book in formatting
 *  the reader never chose, and it would do it without a word on screen. */
export function optionsJsonFor(script) {
  const settings = script?.settings;
  if (typeof settings !== 'object' || settings === null || Array.isArray(settings)) return null;
  if (Object.keys(settings).length === 0) return null;
  return JSON.stringify(settings);
}

export const SEND_LABEL = 'Send to';
export const SENT_LABEL = 'Sent to';

/** The verb stays constant through the flow: the control that says Send
 *  produces a result that says Sent. */
export function sendLabel(device) {
  return `${SEND_LABEL} ${device.name}`;
}

/** What the surface is allowed to claim once the engine says it is done.
 *  Two shapes, because `send` reports two: a volume gets a destination path
 *  and the eject warning that goes with it (a Kobo indexes on unplug and a
 *  yanked cable loses the book), while a reMarkable reports an upload and
 *  has no path to name. A malformed success is still a success — the engine
 *  said ok — but it is not allowed to invent a path it was not given. */
export function sentLine(device, answer) {
  const destination = typeof answer?.destination === 'string' ? answer.destination.trim() : '';
  if (answer?.uploaded === true || destination === '') {
    return `${SENT_LABEL} ${device.name}.`;
  }
  return `${SENT_LABEL} ${device.name} — ${destination}. Eject the volume before you unplug it.`;
}

/** What actually went across, in the engine's own words. `label` is
 *  src/export/formats.ts's, so which rung was reached is stated by the code
 *  that chose it. A missing label falls back to the file itself rather than
 *  to a guess about the ladder. */
export function artifactLine(built) {
  const label = typeof built?.label === 'string' ? built.label.trim() : '';
  if (label !== '') return label;
  const path = typeof built?.path === 'string' ? built.path.trim() : '';
  return path === '' ? '' : path;
}

/** Shown only if the engine breaks its own contract and refuses with no
 *  sentence in it. Every real failure renders the engine's words instead —
 *  they are already written for a person. */
export const NO_MESSAGE = 'The engine refused to send without saying why.';

/** The one place that decides what the status line says, so a line drawn at
 *  the start of a send and a line drawn at the end of one cannot disagree.
 *  `bad` is false for every phase but failure: a new attempt after a failed
 *  one has to clear the alarm, not inherit it.
 *
 *  The route phases sit beside the device ones: `opening` names the route
 *  (its title, the engine's word for it), `saving` is the dialog's copy, and
 *  `building-kindle` says the wait up front, because the Kindle rung can sit
 *  in Kindle Previewer for twenty seconds with nothing else moving. `done` is
 *  a route's own sentence, as `sent` is a device's. */
export function statusFor(phase, { device = null, detail = '', route = null } = {}) {
  const name = device?.name ?? 'the reader';
  if (phase === 'failed') {
    const said = typeof detail === 'string' ? detail.trim() : '';
    return { line: said === '' ? NO_MESSAGE : said, bad: true };
  }
  if (phase === 'sent' || phase === 'done') return { line: detail, bad: false };
  if (phase === 'building') return { line: `Building the file ${name} can open…`, bad: false };
  if (phase === 'preparing') return { line: `Getting the book ready for ${name}…`, bad: false };
  if (phase === 'copying') return { line: `Copying it to ${name}…`, bad: false };
  if (phase === 'opening') {
    const title = isText(route?.title) ? route.title.trim() : '';
    return { line: title === '' ? 'Opening…' : `Opening ${title}…`, bad: false };
  }
  if (phase === 'saving') return { line: 'Saving…', bad: false };
  if (phase === 'building-kindle') {
    return {
      line: 'Building the Kindle file (Kindle Previewer can take about twenty seconds)…',
      bad: false,
    };
  }
  return { line: '', bad: false };
}

/** The engine's own sentence for a refusal, or a readable stand-in when it
 *  breaks its contract and refuses without one. */
export function failureMessage(answer) {
  const said = typeof answer?.error?.message === 'string' ? answer.error.message.trim() : '';
  return said === '' ? NO_MESSAGE : said;
}

/** What the two answers add up to, as the pair statusFor takes.
 *
 *  This is the decision the whole surface turns on, so it is HERE and not in
 *  the drawing: whether a transfer happened. `ok !== true` is the engine's
 *  only word for "it did not", and a surface that failed to check it would
 *  print "Sent to Kindle." over a refusal — sentLine cannot tell, because a
 *  refusal carries no destination and that is also the shape a reMarkable
 *  upload takes. Both answers are checked, and the export's first: a Kindle
 *  whose file could not be built was never copied anywhere. */
export function outcomeFor(built, sent, device) {
  if (built?.ok !== true) return ['failed', { device, detail: failureMessage(built) }];
  if (sent?.ok !== true) return ['failed', { device, detail: failureMessage(sent) }];
  return ['sent', { device, detail: sentLine(device, sent) }];
}

/** Whether this script's settings still have to be fetched before an export.
 *  Tune stores them the moment it opens; a reader who never opened Tune has
 *  a sidecar full of settings and nothing here that knows it, and the rung
 *  that consults them would rebuild the book with the DEFAULTS. */
export function needsSettings(script) {
  if (script === null || script === undefined) return false;
  if (script.settings !== null && script.settings !== undefined) return false;
  const fountain = typeof script.fountainPath === 'string' ? script.fountainPath.trim() : '';
  return fountain !== '';
}

/** Which phase the wait is in before the copy starts. The Kindle rung can
 *  take twenty seconds of Kindle Previewer; the EPUB rung is a stat. Saying
 *  "building" for the one that builds nothing would be theatre. */
export function preparingPhase(device) {
  return forFormat(device) === 'kindle' ? 'building' : 'preparing';
}

// Routes: every way the book can leave, as `screepub routes` lists them.
//
// The catalog is the ENGINE's (src/export/routes.ts): which routes exist
// here, their order, their words, which one is chosen, and why a dimmed one
// cannot fire. What follows only checks that answer's shape and says what
// the window does with each row. It never ranks, renames or hides one; if
// anything here starts to decide which route is better, it belongs there.

/** Why a listed row cannot fire, in the engine's three words. */
const UNAVAILABLE = new Set(['connect', 'platform', 'setup']);

/** A connected device as a row carries it, rebuilt clean, or null. An entry
 *  with no id cannot be addressed by `send` at all, and one with no name has
 *  nothing to put on its row. A kind this window has never heard of is KEPT:
 *  the engine is the authority on what a device is, and a future vendor must
 *  not be invisible here just because this file is older than it; it gets
 *  the unproven caveat, which is the truth. `volume` has to be THERE (a
 *  string, or null for a reMarkable, which JSON keeps), because a missing one
 *  means the engine changed its shape. */
function routeDeviceFrom(device) {
  if (typeof device !== 'object' || device === null || Array.isArray(device)) return null;
  if (!isText(device.id) || !isText(device.kind) || !isText(device.name)) return null;
  if (typeof device.volume !== 'string' && device.volume !== null) return null;
  return { id: device.id, kind: device.kind, name: device.name, volume: device.volume };
}

/** One row, rebuilt clean, or null. The engine's rules, each one checked:
 *  `unavailable` exactly when the row is not available, and a `device`
 *  exactly on an available row that sends to one (a device row with no
 *  device has nothing to hand to `send`; a device on any other row means
 *  the list is not the shape the engine promises). */
function routeFrom(route) {
  if (typeof route !== 'object' || route === null || Array.isArray(route)) return null;
  const { id, key, title, detail, button, available } = route;
  if (![id, key, title, detail, button].every(isText)) return null;
  if (typeof available !== 'boolean') return null;
  if (available && route.unavailable !== undefined) return null;
  if (!available && !UNAVAILABLE.has(route.unavailable)) return null;
  const sendsToDevice = available && isDeviceRoute(route);
  if ((route.device !== undefined) !== sendsToDevice) return null;
  const clean = { id, key, title, detail, button, available };
  if (!available) clean.unavailable = route.unavailable;
  if (sendsToDevice) {
    const device = routeDeviceFrom(route.device);
    if (device === null) return null;
    clean.device = device;
  }
  return clean;
}

/** `routes --json`'s answer as `{ routes, chosen }`, or null.
 *
 *  Taken whole or not at all, the way kfx.js takes its checklist: a list
 *  with one broken row is not drawn with that row missing, because the rows
 *  ARE the page and a quietly shorter list reads as a route that does not
 *  exist. Null sends the page to the engine's failure line instead. The
 *  copies are rebuilt field by field, so nothing the engine happened to
 *  attach rides along into the drawing, and the engine's words are kept
 *  exactly as written (an unavailable row's detail is its fix, shown as is).
 *  Ids are unique and `chosen` is one of them: an id is what the page tells
 *  rows apart by and what gets the brass button. */
export function routesFrom(answer) {
  if (answer?.ok !== true || !Array.isArray(answer.routes)) return null;
  const list = answer.routes.map(routeFrom);
  if (list.some((route) => route === null)) return null;
  const ids = new Set(list.map((route) => route.id));
  if (ids.size !== list.length) return null;
  if (!ids.has(answer.chosen)) return null;
  return { routes: list, chosen: answer.chosen };
}

/** Whether a row goes through `export` then `send`, the device flow with its
 *  own phases: a volume reader of any kind (a kind this file has never heard
 *  of included, as routeDeviceFrom() keeps one), or a docked reMarkable. */
export function isDeviceRoute(route) {
  const key = route?.key;
  if (typeof key !== 'string') return false;
  return key.startsWith('device:') || key === 'remarkable';
}

/** The button a row gets: brass for the chosen route, outline for every
 *  other one that can fire, and none at all for a row that cannot. A chosen
 *  row that is unavailable (the Kindle you used last time, unplugged) keeps
 *  its place at the top and waits without a button. */
export function buttonClassFor(route, chosenId) {
  if (route?.available !== true) return null;
  return route.id === chosenId ? 'btn btn-brad' : 'btn btn-outline';
}

/** Used only when a path has no name in it at all, so the dialog never
 *  starts on a bare ".epub", which a Mac would hide. */
const SAVE_FALLBACK = 'Screenplay';

const bareExtension = (extension) => String(extension ?? '').replace(/^\./, '');

/** The save dialog's default name: the book's own stem with the extension of
 *  the file being saved. The stem comes from the FILE name (a folder called
 *  "v1.2" must not lend it a dot), with either separator, because the window
 *  runs on Windows too. Only the last extension goes, so a title with dots
 *  in it keeps them. */
export function saveNameFor(epubPath, extension) {
  const path = typeof epubPath === 'string' ? epubPath : '';
  const file = path.split(/[/\\]/).pop() ?? '';
  const dot = file.lastIndexOf('.');
  const stem = dot > 0 ? file.slice(0, dot) : file;
  return `${stem === '' ? SAVE_FALLBACK : stem}.${bareExtension(extension)}`;
}

/** The save dialog's one filter. The label is the engine's name for the
 *  file; a filter with no label is named by its extension rather than left
 *  as a blank line in the dialog. */
export function saveFiltersFor(extension, label) {
  const bare = bareExtension(extension);
  const name = isText(label) ? label.trim() : bare.toUpperCase();
  return [{ name, extensions: [bare] }];
}

/** Stand-in for a route the engine says worked but did not describe. It
 *  claims exactly what is known. "Done." would claim more: the window does
 *  not know what the route did, only that the engine said ok. */
export const NO_NOTE = 'The engine said it worked, without saying what it did.';

/** What a route's answer (`route --json`) adds up to, as the pair statusFor
 *  takes, the way outcomeFor() does for a device. `ok !== true` is the
 *  failure path, in the engine's words, whatever else the answer carries: a
 *  note on a refusal is not a success. */
export function routeNoteFrom(answer) {
  if (answer?.ok !== true) return ['failed', { detail: failureMessage(answer) }];
  return ['done', { detail: isText(answer.note) ? answer.note.trim() : NO_NOTE }];
}

/** The email route's first-time step. Amazon throws away mail from a sender
 *  it has not been told to accept, and says nothing, so a first send that
 *  "worked" never arrives. The Swift app offered a guide to Amazon's
 *  Personal Document Settings page, where the Kindle's address lives and the
 *  approved list is edited; this is that offer. `key` is what the engine
 *  opens the page by: the window names no URL. Shown on the email row
 *  whether or not it can fire here, because attaching the EPUB by hand
 *  needs the same approval. */
export function emailSetupHint(route) {
  if (route?.key !== 'email-to-kindle') return null;
  return {
    line: 'First time? Amazon needs your sender address approved, or it drops the email without a word.',
    key: EMAIL_SETUP,
  };
}

/** The key the email row's setup link is performed by: the same one
 *  app.js's `argv.emailSetup()` hands the engine. */
const EMAIL_SETUP = 'kindle-email-setup';

/** The email row's setup link, and the name it is opened by on the status
 *  line ("Opening Amazon’s page…"). */
export const SETUP_BUTTON = 'Open Amazon’s page';
export const SETUP_TITLE = 'Amazon’s page';

/** Which flow a row's button runs. A device row (a reader over USB, or a
 *  docked reMarkable) goes through `export` then `send`, sendTo() below,
 *  with its own phases. Each save is its own flow, because each asks where
 *  first. The email row's setup link opens Amazon's page. Every other key
 *  is a route the ENGINE performs (it opens Books, Amazon's app or page, or
 *  Mail), including one this window is older than: the engine performs it
 *  or refuses in its own words, which beats a button that does nothing. */
export function performerFor(route) {
  if (isDeviceRoute(route)) return 'device';
  const key = route?.key;
  if (!isText(key)) return null;
  if (key === 'save-epub' || key === 'save-kindle') return key;
  if (key === EMAIL_SETUP) return 'setup';
  return 'open';
}

/** What is plugged in, read off the route list: the device of every row
 *  that carries one (routesFrom() lets a device ride only on an available
 *  device row), in the engine's order, as copies. This is what
 *  `ctx.state.devices` and the KFX block's relevance read, as they read
 *  `devices` before routes. Null when there is no list, which the KFX block
 *  takes as "not known yet" rather than "nothing connected". */
export function connectedDevices(shown) {
  if (!Array.isArray(shown?.routes)) return null;
  return shown.routes.filter((route) => route.device !== undefined)
    .map((route) => ({ ...route.device }));
}

/** Whether the list on screen is still the list the engine just described.
 *  The poll runs every two seconds; rebuilding the rows on every tick would
 *  steal the focus out from under anyone tabbing to a button and flicker the
 *  row they were about to press. Everything a row draws counts (id,
 *  availability, detail, title, button, device) and so does which one is
 *  chosen, since that is where the brass goes. Both lists are routesFrom()'s
 *  clean copies, built field by field in one order, so comparing them as
 *  text compares exactly what is drawn. */
export function sameRoutes(a, b) {
  if (!Array.isArray(a?.routes) || !Array.isArray(b?.routes)) return false;
  return JSON.stringify(a) === JSON.stringify(b);
}

/** What a row says: its title and the engine's detail (the mechanism when it
 *  can fire, the fix when it cannot), and on a connected device row the
 *  unproven caveat and, for a reader that mounts, the volume the file lands
 *  on. A docked reMarkable never mounts and gets no such line: the engine's
 *  detail already says how it is reached, and whereLine()'s stand-in beside
 *  it said the same thing twice. */
export function routeLines(route, platform) {
  const device = route?.device ?? null;
  return {
    title: route?.title,
    detail: route?.detail,
    where: device !== null && isText(device.volume) ? whereLine(device) : null,
    caveat: device === null ? null : caveatFor(device, platform),
  };
}

/** Stand-in when the export says it built the Kindle file but not what kind
 *  of file it is, so there is nothing to name the Save box's file by. */
export const NO_EXTENSION = 'The engine built the Kindle file without saying what kind of file it is.';

/** What "Save a Kindle file" learns from `export --for kindle`, as a pair
 *  like outcomeFor()'s: the extension and the engine's label, to name the
 *  Save box's file and filter, or the failure line. The export decides the
 *  rung (KFX, AZW3 or MOBI); this only reads which one it reached. An
 *  extension that is not a bare word opens no dialog at all. */
export function kindleFileFrom(built) {
  if (built?.ok !== true) return ['failed', { detail: failureMessage(built) }];
  const extension = typeof built.extension === 'string' ? bareExtension(built.extension.trim()) : '';
  if (!/^[A-Za-z0-9]+$/.test(extension)) return ['failed', { detail: NO_EXTENSION }];
  return ['built', { extension, label: isText(built.label) ? built.label.trim() : null }];
}

/** Shown in place of the list when `routes` said ok in a shape routesFrom()
 *  will not draw. Not NO_MESSAGE: the engine did not refuse anything. */
export const NO_ROUTES = 'The engine listed the ways to send this book in a shape this window cannot read.';

/** The line in place of the list: the engine's own sentence for a refusal,
 *  or NO_ROUTES for an ok answer that could not be drawn. */
export function routesFailure(answer) {
  return answer?.ok === true ? NO_ROUTES : failureMessage(answer);
}

/** The folded table of every reader and how it is reached, under the list.
 *  "Nothing plugged in" used to stand above it; the dimmed device rows now
 *  say that per reader, with the fix ("plug in over USB to send"). */
export const REACH_HEADING = 'What Screepub can reach';

/** Not "nothing leaves this computer" any more: that was true when every row
 *  was a cable, and Send to Kindle and email go through Amazon. The device
 *  rows still say it, in the engine's words, where it is true. */
export const LEDE = 'Every way this book can go from here, the one you used last time in brass. '
  + 'A reader plugged in over USB gets the file it can actually open.';

/** Shown until the first `routes` answer arrives. */
export const LOOKING = 'Looking for every way to send it…';

export const NO_SCRIPT = {
  slug: 'Nothing to send yet',
  line: 'Convert a script and it can go to a reader from here.',
};

// ------------------------------------------------------------------ drawing

let ctx = null;
let pane = null;
let list = null;
let statusLine = null;
let artifactNote = null;
let poll = null;
/** The route list on screen (routesFrom()'s answer), or null when none is:
 *  still looking, or a failure line in its place. */
let drawn = null;
/** Polls begun, and the newest one whose answer counts. An answer asked
 *  before one already drawn is older than what is on screen and is dropped,
 *  so a slow poll cannot put back a list a faster, later one replaced. */
let asks = 0;
let newest = 0;
/** A send or a route in flight (sendTo() and perform() share it). Two at
 *  once would be a genuine race and not a cosmetic one: the MOBI rung of
 *  src/export/artifact.ts REWRITES the library EPUB in place before it
 *  writes the .mobi beside it, and a save of the EPUB could copy it half
 *  written. So the whole list goes dead for the duration, and the poll stops
 *  rebuilding rows underneath it: a redraw mid-send would hand back a
 *  fresh, enabled button and let a second one start. */
let sending = false;
/** Which script this surface is showing. A send already in flight cannot be
 *  cancelled — the engine has been asked — but it must not SAY anything once
 *  the script under it has been replaced, or "Sent to Kindle." lands in the
 *  status line beside a script that was never sent. Same shape as tune.js's
 *  `era`. */
let era = 0;

/** Under a person's patience, well above the cost of a mount scan. */
const POLL_MS = 2000;

export function mount(node, context) {
  pane = node;
  ctx = context;
  draw();
}

export function scriptChanged() {
  era += 1;
  drawn = null;
  draw();
}

export function show() {
  draw();
  refresh();
  // A reader plugs something in while looking at this surface; the list has
  // to notice on its own. Cleared first: a second show() without an
  // intervening hide() would otherwise leave the first interval running
  // forever with nothing holding its handle.
  clearInterval(poll);
  poll = setInterval(refresh, POLL_MS);
  kfxShown();
}

export function hide() {
  clearInterval(poll);
  poll = null;
  kfxHidden();
}

function draw() {
  clear(pane);
  list = null;
  statusLine = null;
  artifactNote = null;
  drawn = null;

  if (!ctx.state.script) {
    pane.append(
      el('h2', { class: 'slug' }, NO_SCRIPT.slug),
      el('p', { class: 'prose' }, NO_SCRIPT.line),
    );
    return;
  }

  const blocked = blockedReason(ctx.state.script);
  if (blocked !== null) {
    pane.append(
      el('h2', { class: 'fault' }, 'No book to send'),
      el('p', { class: 'fault-body' }, blocked),
      el('div', { class: 'read-ways' },
        el('button', {
          type: 'button', class: 'btn btn-outline', onclick: () => ctx.goTo('convert'),
        }, 'Convert it again')),
    );
    return;
  }

  list = el('div', { class: 'devices' },
    el('p', { class: 'caption' }, LOOKING));
  statusLine = el('p', { class: 'caption send-status', role: 'status' }, '');
  artifactNote = el('p', { class: 'caption send-artifact' }, '');
  artifactNote.hidden = true;
  const kfxNode = el('section', { class: 'kfx-setup', 'aria-label': HEADING });
  kfxNode.hidden = true;

  pane.append(
    el('h2', { class: 'slug' }, 'Send it'),
    el('p', { class: 'prose' }, LEDE),
    list,
    statusLine,
    artifactNote,
    kfxNode,
    reach(),
  );
  // After the append: kfx.js draws only into a node that is in the page.
  mountKfx(kfxNode, {
    isSending: () => sending,
    // What is connected, read off the route list: the block's relevance
    // (Kindle advice is for Kindles) reads it as it read `devices`. Null
    // until the first answer, so the block does not flash up and vanish.
    devices: () => connectedDevices(drawn),
    onBusy: (on) => { for (const button of buttons()) button.disabled = on; },
    // Its redraws hand the keyboard back through the same plan as every
    // other surface's (focus.js), when a control it held is gone.
    restoreFocus: () => ctx.restoreFocus(),
  });
}

/** Every route this book can take, as `screepub routes` lists them, asked
 *  again every two seconds so a reader plugged in turns up on its own. */
async function refresh() {
  if (list === null) return;
  // Rows must not be rebuilt out from under a send in progress.
  if (sending) return;
  const into = list;
  const mine = ++asks;
  let answer;
  try {
    answer = await runEngine(argv.routes(ctx.state.script.epubPath));
  } catch (err) {
    // The same three reasons to drop an answer as below.
    if (list !== into || sending || mine <= newest) return;
    newest = mine;
    fault(err.message);
    return;
  }
  // A new script's page, a send begun since, or a newer answer already
  // drawn: this one is out of date, and drawing it would undo something.
  if (list !== into || sending || mine <= newest) return;
  newest = mine;
  const shown = routesFrom(answer);
  if (shown === null) {
    fault(routesFailure(answer));
    return;
  }
  ctx.state.devices = connectedDevices(shown);
  // Nothing changed, so nothing is redrawn: a rebuild every two seconds
  // would take the focus off a button someone had just tabbed to.
  if (sameRoutes(drawn, shown)) return;
  drawn = shown;
  rebuild(() => {
    for (const route of shown.routes) list.append(routeRow(route, shown.chosen));
  });
  // After the rows, not before: a KFX block that hides now while it held
  // the keyboard hands it to the page's first stop, which should be a row.
  kfxDevicesChanged();
}

/** A route or a send just worked, and the engine now remembers it: ask again
 *  at once rather than at the next tick, so the brass moves to the route
 *  just used. Every poll already out was asked before the engine remembered
 *  it, so none of them may land after this one and put the brass back. */
function repoll() {
  newest = asks;
  refresh();
}

/** The list could not be drawn: the engine's sentence (or NO_ROUTES) in its
 *  place, never a list quietly short of the row that broke it. */
function fault(line) {
  drawn = null;
  rebuild(() => list.append(el('p', { class: 'fault-body' }, line)));
}

/** Refill the list. Rebuilding throws away whatever button the keyboard
 *  stood on, so where it stood is noted first and handed back after, the
 *  way kfx.js does for its own rows. */
function rebuild(fill) {
  const focused = list.contains(document.activeElement) ? document.activeElement : null;
  clear(list);
  fill();
  if (focused !== null) giveBackFocus(focused.dataset?.route ?? null);
}

/** The keyboard, back on the same route's button when it can still take the
 *  focus (a new reader plugged in above it moved it down, the brass moved to
 *  it). Otherwise focus.js's plan picks the page's first stop, as after
 *  every other redraw in this window: the reader it sent to was unplugged. */
function giveBackFocus(route) {
  const same = route === null ? null
    : buttons().find((button) => button.dataset.route === route);
  if (canFocus(same)) same.focus();
  else ctx.restoreFocus();
}

/** What Screepub can reach, and how, whatever is plugged in.
 *
 *  The table folds away. It is four readers, four honesty labels and two
 *  caveats: good information, and not what someone came to this page to
 *  find out. A <details> rather than a hand-rolled toggle: the open/shut
 *  state, the keyboard and the announcement come from the platform. It is
 *  drawn once per page, outside the list the poll rebuilds, so a reader who
 *  opened it does not have it shut on them by a reader being plugged in.
 *
 *  Folded, never dropped. Everything that made the table honest travels with
 *  it, including provenNote(), which carries the one fact the four statuses
 *  cannot: WHERE the single proven route was proven.
 *
 *  Built through el() rather than appended straight to the node, because
 *  el() drops a null child and Node.append() renders it as the word "null".
 *  That is not hypothetical: the old empty state shipped a stray "null"
 *  under the list on every platform but Windows until it was seen on screen. */
function reach() {
  const platform = navigator.platform;
  const cannot = undetectable(platform);
  return el('details', { class: 'reach' },
    el('summary', { class: 'reach-summary' }, REACH_HEADING),
    ...READERS.map((reader) => readerRow(reader, platform)),
    el('p', { class: 'caption reader-note' }, provenNote(platform)),
    cannot === null ? null : el('p', { class: 'caption device-caveat' }, cannot),
  );
}

function readerRow(reader, platform) {
  const status = readerStatus(reader.kind, platform);
  return el('div', { class: 'reader-row' },
    el('p', { class: 'device-name' }, reader.name),
    el('p', { class: `reader-status${status.proven ? '' : ' reader-untested'}` }, status.text),
    el('p', { class: 'reader-route' }, reader.route),
  );
}

/** One route: its title and the engine's detail, a device's volume line and
 *  caveat, the email row's first-time step, and a button only when it can
 *  fire. A dimmed row keeps its place and its fix; it has nothing to press.
 *  Each button carries its route's id as data-route, which is how a rebuild
 *  finds the same route's button again. */
function routeRow(route, chosen) {
  const lines = routeLines(route, navigator.platform);
  const hint = emailSetupHint(route);
  const style = buttonClassFor(route, chosen);
  // The poll keeps running through a KFX install (it stops only for a send),
  // so a row it draws mid-install has its buttons born as dead as the
  // others', and the install's end brings them all back.
  const button = style === null ? null : el('button', {
    type: 'button', class: style, 'data-route': route.id, disabled: kfxInstalling(),
    onclick: () => choose(route),
  }, route.button);
  return el('div', { class: route.available ? 'device-row' : 'device-row route-unavailable' },
    el('div', { class: 'device-what' },
      el('p', { class: 'device-name' }, lines.title),
      el('p', { class: 'route-detail' }, lines.detail),
      lines.where === null ? null : el('p', { class: 'device-where' }, lines.where),
      lines.caveat === null ? null : el('p', { class: 'device-caveat' }, lines.caveat),
      hint === null ? null : el('p', { class: 'caption route-hint' }, hint.line, ' ',
        el('button', {
          type: 'button', class: 'btn-quiet', 'data-route': hint.key, disabled: kfxInstalling(),
          onclick: () => keepFocus(hint.key, () => perform({ key: hint.key, title: SETUP_TITLE })),
        }, SETUP_BUTTON)),
    ),
    button,
  );
}

/** A row's button: a device through sendTo(), with its phases; every other
 *  route through perform(). */
function choose(route) {
  if (performerFor(route) === 'device') keepFocus(route.id, () => sendTo(route.device));
  else keepFocus(route.id, () => perform(route));
}

/** Runs one route and gives the keyboard back to the button that started it.
 *  A route kills every button on the list while it runs, and a dead button
 *  cannot hold the focus; a Save box takes it too, and when that closes the
 *  window's own handler puts it on the page's first live stop, which is not
 *  this row. So when the keyboard was in the list as the route started, it
 *  goes back to the same route's button once the buttons live again, found
 *  by its id (a repoll may redraw the row), or failing that to the page's
 *  plan: giveBackFocus(), as after a redraw. Success, refusal or a cancelled
 *  Save box alike.
 *
 *  Left alone when there is nothing to put back (a mouse press: WebKit does
 *  not focus a clicked button) or the reader has moved on: another script
 *  (a new page), or another surface (the list is hidden, and the plan would
 *  move the keyboard on a page the reader is not looking at). */
async function keepFocus(id, run) {
  const held = list !== null && list.contains(document.activeElement);
  const mine = era;
  await run();
  if (held && era === mine && canFocus(list)) giveBackFocus(id);
}

/** Every Send button on the surface, so a send can take the whole list out
 *  of reach rather than only the row it started from. */
function buttons() {
  return list === null ? [] : [...list.querySelectorAll('button')];
}

/** The script's own settings, fetched if this window has not seen them yet.
 *  Tune stores them on the script the moment it opens; a reader who never
 *  opened Tune has a sidecar full of settings and nothing here that knows
 *  it, and the MOBI rung would then rebuild the book with the DEFAULTS. The
 *  engine is asked rather than guessed at, and one validator — Tune's — says
 *  whether the answer is one. A read that fails changes nothing: the send
 *  goes ahead exactly as it would have, with no options to pass. */
async function ensureSettings() {
  const script = ctx.state.script;
  if (!needsSettings(script)) return;
  try {
    const answer = await runEngine(argv.settings(script.fountainPath));
    ctx.state.script.settings = settingsFrom(answer);
  } catch {
    // Unreadable settings are not a reason to refuse a send: an EPUB route
    // does not consult them at all, and the Kindle rung that does will fall
    // back to what the engine already considers this script's defaults.
  }
}

async function sendTo(device) {
  if (sending || kfxInstalling()) return;
  sending = true;
  const mine = era;
  /** Another script was opened while this send was in flight. */
  const stale = () => era !== mine;
  /** The copy happened; the engine now remembers this reader's kind. */
  let worked = false;
  for (const button of buttons()) button.disabled = true;
  artifactNote.hidden = true;
  try {
    // Inside the try, so a redraw that threw could never leave `sending` on.
    kfxRedraw();
    await ensureSettings();
    if (stale()) return;
    const script = ctx.state.script;
    say(statusFor(preparingPhase(device), { device }));

    // The library artifact is what Read previewed and what Tune rebuilds, so
    // it is the only file handed to a transfer. What the Kindle rung makes
    // of it is the engine's ladder, not this window's.
    const built = await runEngine(argv.export(script.epubPath, {
      forFormat: forFormat(device),
      fountain: script.fountainPath,
      optionsJson: optionsJsonFor(script),
    }));

    // Nothing is copied when nothing was built: the export's refusal is the
    // whole answer, and asking `send` to move a file that does not exist
    // would replace the engine's sentence with a worse one.
    if (stale()) return;
    if (built.ok !== true) {
      say(statusFor(...outcomeFor(built, null, device)));
      return;
    }

    say(statusFor('copying', { device }));
    const sent = await runEngine(argv.send(built.path, device.id));
    if (stale()) return;

    const [phase, detail] = outcomeFor(built, sent, device);
    say(statusFor(phase, detail));
    if (phase !== 'sent') return;
    worked = true;
    const what = artifactLine(built);
    text(artifactNote, what);
    artifactNote.hidden = what === '';
  } catch (err) {
    // The engine's own sentence, verbatim. Every one of them is already
    // written for a person — "no reader is connected — plug one in over USB
    // and try again", "reMarkable accepts PDF and EPUB, not .mobi." — and
    // this window is not better placed to say it.
    if (!stale()) say(statusFor('failed', { device, detail: err.message }));
  } finally {
    sending = false;
    for (const button of buttons()) button.disabled = false;
    kfxRedraw();
    if (worked && !stale()) repoll();
  }
}

/** Every route that is not a device, from the press to the line that says
 *  how it went: sendTo()'s twin, under the SAME `sending` flag and the same
 *  `era` discipline, so no two routes (or a route and a send) ever run at
 *  once and no line is painted into a script that replaced this one.
 *
 *  The window never writes the file. A save asks where in the Save box and
 *  hands the chosen path to `route save-* --out`; the engine writes there.
 *  A cancelled box (null) is a change of mind: it goes straight out, asks
 *  the engine nothing more, and says nothing. */
async function perform(route) {
  if (sending || kfxInstalling()) return;
  sending = true;
  const mine = era;
  /** Another script was opened while this route was in flight. */
  const stale = () => era !== mine;
  const how = performerFor(route);
  /** The engine said the route worked, so it now remembers it. */
  let worked = false;
  for (const button of buttons()) button.disabled = true;
  artifactNote.hidden = true;
  try {
    // Inside the try, so a redraw that threw could never leave `sending` on.
    kfxRedraw();
    const script = ctx.state.script;
    let options = {};
    let what = '';
    if (how === 'save-epub') {
      const out = await saveDialog({
        defaultPath: saveNameFor(script.epubPath, 'epub'),
        filters: saveFiltersFor('epub', 'EPUB'),
      });
      if (stale() || out === null) return;
      options = { out };
      say(statusFor('saving'));
    } else if (how === 'save-kindle') {
      // The Kindle file is built (or found fresh) first, with this script's
      // own settings: which rung it reaches (KFX, AZW3, MOBI) is what names
      // the file in the Save box.
      await ensureSettings();
      if (stale()) return;
      const settings = { fountain: script.fountainPath, optionsJson: optionsJsonFor(script) };
      say(statusFor('building-kindle'));
      const built = await runEngine(argv.export(script.epubPath, { forFormat: 'kindle', ...settings }));
      if (stale()) return;
      const [phase, file] = kindleFileFrom(built);
      if (phase === 'failed') {
        say(statusFor(phase, file));
        return;
      }
      // The wait is over; the Save box is the next thing on screen.
      say(statusFor('idle'));
      const out = await saveDialog({
        defaultPath: saveNameFor(script.epubPath, file.extension),
        // Named by purpose and type, short enough for a dialog's format menu.
        // The engine's label ("AZW3, for USB sideload to Kindle") is a
        // sentence for the page, not a menu item.
        filters: saveFiltersFor(file.extension, `Kindle file (${file.extension.toUpperCase()})`),
      });
      if (stale() || out === null) return;
      options = { out, ...settings };
      what = artifactLine(built);
      say(statusFor('saving'));
    } else {
      say(statusFor('opening', { route }));
    }
    const answer = await runEngine(how === 'setup'
      ? argv.emailSetup()
      : argv.route(route.key, script.epubPath, options));
    if (stale()) return;
    const [phase, detail] = routeNoteFrom(answer);
    say(statusFor(phase, detail));
    worked = phase === 'done';
    if (!worked) return;
    text(artifactNote, what);
    artifactNote.hidden = what === '';
  } catch (err) {
    // runEngine throws only when the engine could not run or broke its
    // contract, and a Save box only when the OS refused one; both messages
    // are already written for a person.
    if (!stale()) say(statusFor('failed', { detail: err.message }));
  } finally {
    sending = false;
    for (const button of buttons()) button.disabled = false;
    kfxRedraw();
    if (worked && !stale()) repoll();
  }
}

function say(status) {
  if (statusLine === null) return;
  text(statusLine, status.line);
  statusLine.classList.toggle('bad', status.bad);
}
