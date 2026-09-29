// bun tools/review-screens.ts --out <page.html> [--repo <dir>]
//
// After `bun tools/capture-screens.ts`: which pictures changed since the
// last commit, and a page showing each one old beside new. The /release
// skill runs it at its first moment and shows the page to the owner, who
// checks the pictures as he checks the notes. The pictures it names are the
// ones that join the release commit. tools/capture/review.ts has the logic.
//
// Prints "No picture changed." and writes nothing, or writes the page to
// --out and prints one line per picture: changed, new or removed, then
// every path that holds it. --out is required, so the tool never leaves a
// file in a folder nobody named. Exit codes: 0 done, 1 refused or failed.

import { writeFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { REPO_DIR } from './build-cli';
import { changedPictures, kindOf, reviewPage } from './capture/review';

if (import.meta.main) {
  try {
    const { values } = parseArgs({
      args: Bun.argv.slice(2),
      options: { out: { type: 'string' }, repo: { type: 'string' } },
    });
    if (values.out === undefined) throw new Error('usage: bun tools/review-screens.ts --out <page.html>');
    const pictures = changedPictures(values.repo ?? REPO_DIR);
    if (pictures.length === 0) {
      console.log('No picture changed.');
    } else {
      writeFileSync(values.out, reviewPage(pictures));
      const n = pictures.length;
      console.log(`${n} picture${n === 1 ? '' : 's'} changed. Old beside new: ${values.out}`);
      for (const p of pictures) console.log(`  ${kindOf(p).padEnd(7)}  ${p.paths.join(' ')}`);
    }
  } catch (e) {
    console.error(`review-screens: ${e instanceof Error ? e.message : String(e)}`);
    process.exit(1);
  }
}
