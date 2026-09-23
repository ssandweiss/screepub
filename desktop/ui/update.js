// Whether there is a newer Screepub, and what to say about it.
//
// This file holds no version rule and no endpoint. `pickUpdate` decides what
// counts as newer, and it is transpiled from the engine's own module, so the
// CLI and the window cannot disagree about it. The endpoint lives in
// tauri.conf.json. What is decided HERE is when to ask, what a failure means,
// and what a person is told.
//
// Three rules from tauri-plugin-updater's own behaviour, each of which is a
// test above:
//
//   * check() REJECTS on any failure — a 404 manifest, no network, a platform
//     the manifest does not list. A rejection is a MESSAGE. It is never "you
//     are up to date", and treating it as one would tell somebody they were
//     current at the exact moment nobody could reach the server.
//   * The day-stamp is written BEFORE the request. README promises at most
//     one request a day; stamping afterwards would turn a persistent failure
//     into a request on every launch, which is the opposite of the promise.
//   * The plugin does not relaunch on macOS. It swaps the bundle and stops.
//     Until 2026-09-23 that was the end of it: a one-click restart was
//     another crate and another permission, so the window asked the reader
//     to quit and reopen. The owner watched that fail on his own Mac (0.7.2
//     installed, the window still said 0.7.1, and nothing said why) and
//     approved both: tauri-plugin-process and process:allow-restart. The
//     restart waits for any engine work still running (installAndRestart).
import { pickUpdate, shouldCheck } from './update-compare.js';

const OPT_IN = 'updateOptIn';
const ASKED = 'updateAsked';
const STAMP = 'updateLastChecked';
const FOUND = 'updateFound';

/** Whether this build can be updated at all where it is running.
 *
 *  The published manifest lists darwin only. On Linux and Windows check()
 *  throws TargetNotFound every time, so offering the control there would be
 *  offering a button whose only possible outcome is an error. Widen this the
 *  day the manifest gains rows, and not before. */
export function updatesPossible(platform) {
  return /mac/i.test(String(platform ?? ''));
}

/** The three facts, read out of a string bucket anyone can edit.
 *
 *  A junk timestamp reads as "never checked" rather than as NaN. NaN makes
 *  every comparison false, which would silently disable the daily check
 *  forever, and silently is the worst way for a promise about network
 *  behaviour to stop being kept. */
export function readState(storage) {
  const raw = Number(storage?.getItem(STAMP));
  return {
    optedIn: storage?.getItem(OPT_IN) === 'true',
    asked: storage?.getItem(ASKED) === 'true',
    lastChecked: Number.isFinite(raw) && raw > 0 ? raw : null,
  };
}

/** Record the reader's answer to the one question, so it is never asked
 *  twice. `asked` is stored separately from `optedIn`, because "said no" and
 *  "has not been asked" are different states and only one of them may be
 *  asked again. */
export function rememberAnswer(storage, optedIn) {
  storage?.setItem(ASKED, 'true');
  storage?.setItem(OPT_IN, optedIn ? 'true' : 'false');
}

/** Whether the Convert page should ask the one question.
 *
 *  Only where an update could actually happen, and only until it has been
 *  answered, here or with the switch in the release notes. "Said no" and
 *  "never asked" are different states (see rememberAnswer), and only the
 *  second one is asked. */
export function shouldAsk(usable, storage) {
  return Boolean(usable) && !readState(storage).asked;
}

/** The version a check found, kept across launches.
 *
 *  The check runs once a day, so an offer held only in memory was lost by
 *  quitting and reopening the same day: the label went away and nothing
 *  brought it back until tomorrow. Forgetting writes an empty string rather
 *  than removing the key, because every storage this file is handed has
 *  setItem and an empty string reads as nothing. */
export function rememberFound(storage, version) {
  storage?.setItem(FOUND, String(version ?? ''));
}

export function forgetFound(storage) {
  storage?.setItem(FOUND, '');
}

/** The remembered version if this build is still behind it, else null. The
 *  judgement is pickUpdate's, the same one a live check uses. */
export function rememberedOffer(storage, currentVersion) {
  const found = storage?.getItem(FOUND);
  if (!found) return null;
  return pickUpdate({ version: found, currentVersion }).offer ? found : null;
}

/** How far a download has got, as a whole percent, or null when the server
 *  sent no length. Never above 100: a server that under-reports its length
 *  must not produce "140%". */
export function downloadPercent(received, total) {
  if (!Number.isFinite(total) || total <= 0 || !Number.isFinite(received)) return null;
  return Math.min(100, Math.max(0, Math.floor((received / total) * 100)));
}

/** The words beside the version stamp for each moment of an update, or null
 *  when there is nothing to say. One function, so the label and the release
 *  notes cannot describe the same moment two ways. */
