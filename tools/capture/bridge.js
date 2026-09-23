// A stand-in for window.__TAURI__, for the capture tool only.
//
// Exactly what desktop/ui/app.js uses and nothing more: core.invoke for
// run_engine and pick_file, and event.listen. opener and updater are absent
// on purpose, so the window draws itself as a build without the updater
// would, and no picture shows an update prompt.
//
// run_engine does not fake anything. It posts the window's own argument list
// to the capture server, which runs the real CLI through an allow-list gate
// (tools/capture/gate.ts) and returns its stdout, exactly as the Rust does.
// A refused call fails the capture, naming the call.

const cfg = window.__CAPTURE__;
const listeners = new Map();

window.__captureState = 'working';

export function fail(message) {
  if (window.__captureState === 'failed') return;
  window.__captureState = 'failed';
  window.__captureError = String(message);
}

export function fire(name, payload) {
  for (const handler of listeners.get(name) ?? []) handler({ payload });
}

window.__TAURI__ = {
  core: {
    async invoke(command, payload) {
      if (command === 'run_engine') {
        // The per-run token the server requires on /engine, so no other
        // page open in a browser on this machine can post engine calls to
        // the capture server's port while it runs.
        const response = await fetch('/engine', {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'x-capture-token': cfg.token },
          body: JSON.stringify({ args: payload.args }),
        });
        const text = await response.text();
        if (!response.ok) {
          fail(`engine call refused: ${text}`);
          throw text;
        }
        return text;
      }
      if (command === 'pick_file') return cfg.demoPdf;
      fail(`the window invoked "${command}", which the capture bridge does not provide`);
      throw `unknown command ${command}`;
    },
  },
  event: {
    async listen(name, handler) {
      if (!listeners.has(name)) listeners.set(name, []);
      listeners.get(name).push(handler);
      return () => {};
    },
  },
};
