// Every picture the capture tool takes, and where each one goes.
//
// The README gets all of them (spec 2026-09-22, decision 7): the hero, the
// drop-and-result pair and reading, window pictures in light AND dark so
// GitHub shows the one matching the reader's theme. The site gets the light
// drop and result for its "Drag and drop" section; it has no dark mode.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

export type Theme = 'light' | 'dark';

export interface Shot {
  name: 'hero' | 'drop' | 'result' | 'read';
  /** window: the app, framed. site: a web page, captured as it is. */
  kind: 'window' | 'site';
  width: number;
  height: number;
  themes: Theme[];
  /** Copied into site/img/ as well, light only. */
  site: boolean;
}

export const SHOTS: Shot[] = [
  { name: 'hero', kind: 'site', width: 1200, height: 760, themes: ['light'], site: false },
  { name: 'drop', kind: 'window', width: 860, height: 620, themes: ['light', 'dark'], site: true },
  { name: 'result', kind: 'window', width: 860, height: 620, themes: ['light', 'dark'], site: true },
  { name: 'read', kind: 'window', width: 860, height: 620, themes: ['light', 'dark'], site: false },
];

export function outputsFor(shot: Shot, theme: Theme): string[] {
  const file = `${shot.name}-${theme}.png`;
  const out = [`assets/screens/${file}`];
  if (shot.site && theme === 'light') out.push(`site/img/${file}`);
  return out;
}

/** Same pixels in, same bytes out, so a release where the window did not
 *  change commits no new images and the repository does not grow. */
export function writeIfChanged(path: string, bytes: Uint8Array): 'written' | 'unchanged' {
  if (existsSync(path)) {
    const old = readFileSync(path);
    if (old.length === bytes.length && old.equals(Buffer.from(bytes))) return 'unchanged';
  }
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, bytes);
  return 'written';
}
