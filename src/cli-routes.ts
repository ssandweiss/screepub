// The `routes` verb: every way a finished book can leave Screepub, best
// first, with the one to choose already chosen. The ORDER is
// src/export/routes.ts's and the probing is src/export/route-facts.ts's;
// this file chooses nothing, it only carries their answers out. Handlers
// RETURN values and never print: cli.ts owns stdout, the same split as
// cli-export.ts and cli-kfx.ts.
import { statSync } from 'node:fs';
import { CliError } from './cli-errors';
import { routeFacts } from './export/route-facts';
import { preselected, routes, type Route, type RouteFacts } from './export/routes';
import { appSettingsPath, readAppSettings } from './settings/app';

/** Injectable seams, defaulted to the real thing, so a test can hand in any
 *  machine's facts and keep the settings file inside its own scratch folder. */
export interface RoutesDeps {
  /** default: routeFacts() on this machine */
  facts?: () => Promise<RouteFacts>;
  /** default: appSettingsPath(), which SCREEPUB_CONFIG_DIR overrides */
  settingsPath?: string;
}

export interface RoutesAnswer {
  routes: Route[];
  /** The id (not the key) of the row to choose first: a connected device's
   *  id carries its volume, and the window matches rows by id. */
  chosen: string;
}

/** The book must be a file that is there, checked before anything is probed:
 *  a typo must not pay for the reMarkable probe's timeout to be reported.
 *  Same check and code as `export`. */
export function requireBook(epub: string): void {
  let isFile = false;
  try {
    isFile = statSync(epub).isFile();
  } catch {
    isFile = false;
  }
  if (!isFile) {
    throw new CliError('unreadable', `cannot read the book: ${epub}`);
  }
}

/** Read-only: reads the settings file, never writes it. The Send page polls
 *  this every couple of seconds, and a poll that wrote would race the one
 *  write that matters, `route` or `send` remembering a choice that worked.
 *
 *  The file is shared and hand-editable, so `lastRoute` may hold anything.
 *  preselected matches it against row keys with `===`, so a value that is
 *  not one of them (a number, a key from a newer build) falls back exactly
 *  as nothing remembered does. */
export async function routesCommand(epub: string, deps: RoutesDeps = {}): Promise<RoutesAnswer> {
  requireBook(epub);
  const list = routes(await (deps.facts ?? (() => routeFacts()))());
  const { lastRoute } = readAppSettings(deps.settingsPath ?? appSettingsPath());
  return { routes: list, chosen: preselected(list, lastRoute).id };
}

/** `routes` for a person: one line per row, `*` beside the chosen one, the
 *  key a person would type for `screepub route`, and a dimmed row's fix in
 *  place of its mechanism. */
export function routesLines(answer: RoutesAnswer): string[] {
  const width = Math.max(0, ...answer.routes.map((r) => r.key.length));
  return answer.routes.map((r) => {
    const mark = r.id === answer.chosen ? '*' : ' ';
    const detail = r.available ? r.detail : `(dimmed: ${r.detail})`;
    return `${mark} ${r.key.padEnd(width)}  ${r.title}: ${detail}`;
  });
}
