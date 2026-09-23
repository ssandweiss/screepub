// Which engine calls the capture tool may make on the window's behalf.
//
// The capture server answers each engine call the window makes by running
// the REAL CLI with exactly those arguments, so every answer in a picture
// is real by construction. What it must never do is let a picture reach
// anything real besides the demo: a connected Kindle, a send, an export,
// or a file that is not the invented script. So every call passes this
// gate first, and a refusal fails the whole capture, naming the call.
//
// Pure. tests/capture.test.ts builds its cases with the window's own argv
// builders from desktop/ui/app.js, so the gate recognises the window's
// calls rather than a copy of them.

import { resolve, sep } from 'node:path';

export interface GateContext {
  /** The one file the capture may convert. */
  demoPdf: string;
  /** The scratch library the engine writes into for the capture. */
  library: string;
}

export type GateAnswer = { allow: true } | { allow: false; reason: string };

/** Verbs that reach hardware or write a file somewhere a person chose. */
const REFUSED_VERBS = new Set(['devices', 'send', 'export', 'update-decision', 'update-should-check']);

const refuse = (reason: string): GateAnswer => ({ allow: false, reason });

function inside(path: string | undefined, dir: string): boolean {
  if (!path) return false;
  const p = resolve(path);
  const d = resolve(dir);
  return p.startsWith(d + sep);
}

export function gateEngineCall(args: readonly string[], ctx: GateContext): GateAnswer {
  if (args.length === 0) return refuse('an empty engine call');
  const [first] = args as [string, ...string[]];

  if (first === '--version') return { allow: true };

  if (REFUSED_VERBS.has(first)) {
    return refuse(`${first}: it reaches a device or writes outside the demo library`);
  }

  // Wherever the call names an output with -o, that output must be inside
  // the library, whatever else the call is.
  const o = args.indexOf('-o');
  if (o !== -1 && !inside(args[o + 1], ctx.library)) {
    return refuse(`${first} -o ${args[o + 1] ?? '<nothing>'}: writes outside the demo library`);
  }

  if (first === 'settings') {
    return inside(args[1], ctx.library)
      ? { allow: true }
      : refuse(`settings ${args[1] ?? '<nothing>'}: not a script in the demo library`);
  }

  // Otherwise the first argument is an input file: the demo script itself,
  // or the cached .fountain the window re-renders from.
  if (resolve(first) === resolve(ctx.demoPdf)) return { allow: true };
  if (inside(first, ctx.library)) return { allow: true };
  return refuse(`a conversion of ${first}: it is not the demo script`);
}
