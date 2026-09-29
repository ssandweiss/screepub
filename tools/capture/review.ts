// Which pictures a capture run changed, compared with the last commit, and
// a page that shows each one old beside new. tools/review-screens.ts is the
// command; the /release skill runs it at its first moment, so the owner
// checks the pictures as he checks the notes: that they look right, and
// that nothing real is in frame (spec 2026-09-22, part 5).
//
// Compared with HEAD, staged or not, because the release commit is what
// they are about to join. A picture the capture writes to two places (the
// light drop and result go to assets/screens/ and site/img/) is one picture
// to look at, shown once with both paths.

import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { SHOTS, outputsFor } from './shots';

/** Every folder the capture tool writes a picture into. */
export const PICTURE_DIRS: readonly string[] = [
  ...new Set(SHOTS.flatMap((shot) => shot.themes.flatMap((theme) => outputsFor(shot, theme))).map(dirname)),
].sort();

export interface ChangedPicture {
  /** Every path holding this picture, sorted. */
  paths: string[];
  /** The bytes at HEAD, or null for a new picture. */
  before: Uint8Array | null;
  /** The bytes on disk now, or null for a removed one. */
  after: Uint8Array | null;
}

function git(repoDir: string, args: string[]): { ok: boolean; out: Buffer; err: string } {
  const proc = Bun.spawnSync(['git', ...args], { cwd: repoDir, stdout: 'pipe', stderr: 'pipe' });
  return { ok: proc.exitCode === 0, out: proc.stdout, err: proc.stderr.toString() };
}

/** The pictures under PICTURE_DIRS that differ from HEAD, grouped so the
 *  same change in two places is listed once, sorted by first path. */
export function changedPictures(repoDir: string): ChangedPicture[] {
  const status = git(repoDir, ['status', '--porcelain=v1', '-z', '--untracked-files=all', '--', ...PICTURE_DIRS]);
  if (!status.ok) throw new Error(`git status failed: ${status.err.trim()}`);
  // Records are "XY path"; a rename or copy is followed by its old path as
  // a record of its own. Both are looked at: after a rename the old path
  // is gone from disk and shows as removed, and after a copy it is
  // unchanged and drops out below.
  const records = status.out.toString().split('\0');
  const paths: string[] = [];
  for (let i = 0; i < records.length; i++) {
    const record = records[i]!;
    if (record.length < 4) continue;
    const found = [record.slice(3)];
    if (record[0] === 'R' || record[0] === 'C') found.push(records[++i] ?? '');
    for (const path of found) if (path.endsWith('.png')) paths.push(path);
  }

  const groups = new Map<string, ChangedPicture>();
  for (const path of paths.sort()) {
    const head = git(repoDir, ['cat-file', 'blob', `HEAD:${path}`]);
    const before = head.ok ? new Uint8Array(head.out) : null;
    const after = existsSync(join(repoDir, path)) ? new Uint8Array(readFileSync(join(repoDir, path))) : null;
    if (before !== null && after !== null && Buffer.from(before).equals(after)) continue;
    const key = `${before === null ? '-' : Buffer.from(before).toString('base64')}:${
      after === null ? '-' : Buffer.from(after).toString('base64')
    }`;
    const group = groups.get(key);
    if (group) group.paths.push(path);
    else groups.set(key, { paths: [path], before, after });
  }
  return [...groups.values()].sort((a, b) => a.paths[0]!.localeCompare(b.paths[0]!));
}

export function kindOf(picture: ChangedPicture): 'new' | 'removed' | 'changed' {
  return picture.before === null ? 'new' : picture.after === null ? 'removed' : 'changed';
}

const escape = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function side(label: string, bytes: Uint8Array | null, missing: string): string {
  const body = bytes === null
    ? `<p class="none">${missing}</p>`
    : `<img alt="${label}" src="data:image/png;base64,${Buffer.from(bytes).toString('base64')}">`;
  return `<figure><figcaption>${label}</figcaption>${body}</figure>`;
}

/** One self-contained page: every picture is inside it, so it opens from
 *  any folder, in any viewer, with nothing else beside it. */
export function reviewPage(pictures: ChangedPicture[]): string {
  const sections = pictures.map((p) => `
<section>
  <h2>${p.paths.map(escape).join('<br>')} <span>${kindOf(p)}</span></h2>
  <div class="pair">
    ${side('Before', p.before, 'No picture before. This one is new.')}
    ${side('Now', p.after, 'Removed. The capture no longer takes this picture.')}
  </div>
</section>`).join('\n');
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Pictures to check</title>
<style>
body{margin:0;padding:24px;font:15px/1.5 -apple-system,system-ui,sans-serif;background:#f4f2ec;color:#1d1b16}
h1{font-size:20px;margin:0 0 6px}
.lead{max-width:44em;margin:0 0 24px}
section{margin:0 0 36px}
h2{font-size:13px;font-family:ui-monospace,monospace;font-weight:600;margin:0 0 10px}
h2 span{font-family:-apple-system,system-ui,sans-serif;font-weight:400;color:#6d6960;margin-left:8px}
.pair{display:grid;grid-template-columns:1fr 1fr;gap:16px}
figure{margin:0;background:#d9d6ce;padding:10px;border-radius:6px}
figcaption{font-size:12px;color:#4a453a;margin-bottom:6px}
img{display:block;width:100%;height:auto}
.none{margin:40px 0;text-align:center;color:#6d6960}
</style>
</head>
<body>
<h1>Pictures to check</h1>
<p class="lead">The release will commit these with the notes. Before on the left, now on the right.
Look for anything real in frame: a real script's title, author or character name.
Every picture should show Field Station, the invented script, or no script at all.</p>
${sections}
</body>
</html>
`;
}
