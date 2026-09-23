// tools/update-signature.ts: reading the two minisign containers the
// updater deals in, WITHOUT verifying anything cryptographic.
//
// The plugin verifies signatures at install time and the CLI makes them at
// release time; neither is this repository's code. What IS this
// repository's job is carrying the signature from the bundler to the
// manifest to the freshness check without corrupting it, and noticing
// when a file that should be a signature is not one. A `.sig` that is
// really a 404 page, or a public key that is really an empty string,
// must be refused by name rather than discovered by a user whose update
// fails with "signature could not be decoded".
import { afterAll, describe, test, expect } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parsePublicKeyBox, parseSignatureBox } from '../tools/update-signature';
import { FAKE_KEY_ID, fakePublicKeyBox, fakeSignatureBox, keyIdHex } from './signature-box';

const SCRATCH = mkdtempSync(join(tmpdir(), 'screepub-update-signature-'));
afterAll(() => rmSync(SCRATCH, { recursive: true, force: true }));

describe('a .sig file', () => {
  test('a well-formed box is read, and reports the key that made it', () => {
    const parsed = parseSignatureBox(fakeSignatureBox('Screepub Desktop.app.tar.gz'));
    expect(parsed.keyId).toBe(keyIdHex(FAKE_KEY_ID));
    expect(parsed.fileName).toBe('Screepub Desktop.app.tar.gz');
  });

  test('a trailing newline or none makes no difference', () => {
    const box = fakeSignatureBox('x.tar.gz');
    const trimmed = Buffer.from(Buffer.from(box, 'base64').toString('utf8').trimEnd()).toString(
      'base64',
    );
    expect(parseSignatureBox(trimmed).keyId).toBe(parseSignatureBox(box).keyId);
  });

  test('a 404 page where a signature should be is refused, and says so', () => {
    const html = Buffer.from('<html><body>Not Found</body></html>').toString('base64');
    expect(() => parseSignatureBox(html)).toThrow(/untrusted comment/);
  });

  test('something that is not base64 at all is refused', () => {
    expect(() => parseSignatureBox('this is not base64!!')).toThrow(/base64|decode/i);
  });

  test('an empty string is refused rather than read as an empty signature', () => {
    expect(() => parseSignatureBox('')).toThrow();
  });

  test('a signature line of the wrong length is refused', () => {
    // 74 bytes: alg (2) + key id (8) + ed25519 signature (64). Anything
    // else is not a minisign signature whatever the comment says.
    const short = Buffer.concat([Buffer.from('ED'), FAKE_KEY_ID, Buffer.alloc(63, 7)]);
    const box =
      'untrusted comment: signature from tauri secret key\n' +
      `${short.toString('base64')}\n` +
      'trusted comment: timestamp:1\tfile:x\n' +
      `${Buffer.alloc(64, 9).toString('base64')}\n`;
    expect(() => parseSignatureBox(Buffer.from(box).toString('base64'))).toThrow(/74/);
  });

  test('a box missing its trusted comment and global signature is refused', () => {
    const sig = Buffer.concat([Buffer.from('ED'), FAKE_KEY_ID, Buffer.alloc(64, 7)]);
    const box = 'untrusted comment: signature from tauri secret key\n' + `${sig.toString('base64')}\n`;
    expect(() => parseSignatureBox(Buffer.from(box).toString('base64'))).toThrow(/trusted comment/);
  });

  test('a global signature of the wrong length is refused', () => {
    const sig = Buffer.concat([Buffer.from('ED'), FAKE_KEY_ID, Buffer.alloc(64, 7)]);
    const box =
      'untrusted comment: signature from tauri secret key\n' +
      `${sig.toString('base64')}\n` +
      'trusted comment: timestamp:1\tfile:x\n' +
      `${Buffer.alloc(32, 9).toString('base64')}\n`;
    expect(() => parseSignatureBox(Buffer.from(box).toString('base64'))).toThrow(/64/);
  });
});

describe('a public key', () => {
  test('a well-formed box is read, and reports its key id', () => {
    expect(parsePublicKeyBox(fakePublicKeyBox()).keyId).toBe(keyIdHex(FAKE_KEY_ID));
  });

  test('the key id comes from the BYTES, not from the comment line', () => {
    // The comment is untrusted by minisign's own naming. A signature is
    // matched to a key by the id inside the bytes, so that is what gets
    // compared.
    const other = Buffer.from('1112131415161718', 'hex');
    const lied = Buffer.from(fakePublicKeyBox(other), 'base64')
      .toString('utf8')
      .replace(keyIdHex(other), 'DEADBEEFDEADBEEF');
    expect(parsePublicKeyBox(Buffer.from(lied).toString('base64')).keyId).toBe(keyIdHex(other));
  });

  test('an empty string is refused, because that is what the config ships with until the owner acts', () => {
    expect(() => parsePublicKeyBox('')).toThrow(/empty/i);
  });

  test('a key of the wrong length is refused', () => {
    const short = Buffer.concat([Buffer.from('Ed'), FAKE_KEY_ID, Buffer.alloc(31, 3)]);
    const box = `untrusted comment: minisign public key: X\n${short.toString('base64')}\n`;
    expect(() => parsePublicKeyBox(Buffer.from(box).toString('base64'))).toThrow(/42/);
  });

  test('the tag-time gate reads the key out of a tauri.conf.json and says yes or no', async () => {
    // release.yml's checks job runs this against the TAGGED commit's
    // config. A tag whose app trusts no key ships an updater that can
    // never accept a release, which is the thing ADR 2026-09-21 says
    // v0.6.1 must not do.
    const dir = mkdtempSync(join(SCRATCH, 'pubkey-gate-'));
    const run = async (conf: unknown) => {
      const path = join(dir, 'tauri.conf.json');
      writeFileSync(path, JSON.stringify(conf));
      const proc = Bun.spawn(
        ['bun', new URL('../tools/update-signature.ts', import.meta.url).pathname, '--pubkey-from-config', path],
        { stdout: 'pipe', stderr: 'pipe' },
      );
      const [stdout, stderr, exitCode] = await Promise.all([
        new Response(proc.stdout).text(),
        new Response(proc.stderr).text(),
        proc.exited,
      ]);
      return { stdout, stderr, exitCode };
    };
    const real = await run({ plugins: { updater: { pubkey: fakePublicKeyBox() } } });
    expect(real.exitCode).toBe(0);
    expect(real.stdout).toContain(keyIdHex(FAKE_KEY_ID));

    const empty = await run({ plugins: { updater: { pubkey: '' } } });
    expect(empty.exitCode).not.toBe(0);
    expect(empty.stderr).toMatch(/empty/i);
    expect(empty.stderr).toContain('release-secrets');

    const absent = await run({ plugins: {} });
    expect(absent.exitCode).not.toBe(0);

    const garbage = await run({ plugins: { updater: { pubkey: 'bm90IGEga2V5' } } });
    expect(garbage.exitCode).not.toBe(0);
  });

  test('a signature and a public key from the same pair agree on the key id', () => {
    // The comparison the release gate and the freshness check make: a
    // manifest signed by a key the shipped app does not trust would fail
    // every install, and the CLI only WARNS when the two differ.
    expect(parseSignatureBox(fakeSignatureBox('a')).keyId).toBe(
      parsePublicKeyBox(fakePublicKeyBox()).keyId,
    );
    const other = Buffer.from('1112131415161718', 'hex');
    expect(parseSignatureBox(fakeSignatureBox('a', other)).keyId).not.toBe(
      parsePublicKeyBox(fakePublicKeyBox()).keyId,
    );
  });
});
