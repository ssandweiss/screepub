import { test, expect } from 'bun:test';
import { CliError } from '../src/cli-errors';
import { resolveCommand, VERBS } from '../src/cli-devices';

test('CliError carries a contract code and renders the exact JSON error shape', () => {
  const err = new CliError('ambiguous-device', 'several devices are connected: a, b');
  expect(err).toBeInstanceOf(Error);
  expect(err.name).toBe('CliError');
  expect(err.code).toBe('ambiguous-device');
  expect(err.message).toBe('several devices are connected: a, b');
  // The JSON body is exactly two keys — the app decodes {code, message} and
  // nothing else. An implementation that spread the Error (picking up `name`,
  // or nothing at all, since Error fields are non-enumerable) fails here.
  expect(err.toJson()).toEqual({ code: 'ambiguous-device', message: 'several devices are connected: a, b' });
  expect(Object.keys(err.toJson()).sort()).toEqual(['code', 'message']);
});

const noFiles = () => false;
const onlyDevicesFile = (path: string) => path === 'devices';

test('the bare verb dispatches when no file of that name exists', () => {
  expect(resolveCommand(['devices'], noFiles)).toEqual({ kind: 'verb', verb: 'devices', args: [] });
  expect(resolveCommand(['devices', '--json'], noFiles)).toEqual({
    kind: 'verb', verb: 'devices', args: ['--json'],
  });
  expect(resolveCommand(['send', 'Script.epub', '--device', 'x'], noFiles)).toEqual({
    kind: 'verb', verb: 'send', args: ['Script.epub', '--device', 'x'],
  });
});

test('a file literally named `devices` beats the verb', () => {
  // The other direction of the same rule. Without the exists() check this
  // passes as a verb and the file becomes silently unconvertible; without the
  // verb branch at all, the test above fails. Neither half is provable alone.
  expect(resolveCommand(['devices'], onlyDevicesFile)).toEqual({ kind: 'convert' });
  expect(resolveCommand(['devices', '--json'], onlyDevicesFile)).toEqual({ kind: 'convert' });
});

test('an explicit path is never a verb, even with no such file', () => {
  // Catches an implementation that strips ./ or compares basenames: `./devices`
  // is how the user disambiguates when a verb would otherwise win.
  expect(resolveCommand(['./devices'], noFiles)).toEqual({ kind: 'convert' });
  expect(resolveCommand(['devices.pdf'], noFiles)).toEqual({ kind: 'convert' });
  expect(resolveCommand(['/tmp/send'], noFiles)).toEqual({ kind: 'convert' });
});

test('only the first argument can be a verb', () => {
  // Catches an implementation that scans argv for any known verb: a script
  // named devices.pdf sent with --title devices must still convert.
  expect(resolveCommand(['--json', 'devices'], noFiles)).toEqual({ kind: 'convert' });
  expect(resolveCommand(['Script.pdf', '--title', 'send'], noFiles)).toEqual({ kind: 'convert' });
});

test('unknown words and an empty argv are the default path', () => {
  expect(resolveCommand(['frobnicate'], noFiles)).toEqual({ kind: 'convert' });
  expect(resolveCommand([], noFiles)).toEqual({ kind: 'convert' });
  expect(resolveCommand(['--help'], noFiles)).toEqual({ kind: 'convert' });
});

test('VERBS is the single list of known verbs', () => {
  expect([...VERBS]).toEqual(['devices', 'send']);
});

import { devicesCommand } from '../src/cli-devices';
import type { ConnectedDevice } from '../src/device/types';

const kobo: ConnectedDevice = { kind: 'kobo', name: 'KOBOeReader', volume: '/run/media/sam/KOBOeReader' };

test('devicesCommand reports each device with the id send accepts', async () => {
  const { devices } = await devicesCommand({ scan: () => [kobo], probe: async () => true });
  expect(devices).toEqual([
    { id: '/run/media/sam/KOBOeReader', kind: 'kobo', name: 'KOBOeReader', volume: '/run/media/sam/KOBOeReader' },
    { id: 'remarkable', kind: 'remarkable', name: 'reMarkable', volume: null },
  ]);
});

test('devicesCommand on an empty list is an empty array, not a throw', async () => {
  const { devices } = await devicesCommand({ scan: () => [], probe: async () => false });
  expect(devices).toEqual([]);
});

import { selectDevice } from '../src/cli-devices';

const kindle: ConnectedDevice = { kind: 'kindle', name: 'Kindle', volume: '/run/media/sam/Kindle' };
const remarkable: ConnectedDevice = { kind: 'remarkable', name: 'reMarkable', volume: null };

test('one device connected and no --device picks it', () => {
  expect(selectDevice([kobo])).toBe(kobo);
});

test('an explicit id picks that device even when several are connected', () => {
  // Ordering test: "ambiguous when >1" and "honour --device first" disagree
  // on exactly this input. An implementation that checks the count before the
  // id throws ambiguous-device here.
  expect(selectDevice([kobo, kindle], '/run/media/sam/Kindle')).toBe(kindle);
  expect(selectDevice([kobo, kindle, remarkable], 'remarkable')).toBe(remarkable);
});

test('several connected and no --device is ambiguous-device, listing the ids', () => {
  let thrown: unknown;
  try { selectDevice([kobo, kindle]); } catch (err) { thrown = err; }
  expect(thrown).toBeInstanceOf(CliError);
  expect((thrown as CliError).code).toBe('ambiguous-device');
  // The message must name both, or the user has no way to pick one.
  expect((thrown as CliError).message).toContain('/run/media/sam/KOBOeReader');
  expect((thrown as CliError).message).toContain('/run/media/sam/Kindle');
});

test('nothing connected is no-devices even when --device was given', () => {
  // Ordering test: both no-devices and unknown-device describe this input.
  // The plan's rule is that the empty list wins, because "nothing is plugged
  // in" is the actionable fact. An implementation that checks the requested
  // id first reports unknown-device and fails here.
  let thrown: unknown;
  try { selectDevice([], '/run/media/sam/Kindle'); } catch (err) { thrown = err; }
  expect(thrown).toBeInstanceOf(CliError);
  expect((thrown as CliError).code).toBe('no-devices');
});

test('nothing connected and no --device is also no-devices', () => {
  let thrown: unknown;
  try { selectDevice([]); } catch (err) { thrown = err; }
  expect((thrown as CliError).code).toBe('no-devices');
});

test('an id that matches nothing connected is unknown-device, listing what is', () => {
  let thrown: unknown;
  try { selectDevice([kobo, kindle], '/run/media/sam/Nope'); } catch (err) { thrown = err; }
  expect(thrown).toBeInstanceOf(CliError);
  expect((thrown as CliError).code).toBe('unknown-device');
  expect((thrown as CliError).message).toContain('/run/media/sam/Nope');
  expect((thrown as CliError).message).toContain('/run/media/sam/KOBOeReader');
});

test('selection matches on the id, never on a prefix or the name', () => {
  // Catches `deviceId(d).includes(requested)` and `d.name === requested`.
  let thrown: unknown;
  try { selectDevice([kindle], '/run/media/sam'); } catch (err) { thrown = err; }
  expect((thrown as CliError).code).toBe('unknown-device');
  let byName: unknown;
  try { selectDevice([kindle], 'Kindle'); } catch (err) { byName = err; }
  expect((byName as CliError).code).toBe('unknown-device');
});
