// Verb dispatch and the device command handlers. Handlers RETURN result
// objects and never print: cli.ts owns stdout, so these are testable in
// process. Dispatch lives here rather than in cli.ts because cli.ts runs
// main() on import and cannot be imported by a test.
import { existsSync } from 'node:fs';

export const VERBS = ['devices', 'send'] as const;
export type Verb = (typeof VERBS)[number];

export type Command = { kind: 'verb'; verb: Verb; args: string[] } | { kind: 'convert' };

/** Decide whether argv opens with a subcommand.
 *
 * The rule, and the whole compatibility surface of this piece: the FIRST
 * argument is a verb only when it matches a known verb exactly AND no file of
 * that name exists. `screepub devices` lists; `screepub ./devices` and
 * `screepub devices.pdf` convert; and a real file named `devices` wins,
 * because a user can always write `./devices` to get the file, while a stolen
 * filename would be unconvertible with no way out.
 *
 * Only argv[0] is considered. A verb after a flag would be indistinguishable
 * from a flag's value (`--title send`). */
export function resolveCommand(
  argv: string[],
  exists: (path: string) => boolean = existsSync,
): Command {
  const first = argv[0];
  if (first === undefined) return { kind: 'convert' };
  if (!(VERBS as readonly string[]).includes(first)) return { kind: 'convert' };
  if (exists(first)) return { kind: 'convert' };
  return { kind: 'verb', verb: first as Verb, args: argv.slice(1) };
}
