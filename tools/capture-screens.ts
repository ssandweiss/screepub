// bun tools/capture-screens.ts [--only <shot>]
//
// Takes every README and site picture from the real window running the
// real engine on tests/fixtures/field-station.pdf. Spec:
// docs/superpowers/specs/2026-09-22-readme-site-screens-design.md, part 3.
//
// Writes assets/screens/<shot>-<theme>.png, and copies the light drop and
// result into site/img/. A file is rewritten only when its bytes change.
// Prints Chrome's version, then one line per file: written or unchanged.
// Nothing is written unless every picture was taken.
//
// Needs Chrome at the path in tools/capture/cdp.ts, and macOS: the demo
// library is /Users/Shared/Documents/Screepub, because the result screen
// prints the book's full path and that folder reads naturally with no
// username in it. The tool marks the library as its own, refuses to run if
// an unmarked one is already there, and removes it when done, along with
// any folder above it that it had to create. tools/capture/run.ts has the
// details.
//
// Exit codes: 0 done. 1 failed: if a picture could not be taken, or an
// engine call was refused or failed, or the page server hit an error,
// nothing was written; if only the cleanup afterwards failed, the pictures
// WERE written and the message says what could not be cleaned up. 2 no
// Chrome, so nothing was retaken (a release warns about that rather than
// stopping). 130 or 143 interrupted, after cleaning up; nothing written.

import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { REPO_DIR } from './build-cli';
import { CHROME, launch } from './capture/cdp';
import { CaptureError, cleanupErrorsOf, runCapture } from './capture/run';
import { SHOTS } from './capture/shots';

const LIBRARY = '/Users/Shared/Documents/Screepub';
const DEMO_PDF = join(REPO_DIR, 'tests', 'fixtures', 'field-station.pdf');

/** No Chrome, so no pictures: exit code 2, not a failure. */
export class CaptureSkipped extends Error {}

export async function main(opts: {
  argv?: string[];
  onCleanup?: (cleanup: () => Promise<string[]>) => void;
} = {}): Promise<void> {
  const { values } = parseArgs({
    args: opts.argv ?? Bun.argv.slice(2),
    options: { only: { type: 'string' } },
  });
  const shots = values.only === undefined ? SHOTS : SHOTS.filter((s) => s.name === values.only);
  if (shots.length === 0) throw new CaptureError(`capture: no shot named ${values.only}`);
  if (!existsSync(CHROME)) throw new CaptureSkipped(`capture: no Chrome at ${CHROME}. Pictures NOT retaken.`);
  await runCapture({
    shots,
    repoDir: REPO_DIR,
    demoPdf: DEMO_PDF,
    library: LIBRARY,
    launch: () => launch(CHROME),
    // This Bun, not whichever one is first on PATH.
    engine: [process.execPath, join(REPO_DIR, 'src', 'cli.ts')],
    outDir: REPO_DIR,
    log: (line) => console.log(line),
    onCleanup: opts.onCleanup,
  });
}

if (import.meta.main) {
  let cleanup: (() => Promise<string[]>) | null = null;
  let interrupted = false;
  const onSignal = (signal: NodeJS.Signals) => {
    const code = signal === 'SIGINT' ? 130 : 143;
    // A second signal means "now": skip the cleanup already under way.
    if (interrupted) process.exit(code);
    interrupted = true;
    console.error(`capture: ${signal}, cleaning up`);
    void (cleanup ?? (async () => []))().then((errors) => {
      for (const e of errors) console.error(e);
      process.exit(code);
    });
  };
  process.on('SIGINT', onSignal);
  process.on('SIGTERM', onSignal);

  main({ onCleanup: (c) => { cleanup = c; } }).catch((err: unknown) => {
    // The signal handler owns the exit once a signal has arrived.
    if (interrupted) return;
    if (err instanceof CaptureSkipped) {
      console.error(err.message);
      process.exit(2);
    }
    console.error(err instanceof CaptureError ? err.message
      : err instanceof Error ? (err.stack ?? err.message) : String(err));
    for (const e of cleanupErrorsOf(err)) console.error(e);
    process.exit(1);
  });
}
