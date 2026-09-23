// Which engine calls the capture tool may make on the window's behalf.
//
// The gate allows only calls whose WHOLE SHAPE the window's own argv
// builders (desktop/ui/app.js) reproduce exactly — not calls that merely
// start with a recognised verb, or merely put -o somewhere inside the
// library. That is the difference between a real boundary and a checklist:
// an unknown flag, a repeated flag, a `--flag=value` form the window never
// writes, a missing constant flag like --library, or a relative path all
// fail closed, because none of them is a shape any argv.* builder can
// produce. A constant flag a builder adds tomorrow is allowed automatically,
// since the gate rebuilds the call with that same builder and compares; a
// new VARIABLE part (a flag that takes a path, say) is refused until the
// gate is taught to recognise it, because nothing here can guess whether an
// unfamiliar value is safe.
//
// Pure. tests/capture.test.ts builds its allowed cases, and most of its
// refused ones, by taking a call straight from the window's own argv
// builders and, for a refusal, adding the one bad flag or path the label
// names; the rest of the refused cases are calls no argv builder makes at
// all (a missing constant flag, an unknown verb). Either way the gate is
// checked against the real contract, not a copy of it.

import { isAbsolute, resolve, sep } from 'node:path';
// @ts-expect-error -- plain JS module, no types
import { FORCE_FLAG, argv } from '../../desktop/ui/app.js';

export interface GateContext {
  /** The one file the capture may convert. */
  demoPdf: string;
  /** The scratch library the engine writes into for the capture. */
  library: string;
}

export type GateAnswer = { allow: true } | { allow: false; reason: string };

const ALLOW: GateAnswer = { allow: true };

function inside(path: string | null | undefined, dir: string): boolean {
  if (!path || !isAbsolute(path)) return false;
  return resolve(path).startsWith(resolve(dir) + sep);
}

const valueAfter = (args: readonly string[], flag: string): string | null => {
  const i = args.indexOf(flag);
  return i === -1 ? null : (args[i + 1] ?? null);
};

const same = (a: readonly string[], b: readonly string[]) =>
  a.length === b.length && a.every((x, i) => x === b[i]);

export function gateEngineCall(args: readonly string[], ctx: GateContext): GateAnswer {
  const [first] = args;
  if (first === undefined) return { allow: false, reason: 'an empty engine call' };
  const opts = valueAfter(args, '--options-json');

  if (same(args, argv.version())) return ALLOW;

  if (
    first === 'settings' &&
    inside(args[1], ctx.library) &&
    same(args, argv.settings(args[1], valueAfter(args, '--set')))
  )
    return ALLOW;

  if (
    isAbsolute(first) &&
    resolve(first) === resolve(ctx.demoPdf) &&
    same(args, argv.convert(first, { force: args.includes(FORCE_FLAG), optionsJson: opts }))
  )
    return ALLOW;

  const out = valueAfter(args, '-o');
  if (
    inside(first, ctx.library) &&
    inside(out, ctx.library) &&
    opts !== null &&
    same(args, argv.reconvert(first, out, opts))
  )
    return ALLOW;

  return { allow: false, reason: `${args.join(' ')}: not a call the window makes on the way to a picture` };
}
