// The CLI's error contract, separated from cli.ts so tests can exercise
// the mapping without spawning the binary (cli.ts runs main() on import).

export interface JsonError {
  code:
    | 'scanned'
    | 'not-screenplay'
    | 'unreadable'
    | 'password'
    | 'unsupported-type'
    | 'usage'
    | 'bad-options'
    | 'internal'
    // The library folder could not be opened or made.
    | 'library'
    // Device commands (piece B). Same contract, same stdout rule.
    | 'no-devices'
    | 'ambiguous-device'
    | 'unknown-device'
    | 'send-failed'
    | 'unsupported-file'
    // Settings and export verbs (piece D). Same contract, same stdout rule.
    | 'bad-settings'
    | 'export-failed'
    // The KFX plugin install (parity piece D). Same contract, same stdout rule.
    | 'kfx-install-failed'
    // The route verb (parity piece B): a route that cannot fire here (its
    // message is the row's fix), and one whose app, page or folder did not
    // open (its message names which).
    | 'route-unavailable'
    | 'route-failed';
  message: string;
}

/// Map a thrown conversion error to its contract code, or null for
/// anything unrecognized (the caller's catch-all owns those). Detection
/// is TYPED — pdf.js exceptions carry stable `name`s — never substring:
/// a path like ~/scripts/password-notes/x.pdf must not classify as a
/// password failure.
export function mapConversionError(err: unknown): JsonError | null {
  const name = (err as { name?: string })?.name;
  if (name === 'PasswordException') {
    return {
      code: 'password',
      message: 'this PDF is password-protected — remove the password first',
    };
  }
  if (name === 'InvalidPDFException') {
    return {
      code: 'unreadable',
      message: 'this file is not a readable PDF — it may be corrupt or mislabeled',
    };
  }
  const fsCode = (err as NodeJS.ErrnoException)?.code;
  if (fsCode === 'ENOENT' || fsCode === 'EISDIR' || fsCode === 'EACCES') {
    return { code: 'unreadable', message: `cannot read the input file (${fsCode})` };
  }
  return null;
}

/** A failure that already knows its contract code. Thrown by the device
 * command handlers, which must not import the printer: they return values or
 * throw this, and cli.ts is the only place that decides how it reaches the
 * user. */
export class CliError extends Error {
  constructor(
    readonly code: JsonError['code'],
    message: string,
  ) {
    super(message);
    this.name = 'CliError';
  }

  toJson(): JsonError {
    return { code: this.code, message: this.message };
  }
}

/** The message to report for an arbitrary throw.
 *
 * NOT `(err as Error).message`: a non-Error throw (a string, a rejected
 * promise carrying an object) yields undefined, and `JSON.stringify` DROPS an
 * undefined value — so `{"ok":false,"error":{"code":"send-failed"}}` reaches
 * the caller with no `message` at all, while `JsonError.message` is declared
 * required and the Tauri decoder rejects the object. One coercion, used at
 * every site that turns a caught unknown into a contract error. */
export function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
