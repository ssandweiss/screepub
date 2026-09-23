// Send: what is plugged in, and the file that should go on it.
//
// The window knows nothing about devices. `screepub devices` says what is
// connected, `screepub export` says which file a Kindle should get (KFX →
// AZW3 → MOBI, the best rung this machine can reach), and `screepub send`
// moves it. Each of those is tested TypeScript shared with the CLI; this
// file draws their answers and never re-decides them. If anything here
// starts to look like it knows what a Kindle is, it belongs in src/device/.
//
// The file is in two halves, the way convert.js, read.js and tune.js are.
// Everything this surface DECIDES — which devices are offerable, which
// rung applies, what a refusal means, what "sent" is allowed to claim, and
// what is honest to say about hardware nobody here has ever plugged in — is
// a pure exported function above the line, tested directly by
// tests/desktop-ui.test.ts. Below the line is drawing, which holds no rule
// of its own and rides on the live run.
import { runEngine, argv } from './app.js';
import { settingsFrom } from './tune.js';
import { el, clear, text } from './dom.js';
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

/** One device from the engine's answer, or null if it is not one. An entry
 *  with no id cannot be addressed by `send` at all, and an entry with no
 *  name has nothing to put on a button, so both are dropped rather than
 *  drawn as a row that cannot work. A kind this window has never heard of is
 *  KEPT: the engine is the authority on what a device is, and a future
 *  vendor must not be invisible here just because this file is older than
 *  it. It simply gets the unproven treatment, which is the truth. */
export function deviceFrom(entry) {
  if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) return null;
  const id = typeof entry.id === 'string' ? entry.id.trim() : '';
  const name = typeof entry.name === 'string' ? entry.name.trim() : '';
  const kind = typeof entry.kind === 'string' ? entry.kind.trim() : '';
  if (id === '' || name === '' || kind === '') return null;
  return { id, kind, name, volume: typeof entry.volume === 'string' ? entry.volume : null };
}

/** Everything connected, as this surface will draw it. A malformed answer
 *  reads as nothing connected rather than as an error: the empty state is
 *  already an honest, actionable thing to show, and "the engine broke its
 *  contract" is not something a reader can do anything about. */
export function devicesFrom(answer) {
  const devices = answer?.devices;
  if (!Array.isArray(devices)) return [];
  return devices.map(deviceFrom).filter((device) => device !== null);
}

/** Whether the list on screen is still the list the engine just described.
 *  The poll runs every two seconds; rebuilding the rows on every tick would
 *  steal the focus out from under anyone tabbing to a button and flicker the
 *  row they were about to press. Identity is id AND name AND kind: a volume
 *  remounted under the same path with a different reader on it is a
 *  different device. */
export function sameDevices(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
  return a.every((device, i) =>
    device.id === b[i].id && device.kind === b[i].kind && device.name === b[i].name);
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
 *  one has to clear the alarm, not inherit it. */
export function statusFor(phase, { device = null, detail = '' } = {}) {
  const name = device?.name ?? 'the reader';
  if (phase === 'failed') {
    const said = typeof detail === 'string' ? detail.trim() : '';
    return { line: said === '' ? NO_MESSAGE : said, bad: true };
  }
  if (phase === 'sent') return { line: detail, bad: false };
  if (phase === 'building') return { line: `Building the file ${name} can open…`, bad: false };
  if (phase === 'preparing') return { line: `Getting the book ready for ${name}…`, bad: false };
  if (phase === 'copying') return { line: `Copying it to ${name}…`, bad: false };
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

export const EMPTY = {
  slug: 'No reader connected',
  // The empty state is what most people meet first, so it is an invitation
  // and an explanation rather than a blank panel. It says what is true now,
  // what will happen when that changes, and what Screepub can reach at all.
  line: 'There is no reader connected right now. Plug one in over USB and it turns up here on '
    + 'its own, within a couple of seconds — there is nothing to press first.',
  heading: 'What Screepub can reach',
};

export const LEDE = 'The book in your library, on the reader on your desk. Screepub builds the '
  + 'file each reader can actually open, then copies it across — nothing leaves this computer.';

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
let drawn = null;
/** A send in flight. Two sends at once would be a genuine race and not a
 *  cosmetic one: the MOBI rung of src/export/artifact.ts REWRITES the
 *  library EPUB in place before it writes the .mobi beside it. So the whole
 *  list goes dead for the duration, and the poll stops rebuilding rows
 *  underneath it — a redraw mid-send would hand back a fresh, enabled
 *  button and let a second one start. */
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
    el('p', { class: 'caption' }, 'Looking for readers…'));
  statusLine = el('p', { class: 'caption send-status', role: 'status' }, '');
  artifactNote = el('p', { class: 'caption send-artifact' }, '');
  artifactNote.hidden = true;
  const kfxNode = el('section', { class: 'kfx-setup', 'aria-label': HEADING });
  kfxNode.hidden = true;

  pane.append(
    el('h2', { class: 'slug' }, 'Send to a reader'),
    el('p', { class: 'prose' }, LEDE),
    list,
    statusLine,
    artifactNote,
    kfxNode,
  );
  // After the append: kfx.js draws only into a node that is in the page.
  mountKfx(kfxNode, {
    isSending: () => sending,
    devices: () => drawn,
    onBusy: (on) => { for (const button of buttons()) button.disabled = on; },
    // Its redraws hand the keyboard back through the same plan as every
    // other surface's (focus.js), when a control it held is gone.
    restoreFocus: () => ctx.restoreFocus(),
  });
}

