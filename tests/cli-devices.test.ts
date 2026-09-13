import { test, expect } from 'bun:test';
import { CliError } from '../src/cli-errors';

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
