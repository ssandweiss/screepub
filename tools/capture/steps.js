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

// The version stamp changes every release. Left in, every picture would
// change every release and the repository would grow by megabytes each
// time. Hidden, a picture changes only when the window's look does.
function hideStamp() {
  const style = document.createElement('style');
  style.textContent = '.rev-stamp { visibility: hidden !important; }';
  document.head.append(style);
}

async function dropped() {
  await until(() => q('#surface-convert[data-state="idle"]'), 'the drop well');
  // Exactly the event Tauri fires when a file lands on the window.
  fire('tauri://drag-drop', { paths: [cfg.demoPdf], position: { x: 400, y: 300 } });
  await until(() => q('#surface-convert[data-state="done"]'), 'the finished book');
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
  },
};

try {
  const run = SHOTS[cfg.shot];
  if (!run) throw new Error(`no capture steps for shot "${cfg.shot}"`);
  hideStamp();
  await run();
  await document.fonts.ready;
  await frames();
  await new Promise((r) => setTimeout(r, 250));
  if (window.__captureState !== 'failed') window.__captureState = 'ready';
} catch (error) {
  fail(error?.message ?? error);
}
