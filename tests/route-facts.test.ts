// The probes behind the route catalog: what is actually on this machine,
// each one injectable so no test here ever touches the real machine's state
// (see docs/superpowers/plans/2026-09-23-send-routes-engine.md Task 3 and
// its ground rules). Every routeFacts() call below injects devices, exists
// and mailtoHandler explicitly; the two darwin-only probes are also checked
// for zero calls off darwin.
import { describe, expect, test } from 'bun:test';
import type { ConnectedDevice } from '../src/device/types';
import { parseMailtoHandler, routeFacts, type RouteProbes } from '../src/export/route-facts';

const kindle: ConnectedDevice = { kind: 'kindle', name: 'Kindle', volume: '/Volumes/Kindle' };

/** Every probe stubbed to something harmless and darwin-flavoured; each test
 * overrides just the probe it is about. */
function baseProbes(): RouteProbes {
  return {
    platform: 'darwin',
    devices: async () => [],
    exists: () => false,
    mailtoHandler: async () => null,
  };
}

describe('parseMailtoHandler', () => {
  test('the exact shape measured on the owner\'s Mac (2026-09-23): the top-level LSHandlerRoleAll, not the one nested inside LSHandlerPreferredVersions', () => {
    const output = `(
    {
        LSHandlerContentType = "public.svg-image";
        LSHandlerPreferredVersions =         {
            LSHandlerRoleAll = "-";
        };
        LSHandlerRoleAll = "com.google.Chrome";
    },
    {
        LSHandlerModificationDate = 727881812;
        LSHandlerPreferredVersions =         {
            LSHandlerRoleAll = "-";
        };
        LSHandlerRoleAll = "com.superhuman.electron";
        LSHandlerURLScheme = mailto;
    },
    {
        LSHandlerContentType = "public.plain-text";
        LSHandlerRoleAll = "com.apple.TextEdit";
    }
)`;
    expect(parseMailtoHandler(output)).toBe('com.superhuman.electron');
  });

  test('a bare (unquoted) value on both sides', () => {
    const output = `(
    {
        LSHandlerRoleAll = com.apple.mail;
        LSHandlerURLScheme = mailto;
    }
)`;
    expect(parseMailtoHandler(output)).toBe('com.apple.mail');
  });

  test('no mailto dict at all reads as null', () => {
    const output = `(
    {
        LSHandlerContentType = "public.plain-text";
        LSHandlerRoleAll = "com.apple.TextEdit";
    },
    {
        LSHandlerContentType = "public.svg-image";
        LSHandlerRoleAll = "com.google.Chrome";
    }
)`;
    expect(parseMailtoHandler(output)).toBeNull();
  });

  test('garbage input reads as null, not a throw', () => {
    expect(parseMailtoHandler('not a plist at all {{{ broken )')).toBeNull();
    expect(parseMailtoHandler('')).toBeNull();
  });
});

describe('routeFacts: booksApp', () => {
  test('true when Books.app exists at the System Applications path', async () => {
    const facts = await routeFacts({
      ...baseProbes(),
      exists: (p) => p === '/System/Applications/Books.app',
    });
    expect(facts.booksApp).toBe(true);
  });

  test('true when Books.app exists at the Applications path', async () => {
    const facts = await routeFacts({
      ...baseProbes(),
      exists: (p) => p === '/Applications/Books.app',
    });
    expect(facts.booksApp).toBe(true);
  });

  test('false when Books.app exists at neither path', async () => {
    const facts = await routeFacts({ ...baseProbes(), exists: () => false });
    expect(facts.booksApp).toBe(false);
  });
});

describe('routeFacts: sendToKindleApp', () => {
  test('true when Send to Kindle.app exists', async () => {
    const facts = await routeFacts({
      ...baseProbes(),
      exists: (p) => p === '/Applications/Send to Kindle.app',
    });
    expect(facts.sendToKindleApp).toBe(true);
  });

  test('false when it does not exist', async () => {
    const facts = await routeFacts({ ...baseProbes(), exists: () => false });
    expect(facts.sendToKindleApp).toBe(false);
  });
});

describe('routeFacts: appleMailDefault', () => {
  test('true when there is no mailto entry: the system default is Apple Mail', async () => {
    const facts = await routeFacts({ ...baseProbes(), mailtoHandler: async () => null });
    expect(facts.appleMailDefault).toBe(true);
  });

  test('true for com.apple.mail', async () => {
    const facts = await routeFacts({ ...baseProbes(), mailtoHandler: async () => 'com.apple.mail' });
    expect(facts.appleMailDefault).toBe(true);
  });

  test('true for COM.APPLE.MAIL, case-insensitively', async () => {
    const facts = await routeFacts({ ...baseProbes(), mailtoHandler: async () => 'COM.APPLE.MAIL' });
    expect(facts.appleMailDefault).toBe(true);
  });

  test('false for a third-party handler (superhuman)', async () => {
    const facts = await routeFacts({
      ...baseProbes(),
      mailtoHandler: async () => 'com.superhuman.electron',
    });
    expect(facts.appleMailDefault).toBe(false);
  });

  test('false when the handler could not be read: a failure never reads as Apple Mail', async () => {
    const facts = await routeFacts({ ...baseProbes(), mailtoHandler: async () => undefined });
    expect(facts.appleMailDefault).toBe(false);
  });
});

describe('routeFacts: off darwin', () => {
  for (const platform of ['win32', 'linux'] as const) {
    test(`${platform}: booksApp, sendToKindleApp and appleMailDefault are all false however the probes would answer`, async () => {
      const facts = await routeFacts({
        ...baseProbes(),
        platform,
        exists: () => true,
        mailtoHandler: async () => 'com.apple.mail',
      });
      expect(facts.booksApp).toBe(false);
      expect(facts.sendToKindleApp).toBe(false);
      expect(facts.appleMailDefault).toBe(false);
    });

    test(`${platform}: the exists and mailtoHandler probes are never called`, async () => {
      let existsCalls = 0;
      let mailtoCalls = 0;
      await routeFacts({
        ...baseProbes(),
        platform,
        exists: () => {
          existsCalls++;
          return true;
        },
        mailtoHandler: async () => {
          mailtoCalls++;
          return null;
        },
      });
      expect(existsCalls).toBe(0);
      expect(mailtoCalls).toBe(0);
    });
  }
});

describe('routeFacts: devices', () => {
  for (const platform of ['darwin', 'win32', 'linux'] as const) {
    test(`${platform}: the devices probe always runs and its result is carried through`, async () => {
      let called = false;
      const facts = await routeFacts({
        ...baseProbes(),
        platform,
        devices: async () => {
          called = true;
          return [kindle];
        },
      });
      expect(called).toBe(true);
      expect(facts.devices).toEqual([kindle]);
    });
  }

  test('with no devices probe injected, the default wires to listDevices with the given deviceOptions', async () => {
    // roots: [] scans nothing (no real /Volumes read) and the closed local
    // port fails the reMarkable probe immediately, so this never touches the
    // real machine and never waits out a timeout.
    const facts = await routeFacts(
      { platform: 'linux', exists: () => false, mailtoHandler: async () => null },
      { roots: [], remarkableEndpoint: 'http://127.0.0.1:9' },
    );
    expect(facts.devices).toEqual([]);
  });
});

describe('routeFacts: platform', () => {
  test('defaults to process.platform when not given', async () => {
    const facts = await routeFacts({
      devices: async () => [],
      exists: () => false,
      mailtoHandler: async () => null,
    });
    expect(facts.platform).toBe(process.platform);
  });
});
