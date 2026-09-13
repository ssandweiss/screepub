import { test, expect, afterAll } from 'bun:test';
import { mkdirSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { listDevices } from '../src/device/list';
import type { ConnectedDevice } from '../src/device/types';

/** A mount parent holding one Kobo, built in a temp dir. No real mount is
 * ever read: the root is injected, exactly as piece A's enumerateVolumes
 * allows. */
function mountRootWithKobo(): string {
  const root = mkdtempSync(join(tmpdir(), 'screepub-mounts-'));
  mkdirSync(join(root, 'KOBOeReader', '.kobo'), { recursive: true });
  return root;
}

function stub(status: number) {
  const server = Bun.serve({ port: 0, fetch: () => new Response('[]', { status }) });
  return { url: `http://127.0.0.1:${server.port}`, stop: () => server.stop(true) };
}

const answering = stub(200);
const silent = stub(404);
afterAll(() => {
  answering.stop();
  silent.stop();
});

test('mounted vendors are listed when the tablet does not answer', async () => {
  const devices = await listDevices({
    roots: [mountRootWithKobo()],
    remarkableEndpoint: silent.url,
  });
  expect(devices.map((d) => d.kind)).toEqual(['kobo']);
  expect(devices[0].volume).toMatch(/KOBOeReader$/);
});

test('a reMarkable that answers is appended after the mounted devices', async () => {
  const devices = await listDevices({
    roots: [mountRootWithKobo()],
    remarkableEndpoint: answering.url,
  });
  // Order is asserted with a mounted device PRESENT, so an implementation
  // that prepended the tablet fails rather than passing on an empty list.
  expect(devices.map((d) => d.kind)).toEqual(['kobo', 'remarkable']);
  const rm = devices[1];
  expect(rm.volume).toBeNull();
  expect(rm.name).toBe('reMarkable');
});

test('nothing connected is an empty list, not an error', async () => {
  const empty = mkdtempSync(join(tmpdir(), 'screepub-mounts-'));
  expect(await listDevices({ roots: [empty], remarkableEndpoint: silent.url })).toEqual([]);
});

test('the mount scan and the probe run concurrently, not one after the other', async () => {
  const slow = <T>(value: T, ms: number) =>
    new Promise<T>((resolve) => setTimeout(() => resolve(value), ms));
  const started = Date.now();
  const devices = await listDevices({
    scan: () => slow<ConnectedDevice[]>([{ kind: 'kindle', name: 'Kindle', volume: '/v/Kindle' }], 200),
    probe: () => slow(true, 200),
  });
  const elapsed = Date.now() - started;
  expect(devices.map((d) => d.kind)).toEqual(['kindle', 'remarkable']);
  // Sequential (`await scan(); await probe()`) takes ~400ms and fails here;
  // Promise.all takes ~200ms. This is the spec's "wall-clock is the probe's
  // timeout rather than the sum" made into an assertion.
  expect(elapsed).toBeLessThan(350);
});

test('a probe that throws is a tablet that is not there, not a crash', async () => {
  const devices = await listDevices({
    scan: () => [],
    probe: () => Promise.reject(new Error('ECONNREFUSED')),
  });
  expect(devices).toEqual([]);
});
