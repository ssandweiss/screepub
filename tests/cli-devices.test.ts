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
