import { describe, test, expect } from 'bun:test';
import {
  soleJson,
  checkVersion,
  checkConvertResult,
  checkEpubBytes,
  checkDevices,
} from '../tools/smoke-cli';

const ok = (stdout: string) => ({ exitCode: 0, stdout, stderr: '' });

describe('soleJson', () => {
  test('accepts exactly one JSON object', () => {
    expect(soleJson('{"ok":true}\n', 'x')).toEqual({ ok: true });
  });

  test('rejects two objects, which is the --json contract breaking', () => {
    // The contract is ONE parseable object on stdout. Two would parse fine
    // if a checker only looked at the first line.
    expect(() => soleJson('{"ok":true}\n{"ok":false}\n', 'convert')).toThrow(/2 lines/);
  });

  test('rejects empty output and non-JSON', () => {
    expect(() => soleJson('', 'convert')).toThrow(/0 lines/);
    expect(() => soleJson('converting...\n', 'convert')).toThrow(/parseable JSON/);
  });
});

describe('checkVersion', () => {
  test('passes only on the exact expected line', () => {
    expect(() => checkVersion(ok('screepub 0.6.0\n'), '0.6.0')).not.toThrow();
  });

  test('a stale binary reporting the old version fails', () => {
    // The failure this exists for: an artifact built from a checkout that
    // was not the tagged one.
    expect(() => checkVersion(ok('screepub 0.5.4\n'), '0.6.0')).toThrow(/0\.5\.4/);
    // And a substring match must not save it.
    expect(() => checkVersion(ok('screepub 0.6.0-dirty\n'), '0.6.0')).toThrow();
    expect(() => checkVersion({ exitCode: 1, stdout: '', stderr: 'boom' }, '0.6.0')).toThrow(/exited 1/);
  });
});

describe('checkConvertResult', () => {
  const good = ok('{"ok":true,"epubPath":"/tmp/smoke.epub","pages":97}\n');

  test('passes on a real success payload', () => {
    expect(() => checkConvertResult(good, '/tmp/smoke.epub')).not.toThrow();
  });

  test('a reported failure fails, even at exit 0', () => {
    const failed = ok('{"ok":false,"error":{"code":"not-screenplay","message":"x"}}\n');
    expect(() => checkConvertResult(failed, '/tmp/smoke.epub')).toThrow(/not-screenplay/);
  });

  test('zero pages fails: an empty book is not a conversion', () => {
    const empty = ok('{"ok":true,"epubPath":"/tmp/smoke.epub","pages":0}\n');
    expect(() => checkConvertResult(empty, '/tmp/smoke.epub')).toThrow(/pages/);
    const none = ok('{"ok":true,"epubPath":"/tmp/smoke.epub"}\n');
    expect(() => checkConvertResult(none, '/tmp/smoke.epub')).toThrow(/pages/);
  });

  test('writing somewhere other than where we asked fails', () => {
    expect(() => checkConvertResult(good, '/tmp/other.epub')).toThrow(/other\.epub/);
  });

  test('a non-zero exit fails and carries stderr', () => {
    const crashed = { exitCode: 134, stdout: '', stderr: 'Segmentation fault' };
    expect(() => checkConvertResult(crashed, '/tmp/smoke.epub')).toThrow(/134/);
    expect(() => checkConvertResult(crashed, '/tmp/smoke.epub')).toThrow(/Segmentation/);
  });
});

describe('checkEpubBytes', () => {
  test('an EPUB is a zip container', () => {
    expect(() => checkEpubBytes(new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0x14]))).not.toThrow();
  });

  test('a 0-byte or non-zip output fails', () => {
    // The CLI can report success and still have written nothing usable.
    expect(() => checkEpubBytes(new Uint8Array(0))).toThrow();
    expect(() => checkEpubBytes(new TextEncoder().encode('<html>'))).toThrow();
  });
});

describe('checkDevices', () => {
  test('an empty device list is a pass: the command ran', () => {
    expect(() => checkDevices(ok('{"ok":true,"devices":[]}\n'))).not.toThrow();
    expect(() => checkDevices(ok('{"ok":true,"devices":[{"id":"kindle"}]}\n'))).not.toThrow();
  });

  test('a missing array, a reported failure, or a crash all fail', () => {
    expect(() => checkDevices(ok('{"ok":true}\n'))).toThrow(/devices/);
    expect(() => checkDevices(ok('{"ok":false,"error":{"code":"internal"}}\n'))).toThrow(/internal/);
    expect(() => checkDevices({ exitCode: 1, stdout: '', stderr: 'no' })).toThrow(/exited 1/);
  });
});
