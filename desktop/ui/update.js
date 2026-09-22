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
//     A one-click restart is another crate and another permission, so the
//     honest move is to ask rather than to pretend.
import { pickUpdate, shouldCheck } from './update-compare.js';

const OPT_IN = 'updateOptIn';
const ASKED = 'updateAsked';
const STAMP = 'updateLastChecked';

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

/** What to tell someone after the bundle has been swapped. */
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
  if (!decision.offer) return { outcome: 'current', reason: decision.reason };
  return {
    outcome: 'offer',
    version: update.version,
    body: typeof update.body === 'string' ? update.body : '',
    update,
  };
}
