// Mount a macOS .dmg and find the one app on it. macOS only; nothing else
// has hdiutil.
//
// Shared by smoke-bundle.ts (which runs the engine inside the app) and
// verify-signing.ts (which asks codesign about the app). The two used to
// carry a copy each, and a rule about what counts as "the app" on an image
// is exactly the kind that drifts when written twice.

import { mkdirSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import type { Runner } from './smoke-cli';

/** Mount `dmgPath` under `workDir` and return the one .app on it. `tool`
 *  opens every error, so a failure names the tool that hit it. Returns a
 *  `detach` the caller must run in a finally: an attached image on a runner
 *  outlives the job and the next one inherits a busy mount point. */
export function mountDmgApp(
  dmgPath: string,
  workDir: string,
  run: Runner,
  tool: string,
): { appPath: string; detach: () => void } {
  const mount = join(workDir, 'mnt');
  mkdirSync(mount, { recursive: true });
  // -readonly so verifying an artifact cannot modify it; -nobrowse so no
  // volume appears on a desktop the next job inherits.
  const attach = run([
    'hdiutil',
    'attach',
    dmgPath,
    '-readonly',
    '-nobrowse',
    '-mountpoint',
    mount,
  ]);
  if (attach.exitCode !== 0) {
    throw new Error(
      `${tool}: hdiutil attach failed on ${dmgPath}: ${attach.stderr.trim().slice(0, 500)}`,
    );
  }
  const detach = (): void => {
    run(['hdiutil', 'detach', mount, '-force']);
  };
  try {
    // Found by suffix, not by name: the transition overlay ships "Screepub
    // Desktop.app" and the handover renames it to "Screepub.app".
    // Sorted so a two-.app error names them in a stable order.
    const apps = readdirSync(mount)
      .filter((n) => n.endsWith('.app'))
      .sort();
    if (apps.length !== 1) {
      throw new Error(
        `${tool}: expected exactly one .app on the mounted image, found ` +
          `${apps.length}${apps.length ? ` (${apps.join(', ')})` : ''}`,
      );
    }
    return { appPath: join(mount, apps[0]!), detach };
  } catch (err) {
    detach();
    throw err;
  }
}
