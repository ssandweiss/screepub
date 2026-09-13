// reMarkable tablets never mount as a volume (no mass storage, no MTP). With
// "USB web interface" enabled in the tablet's storage settings, the device
// serves plain HTTP on its fixed USB-ethernet address; files are added with a
// multipart POST. EPUB and PDF only.
import { statSync } from 'node:fs';
import { basename, extname } from 'node:path';

/** The tablet's fixed address on the USB link, same on every unit. */
export const REMARKABLE_USB_ADDRESS = [10, 11, 99, 1].join('.');
export const REMARKABLE_ENDPOINT = `http://${REMARKABLE_USB_ADDRESS}`;

/** Paper Pro's web interface caps uploads here. */
export const REMARKABLE_MAX_UPLOAD_BYTES = 100 * 1024 * 1024;

/** How long the presence probe waits. One constant, because listDevices always
 * passes an explicit value: a second copy as this function's default would be
 * dead for the only production caller, and changing it would do nothing. */
export const REMARKABLE_PROBE_TIMEOUT_MS = 1500;

export class RemarkableUploadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RemarkableUploadError';
  }
}

/** The root-folder listing URL. Listing is also STATE on the tablet: /upload
 * has no destination parameter and writes into whichever folder the interface
 * listed last, so this GET doubles as the aim taken immediately before every
 * shot. */
function documentsUrl(endpoint: string): string {
  return new URL('documents/', `${endpoint.replace(/\/$/, '')}/`).toString();
}

/** True when the USB web interface answers — i.e. the tablet is docked over
 * USB with the interface enabled. Cheap enough to poll. */
export async function probeRemarkable(
  endpoint: string = REMARKABLE_ENDPOINT,
  timeoutMs = REMARKABLE_PROBE_TIMEOUT_MS,
): Promise<boolean> {
  try {
    const response = await fetch(documentsUrl(endpoint), {
      method: 'GET',
      signal: AbortSignal.timeout(timeoutMs),
    });
    return response.status === 200;
  } catch {
    return false;
  }
}

/** The tablet's USB web interface accepts these two formats and no others.
 * Exported because `send` has to report `unsupported-file` BEFORE it calls
 * upload — deciding that by matching the upload error's message would be the
 * substring detection cli-errors.ts bans. One copy, two callers. */
export function remarkableAccepts(file: string): boolean {
  const ext = extname(file).replace(/^\./, '').toLowerCase();
  return ext === 'pdf' || ext === 'epub';
}

/** Upload a PDF or EPUB to the tablet's root folder. "Root" is made true, not
 * assumed: /upload writes into the last-listed folder (server-side state), so
 * root is listed first and a failed listing aborts the send rather than fire
 * blind into the wrong folder. */
export async function uploadToRemarkable(
  file: string,
  endpoint: string = REMARKABLE_ENDPOINT,
): Promise<void> {
  const ext = extname(file).replace(/^\./, '').toLowerCase();
  if (!remarkableAccepts(file)) {
    // Word-for-word what cli-devices.ts's own pre-check says, because
    // `send-failed` passes this text through verbatim: a user who hits the two
    // guards from the CLI and from the Tauri shell would otherwise read two
    // wordings for one fact. House convention for these messages is no
    // trailing period, which is why the three below lost theirs. (This
    // diverges from RemarkableDevice.swift's wording; the Swift app is being
    // retired and its strings are not the source of truth any more.)
    throw new RemarkableUploadError(
      `reMarkable accepts PDF and EPUB only — ${file} is neither`,
    );
  }

  // Fail the whole send before any bytes move or any state changes.
  //
  // DIVERGENCE from RemarkableDevice.swift, deliberately: it reads the size
  // as `try? ... ?? 0`, so an unreadable file sails past the size guard as
  // "0 bytes" and into the POST. Here statSync throws and the send stops —
  // the safer behavior, and the honest one: a file we cannot stat is a file
  // we cannot upload either.
  const size = statSync(file).size;
  if (size > REMARKABLE_MAX_UPLOAD_BYTES) {
    throw new RemarkableUploadError(
      `this file is ${Math.floor(size / (1024 * 1024))} MB; the tablet's USB web interface accepts up to 100 MB`,
    );
  }

  const listing = await fetch(documentsUrl(endpoint), {
    method: 'GET',
    signal: AbortSignal.timeout(10_000),
  });
  if (listing.status !== 200) {
    throw new RemarkableUploadError(
      `couldn't open the tablet's root folder (HTTP ${listing.status}); nothing was uploaded`,
    );
  }

  const form = new FormData();
  const mime = ext === 'pdf' ? 'application/pdf' : 'application/epub+zip';
  form.append('file', new File([await Bun.file(file).arrayBuffer()], basename(file), { type: mime }));

  const response = await fetch(new URL('upload', `${endpoint.replace(/\/$/, '')}/`).toString(), {
    method: 'POST',
    body: form,
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) {
    throw new RemarkableUploadError(`reMarkable upload failed (HTTP ${response.status})`);
  }
}
