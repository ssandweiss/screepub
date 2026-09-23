// bun tools/capture-screens.ts [--only <shot>]
//
// Takes every README and site picture from the real window running the
// real engine on tests/fixtures/field-station.pdf. Spec:
// docs/superpowers/specs/2026-09-22-readme-site-screens-design.md, part 3.
//
// Writes assets/screens/<shot>-<theme>.png, and copies the light drop and
// result into site/img/. A file is rewritten only when its bytes change.
// Prints one line per file: written or unchanged.
//
// Needs Chrome at the path in tools/capture/cdp.ts, and macOS: the demo
// library is /Users/Shared/Documents/Screepub, because the result screen
// prints the book's full path and that folder reads naturally with no
// username in it. The tool refuses to run if that folder already exists,
// and removes it when done.

import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, rmdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { REPO_DIR } from './build-cli';
import { CHROME, launch } from './capture/cdp';
import { gateEngineCall } from './capture/gate';
import { captureIndex } from './capture/page';
import { SHOTS, outputsFor, writeIfChanged } from './capture/shots';

const LIBRARY = '/Users/Shared/Documents/Screepub';
const DEMO_PDF = join(REPO_DIR, 'tests', 'fixtures', 'field-station.pdf');

const TYPES: Record<string, string> = {
  '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json',
  '.png': 'image/png', '.svg': 'image/svg+xml', '.woff2': 'font/woff2',
};
const typeOf = (p: string) => TYPES[p.slice(p.lastIndexOf('.'))] ?? 'application/octet-stream';

export async function main() {
  const { values } = parseArgs({ args: Bun.argv.slice(2), options: { only: { type: 'string' } } });
  const token = crypto.randomUUID();
  const shots = values.only ? SHOTS.filter((s) => s.name === values.only) : SHOTS;
  if (shots.length === 0) throw new Error(`capture: no shot named ${values.only}`);
  if (!existsSync(CHROME)) {
    console.error(`capture: no Chrome at ${CHROME}. Pictures NOT retaken.`);
    process.exit(2);
  }
  if (existsSync(LIBRARY)) {
    throw new Error(`capture: ${LIBRARY} already exists. It is not the tool's to touch; move it and rerun.`);
  }

  const passOne = mkdtempSync(join(tmpdir(), 'screepub-capture-'));
  mkdirSync(LIBRARY, { recursive: true });
  const refused: string[] = [];

  const server = Bun.serve({
    // Loopback only. Bun's default is every interface, which would put the
    // whole repository (and the engine, behind its token) on the network
    // for as long as the run lasts.
    hostname: '127.0.0.1',
    port: 0,
    async fetch(req) {
      const url = new URL(req.url);
      if (url.pathname === '/engine' && req.method === 'POST') {
        if (req.headers.get('x-capture-token') !== token) {
          return new Response('capture: missing or wrong token', { status: 403 });
        }
        const { args } = (await req.json()) as { args: string[] };
        const gate = gateEngineCall(args, { demoPdf: DEMO_PDF, library: LIBRARY });
        if (!gate.allow) {
          refused.push(gate.reason);
          return new Response(gate.reason, { status: 403 });
        }
        const proc = Bun.spawn(['bun', join(REPO_DIR, 'src', 'cli.ts'), ...args], {
          stdout: 'pipe', stderr: 'pipe', env: { ...process.env, SCREEPUB_LIBRARY: LIBRARY },
        });
        const out = await new Response(proc.stdout).text();
        await proc.exited;
        return new Response(out);
      }
      if (url.pathname === '/capture/window.html') {
        const shot = url.searchParams.get('shot') ?? '';
        if (!SHOTS.some((s) => s.kind === 'window' && s.name === shot)) {
          return new Response(`capture: no window shot named ${shot}`, { status: 400 });
        }
        const html = readFileSync(join(REPO_DIR, 'desktop', 'ui', 'index.html'), 'utf8');
        return new Response(captureIndex(html, { shot, demoPdf: DEMO_PDF, token }), {
          headers: { 'content-type': 'text/html; charset=utf-8' },
        });
      }
      if (url.pathname.startsWith('/pass-one/')) {
        const file = join(passOne, url.pathname.slice('/pass-one/'.length));
        return existsSync(file) ? new Response(Bun.file(file), { headers: { 'content-type': 'image/png' } }) : new Response('', { status: 404 });
      }
      const file = join(REPO_DIR, decodeURIComponent(url.pathname));
      if (!file.startsWith(REPO_DIR) || !existsSync(file)) return new Response('', { status: 404 });
      return new Response(Bun.file(file), { headers: { 'content-type': typeOf(file) } });
    },
  });
  const base = `http://127.0.0.1:${server.port}`;
  const browser = await launch();

  try {
    for (const shot of shots) {
      for (const theme of shot.themes) {
        let png: Uint8Array;
        if (shot.kind === 'site') {
          png = await browser.capture({ url: `${base}/tools/capture/hero.html`, width: shot.width, height: shot.height, theme, transparent: false });
        } else {
          const one = await browser.capture({ url: `${base}/capture/window.html?shot=${shot.name}`, width: shot.width, height: shot.height, theme, transparent: false });
          const name = `${shot.name}-${theme}.png`;
          writeFileSync(join(passOne, name), one);
          // Pass two: the frame. Its padding is 44 + 68 vertically and 56 + 56 across.
          png = await browser.capture({
            url: `${base}/tools/capture/frame.html?img=/pass-one/${name}&w=${shot.width}&h=${shot.height}`,
            width: shot.width + 112, height: shot.height + 112, theme, transparent: true,
          });
        }
        for (const out of outputsFor(shot, theme)) {
          console.log(`${writeIfChanged(join(REPO_DIR, out), png)}  ${out}`);
        }
      }
    }
    if (refused.length) throw new Error(`capture: the window made engine calls the gate refused:\n  ${refused.join('\n  ')}`);
  } finally {
    await browser.close();
    server.stop(true);
    rmSync(passOne, { recursive: true, force: true });
    rmSync(LIBRARY, { recursive: true, force: true });
    // Remove the Documents folder too, but only if the tool's run left it
    // empty. rmdirSync, not rmSync: rmSync without `recursive` refuses every
    // directory, empty or not (measured), so it would never remove this one;
    // rmdirSync removes an empty one and refuses anything with a file in it.
    try { rmdirSync('/Users/Shared/Documents'); } catch { /* not empty, or not ours */ }
  }
}

if (import.meta.main) {
  main().catch((err) => {
    console.error((err as Error).message);
    process.exit(1);
  });
}
