// `screepub update-decision` and `screepub update-should-check`.
//
// The window reaches src/update/compare.ts through a transpiled module.
// These verbs are the same judgement for everything that is not the
// window, so the comparator is never implemented-but-unreachable, which
// is the shape the parity audit found in the KFX installer.
//
// BOTH ARE OFFLINE, and that is a constraint rather than an accident.
// The caller supplies the versions or the timestamps; nothing here
// fetches a release list. The engine makes no network requests, the
// README says so on a public page, and the updater's network lives in
// the Tauri plugin on the other side of the process boundary.

import { pickUpdate, shouldCheck, type UpdateDecision } from './update/compare';

export interface UpdateDecisionArgs {
  offered: string | undefined;
  current: string | undefined;
}

/** Judge one offered version against the running one.
 *
 *  A missing flag THROWS rather than refusing. A refusal means "judged,
 *  and the answer is no"; a missing `--current` means nothing was
 *  judged, and folding the second into the first would let a caller with
 *  a typo conclude that no update exists. */
export function updateDecisionCommand(args: UpdateDecisionArgs): UpdateDecision {
  if (args.offered === undefined) {
    throw new Error('update-decision needs --offered <version> (the release that was found)');
  }
  if (args.current === undefined) {
    throw new Error('update-decision needs --current <version> (the build that is running)');
  }
  return pickUpdate({ version: args.offered, currentVersion: args.current });
}

export interface UpdateShouldCheckArgs {
  optedIn: boolean;
  /** Epoch milliseconds as the CLI received it, or undefined for never. */
  lastChecked: string | undefined;
  now: number;
}

/** Whether a network request is allowed at all, right now.
 *
 *  A `--last-checked` that is not a number THROWS rather than reading as
 *  "never checked". Garbage-means-never would turn one corrupted
 *  preference into a request on every launch, breaking the README's
 *  once-a-day promise through a typo. */
export function updateShouldCheckCommand(args: UpdateShouldCheckArgs): { check: boolean } {
  let last: number | undefined;
  if (args.lastChecked !== undefined) {
    last = Number(args.lastChecked);
    if (!Number.isFinite(last)) {
      throw new Error(
        `update-should-check: --last-checked must be epoch milliseconds (got "${args.lastChecked}")`,
      );
    }
  }
  return { check: shouldCheck(args.optedIn, last, args.now) };
}
