// The window's one update: which moment it is in, and the single run that
// downloads, installs and restarts.
//
// update.js decides and app.js touches Tauri. This file connects the two and
// keeps the moment, so the label beside the version stamp and the release
// notes cannot tell two different stories about the same update. It is a
// factory so a test can hand it fakes; the window uses `flow`, at the bottom.
import {
  updaterReady, updateCheck, updateInstall, engineBusy, whenIdle, restartReady, restartApp,
} from './app.js';
import {
  updatesPossible, runCheck, rememberAnswer, rememberedOffer, rememberFound, forgetFound,
  installAndRestart,
} from './update.js';
import { RELEASE } from './notes.js';

/** 'restarting' and 'installed' are final: the process is on its way out, or
 *  there is nothing left for a second click to do. start() below calls this
 *  once, right after installAndRestart returns. A failure caught before
 *  installAndRestart could run at all never reaches it: nothing was
 *  returned to ask about, so that path always counts as non-final and
 *  resets `running` directly. */
function isFinalOutcome(outcome) {
  return outcome?.outcome === 'restarting' || outcome?.outcome === 'installed';
}

export function createUpdateFlow(deps) {
  let phase = null;
  let offer = null;
  let running = false;
  let booted = false;
  const listeners = new Set();

  /** Call a listener without letting it take anything else down. One
   *  subscriber's bug (a typo in frame.js, say) must not silence every
   *  OTHER subscriber, and must not turn a restart that would otherwise
   *  succeed into a reported failure — this can fire from deep inside
   *  installAndRestart's own try/catch (update.js), so an uncaught throw
   *  here does not stop at "that listener didn't hear it", it can end the
   *  whole run. The same guard covers subscribe()'s own first call, so a
   *  broken listener cannot crash the SUBSCRIBE either. Logged rather than
   *  swallowed outright, so a broken listener still leaves something to
   *  debug. */
  function notify(listener, value) {
    try {
      listener(value);
    } catch (err) {
      console.error('update-flow.js: a subscriber threw', err);
    }
  }

  function setPhase(next) {
    phase = next ?? null;
    for (const listener of listeners) notify(listener, phase);
  }

  /** A check somewhere found a newer version. If nothing is running, this
   *  becomes the visible phase, body and all — so a subscriber that skips
   *  a redraw when the version repeats (a remembered stub, then a live
   *  check confirming the same version with real notes) still sees the
   *  real body, because the two emits are not identical payloads. If a run
   *  is already under way, the new offer is remembered for afterwards, and
   *  the CURRENT phase is re-emitted (unchanged) so a listener waiting on
   *  a change — a "Looking…" caption, say — still hears something rather
   *  than sticking on its own words forever. */
  function offerFound(result) {
    offer = result;
    if (!running) setPhase({ kind: 'offer', version: result.version, body: result.body ?? '' });
    else setPhase(phase);
  }

  async function launchCheck() {
    const result = await runCheck({
      manual: false, storage: deps.storage(), now: deps.now(), check: deps.check,
    });
    if (result.outcome === 'offer') {
      offerFound(result);
    } else if (result.outcome === 'current' && !running) {
      // A request was made and there is nothing newer, so a label drawn from
      // memory was wrong (a release pulled, say). runCheck has already
      // forgotten the version; take the label down to match.
      offer = null;
      setPhase(null);
    }
    // 'skipped' and 'error' say nothing. The launch check is Screepub's
    // errand, not the reader's, and a startup that shouts about the network
    // is worse than one that quietly tries again tomorrow. The manual button
    // in the release notes reports its failures, because there somebody asked.
  }

  return {
    usable: () => deps.usable(),

    /** Hear every change of moment, starting with the current one. */
    subscribe(listener) {
      listeners.add(listener);
      notify(listener, phase);
      return () => listeners.delete(listener);
    },

    currentOffer: () => offer,
    offerFound,

    /** At launch: redraw what an earlier check found, then run today's check
     *  (which runCheck skips unless the reader said yes, and at most once a
     *  day). Runs once, ever: a second call must not redraw a remembered
     *  stub over a live offer the first call (or offerFound since) already
     *  fetched. */
    async boot() {
      if (booted) return;
      booted = true;
      if (!deps.usable()) return;
      const remembered = rememberedOffer(deps.storage(), deps.currentVersion);
      if (remembered) offerFound({ outcome: 'offer', version: remembered, body: '', update: null });
      else forgetFound(deps.storage());
      await launchCheck();
    },

    /** The reader answered the question on the Convert page. A yes IS the
     *  consent and nothing has been stamped yet, so the check runs now:
     *  someone who says yes on a release day hears about it this session. */
    async answer(on) {
      rememberAnswer(deps.storage(), on);
      if (on && deps.usable()) await launchCheck();
    },

    /** The one run. A second call while it is under way does nothing. */
    async start() {
      if (running || offer === null) return;
      running = true;
      const attempted = offer;
      // A retry from a 'failed' phase must not sit on that stale text while
      // installAndRestart's own fresh check (triggered because a failed
      // attempt clears `update`) is in flight: show what is about to be
      // attempted at once, synchronously, so a re-emit mid-check
      // (offerFound, from an unrelated background check landing at the
      // same moment) has something honest to repeat instead of the last
      // failure.
      if (phase?.kind === 'failed') {
        // `retrying: true` marks this specific re-emit: the fresh check
        // this triggers (installAndRestart's own, since the failed attempt
        // cleared `update`) is running and nothing has been confirmed yet,
        // so a subscriber (notes-surface.js) must not treat this moment as
        // ready to click again.
        setPhase({ kind: 'offer', version: attempted.version, body: attempted.body ?? '', retrying: true });
      }
      let outcome;
      try {
        outcome = await installAndRestart({
          offer,
          storage: deps.storage(),
          now: deps.now(),
          check: deps.check,
          install: deps.install,
          busy: deps.busy,
          whenIdle: deps.whenIdle,
          restartReady: deps.restartReady,
          restart: deps.restart,
          onPhase: setPhase,
        });
      } catch (err) {
        // Something failed before installAndRestart could report anything
        // of its own — a storage accessor throwing, say. This runs from
        // click handlers with no catch of their own, so start() must
        // resolve, not reject, and the label must say something rather
        // than stick on whatever it last showed. installAndRestart never
        // got to run, so nothing was actually attempted: `offer` (and
        // whatever live Update handle it holds) is left exactly as it was.
        running = false;
        setPhase({ kind: 'failed', version: attempted.version, message: String(err?.message ?? err) });
        return;
      }
      if (isFinalOutcome(outcome)) return;
      running = false;
      if (offer !== attempted) {
        // A newer offer replaced this one while the run was under way: the
        // run that just finished was for `attempted` (or, if
        // installAndRestart ran its own fresh check, for outcome.offer
        // instead), not this one, so its outcome — a failure, or "nothing
        // newer" answering that check — must not be shown in its place.
        // Show what a click would actually install now, and keep storage
        // agreeing with the screen: installAndRestart's own fresh check may
        // just have forgotten the remembered version because ITS check
        // found nothing newer, which is no longer true of what is on
        // screen. The live Update handle this offer holds is left untouched
        // either way — clearing it would throw away a resource nobody used,
        // and cost the next start() an extra request it did not need.
        //
        // EXCEPTION: a launch check can answer with the very version a
        // click is installing right now (the launch check answers the same
        // 0.8.0 while a click's install of 0.8.0 is running, and that
        // install fails). Showing "Update to 0.8.0" the instant the failure
        // lands would erase it before the reader ever saw why it failed, so
        // a same-version offer after an error leaves the failed phase on
        // screen. `offer` already points at the newer object either way, so
        // "Try again" uses its live handle instead of triggering a fresh
        // check.
        const attemptedVersion = (outcome.offer ?? attempted).version;
        if (outcome.outcome === 'error' && offer.version === attemptedVersion) return;
        setPhase({ kind: 'offer', version: offer.version, body: offer.body ?? '' });
        rememberFound(deps.storage(), offer.version);
        return;
      }
      if (outcome.outcome === 'current') { offer = null; return; }
      // app.js closes the Update object after any attempt, so a retry has
      // to fetch a fresh one (installAndRestart does, when `update` is
      // null). outcome.offer is the offer installAndRestart actually used,
      // which can be newer than what this call started with, when a label
      // drawn from memory triggers a live check inside it.
      offer = { ...(outcome.offer ?? offer), update: null };
    },
  };
}

/** The window's one flow, built at import — RELEASE.version is read here
 *  too, since notes.js is pure data and that is safe at import time. What
 *  is NOT read at import: storage (localStorage), navigator, the clock
 *  (Date.now — app.js is the one that also needs performance.now, for its
 *  own quiet-period tracking) and every Tauri call. Each of those is a
 *  closure here, called only when a method runs, so importing this file
 *  needs no window and bun test can do it directly. */
export const flow = createUpdateFlow({
  usable: () => updaterReady()
    && updatesPossible(navigator.userAgentData?.platform ?? navigator.platform),
  storage: () => localStorage,
  now: () => Date.now(),
  check: updateCheck,
  install: updateInstall,
  busy: engineBusy,
  whenIdle,
  restartReady,
  restart: restartApp,
  currentVersion: RELEASE.version,
});
