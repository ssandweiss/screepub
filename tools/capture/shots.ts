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

/** The margin pass two draws around a window picture, in CSS pixels: room
 *  for the frame's shadow, deeper below than above. tools/capture/frame.html
 *  says the same numbers in its `.pad` rule, and a test holds the two
 *  together, because a mismatch clips the shadow or leaves a strip of
 *  nothing along one edge. */
export const FRAME_PAD = { top: 44, right: 56, bottom: 68, left: 56 } as const;

/** The page size pass two is captured at: the window plus the frame. */
export function framedSize(shot: Shot): { width: number; height: number } {
  return {
    width: shot.width + FRAME_PAD.left + FRAME_PAD.right,
    height: shot.height + FRAME_PAD.top + FRAME_PAD.bottom,
  };
}

export function outputsFor(shot: Shot, theme: Theme): string[] {
  const file = `${shot.name}-${theme}.png`;
  const out = [`assets/screens/${file}`];
  if (shot.site && theme === 'light') out.push(`site/img/${file}`);
  return out;
}

/** Same pixels in, same bytes out, so a release where the window did not
 *  change commits no new images and the repository does not grow. */
export function writeIfChanged(path: string, bytes: Uint8Array): 'written' | 'unchanged' {
  if (existsSync(path) && readFileSync(path).equals(bytes)) return 'unchanged';
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, bytes);
  return 'written';
}