async function refresh() {
  if (list === null) return;
  // Rows must not be rebuilt out from under a send in progress.
  if (sending) return;
  let answer;
  try {
    answer = await runEngine(argv.devices());
  } catch (err) {
    if (list === null) return;
    drawn = null;
    clear(list);
    list.append(el('p', { class: 'fault-body' }, err.message));
    return;
  }
  if (list === null || sending) return;
  const devices = devicesFrom(answer);
  ctx.state.devices = devices;
  // Nothing changed, so nothing is redrawn: a rebuild every two seconds
  // would take the focus off a button someone had just tabbed to.
  if (drawn !== null && sameDevices(drawn, devices)) return;
  drawn = devices;
  clear(list);
  if (devices.length === 0) drawEmpty();
  else for (const device of devices) list.append(deviceRow(device));
  // After the rows, not before: a KFX block that hides now while it held
  // the keyboard hands it to the page's first stop, which should be a row.
  kfxDevicesChanged();
}

/** Nothing connected is an ANSWER, not an error — the same position
 *  `screepub devices` itself takes — so it is set in the page's own ink and
 *  never in alarm. */
function drawEmpty() {
  const platform = navigator.platform;
  const cannot = undetectable(platform);
  // Built through el() rather than appended straight to the node, because
  // el() drops a null child and Node.append() renders it as the word "null".
  // That is not hypothetical: this state shipped a stray "null" under the
  // list on every platform but Windows until it was seen on screen.
  // The reach table folds away. It is four readers, four honesty labels and
  // two caveats, and it was the bulk of this page — good information, and not
  // what someone with nothing plugged in came here to find out. A <details>
  // rather than a hand-rolled toggle: the open/shut state, the keyboard and
  // the announcement come from the platform.
  //
  // Folded, never dropped. Everything that made the table honest travels with
  // it, including provenNote(), which carries the one fact the four statuses
  // cannot: WHERE the single proven route was proven.
  list.append(el('div', { class: 'reader-list' },
    el('p', { class: 'state-label' }, 'Nothing plugged in'),
    el('p', { class: 'prose' }, EMPTY.line),
    el('details', { class: 'reach' },
      el('summary', { class: 'reach-summary' }, EMPTY.heading),
      ...READERS.map((reader) => readerRow(reader, platform)),
      el('p', { class: 'caption reader-note' }, provenNote(platform)),
      cannot === null ? null : el('p', { class: 'caption device-caveat' }, cannot),
    ),
  ));
}

function readerRow(reader, platform) {
  const status = readerStatus(reader.kind, platform);
  return el('div', { class: 'reader-row' },
    el('p', { class: 'device-name' }, reader.name),
    el('p', { class: `reader-status${status.proven ? '' : ' reader-untested'}` }, status.text),
    el('p', { class: 'reader-route' }, reader.route),
  );
}

function deviceRow(device) {
  const caveat = caveatFor(device, navigator.platform);
  // The poll keeps running through a KFX install (it stops only for a send),
  // so a reader plugged in mid-install gets a row here; its button starts
  // out as dead as the others, and the install's end brings them all back.
  const button = el('button', {
    type: 'button', class: 'btn btn-brad', disabled: kfxInstalling(),
  }, sendLabel(device));
  button.addEventListener('click', () => sendTo(device));
  return el('div', { class: 'device-row' },
    el('div', { class: 'device-what' },
      el('p', { class: 'device-name' }, device.name),
      el('p', { class: 'device-where' }, whereLine(device)),
      caveat === null ? null : el('p', { class: 'device-caveat' }, caveat),
    ),
    button,
  );
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
  }
}

function say(status) {
  if (statusLine === null) return;
  text(statusLine, status.line);
  statusLine.classList.toggle('bad', status.bad);
}
