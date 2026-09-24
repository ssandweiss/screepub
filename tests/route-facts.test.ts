// The probes behind the route catalog: what is actually on this machine,
// each one injectable so no test here ever touches the real machine's state
// (see docs/superpowers/plans/2026-09-23-send-routes-engine.md Task 3 and
// its ground rules). Every routeFacts() call below injects devices, exists
// and either mailtoHandler or the runner the real mail probe spawns through;
// the darwin-only probes are also checked for zero calls off darwin.
import { describe, expect, test } from 'bun:test';
import { homedir } from 'node:os';
import type { ConnectedDevice } from '../src/device/types';
import {
  parseMailtoHandler,
  routeFacts,
  type CommandResult,
  type CommandRunner,
  type RouteProbes,
} from '../src/export/route-facts';

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

  test("true when it is in the home folder's Applications (an install without admin rights)", async () => {
    const asked: string[] = [];
    const facts = await routeFacts({
      ...baseProbes(),
      env: { HOME: '/Users/tester' },
      exists: (p) => {
        asked.push(p);
        return p === '/Users/tester/Applications/Send to Kindle.app';
      },
    });
    expect(facts.sendToKindleApp).toBe(true);
    expect(asked).toContain('/Applications/Send to Kindle.app');
  });

  test('the home folder comes from HOME, then USERPROFILE, then the OS, as the settings file finds it', async () => {
    const sendToKindleIn = async (env: Record<string, string | undefined>, home: string) =>
      (await routeFacts({
        ...baseProbes(),
        env,
        exists: (p) => p === `${home}/Applications/Send to Kindle.app`,
      })).sendToKindleApp;
    expect(await sendToKindleIn({ HOME: '/Users/a', USERPROFILE: '/Users/b' }, '/Users/a')).toBe(true);
    expect(await sendToKindleIn({ USERPROFILE: '/Users/b' }, '/Users/b')).toBe(true);
    expect(await sendToKindleIn({}, homedir())).toBe(true);
    // Only a home folder's Applications counts, never some other user's.
    expect(await sendToKindleIn({ HOME: '/Users/a' }, '/Users/b')).toBe(false);
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

describe('routeFacts: the real mail probe, through its runner', () => {
  // The default mailtoHandler, driven with a fake runner in place of
  // Bun.spawn, so nothing here runs `defaults` or reads this Mac's handler.
  // What `defaults` really prints when the key is absent (measured
  // 2026-09-23 with a key that does not exist): exit 1, and on stderr a
  // timestamp line then this.
  const ABSENT =
    '2026-09-23 18:07:32.137 defaults[94708:26435202] \n'
    + 'The domain/default pair of (com.apple.LaunchServices/com.apple.launchservices.secure, LSHandlers) does not exist\n';
  const SUPERHUMAN = `(
    {
        LSHandlerPreferredVersions =         {
            LSHandlerRoleAll = "-";
        };
        LSHandlerRoleAll = "com.superhuman.electron";
        LSHandlerURLScheme = mailto;
    }
)`;
  const NO_MAILTO = `(
    {
        LSHandlerContentType = "public.plain-text";
        LSHandlerRoleAll = "com.apple.TextEdit";
    }
)`;

  /** baseProbes() with its mailtoHandler taken away, so the default runs,
   *  and a runner that records every argv and answers `result`. */
  function viaRunner(result: CommandResult | (() => Promise<CommandResult>)) {
    const { mailtoHandler: _dropped, ...probes } = baseProbes();
    const argvs: string[][] = [];
    const run: CommandRunner = async (argv) => {
      argvs.push(argv);
      return typeof result === 'function' ? result() : result;
    };
    return { probes: { ...probes, run }, argvs };
  }

  test('asks Launch Services, exactly once, for LSHandlers', async () => {
    const { probes, argvs } = viaRunner({ code: 0, stdout: NO_MAILTO, stderr: '' });
    await routeFacts(probes);
    expect(argvs).toEqual([
      ['defaults', 'read', 'com.apple.LaunchServices/com.apple.launchservices.secure', 'LSHandlers'],
    ]);
  });

  test('exit 1 saying the key does not exist is a Mac where nobody changed a default app: Apple Mail', async () => {
    const { probes } = viaRunner({ code: 1, stdout: '', stderr: ABSENT });
    expect((await routeFacts(probes)).appleMailDefault).toBe(true);
  });

  test('the same words on stdout count too', async () => {
    const { probes } = viaRunner({ code: 1, stdout: ABSENT, stderr: '' });
    expect((await routeFacts(probes)).appleMailDefault).toBe(true);
  });

  test('any other failure could not tell, which is never Apple Mail', async () => {
    for (const stderr of ['', 'Could not open the preferences database\n', 'permission denied\n']) {
      const { probes } = viaRunner({ code: 1, stdout: '', stderr });
      expect(`${JSON.stringify(stderr)}: ${(await routeFacts(probes)).appleMailDefault}`).toBe(
        `${JSON.stringify(stderr)}: false`,
      );
    }
  });

  test('a runner that throws (no `defaults` at all) could not tell either', async () => {
    const { probes } = viaRunner(async () => {
      throw new Error('spawn defaults ENOENT');
    });
    expect((await routeFacts(probes)).appleMailDefault).toBe(false);
  });

  test('exit 0 naming another mail app is not Apple Mail', async () => {
    const { probes } = viaRunner({ code: 0, stdout: SUPERHUMAN, stderr: '' });
    expect((await routeFacts(probes)).appleMailDefault).toBe(false);
  });

  test('exit 0 with no mailto entry is the system default: Apple Mail', async () => {
    const { probes } = viaRunner({ code: 0, stdout: NO_MAILTO, stderr: '' });
    expect((await routeFacts(probes)).appleMailDefault).toBe(true);
  });

  test('exit 0 is read from stdout even when stderr happens to say "does not exist"', async () => {
    const { probes } = viaRunner({ code: 0, stdout: SUPERHUMAN, stderr: ABSENT });
    expect((await routeFacts(probes)).appleMailDefault).toBe(false);
  });

  test('off darwin the runner is never called', async () => {
    for (const platform of ['win32', 'linux']) {
      const { probes, argvs } = viaRunner({ code: 1, stdout: '', stderr: ABSENT });
      await routeFacts({ ...probes, platform });
      expect(argvs).toEqual([]);
    }
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
