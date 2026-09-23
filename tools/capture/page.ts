// The window's own desktop/ui/index.html, with the capture scripts inserted.
//
// Served, never copied: a copy would be a second definition of the window's
// page, and the day the window added a stylesheet the pictures would quietly
// stop matching the app. So the server reads the real file on every request
// and inserts four things:
//
//   <base href="/desktop/ui/">       relative URLs resolve as in the app
//   window.__CAPTURE__ = {...}        which shot, where the demo PDF is, and
//                                     the run's token for /engine
//   bridge.js BEFORE main.js          window.__TAURI__ exists when main.js
//                                     makes its first engine call at boot
//   steps.js AFTER main.js            drives the window into the shot
//
// Module scripts run in document order, which is the whole mechanism.

export interface CaptureConfig {
  shot: string;
  demoPdf: string;
  /** The per-run secret the capture server's /engine requires. */
  token: string;
}

const MAIN = '<script type="module" src="main.js"></script>';

export function captureIndex(html: string, cfg: CaptureConfig): string {
  const count = html.split(MAIN).length - 1;
  if (count !== 1) {
    throw new Error(
      `capture: desktop/ui/index.html must load main.js exactly once as ${MAIN}; ` +
        `found ${count}. The window changed shape; update tools/capture/page.ts.`,
    );
  }
  if (!html.includes('<head>')) throw new Error('capture: desktop/ui/index.html has no <head>');
  // Escaped so a `<` in a value cannot close the <script> early (the HTML
  // parser looks for the literal text `</script`, however it got there —
  // quoting inside the JS string does not stop it), and inserted with a
  // replacer FUNCTION below so a literal `$` in a value (a `$&`, say) is
  // never read as a String.replace substitution pattern.
  const config = JSON.stringify(cfg).replace(/</g, '\\u003c');
  const head =
    '<head>\n    <base href="/desktop/ui/">\n' +
    `    <script>window.__CAPTURE__ = ${config};</script>`;
  const scripts =
    '<script type="module" src="/tools/capture/bridge.js"></script>\n    ' +
    MAIN +
    '\n    <script type="module" src="/tools/capture/steps.js"></script>';
  return html.replace('<head>', () => head).replace(MAIN, () => scripts);
}
