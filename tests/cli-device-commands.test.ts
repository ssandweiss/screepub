import { afterAll, describe, test, expect } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname;
const SCRATCH = mkdtempSync(join(tmpdir(), 'screepub-devcli-'));
afterAll(() => rmSync(SCRATCH, { recursive: true, force: true }));

/** A mount parent with one Kobo in it. Injected through SCREEPUB_VOLUME_ROOTS
 * so the spawned CLI never enumerates this machine's real mounts. */
function mountRootWithKobo(): string {
  const root = mkdtempSync(join(tmpdir(), 'screepub-mounts-'));
  mkdirSync(join(root, 'KOBOeReader', '.kobo'), { recursive: true });
  return root;
}

const silent = Bun.serve({ port: 0, fetch: () => new Response('no', { status: 404 }) });
const SILENT_URL = `http://127.0.0.1:${silent.port}`;
afterAll(() => silent.stop(true));

async function runCli(args: string[], env: Record<string, string> = {}, cwd = ROOT) {
  const proc = Bun.spawn(['bun', `${ROOT}src/cli.ts`, ...args], {
    stdout: 'pipe',
    stderr: 'pipe',
    cwd,
    env: { ...process.env, SCREEPUB_REMARKABLE_ENDPOINT: SILENT_URL, ...env },
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  return { stdout, stderr, exitCode };
}

/** The --json contract, asserted the same way everywhere: stdout is EXACTLY
 * one parseable object. `JSON.parse` alone would accept a leading log line in
 * some shapes, so the line count is asserted too. */
function soleJson(stdout: string): any {
  const lines = stdout.trim().split('\n');
  expect(lines).toHaveLength(1);
  return JSON.parse(lines[0]);
}

describe('screepub devices', () => {
  test('--json reports the injected device and exits 0', async () => {
    const { stdout, exitCode } = await runCli(['devices', '--json'], {
      SCREEPUB_VOLUME_ROOTS: mountRootWithKobo(),
    });
    expect(exitCode).toBe(0);
    const result = soleJson(stdout);
    expect(result.ok).toBe(true);
    expect(result.devices).toHaveLength(1);
    expect(result.devices[0].kind).toBe('kobo');
    expect(result.devices[0].name).toBe('KOBOeReader');
    expect(result.devices[0].id).toBe(result.devices[0].volume);
    expect(result.devices[0].volume).toMatch(/KOBOeReader$/);
  });

  test('nothing connected is ok:true with an empty list and exit 0', async () => {
    const { stdout, exitCode } = await runCli(['devices', '--json'], {
      SCREEPUB_VOLUME_ROOTS: mkdtempSync(join(tmpdir(), 'screepub-empty-')),
    });
    // An empty list is an answer, not an error: an implementation that
    // reported no-devices here (as `send` correctly does) fails on BOTH.
    expect(exitCode).toBe(0);
    expect(soleJson(stdout)).toEqual({ ok: true, devices: [] });
  });

  test('human output is one line per device on stdout', async () => {
    const { stdout, exitCode } = await runCli(['devices'], {
      SCREEPUB_VOLUME_ROOTS: mountRootWithKobo(),
    });
    expect(exitCode).toBe(0);
    expect(stdout.trim().split('\n')).toHaveLength(1);
    expect(stdout).toContain('KOBOeReader');
    expect(stdout).toContain('kobo');
  });

  test('human output says so when nothing is connected', async () => {
    const { stdout, exitCode } = await runCli(['devices'], {
      SCREEPUB_VOLUME_ROOTS: mkdtempSync(join(tmpdir(), 'screepub-empty-')),
    });
    expect(exitCode).toBe(0);
    expect(stdout.trim()).toBe('no devices connected');
  });

  test('an unknown flag on devices --json is still one JSON object', async () => {
    // The pre-scan case: parseArgs throws before it could report the mode.
    const { stdout, exitCode } = await runCli(['devices', '--json', '--no-such-flag']);
    expect(exitCode).toBe(1);
    const result = soleJson(stdout);
    expect(result.ok).toBe(false);
    expect(result.error.code).toBe('usage');
  });

  test('devices takes no positional argument', async () => {
    const { stdout, exitCode } = await runCli(['devices', 'extra', '--json']);
    expect(exitCode).toBe(1);
    expect(soleJson(stdout).error.code).toBe('usage');
  });

  test('a real reMarkable stub appears in the listing', async () => {
    const answering = Bun.serve({ port: 0, fetch: () => new Response('[]', { status: 200 }) });
    const { stdout } = await runCli(['devices', '--json'], {
      SCREEPUB_VOLUME_ROOTS: mkdtempSync(join(tmpdir(), 'screepub-empty-')),
      SCREEPUB_REMARKABLE_ENDPOINT: `http://127.0.0.1:${answering.port}`,
    });
    answering.stop(true);
    expect(soleJson(stdout).devices).toEqual([
      { id: 'remarkable', kind: 'remarkable', name: 'reMarkable', volume: null },
    ]);
  });
});

function kindleRoot(): { root: string; volume: string } {
  const root = mkdtempSync(join(tmpdir(), 'screepub-mounts-'));
  const volume = join(root, 'Kindle');
  mkdirSync(join(volume, 'documents'), { recursive: true });
  return { root, volume };
}

function book(name = 'Script.epub'): string {
  const path = join(mkdtempSync(join(tmpdir(), 'screepub-book-')), name);
  writeFileSync(path, 'book-bytes');
  return path;
}

describe('screepub send', () => {
  test('--json reports the device and the destination, and the bytes moved', async () => {
    const { root, volume } = kindleRoot();
    const file = book();
    const { stdout, exitCode } = await runCli(['send', file, '--json'], {
      SCREEPUB_VOLUME_ROOTS: root,
    });
    expect(exitCode).toBe(0);
    const result = soleJson(stdout);
    expect(result.ok).toBe(true);
    expect(result.device).toEqual({ id: volume, kind: 'kindle', name: 'Kindle' });
    expect(result.destination).toBe(join(volume, 'documents', 'Script.epub'));
    expect(readFileSync(result.destination, 'utf8')).toBe('book-bytes');
  });

  test('a reMarkable send reports uploaded:true and NO destination key', async () => {
    const posted: string[] = [];
    const tablet = Bun.serve({
      port: 0,
      async fetch(req) {
        if (req.method === 'POST') { posted.push(new URL(req.url).pathname); await req.arrayBuffer(); }
        return new Response('[]', { status: 200 });
      },
    });
    const { stdout, exitCode } = await runCli(['send', book(), '--json'], {
      SCREEPUB_VOLUME_ROOTS: mkdtempSync(join(tmpdir(), 'screepub-empty-')),
      SCREEPUB_REMARKABLE_ENDPOINT: `http://127.0.0.1:${tablet.port}`,
    });
    tablet.stop(true);
    expect(exitCode).toBe(0);
    const result = soleJson(stdout);
    expect(result.uploaded).toBe(true);
    // The key must be ABSENT, not null: the spec says the field is omitted.
    // `expect(result.destination).toBeUndefined()` would also pass on null.
    expect('destination' in result).toBe(false);
    expect(posted).toEqual(['/upload']);
  });

  test('--device picks one of several, and the others are untouched', async () => {
    const root = mkdtempSync(join(tmpdir(), 'screepub-mounts-'));
    const kindle = join(root, 'Kindle');
    const kobo = join(root, 'KOBOeReader');
    mkdirSync(join(kindle, 'documents'), { recursive: true });
    mkdirSync(join(kobo, '.kobo'), { recursive: true });
    const { stdout, exitCode } = await runCli(['send', book(), '--device', kobo, '--json'], {
      SCREEPUB_VOLUME_ROOTS: root,
    });
    expect(exitCode).toBe(0);
    const result = soleJson(stdout);
    expect(result.device.kind).toBe('kobo');
    expect(result.destination).toBe(join(kobo, 'Script.epub'));
    // Two devices were connected: an implementation that ignored --device and
    // took the first would have written into the Kindle instead.
    expect(readFileSync(join(kobo, 'Script.epub'), 'utf8')).toBe('book-bytes');
  });

  test('several connected and no --device is ambiguous-device, naming both', async () => {
    const root = mkdtempSync(join(tmpdir(), 'screepub-mounts-'));
    const kindle = join(root, 'Kindle');
    const kobo = join(root, 'KOBOeReader');
    mkdirSync(join(kindle, 'documents'), { recursive: true });
    mkdirSync(join(kobo, '.kobo'), { recursive: true });
    const { stdout, exitCode } = await runCli(['send', book(), '--json'], {
      SCREEPUB_VOLUME_ROOTS: root,
    });
    expect(exitCode).toBe(1);
    const result = soleJson(stdout);
    expect(result.error.code).toBe('ambiguous-device');
    expect(result.error.message).toContain(kindle);
    expect(result.error.message).toContain(kobo);
  });

  test('nothing connected is no-devices', async () => {
    const { stdout, exitCode } = await runCli(['send', book(), '--json'], {
      SCREEPUB_VOLUME_ROOTS: mkdtempSync(join(tmpdir(), 'screepub-empty-')),
    });
    expect(exitCode).toBe(1);
    expect(soleJson(stdout).error.code).toBe('no-devices');
  });

  test('an id nothing matches is unknown-device', async () => {
    const { root } = kindleRoot();
    const { stdout, exitCode } = await runCli(['send', book(), '--device', '/nope', '--json'], {
      SCREEPUB_VOLUME_ROOTS: root,
    });
    expect(exitCode).toBe(1);
    expect(soleJson(stdout).error.code).toBe('unknown-device');
  });

  test('an extension reMarkable cannot read is unsupported-file', async () => {
    const tablet = Bun.serve({ port: 0, fetch: () => new Response('[]', { status: 200 }) });
    const { stdout, exitCode } = await runCli(['send', book('Script.azw3'), '--json'], {
      SCREEPUB_VOLUME_ROOTS: mkdtempSync(join(tmpdir(), 'screepub-empty-')),
      SCREEPUB_REMARKABLE_ENDPOINT: `http://127.0.0.1:${tablet.port}`,
    });
    tablet.stop(true);
    expect(exitCode).toBe(1);
    expect(soleJson(stdout).error.code).toBe('unsupported-file');
  });

  test('a tablet that refuses the upload is send-failed', async () => {
    const refusing = Bun.serve({
      port: 0,
      fetch: (req) => new Response('[]', { status: req.method === 'POST' ? 500 : 200 }),
    });
    const { stdout, exitCode } = await runCli(['send', book(), '--json'], {
      SCREEPUB_VOLUME_ROOTS: mkdtempSync(join(tmpdir(), 'screepub-empty-')),
      SCREEPUB_REMARKABLE_ENDPOINT: `http://127.0.0.1:${refusing.port}`,
    });
    refusing.stop(true);
    expect(exitCode).toBe(1);
    expect(soleJson(stdout).error.code).toBe('send-failed');
  });

  test('no file argument is a usage error', async () => {
    const { stdout, exitCode } = await runCli(['send', '--json']);
    expect(exitCode).toBe(1);
    expect(soleJson(stdout).error.code).toBe('usage');
  });

  test('a file that is not there is unreadable', async () => {
    const { stdout, exitCode } = await runCli(['send', join(SCRATCH, 'ghost.epub'), '--json'], {
      SCREEPUB_VOLUME_ROOTS: mkdtempSync(join(tmpdir(), 'screepub-empty-')),
    });
    expect(exitCode).toBe(1);
    // Not no-devices: the file is checked before the device list is built.
    expect(soleJson(stdout).error.code).toBe('unreadable');
  });

  test('human output names the device and the destination', async () => {
    const { root, volume } = kindleRoot();
    const { stdout, exitCode } = await runCli(['send', book()], { SCREEPUB_VOLUME_ROOTS: root });
    expect(exitCode).toBe(0);
    expect(stdout).toContain('Kindle');
    expect(stdout).toContain(join(volume, 'documents', 'Script.epub'));
  });
});
