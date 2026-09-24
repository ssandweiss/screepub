// Performs the routes that leave Screepub through another program: Apple
// Books, Amazon's Send to Kindle (its app, or its web page beside the book's
// folder), a Mail message with the book attached, and Amazon's settings page
// for the email route's one-time setup.
//
// Decided by the owner (2026-09-23): the ENGINE opens these, the same way it
// already runs Calibre, and the window gains no permission for them. These
// routes open a file in the library, piece C makes the library movable, and
// a window permission is a fixed path that cannot follow it.
//
// Every open goes through an injectable Opener, so no test ever launches
// Books, a browser, Mail or the file manager. Each performer returns the
// sentence the window shows, or throws an Error naming what could not be
// opened (cli-routes.ts turns that into `route-failed`).
import { dirname } from 'node:path';
import { errorMessage } from '../cli-errors';

/** Runs one argv and reports how it went. Never throws for a program that
 *  failed or was not there: that is an answer, carried as a non-zero code. */
export type Opener = (argv: string[]) => Promise<{ code: number; stderr: string }>;

/** Amazon's web uploader, the route when its app is not installed. */
export const SEND_TO_KINDLE_URL = 'https://www.amazon.com/sendtokindle';

/** Amazon's Personal Document Settings: where a Kindle's email address is
 *  listed and where the approved senders list is edited. One page for both
 *  steps of the email setup (the Swift app's Personal Document Settings
 *  link; the send-routes plan names the original). */
export const KINDLE_EMAIL_SETTINGS_URL = 'https://www.amazon.com/hz/mycd/myx#/home/settings/pdoc';

/** The real thing: spawns argv[0] with the rest, waits, and returns its exit
 *  code and stderr. stdout is not read (nothing here prints an answer there). */
export const realOpener: Opener = async (argv) => {
  try {
    const proc = Bun.spawn(argv, { stdin: 'ignore', stdout: 'ignore', stderr: 'pipe' });
    const [code, stderr] = await Promise.all([proc.exited, new Response(proc.stderr).text()]);
    return { code, stderr };
  } catch (err) {
    // Bun.spawn throws when the program is not there at all (no xdg-open on
    // a minimal Linux). That is a failure to open, reported like one.
    return { code: 127, stderr: errorMessage(err) };
  }
};

/** Open, or throw a sentence that names what did not open and why: the
 *  program's own complaint when it printed one, else its exit code, so the
 *  message is never just "could not open X". */
async function openOrThrow(open: Opener, argv: string[], what: string): Promise<void> {
  const { code, stderr } = await open(argv);
  if (code === 0) return;
  const why = stderr.trim();
  throw new Error(`could not open ${what}: ${why !== '' ? why : `it exited with code ${code}`}`);
}

/** Each platform's way to open a web page in the default browser. */
function urlArgv(platform: string, url: string): string[] {
  if (platform === 'darwin') return ['open', url];
  if (platform === 'win32') return ['rundll32', 'url.dll,FileProtocolHandler', url];
  return ['xdg-open', url];
}

export async function addToAppleBooks(epub: string, open: Opener = realOpener): Promise<string> {
  await openOrThrow(open, ['open', '-a', 'Books', epub], 'Apple Books');
  return 'Added to Apple Books. It syncs to your iPhone and iPad when Books uses iCloud.';
}

/** Amazon's app when it is installed (a Mac app), else its web uploader with
 *  the book's folder shown beside it, so the file is one drag away. The
 *  folder is shown FIRST: the page then opens in front of it. */
export async function sendViaAmazon(
  epub: string,
  facts: { platform: string; sendToKindleApp: boolean },
  open: Opener = realOpener,
): Promise<string> {
  if (facts.platform === 'darwin' && facts.sendToKindleApp) {
    await openOrThrow(open, ['open', '-a', 'Send to Kindle', epub], "Amazon's Send to Kindle app");
    return "Opened Amazon's Send to Kindle app with the book.";
  }
  if (facts.platform === 'win32') {
    // The folder, not `/select,<book>`: Bun quotes that whole argument when
    // the path has a space in it, and explorer misreads the quoted form (a
    // comma in the path breaks it too), so the book is not selected and the
    // wrong folder can open. Opening the folder is what Linux does as well.
    // explorer exits 1 even when it did exactly what was asked, so its exit
    // code says nothing about whether the folder opened, and is not read.
    await open(['explorer', dirname(epub)]);
  } else {
    const reveal = facts.platform === 'darwin' ? ['open', '-R', epub] : ['xdg-open', dirname(epub)];
    await openOrThrow(open, reveal, "the book's folder");
  }
  await openOrThrow(open, urlArgv(facts.platform, SEND_TO_KINDLE_URL), "Amazon's Send to Kindle page");
  return "Opened Amazon's Send to Kindle page, and the book's folder so you can drag it in.";
}

/** A new Mail message with the book attached. Only offered when Apple Mail
 *  is the default mail app (routes.ts): with any other, macOS hands over a
 *  mailto: link, which carries no attachment. */
export async function emailToKindle(epub: string, open: Opener = realOpener): Promise<string> {
  await openOrThrow(open, ['open', '-a', 'Mail', epub], 'Mail');
  return "Opened a Mail message with the book attached. Address it to your Kindle's email address.";
}

/** Amazon's settings page, for the email route's one-time setup: Amazon
 *  drops mail from an address it has not been told to accept, and says
 *  nothing. Needs no book, and works on every platform. */
export async function openKindleEmailSettings(platform: string, open: Opener = realOpener): Promise<string> {
  await openOrThrow(open, urlArgv(platform, KINDLE_EMAIL_SETTINGS_URL), "Amazon's settings page");
  return "Opened Amazon's settings page. Find your Kindle's email address there, and add the address you send from to the approved list.";
}
