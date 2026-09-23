// The window's own desktop/ui/index.html, with the capture scripts inserted.
//
// Served, never copied: a copy would be a second definition of the window's
// page, and the day the window added a stylesheet the pictures would quietly
// stop matching the app. So the server reads the real file on every request
// and inserts three things:
//
//   <base href="/desktop/ui/">       relative URLs resolve as in the app
//   window.__CAPTURE__ = {...}        which shot, and where the demo PDF is
//   bridge.js BEFORE main.js          window.__TAURI__ exists when main.js
//                                     makes its first engine call at boot
//   steps.js AFTER main.js            drives the window into the shot
//
// Module scripts run in document order, which is the whole mechanism.

export interface CaptureConfig {
  shot: string;
  demoPdf: string;
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
  const head =
    '<head>\n    <base href="/desktop/ui/">\n' +
    `    <script>window.__CAPTURE__ = ${JSON.stringify(cfg)};</script>`;
  const scripts =
    '<script type="module" src="/tools/capture/bridge.js"></script>\n    ' +
    MAIN +
    '\n    <script type="module" src="/tools/capture/steps.js"></script>';
  return html.replace('<head>', head).replace(MAIN, scripts);
}
