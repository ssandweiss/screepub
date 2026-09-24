// Test-only builders for the two minisign "boxes" the updater deals in,
// shaped exactly as tauri-cli writes them (helpers/updater_signature.rs):
//
//   .sig file  = base64( "untrusted comment: signature from tauri secret key\n"
//                        <base64: 2-byte alg, 8-byte key id, 64-byte sig>\n
//                        "trusted comment: timestamp:<unix>\tfile:<name>\n"
//                        <base64: 64-byte global signature>\n )
//   pubkey     = base64( "untrusted comment: minisign public key: <KEYID>\n"
//                        <base64: 2-byte alg, 8-byte key id, 32-byte key>\n )
//
// The bytes are NOT real signatures; nothing here can be verified by
// minisign. They exist so the tools that carry signatures around (the
// bundle tool, the manifest builder, the freshness check) can be tested
// for what they do with the CONTAINER: read it, refuse a malformed one,
// copy it byte for byte, and compare key ids.

export const FAKE_KEY_ID = Buffer.from('0102030405060708', 'hex');

/** The key id as tauri and minisign print it: the 8 bytes read as a
 *  little-endian u64, in uppercase hex. */
export function keyIdHex(keyId: Buffer): string {
  return keyId.readBigUInt64LE(0).toString(16).toUpperCase();
}

export function fakeSignatureBox(fileName: string, keyId: Buffer = FAKE_KEY_ID): string {
  const signature = Buffer.concat([Buffer.from('ED'), keyId, Buffer.alloc(64, 7)]);
  const global = Buffer.alloc(64, 9);
  const box =
    'untrusted comment: signature from tauri secret key\n' +
    `${signature.toString('base64')}\n` +
    `trusted comment: timestamp:1758470000\tfile:${fileName}\n` +
    `${global.toString('base64')}\n`;
  return Buffer.from(box).toString('base64');
}

export function fakePublicKeyBox(keyId: Buffer = FAKE_KEY_ID): string {
  const key = Buffer.concat([Buffer.from('Ed'), keyId, Buffer.alloc(32, 3)]);
  const box =
    `untrusted comment: minisign public key: ${keyIdHex(keyId)}\n` + `${key.toString('base64')}\n`;
  return Buffer.from(box).toString('base64');
}
