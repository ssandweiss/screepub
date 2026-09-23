// What the capture server answers, and what it refuses.
//
// It serves three folders and three routes, and nothing else:
//
//   desktop/ui/  site/  tools/capture/     the pages Chrome draws
//   /capture/window.html?shot=<window shot> the window's own page, with the
//                                           capture scripts inserted
//   /pass-one/<shot>-<theme>.png            this run's first-pass pictures
//   /engine                                 the window's engine calls, run
//                                           through the gate
//
// An allow-list and not "the repository minus some things", because the
// main checkout holds /fixtures/ (real, gitignored screenplays) and .git,
// and a server that serves the repository serves those too. Every request
// must also name this server's own host exactly, so a web page that got a
// name of its own pointed at 127.0.0.1 still cannot read from it, and
// /engine needs the run's token on top of that.
//
// Pure apart from reading files: the engine is passed in, so a test can
// fake it and drive this with `new Request(...)`.

import { readFileSync, statSync } from 'node:fs';
import { join, normalize } from 'node:path';
import { gateEngineCall } from './gate';
import { captureIndex } from './page';
import { SHOTS } from './shots';

export interface EngineResult {
  /** Null when the engine was killed by a signal. */
  code: number | null;
  stdout: string;
  stderr: string;
}

export interface HandlerOptions {
  repoDir: string;
  /** Where this run keeps its first-pass pictures. */
  passOne: string;
  /** The per-run secret /engine requires. */
  token: string;
  library: string;
  demoPdf: string;
  /** The Host header every request must carry: `127.0.0.1:<port>`. */
  host: string;
  runEngine: (args: string[]) => Promise<EngineResult>;
  /** Each refused engine call, as the gate's sentence. */
  refused: string[];
  /** Each engine run that exited non-zero or printed nothing. */
  failed: string[];
}

/** The only folders served, relative to the repository. */
export const SERVED = ['desktop/ui/', 'site/', 'tools/capture/'];

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
};
const typeOf = (p: string) => TYPES[p.slice(p.lastIndexOf('.'))] ?? 'application/octet-stream';

const PASS_ONE_NAME = /^[a-z]+-(light|dark)\.png$/;

const say = (body: string, status: number) =>
  new Response(body, { status, headers: { 'content-type': 'text/plain; charset=utf-8' } });

function isFile(path: string): boolean {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
}

export function makeHandler(o: HandlerOptions): (req: Request) => Promise<Response> {
  async function engine(req: Request): Promise<Response> {
    if (req.method !== 'POST') return say('capture: /engine takes POST', 405);
    if (req.headers.get('x-capture-token') !== o.token) {
      return say('capture: missing or wrong token', 403);
    }
    let args: unknown;
    try {
      args = ((await req.json()) as { args?: unknown }).args;
    } catch {
      return say('capture: the engine call was not JSON', 400);
    }
    if (!Array.isArray(args) || !args.every((a) => typeof a === 'string')) {
      return say('capture: an engine call is a list of strings', 400);
    }
    const gate = gateEngineCall(args, { demoPdf: o.demoPdf, library: o.library });
    if (!gate.allow) {
      o.refused.push(gate.reason);
      return say(gate.reason, 403);
    }
    const run = await o.runEngine(args);
    const said = run.stderr.trim();
    if (run.code !== 0) o.failed.push(`${args.join(' ')}: exited with ${run.code}: ${said}`);
    // Exactly what desktop/src-tauri/src/sidecar.rs does: stdout is the
    // contract and the exit code is not, because an engine error exits 1 AND
    // prints a perfectly good error object, which the window then draws. Only
    // an engine that printed nothing is an error, carrying what it said on
    // the way down. (A non-zero exit still fails the run: see `failed`.)
    const answer = run.stdout.trim();
    if (answer === '') {
      return say(`the Screepub engine exited with ${run.code} and printed nothing: ${said}`, 500);
    }
    return say(answer, 200);
  }

  return async (req) => {
    if (req.headers.get('host') !== o.host) return say('capture: wrong host', 403);
    const url = new URL(req.url);

    if (url.pathname === '/engine') return engine(req);

    if (url.pathname === '/capture/window.html') {
      const shot = url.searchParams.get('shot') ?? '';
      if (!SHOTS.some((s) => s.kind === 'window' && s.name === shot)) {
        return say(`capture: no window shot named ${shot}`, 400);
      }
      const html = readFileSync(join(o.repoDir, 'desktop', 'ui', 'index.html'), 'utf8');
      return new Response(captureIndex(html, { shot, demoPdf: o.demoPdf, token: o.token }), {
        headers: { 'content-type': 'text/html; charset=utf-8' },
      });
    }

    if (url.pathname.startsWith('/pass-one/')) {
      // A bare name this run could have written, never a path.
      const name = url.pathname.slice('/pass-one/'.length);
      const file = join(o.passOne, name);
      if (!PASS_ONE_NAME.test(name) || !isFile(file)) return say('', 404);
      return new Response(Bun.file(file), { headers: { 'content-type': 'image/png' } });
    }

    // Decoded, THEN normalised, THEN checked: an encoded `..` (%2e%2e, or a
    // slash spelled %2f) is only a `..` after decoding, and only resolved
    // after normalising, so checking any earlier checks the wrong string.
    let rel: string;
    try {
      rel = normalize(decodeURIComponent(url.pathname)).slice(1);
    } catch {
      return say('capture: a malformed path', 400);
    }
    if (!SERVED.some((p) => rel.startsWith(p))) return say('', 404);
    const file = join(o.repoDir, rel);
    if (!isFile(file)) return say('', 404);
    return new Response(Bun.file(file), { headers: { 'content-type': typeOf(file) } });
  };
}