export function updateLabel(phase) {
  switch (phase?.kind) {
    case 'offer':
      return `Update to ${phase.version}`;
    case 'downloading': {
      const percent = downloadPercent(phase.received, phase.total);
      return percent === null
        ? `Downloading ${phase.version}…`
        : `Downloading ${phase.version}… ${percent}%`;
    }
    case 'installing':
      return 'Installing…';
    case 'waiting':
      return 'Restarting after this finishes…';
    case 'restarting':
      return 'Restarting…';
    case 'failed':
      return 'Update failed. Try again';
    case 'installed':
      return installedLine(phase.version);
    default:
      return null;
  }
}

/** What to tell someone when the bundle has been swapped and this build
 *  cannot restart itself (no process plugin). With the plugin, the window
 *  restarts instead and nobody reads this. */
export function installedLine(version) {
  return `Update installed. Quit and reopen Screepub to use ${version}.`;
}

/** Run a check, or decline to.
 *
 *  `check` is injected rather than imported so this can be exercised without
 *  Tauri — the same split convert.js and read.js use, and the reason every
 *  rule above is a test rather than a comment.
 *
 *  Returns one of four outcomes, deliberately distinct:
 *    skipped  no request was made, and none was owed
 *    offer    there is a newer version; version and body are the prompt
 *    current  a request was made and there is nothing newer
 *    error    a request was made and failed; message is for a person
 */
export async function runCheck({ manual, storage, now, check }) {
  const state = readState(storage);
  // A manual press IS the consent for that one request, so it ignores both
  // the opt-in and the throttle. Everything else obeys both.
  if (!manual && !shouldCheck(state.optedIn, state.lastChecked ?? undefined, now)) {
    return { outcome: 'skipped' };
  }

  // Before the request. See the header.
  storage?.setItem(STAMP, String(now));

  let update;
  try {
    update = await check();
  } catch (err) {
    return { outcome: 'error', message: String(err?.message ?? err) };
  }

  const decision = pickUpdate(update
    ? { version: update.version, currentVersion: update.currentVersion }
    : null);
  if (!decision.offer) {
    // A request was made and answered: whatever an earlier check remembered
    // is no longer true. A FAILED request never reaches here, so no network
    // forgets nothing.
    forgetFound(storage);
    return { outcome: 'current', reason: decision.reason };
  }
  rememberFound(storage, update.version);
  return {
    outcome: 'offer',
    version: update.version,
    body: typeof update.body === 'string' ? update.body : '',
    update,
  };
}

/** Download, install and restart, saying each moment through onPhase.
 *
 *  Every Tauri call is injected, as `check` is for runCheck, so the whole
 *  order of events runs under `bun test` without a window. Returns what
 *  happened, so the caller knows what a second click should do:
 *    restarting  the restart was asked for (the process is on its way out)
 *    installed   the bundle is swapped but this build cannot restart itself
 *    current     a fresh check found nothing newer after all
 *    error       something failed; `message` is for a person */
export async function installAndRestart({
  offer, storage, now, check, install, busy, whenIdle, restartReady, restart, onPhase,
}) {
  let result = offer;
  try {
    // A label drawn from memory has no live Update object: the plugin's
    // resource lasts only as long as the session that fetched it. The click
    // is the consent for one fresh request, exactly as the manual button is.
    if (!result?.update) {
      result = await runCheck({ manual: true, storage, now, check });
      if (result.outcome === 'error') throw new Error(result.message);
      if (result.outcome !== 'offer') {
        onPhase(null);
        return { outcome: 'current' };
      }
    }
    const { version } = result;
    let received = 0;
    let total = null;
    onPhase({ kind: 'downloading', version, received, total });
    await install(result.update, (event) => {
      if (event?.event === 'Started') total = event.data?.contentLength ?? null;
      else if (event?.event === 'Progress') received += event.data?.chunkLength ?? 0;
      else if (event?.event === 'Finished') {
        onPhase({ kind: 'installing', version });
        return;
      }
      onPhase({ kind: 'downloading', version, received, total });
    });
    if (!restartReady()) {
      onPhase({ kind: 'installed', version });
      return { outcome: 'installed', version };
    }
    // Every engine call is somebody's work: a conversion, a copy to a
    // Kindle, a settings file half written. Say why the restart is waiting
    // rather than sitting on "Installing…" with no reason given.
    if (busy()) onPhase({ kind: 'waiting', version });
    await whenIdle();
    onPhase({ kind: 'restarting', version });
    await restart();
    return { outcome: 'restarting', version };
  } catch (err) {
    const message = String(err?.message ?? err);
    onPhase({ kind: 'failed', version: result?.version ?? null, message });
    return { outcome: 'error', message };
  }
}
