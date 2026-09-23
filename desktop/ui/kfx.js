// The Send page's "Best Kindle quality" block: can this computer make KFX,
// and if not, the one thing to press for each missing piece.
//
// The checklist is the ENGINE's (src/export/kfx-setup.ts, via
// `screepub kfx-status`): which of Calibre, Kindle Previewer and the KFX
// plugin are present, what each missing one needs, and what a Kindle gets
// today. This file draws that answer and never re-decides it. It adds only
// what is about the window: when the block is worth showing, what a button
// says while it works, and what to say after.
//
// Two halves, like send.js: pure exported decisions above the line, tested
// directly by tests/desktop-ui.test.ts, and drawing below it.
import { runEngine, argv, openUrl } from './app.js';
import { el, clear, text } from './dom.js';

// ---------------------------------------------------------------- decisions

export const HEADING = 'Best Kindle quality';
export const INSTALLED = 'Installed';
export const INSTALLING = 'Downloading and installing the KFX plugin. This takes a few seconds.';
export const NO_REASON = 'The KFX plugin was not installed, and nothing said why.';

const KINDS = new Set(['link', 'install', 'after', 'unavailable']);
const IDS = ['calibre', 'previewer', 'plugin'];

const isText = (value) => typeof value === 'string' && value.trim() !== '';

// Rebuilt clean rather than passed through: the engine's object is trusted
// for its SHAPE, not kept by reference, so a stray extra key it happened to
// attach never rides along into what this file draws.
function fixFrom(fix) {
  if (fix === null) return null;
  if (typeof fix !== 'object' || Array.isArray(fix) || !KINDS.has(fix.kind)) return undefined;
  if (fix.kind === 'link') {
    return isText(fix.label) && isText(fix.url) ? { kind: fix.kind, label: fix.label, url: fix.url } : undefined;
  }
  if (fix.kind === 'install') {
    return isText(fix.label) ? { kind: fix.kind, label: fix.label } : undefined;
  }
  return isText(fix.why) ? { kind: fix.kind, why: fix.why } : undefined;
}

function stepFrom(step, id) {
  if (typeof step !== 'object' || step === null || step.id !== id) return null;
  if (!isText(step.name) || typeof step.installed !== 'boolean') return null;
  const fix = fixFrom(step.fix);
  if (fix === undefined) return null;
  // The engine's rule: a fix exactly when the step is not installed.
  if ((fix === null) !== step.installed) return null;
  return { id, name: step.name, installed: step.installed, fix };
}

/** The checklist, whole, or null. A broken contract draws NOTHING: this
 *  block is advice, and "the probe answered strangely" is not something a
 *  reader can act on. */
export function checklistFrom(value) {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  if (typeof value.ready !== 'boolean' || typeof value.possible !== 'boolean') return null;
  if (!isText(value.summary) || !Array.isArray(value.steps) || value.steps.length !== IDS.length) return null;
  const steps = IDS.map((id, i) => stepFrom(value.steps[i], id));
  if (steps.some((step) => step === null)) return null;
  return { ready: value.ready, possible: value.possible, summary: value.summary, steps };
}

/** `kfx-status --json`'s answer as a checklist, or null. */
export function setupFrom(answer) {
  return answer?.ok === true ? checklistFrom(answer) : null;
}

/** Kindle advice is for Kindles. Shown with nothing connected (the reader
 *  is deciding) or with a Kindle connected; hidden when only other readers
 *  are. An unknown list (the first poll has not answered) is not relevant
 *  YET, so the block does not flash up and vanish a moment later. */
export function kindleRelevant(devices) {
  if (!Array.isArray(devices)) return false;
  return devices.length === 0 || devices.some((device) => device?.kind === 'kindle');
}

/** Whether the block is drawn at all. A ready machine sees nothing, except
 *  right after an install, when the success line needs somewhere to stand. */
export function showSetup(setup, devices, justInstalled) {
  if (setup === null || setup === undefined || !setup.possible) return false;
  if (!kindleRelevant(devices)) return false;
  return !setup.ready || justInstalled === true;
}

/** What stands to the right of one step. `busy` is true while a send or an
 *  install is running: the plugin must not be swapped under a running KFX
 *  conversion. Opening a web page is harmless at any time. */
export function controlFor(step, busy) {
  const fix = step.fix;
  if (fix === null) return { type: 'status', text: INSTALLED };
  if (fix.kind === 'link') return { type: 'link', label: fix.label, url: fix.url };
  if (fix.kind === 'install') return { type: 'install', label: fix.label, disabled: busy === true };
  return { type: 'status', text: fix.why };
}

/** What the status line says after a successful install. `ready` is the
 *  CHECKED checklist's own field, never the engine's raw `answer.setup.ready`
 *  taken on faith: afterInstall() passes the same value checklistFrom() just
 *  validated (or the previous checklist, when the fresh one did not pass),
 *  so this never claims "Kindles now get KFX." for a checklist the validator
 *  actually rejected. Removed forks are named: Screepub took out something
 *  the reader installed (usually the Swift app's copy), and that deserves
 *  saying. */
export function installedLine(version, removed, ready) {
  const parts = [`Installed the KFX plugin ${version}.`];
  if (ready === true) parts.push('Kindles now get KFX.');
  const names = Array.isArray(removed) ? removed.filter(isText) : [];
  if (names.length === 1) parts.push(`Removed an older copy: ${names[0]}.`);
  else if (names.length > 1) parts.push(`Removed older copies: ${names.join(', ')}.`);
  return parts.join(' ');
}

/** The engine's own sentence for a refusal, or a stand-in. */
export function failedLine(answer) {
  const said = answer?.error?.message;
  return isText(said) ? said.trim() : NO_REASON;
}

/** When the OS will not open a link, the reader can still get there by hand. */
export function linkFailedLine(url) {
  return `Could not open the page. It is at ${url}`;
}

/** Everything an install's answer changes, in one place: the checklist to
 *  draw, the line to say, whether it is an alarm, and whether the block
 *  stays up on a now-ready machine. A success whose checklist is broken keeps
 *  the old one rather than blanking the block under the success line. */
export function afterInstall(answer, previous) {
  if (answer?.ok === true && isText(answer.version)) {
    // Checked once, then reused for both the setup this returns and the
    // "Kindles now get KFX." sentence: the two must agree on the same
    // validated checklist, never on the engine's unchecked raw object.
    const setup = checklistFrom(answer.setup) ?? previous;
    return {
      setup,
      line: installedLine(answer.version, answer.removed, setup?.ready === true),
      bad: false,
      justInstalled: true,
    };
  }
  return { setup: previous, line: failedLine(answer), bad: true, justInstalled: false };
}
