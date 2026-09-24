// The `reveal` verb: show an existing file in the system's file manager.
// The owner decided on 2026-09-23 that the ENGINE reveals now, not the
// window. The window's old "Show in Finder" permission was fixed to
// ~/Documents/Screepub, and now that the library folder can move (piece C's
// app-settings), that permission can no longer follow it. Like the other
// verb handlers, this RETURNS a result and never prints: cli.ts owns
// stdout.
import { statSync } from 'node:fs';
import { isAbsolute } from 'node:path';
import { CliError } from './cli-errors';
import { revealFile, spawnOpener, type Opener } from './reveal';

export interface RevealDeps {
  platform?: NodeJS.Platform;
  open?: Opener;
}

export interface RevealResult {
  revealed: string;
}

/** Show `path`. Both checks below run BEFORE anything opens: a relative
 *  path, or an absolute one that does not exist, must never spawn the file
 *  manager at all. */
export async function revealCommand(path: string, deps: RevealDeps = {}): Promise<RevealResult> {
  if (!isAbsolute(path)) {
    throw new CliError('usage', `reveal needs a full path, not "${path}"`);
  }

  let isFile = false;
  try {
    isFile = statSync(path).isFile();
  } catch {
    isFile = false;
  }
  if (!isFile) {
    throw new CliError('unreadable', `cannot read the file to reveal: ${path}`);
  }

  await revealFile(path, deps.platform ?? process.platform, deps.open ?? spawnOpener);
  return { revealed: path };
}
