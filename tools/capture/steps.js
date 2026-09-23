// Drives the window into one shot's state, the way a person would, then
// reports window.__captureState = 'ready' or 'failed'. The capture tool
// waits on that before it takes the picture, so a failed state is never
// photographed.

import { fail, fire } from '/tools/capture/bridge.js';

const cfg = window.__CAPTURE__;
const q = (selector) => document.querySelector(selector);

async function until(test, what, ms = 30000) {
  const start = performance.now();
  while (!test()) {
    if (window.__captureState === 'failed') throw new Error(window.__captureError);
    if (performance.now() - start > ms) throw new Error(`timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 50));
  }
}

const frames = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));

// Anything still moving (the tabs arrive for about 400 ms after a book is
// done) would be caught at whatever frame the clock allowed, and the picture
// would differ run to run. So every animation is waited out. An endless one
// never finishes and is left out rather than hung on; the window has none.
async function settled(doc) {
  const finite = doc.getAnimations()
    .filter((a) => a.effect?.getComputedTiming().endTime !== Infinity);
  await Promise.all(finite.map((a) => a.finished.catch(() => {})));
}

// The version stamp changes every release. Left in, every picture would
// change every release and the repository would grow by megabytes each
// time. Hidden, a picture changes only when the window's look does. A
// stamp that has been renamed would stay visible and do exactly that, so
// its absence fails the capture instead.
function hideStamp() {
  if (!q('.rev-stamp')) {
    throw new Error('the window has no .rev-stamp any more, so the version stamp would ' +
      'be in every picture; update hideStamp in tools/capture/steps.js');
  }
  const style = document.createElement('style');
  style.textContent = '.rev-stamp { visibility: hidden !important; }';
  document.head.append(style);
}

async function dropped() {
  await until(() => q('#surface-convert[data-state="idle"]'), 'the drop well');
  // Exactly the event Tauri fires when a file lands on the window.
  fire('tauri://drag-drop', { paths: [cfg.demoPdf], position: { x: 400, y: 300 } });
  await until(() => {
    const pane = q('#surface-convert');
    // A refusal is final: say what the window said, now, rather than wait
    // out the timeout for a book that is not coming.
    if (pane?.dataset.state === 'failed') {
      const said = (selector) => pane.querySelector(selector)?.textContent?.trim() ?? '';
      throw new Error(`the window refused the demo script: ${said('.fault')}: ` +
        `${said('.fault-body')} (${pane.dataset.errorCode ?? 'no code'})`);
    }
    return pane?.dataset.state === 'done';
  }, 'the finished book');
}

const SHOTS = {
  async drop() {
    await until(() => q('#surface-convert[data-state="idle"]'), 'the drop well');
  },
  async result() {
    await dropped();
  },
  async read() {
    await dropped();
    q('#tab-read').click();
    await until(() => document.querySelectorAll('#surface-read .scene-rail button').length > 0,
      'the scene index');
    const frame = q('#surface-read .script-frame');
    await until(() => frame?.contentDocument?.querySelector('section.scene'), 'the script');
    // The script is its own document, with its own faces and its own clock.
    await frame.contentDocument.fonts.ready;
    await settled(frame.contentDocument);
  },
};

try {
  const run = SHOTS[cfg.shot];
  if (!run) throw new Error(`no capture steps for shot "${cfg.shot}"`);
  hideStamp();
  await run();
  await document.fonts.ready;
  await settled(document);
  await frames();
  await new Promise((r) => setTimeout(r, 250));
  if (window.__captureState !== 'failed') window.__captureState = 'ready';
} catch (error) {
  fail(error?.message ?? error);
}
