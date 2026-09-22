// The two minisign containers the updater deals in, READ but never verified.
//
// tauri-cli signs each updater artifact at release time and writes the
// signature beside it as `<artifact>.sig`: the base64 of a minisign
// signature box (helpers/updater_signature.rs). The plugin verifies that
// signature at install time against the public key in tauri.conf.json,
// which is the base64 of a minisign public key box. Neither of those two
// steps is this repository's code.
//
// What is this repository's code is everything in between: the bundle
// tool copies the .sig out under a published name, the manifest builder
// pastes its CONTENT into latest.json, the freshness check compares the
// two, and the release gate asks whether the key in the config is a key
// at all. Each of those wants to know "is this the container it claims
// to be, and which key does it name?" without doing any cryptography.
// That is what this module answers.
//
// Shapes, from minisign's own format:
//
//   signature box   untrusted comment: <text>
//                   <base64 of 74 bytes: alg(2) key id(8) signature(64)>
//                   trusted comment: <text>
//                   <base64 of 64 bytes: the global signature>
//
//   public key box  untrusted comment: <text>
//                   <base64 of 42 bytes: alg(2) key id(8) key(32)>
//
// The key id is compared as the 8 bytes read little-endian and printed as
// uppercase hex, which is how minisign and tauri print it. It comes from
// the BYTES, never from the comment line: the comment is untrusted by
// minisign's own naming.

const SIGNATURE_BYTES = 74;
const PUBLIC_KEY_BYTES = 42;
const GLOBAL_SIGNATURE_BYTES = 64;

export interface SignatureBox {
  /** Uppercase hex of the little-endian u64 key id. */
  keyId: string;
  /** The `file:` field of the trusted comment, when the CLI wrote one. */
  fileName: string | undefined;
}

export interface PublicKeyBox {
  keyId: string;
}

/** Decode base64 strictly. `Buffer.from(x, 'base64')` silently skips
 *  characters it does not understand, so "not base64 at all" decodes to
 *  something rather than failing; the shape check is what refuses it. */
function decodeBase64(what: string, encoded: string): Buffer {
  const trimmed = encoded.trim();
  if (trimmed === '') throw new Error(`${what}: empty; nothing to decode`);
  if (!/^[A-Za-z0-9+/]+=*$/.test(trimmed)) {
    throw new Error(`${what}: not base64 (it contains characters outside the base64 alphabet)`);
  }
  return Buffer.from(trimmed, 'base64');
}

function keyIdOf(bytes: Buffer): string {
  return bytes.subarray(2, 10).readBigUInt64LE(0).toString(16).toUpperCase();
}

/** Read a `.sig` file's contents (the base64 the CLI wrote) and say which
 *  key it names. Throws, naming the defect, on anything that is not a
 *  minisign signature box. */
export function parseSignatureBox(encoded: string): SignatureBox {
  const text = decodeBase64('signature', encoded).toString('utf8');
  const lines = text.trimEnd().split('\n');
  if (lines.length !== 4) {
    throw new Error(
      `signature: expected four lines (untrusted comment, signature, trusted comment, global ` +
        `signature), found ${lines.length}`,
    );
  }
  const [untrusted, signature, trusted, global] = lines as [string, string, string, string];
  if (!untrusted.startsWith('untrusted comment: ')) {
    throw new Error(
      `signature: does not begin with "untrusted comment: " (begins ${JSON.stringify(untrusted.slice(0, 40))})`,
    );
  }
  const sigBytes = decodeBase64('signature line', signature);
  if (sigBytes.length !== SIGNATURE_BYTES) {
    throw new Error(
      `signature: the signature line decodes to ${sigBytes.length} bytes, not the ${SIGNATURE_BYTES} of a minisign signature`,
    );
  }
  if (!trusted.startsWith('trusted comment: ')) {
    throw new Error(`signature: third line is not a "trusted comment: " line`);
  }
  const globalBytes = decodeBase64('global signature line', global);
  if (globalBytes.length !== GLOBAL_SIGNATURE_BYTES) {
    throw new Error(
      `signature: the global signature decodes to ${globalBytes.length} bytes, not ${GLOBAL_SIGNATURE_BYTES}`,
    );
  }
  const fileName = /\tfile:([^\t]+)/.exec(trusted)?.[1];
  return { keyId: keyIdOf(sigBytes), fileName };
}

/** Read a public key as tauri.conf.json carries it (the base64 the CLI
 *  printed) and say which key it is. Throws, naming the defect, on
 *  anything that is not a minisign public key box. */
export function parsePublicKeyBox(encoded: string): PublicKeyBox {
  if (encoded.trim() === '') {
    throw new Error(
      'public key: empty. tauri.conf.json ships with an empty pubkey until the owner generates ' +
        'the key pair and pastes the public half in (docs/release-secrets.md §4).',
    );
  }
  const text = decodeBase64('public key', encoded).toString('utf8');
  const lines = text.trimEnd().split('\n');
  if (lines.length !== 2 || !lines[0]!.startsWith('untrusted comment: ')) {
    throw new Error(
      `public key: expected an "untrusted comment: " line and a key line, found ${lines.length} line(s)`,
    );
  }
  const keyBytes = decodeBase64('public key line', lines[1]!);
  if (keyBytes.length !== PUBLIC_KEY_BYTES) {
    throw new Error(
      `public key: the key line decodes to ${keyBytes.length} bytes, not the ${PUBLIC_KEY_BYTES} of a minisign public key`,
    );
  }
  return { keyId: keyIdOf(keyBytes) };
}

// ── the tag-time gate ────────────────────────────────────────────────
//
//   bun tools/update-signature.ts --pubkey-from-config <tauri.conf.json>
//
// release.yml's checks job runs this against the TAGGED commit's config.
// Exit 0 and the key id when plugins.updater.pubkey is a real minisign
// public key; exit 1 and a reason otherwise. A tag whose app trusts no
// key ships an updater that can never accept a release, which is the
// thing ADR 2026-09-21 says v0.6.1 must not do. It is a tag-time gate
// and not a bun test on purpose: until the owner generates the key pair
// the config carries an empty string, and a test that fails until a
// person acts is a red main for nobody's fault.

if (import.meta.main) {
  const { readFileSync } = await import('node:fs');
  const { parseArgs } = await import('node:util');
  const { values } = parseArgs({
    args: Bun.argv.slice(2),
    options: { 'pubkey-from-config': { type: 'string' } },
    strict: true,
    allowPositionals: false,
  });
  const path = values['pubkey-from-config'];
  if (!path) {
    console.error('usage: bun tools/update-signature.ts --pubkey-from-config <tauri.conf.json>');
    process.exit(2);
  }
  try {
    const conf = JSON.parse(readFileSync(path, 'utf8')) as {
      plugins?: { updater?: { pubkey?: unknown } };
    };
    const pubkey = conf.plugins?.updater?.pubkey;
    if (typeof pubkey !== 'string') {
      throw new Error('public key: plugins.updater.pubkey is missing from the config');
    }
    const { keyId } = parsePublicKeyBox(pubkey);
    console.log(`the app trusts updater key ${keyId}`);
  } catch (err) {
    console.error(`::error::${(err as Error).message}`);
    console.error(
      '::error::A tag cannot ship an updater that trusts no key. Generate the pair, add the ' +
        'secrets, and paste the PUBLIC key into desktop/src-tauri/tauri.conf.json: ' +
        'docs/release-secrets.md §4.',
    );
    process.exit(1);
  }
}
