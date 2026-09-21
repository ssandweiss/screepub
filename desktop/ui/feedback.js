// A pre-filled bug report. Ported from app/Sources/ScreepubKit/Feedback.swift,
// which is frozen, so this is the live copy.
//
// Pure, and deliberately in the window rather than in src/: nothing but a
// window has a browser to open, and the CLI has no use for a GitHub issue
// URL. Putting it in the engine and transpiling it here — the arrangement
// update-compare.js has — would be ceremony for one consumer.
//
// The window does not OPEN this. app.js does, because app.js is the only
// file that touches Tauri, and opening a URL is now a Tauri call.

/** The repository's new-issue endpoint. The capability scopes the window to
 *  exactly this repo (capabilities/default.json), so a URL built here that
 *  pointed anywhere else would be refused rather than followed. */
export const NEW_ISSUE_BASE = 'https://github.com/ssandweiss/screepub/issues/new';

/** A pre-filled issue: an instruction, an optional context block seeded by
 *  whatever went wrong, and an environment footer.
 *
 *  The footer is the point of the whole thing. A report that arrives without
 *  a version costs a round trip before anyone can even look, and the two
 *  versions are the two facts the person reporting is least likely to know
 *  offhand and least able to get wrong if the app fills them in.
 *
 *  Built with URLSearchParams rather than by hand. Feedback.swift had to
 *  patch a literal "+" to %2B afterwards, because URLComponents leaves it
 *  alone and a query parser then reads it as a space — so "C++" arrived as
 *  "C  ". URLSearchParams encodes it correctly to begin with, which is why
 *  this port does not carry that fix-up across: the bug it fixed does not
 *  exist here. */
export function newIssueUrl({ appVersion, osVersion, context = null }) {
  let body = '<!-- Describe the issue or suggestion. -->\n\n';
  if (typeof context === 'string' && context.trim() !== '') {
    body += `\n**What happened:**\n${context}\n`;
  }
  body += `\n---\nScreepub ${appVersion} · ${osVersion}\n`;

  const query = new URLSearchParams({ body });
  return `${NEW_ISSUE_BASE}?${query.toString()}`;
}

/** What the window knows about the machine it is on, for the footer. The
 *  Swift read ProcessInfo; a webview has only the user agent's platform,
 *  which is coarser. Coarse and honest beats precise and invented: this is
 *  a hint for triage, not a diagnostic. */
export function osLabel(platform) {
  const said = String(platform ?? '').trim();
  return said === '' ? 'unknown platform' : said;
}
