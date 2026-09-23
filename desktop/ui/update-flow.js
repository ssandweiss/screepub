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
  updatesPossible, runCheck, rememberAnswer, rememberedOffer, forgetFound, installAndRestart,
} from './update.js';
import { RELEASE } from './notes.js';

export function createUpdateFlow(deps) {
  let phase = null;
  let offer = null;
  let running = false;
  const listeners = new Set();

  function setPhase(next) {
    phase = next ?? null;
    for (const listener of listeners) {
      try {
        listener(phase);
      } catch {
        // One subscriber's bug (a typo in frame.js, say) must not silence
        // every OTHER subscriber, and must not turn a restart that would
        // otherwise succeed into a reported failure: this fires from deep
        // inside installAndRestart's own try/catch (update.js), so an
        // uncaught throw here does not stop at "that listener didn't hear
        // it" — it can end the whole run.
      }
    }
  }

  /** A check somewhere found a newer version. A run already under way keeps
   *  its own moment on screen; the new offer waits behind it. */
  function offerFound(result) {
    offer = result;
    if (!running) setPhase({ kind: 'offer', version: result.version });
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
      listener(phase);
      return () => listeners.delete(listener);
    },

    currentOffer: () => offer,
    offerFound,

    /** At launch: redraw what an earlier check found, then run today's check
     *  (which runCheck skips unless the reader said yes, and at most once a
     *  day). */
    async boot() {
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
      } finally {
        // 'restarting' and 'installed' are final: the process is on its way
        // out, or there is nothing left for a second click to do. Every
        // other outcome must let go of `running`, INCLUDING one that never
        // arrived at all (a rejection leaves `outcome` undefined here) — or
        // a fault on the way in, with no outcome to report, would wedge
        // every later start() shut as a silent no-op forever.
        if (!outcome || (outcome.outcome !== 'restarting' && outcome.outcome !== 'installed')) {
          running = false;
        }
      }
      // Restarting, or installed with no way to restart: either way there is
      // nothing left for a second click to do.
      if (outcome.outcome === 'restarting' || outcome.outcome === 'installed') return;
      if (outcome.outcome === 'current') offer = null;
      // app.js closes the Update object after any attempt, so a retry has to
      // fetch a fresh one (installAndRestart does, when `update` is null).
      else offer = { ...offer, update: null };
    },
  };
}

/** The window's one flow. Every dependency is read when a method runs, not
 *  at import, so bun test can import this file without a window. */
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
