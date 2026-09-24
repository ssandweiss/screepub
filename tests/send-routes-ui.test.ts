// The Send page's route decisions (parity piece B, window plan Task W2):
// the pure functions above send.js's drawing line that turn the engine's
// `routes --json` answer into rows, buttons, save-dialog defaults and status
// lines.
//
// Its own file rather than a block in desktop-ui.test.ts only so parallel
// work on that file cannot collide with this one; the style is that file's
// "what the Send surface decides" block, and send.js is imported the same
// dynamic way.
//
// The test that matters most is the round trip: the validator is checked
// against the ENGINE's real catalog (src/export/routes.ts) for every fact
// combination worth naming, so a validator stricter than the engine (the
// dangerous direction: the whole Send page would show a failure line
// instead of routes) cannot pass on hand-written fixtures alone.
import { afterEach, beforeAll, describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import type { ConnectedDevice } from '../src/device/types';
import { preselected, routes, type Route, type RouteFacts } from '../src/export/routes';
import { kfxSetup } from '../src/export/kfx-setup';

const UI = join(new URL('..', import.meta.url).pathname, 'desktop', 'ui');

const EM_DASH = '\u2014';

type RouteDevice = { id: string; kind: string; name: string; volume: string | null };
type Status = { line: string; bad: boolean };
type SendModule = {
  NO_MESSAGE: string;
  NO_NOTE: string;
  NO_ROUTES: string;
  NO_EXTENSION: string;
  LEDE: string;
  SETUP_BUTTON: string;
  SETUP_TITLE: string;
  connectedDevices: (shown: unknown) => RouteDevice[] | null;
  sameRoutes: (a: unknown, b: unknown) => boolean;
  performerFor: (route: unknown) => string | null;
  routeLines: (route: unknown, platform: unknown) =>
    { title: string; detail: string; where: string | null; caveat: string | null };
  kindleFileFrom: (built: unknown) => [string, Record<string, unknown>];
  routesFailure: (answer: unknown) => string;
  caveatFor: (device: unknown, platform: unknown) => string | null;
  whereLine: (device: unknown) => string;
  routesFrom: (answer: unknown) => { routes: Route[]; chosen: string } | null;
  isDeviceRoute: (route: unknown) => boolean;
  buttonClassFor: (route: unknown, chosenId: unknown) => string | null;
  saveNameFor: (epubPath: unknown, extension: string) => string;
  saveFiltersFor: (extension: string, label: unknown) => { name: string; extensions: string[] }[];
  routeNoteFrom: (answer: unknown) => [string, { detail: string }];
  emailSetupHint: (route: unknown) => { line: string; key: string } | null;
  statusFor: (
    phase: string,
    opts?: { device?: unknown; detail?: string; route?: unknown },
  ) => Status;
};

let send: SendModule;
beforeAll(async () => { send = (await import(join(UI, 'send.js'))) as SendModule; });

// ------------------------------------------------------------------ facts

const kindle: ConnectedDevice = { kind: 'kindle', name: 'Kindle', volume: '/Volumes/Kindle' };
const kindleTwin: ConnectedDevice = { kind: 'kindle', name: 'KINDLE2', volume: '/Volumes/KINDLE2' };
const kobo: ConnectedDevice = { kind: 'kobo', name: 'KOBOeReader', volume: '/Volumes/KOBOeReader' };
const tolino: ConnectedDevice = { kind: 'tolino', name: 'tolino', volume: '/Volumes/tolino' };
const rm: ConnectedDevice = { kind: 'remarkable', name: 'reMarkable', volume: null };

/** Every fact combination the plan names: three platforms; Books, Amazon's
 *  app and the mail default each on and off; 0, 1 or 2 Kindles; a docked
 *  reMarkable or not. Plus one set of other volume readers, so the rows for
 *  kinds other than Kindle are walked connected as well as dimmed. */
function* everyFacts(): Generator<RouteFacts> {
  const deviceSets: ConnectedDevice[][] = [[], [kindle], [kindle, kindleTwin], [kobo, tolino]];
  for (const platform of ['darwin', 'win32', 'linux']) {
    for (const booksApp of [true, false]) {
      for (const sendToKindleApp of [true, false]) {
        for (const appleMailDefault of [true, false]) {
          for (const set of deviceSets) {
            for (const docked of [false, true]) {
              yield {
                platform,
                booksApp,
                sendToKindleApp,
                appleMailDefault,
                devices: docked ? [...set, rm] : [...set],
              };
            }
          }
        }
      }
    }
  }
}

/** Every remembered route worth trying for one list: nothing remembered,
 *  each key the list carries (so a platform-unavailable one falls back and
 *  a connect/setup one stays chosen), and a key no route carries. */
const remembered = (list: Route[]) => [undefined, 'gone', ...new Set(list.map((r) => r.key))];

/** The engine's answer as `routes --json` would print it. */
const answerFor = (list: Route[], lastRoute: string | undefined) =>
  ({ ok: true, routes: list, chosen: preselected(list, lastRoute).id });

/** One well-formed answer to break, field by field. */
const sample = () => {
  const list = routes({
    platform: 'darwin', booksApp: true, sendToKindleApp: false, appleMailDefault: false,
    devices: [kindle, rm],
  });
  return structuredClone({ ok: true, routes: list, chosen: list[0]!.id }) as unknown as {
    ok: unknown; routes: Record<string, unknown>[]; chosen: unknown;
  };
};
const at = (answer: ReturnType<typeof sample>, key: string) => {
  const i = answer.routes.findIndex((r) => r.key === key);
  expect(i, `sample has no ${key} row`).toBeGreaterThan(-1);
  return answer.routes[i]!;
};

// ------------------------------------------------------------ routesFrom

describe('routesFrom: the engine’s route list, taken whole or not at all', () => {
  test('every answer the real engine can give comes back exactly as it went in', () => {
    // The dangerous direction for a strict validator is TOO strict: one
    // rejected shape and the Send page shows a failure line where every route
    // should be. So the validator is run over the engine's own catalog for
    // every fact combination and every remembered choice, both as objects and
    // through JSON (what runEngine actually hands the window).
    let checked = 0;
    for (const facts of everyFacts()) {
      const list = routes(facts);
      for (const last of remembered(list)) {
        const answer = answerFor(list, last);
        const expected = { routes: list, chosen: answer.chosen };
        expect(send.routesFrom(answer)).toStrictEqual(expected);
        expect(send.routesFrom(JSON.parse(JSON.stringify(answer)))).toStrictEqual(expected);
        checked += 1;
      }
    }
    // The matrix really ran: 3 platforms x 8 app/mail combinations x 4
    // device sets x docked or not is 192 fact sets, each with several
    // remembered choices.
    expect(checked).toBeGreaterThan(192 * 3);
  });

  test('the copies are clean: rebuilt, never the engine’s objects by reference', () => {
    const answer = sample();
    const extra = structuredClone(answer) as Record<string, unknown> & typeof answer;
    extra.stray = 'kept by accident';
    extra.routes[0]!.stray = 'rides along';
    (extra.routes[0]!.device as Record<string, unknown>).serial = 'G000';
    const got = send.routesFrom(extra)!;
    expect(got).not.toBe(null);
    expect(Object.keys(got).sort()).toEqual(['chosen', 'routes']);
    expect(got.routes[0]).not.toHaveProperty('stray');
    expect(got.routes[0]!.device).not.toHaveProperty('serial');
    expect(got.routes).not.toBe(extra.routes);
    expect(got.routes[0]).not.toBe(extra.routes[0]);
    expect(got.routes[0]!.device).not.toBe(extra.routes[0]!.device);
    // Absent stays absent: no `unavailable: undefined` or `device: undefined`
    // appears on a row that never had one.
    const books = got.routes.find((r) => r.key === 'apple-books')!;
    expect(Object.keys(books).sort()).toEqual(['available', 'button', 'detail', 'id', 'key', 'title']);
  });

  test('the engine’s words are kept as it wrote them', () => {
    // Unavailable rows show the engine's fix as is; the validator checks
    // that a field is text, it does not tidy it.
    const answer = sample();
    at(answer, 'device:kobo').detail = '  plug in over USB to send  ';
    const got = send.routesFrom(answer)!;
    expect(got.routes.find((r) => r.key === 'device:kobo')!.detail)
      .toBe('  plug in over USB to send  ');
  });

  test('anything that is not an ok answer is null', () => {
    for (const answer of [null, undefined, 'routes', 7, [], true]) {
      expect(send.routesFrom(answer)).toBe(null);
    }
    for (const ok of [false, 'true', 1, undefined, null]) {
      expect(`ok ${String(ok)}: ${send.routesFrom({ ...sample(), ok })}`).toBe(`ok ${String(ok)}: null`);
    }
    // A refusal is a refusal, whatever else it carries.
    expect(send.routesFrom({ ok: false, error: { code: 'x', message: 'y' } })).toBe(null);
  });

  test('the list itself must be a list, with something in it', () => {
    for (const list of [undefined, null, 'rows', {}, 7]) {
      expect(send.routesFrom({ ...sample(), routes: list })).toBe(null);
    }
    // An empty list has nothing `chosen` can name.
    expect(send.routesFrom({ ok: true, routes: [], chosen: 'save-epub' })).toBe(null);
    for (const entry of [null, 'save-epub', 7, ['save-epub']]) {
      const answer = sample();
      (answer.routes as unknown[]).splice(1, 0, entry);
      expect(`entry ${JSON.stringify(entry)}: ${send.routesFrom(answer)}`)
        .toBe(`entry ${JSON.stringify(entry)}: null`);
    }
  });

  test('every text field is text, on every row', () => {
    for (const field of ['id', 'key', 'title', 'detail', 'button']) {
      for (const bad of [undefined, null, 7, '', '   ', ['x']]) {
        for (const key of ['device:kindle', 'apple-books', 'device:kobo']) {
          const answer = sample();
          const row = at(answer, key);
          if (bad === undefined) delete row[field];
          else row[field] = bad;
          // `chosen` names the Kindle row, so a broken id on the other two
          // rows is caught by the id check alone, not by the chosen one.
          const got = send.routesFrom(answer);
          expect(`${key}.${field} = ${JSON.stringify(bad)}: ${got}`)
            .toBe(`${key}.${field} = ${JSON.stringify(bad)}: null`);
        }
      }
    }
  });

  test('available is a boolean, and unavailable is present exactly when it is false', () => {
    for (const bad of ['true', 1, 0, null, undefined]) {
      const answer = sample();
      const row = at(answer, 'apple-books');
      if (bad === undefined) delete row.available;
      else row.available = bad;
      expect(`available = ${String(bad)}: ${send.routesFrom(answer)}`)
        .toBe(`available = ${String(bad)}: null`);
    }
    // Present on an available row: the engine's rule is broken.
    for (const why of ['connect', 'platform', 'setup', null]) {
      const answer = sample();
      at(answer, 'apple-books').unavailable = why;
      expect(`available row with unavailable ${String(why)}: ${send.routesFrom(answer)}`)
        .toBe(`available row with unavailable ${String(why)}: null`);
    }
    // Missing on an unavailable row.
    const missing = sample();
    delete at(missing, 'device:kobo').unavailable;
    expect(send.routesFrom(missing)).toBe(null);
    // A kind nobody defined.
    for (const why of ['broken', '', 'Connect', 7, null]) {
      const answer = sample();
      at(answer, 'device:kobo').unavailable = why;
      expect(`unavailable = ${String(why)}: ${send.routesFrom(answer)}`)
        .toBe(`unavailable = ${String(why)}: null`);
    }
    // And each real kind is accepted on an unavailable row.
    for (const why of ['connect', 'platform', 'setup']) {
      const answer = sample();
      at(answer, 'device:kobo').unavailable = why;
      expect(send.routesFrom(answer)).not.toBe(null);
    }
  });

  test('chosen names a row that is listed, by its id', () => {
    for (const chosen of [undefined, null, 7, '', 'gone', ['save-epub']]) {
      expect(`chosen ${JSON.stringify(chosen)}: ${send.routesFrom({ ...sample(), chosen })}`)
        .toBe(`chosen ${JSON.stringify(chosen)}: null`);
    }
    // A connected Kindle's id carries its volume. Its bare key is not an id
    // on this list, and a window that accepted it would brass nothing.
    const answer = sample();
    expect(at(answer, 'device:kindle').id).not.toBe('device:kindle');
    expect(send.routesFrom({ ...answer, chosen: 'device:kindle' })).toBe(null);
    // An unavailable row can be chosen: an unplugged Kindle you chose last
    // time stays chosen and its button waits.
    expect(send.routesFrom({ ...answer, chosen: 'device:kobo' })!.chosen).toBe('device:kobo');
  });

  test('a row or a device is an object, not a list that happens to carry the fields', () => {
    // JSON cannot make one, but the validator rebuilds from whatever it is
    // handed, and an array is not the shape the engine promises.
    const rowAsList = sample();
    const books = at(rowAsList, 'apple-books');
    rowAsList.routes[rowAsList.routes.indexOf(books)] = Object.assign([], books);
    expect(send.routesFrom(rowAsList)).toBe(null);
    const deviceAsList = sample();
    const row = at(deviceAsList, 'device:kindle');
    row.device = Object.assign([], row.device);
    expect(send.routesFrom(deviceAsList)).toBe(null);
  });

  test('two rows with one id are one row too many', () => {
    // Ids are what `chosen` names and what the page tells rows apart by;
    // a repeated one makes both ambiguous.
    const answer = sample();
    at(answer, 'save-kindle').id = 'save-epub';
    expect(send.routesFrom(answer)).toBe(null);
  });

  test('a device is well formed, and rides exactly on the rows that send to one', () => {
    for (const bad of [null, 'Kindle', 7, ['Kindle']]) {
      const answer = sample();
      at(answer, 'device:kindle').device = bad;
      expect(`device = ${JSON.stringify(bad)}: ${send.routesFrom(answer)}`)
        .toBe(`device = ${JSON.stringify(bad)}: null`);
    }
    for (const field of ['id', 'kind', 'name']) {
      for (const bad of [undefined, null, 7, '', '  ']) {
        const answer = sample();
        const device = at(answer, 'device:kindle').device as Record<string, unknown>;
        if (bad === undefined) delete device[field];
        else device[field] = bad;
        expect(`device.${field} = ${JSON.stringify(bad)}: ${send.routesFrom(answer)}`)
          .toBe(`device.${field} = ${JSON.stringify(bad)}: null`);
      }
    }
    // volume is a string or null, and it is there: JSON keeps a null.
    for (const bad of [undefined, 7, false, {}]) {
      const answer = sample();
      const device = at(answer, 'device:kindle').device as Record<string, unknown>;
      if (bad === undefined) delete device.volume;
      else device.volume = bad;
      expect(`device.volume = ${JSON.stringify(bad)}: ${send.routesFrom(answer)}`)
        .toBe(`device.volume = ${JSON.stringify(bad)}: null`);
    }
    // A docked reMarkable has no volume, and that is fine.
    expect((at(sample(), 'remarkable').device as RouteDevice).volume).toBe(null);
    expect(send.routesFrom(sample())).not.toBe(null);

    // An available device row with no device has nothing to send to: its
    // button would be a dead end.
    const bare = sample();
    delete at(bare, 'device:kindle').device;
    expect(send.routesFrom(bare)).toBe(null);
    const bareRm = sample();
    delete at(bareRm, 'remarkable').device;
    expect(send.routesFrom(bareRm)).toBe(null);
    // A device on a row that does not send to one, or on a dimmed one.
    const onBooks = sample();
    at(onBooks, 'apple-books').device = structuredClone(at(onBooks, 'device:kindle').device);
    expect(send.routesFrom(onBooks)).toBe(null);
    const onDimmed = sample();
    at(onDimmed, 'device:kobo').device = { id: '/Volumes/KOBO', kind: 'kobo', name: 'Kobo', volume: '/Volumes/KOBO' };
    expect(send.routesFrom(onDimmed)).toBe(null);
  });
});

// --------------------------------------------------------- isDeviceRoute

describe('isDeviceRoute: which rows go through export then send', () => {
  test('a volume reader of any kind, and a reMarkable', () => {
    for (const key of ['device:kindle', 'device:kobo', 'device:tolino', 'device:someday', 'remarkable']) {
      expect(`${key}: ${send.isDeviceRoute({ key })}`).toBe(`${key}: true`);
    }
  });

  test('never an app, the email, a save, or something that only looks close', () => {
    for (const key of [
      'apple-books', 'send-to-kindle', 'email-to-kindle', 'save-epub', 'save-kindle',
      'device', 'devices:kindle', 'xdevice:kindle', 'remarkable2', 'reMarkable', '',
    ]) {
      expect(`${key}: ${send.isDeviceRoute({ key })}`).toBe(`${key}: false`);
    }
    for (const route of [null, undefined, {}, { key: 7 }, 'device:kindle']) {
      expect(send.isDeviceRoute(route)).toBe(false);
    }
  });

  test('it agrees with the engine: every available device row carries a device', () => {
    for (const facts of everyFacts()) {
      for (const route of routes(facts)) {
        if (!route.available) continue;
        expect(`${route.id}: ${send.isDeviceRoute(route)}`)
          .toBe(`${route.id}: ${route.device !== undefined}`);
      }
    }
  });
});

// -------------------------------------------------------- buttonClassFor

describe('buttonClassFor: brass for the chosen route, outline for the rest', () => {
  const books = { id: 'apple-books', key: 'apple-books', available: true };
  const kobo = { id: 'device:kobo', key: 'device:kobo', available: false, unavailable: 'connect' };

  test('the chosen available route is brass, every other available one is outline', () => {
    expect(send.buttonClassFor(books, 'apple-books')).toBe('btn btn-brad');
    expect(send.buttonClassFor(books, 'save-epub')).toBe('btn btn-outline');
    expect(send.buttonClassFor(books, null)).toBe('btn btn-outline');
  });

  test('an unavailable row has no button, chosen or not', () => {
    expect(send.buttonClassFor(kobo, 'device:kobo')).toBe(null);
    expect(send.buttonClassFor(kobo, 'apple-books')).toBe(null);
    // Only a real true is available.
    expect(send.buttonClassFor({ ...books, available: 'true' }, 'apple-books')).toBe(null);
    expect(send.buttonClassFor(null, 'apple-books')).toBe(null);
  });

  test('on every engine answer: at most one brass button, and it is the chosen one', () => {
    for (const facts of everyFacts()) {
      const list = routes(facts);
      for (const last of remembered(list)) {
        const { chosen } = answerFor(list, last);
        const classes = list.map((r) => send.buttonClassFor(r, chosen));
        const brass = list.filter((_, i) => classes[i] === 'btn btn-brad');
        const chosenRow = list.find((r) => r.id === chosen)!;
        expect(brass.map((r) => r.id)).toEqual(chosenRow.available ? [chosen] : []);
        // Buttons exactly on available rows.
        list.forEach((r, i) => expect(classes[i] !== null).toBe(r.available));
      }
    }
  });
});

// ----------------------------------------------------- the save dialog

describe('saveNameFor and saveFiltersFor: what the save dialog starts with', () => {
  test('the book’s own name, with the extension of the file being saved', () => {
    expect(send.saveNameFor('/Users/sam/Screepub/Library/My Script.epub', 'epub')).toBe('My Script.epub');
    expect(send.saveNameFor('/Users/sam/Screepub/Library/My Script.epub', 'kfx')).toBe('My Script.kfx');
    expect(send.saveNameFor('/lib/draft.epub', 'azw3')).toBe('draft.azw3');
    expect(send.saveNameFor('/lib/draft.epub', 'mobi')).toBe('draft.mobi');
  });

  test('the stem comes from the file name, never the folder', () => {
    expect(send.saveNameFor('/lib/v1.2/script.epub', 'kfx')).toBe('script.kfx');
    expect(send.saveNameFor('/lib/v1.2/script', 'epub')).toBe('script.epub');
    // Windows paths, because the window runs there too.
    expect(send.saveNameFor('C:\\Users\\sam\\Screepub\\Draft Two.epub', 'azw3')).toBe('Draft Two.azw3');
  });

  test('only the last extension goes; a dotted title keeps its dots', () => {
    expect(send.saveNameFor('/lib/Mr. Smith Goes.epub', 'epub')).toBe('Mr. Smith Goes.epub');
    expect(send.saveNameFor('/lib/draft.v2.epub', 'kfx')).toBe('draft.v2.kfx');
  });

  test('an extension handed over with its dot does not get a second one', () => {
    expect(send.saveNameFor('/lib/draft.epub', '.kfx')).toBe('draft.kfx');
  });

  test('no usable name still gives the dialog a name, not a bare extension', () => {
    // A default of ".epub" alone would be a hidden file on a Mac.
    for (const path of ['', '/lib/', null, undefined, 7]) {
      const name = send.saveNameFor(path, 'epub');
      expect(`${String(path)} -> ${name}`).toMatch(/ -> [^.\s][^/\\]*\.epub$/);
    }
  });

  test('one filter, named by the label, holding the one extension', () => {
    expect(send.saveFiltersFor('epub', 'EPUB')).toEqual([{ name: 'EPUB', extensions: ['epub'] }]);
    expect(send.saveFiltersFor('kfx', 'KFX for USB sideload to Kindle'))
      .toEqual([{ name: 'KFX for USB sideload to Kindle', extensions: ['kfx'] }]);
    // The dialog wants the extension bare.
    expect(send.saveFiltersFor('.azw3', 'AZW3')).toEqual([{ name: 'AZW3', extensions: ['azw3'] }]);
    expect(send.saveFiltersFor('epub', '  EPUB ')).toEqual([{ name: 'EPUB', extensions: ['epub'] }]);
  });

  test('a filter with no label is named by its extension rather than left blank', () => {
    for (const label of ['', '   ', null, undefined, 7]) {
      expect(send.saveFiltersFor('azw3', label)).toEqual([{ name: 'AZW3', extensions: ['azw3'] }]);
    }
  });
});

// ------------------------------------------------ routeNoteFrom, statusFor

describe('routeNoteFrom: what a route’s answer lets the status line say', () => {
  test('the engine’s note, trimmed, as a success', () => {
    const answer = { ok: true, key: 'apple-books', note: '  Added to Apple Books.  ' };
    expect(send.routeNoteFrom(answer)).toEqual(['done', { detail: 'Added to Apple Books.' }]);
    expect(send.statusFor(...send.routeNoteFrom(answer)))
      .toEqual({ line: 'Added to Apple Books.', bad: false });
  });

  test('a success with no note says what is known, and never claims more', () => {
    // 'Done.' would be a claim the window cannot back: it does not know what
    // the route did, only that the engine said ok.
    for (const note of [undefined, null, '', '   ', 7]) {
      const [phase, detail] = send.routeNoteFrom({ ok: true, key: 'save-epub', note });
      expect(phase).toBe('done');
      expect(detail.detail).toBe(send.NO_NOTE);
    }
    expect(send.NO_NOTE).not.toBe('Done.');
    expect(send.NO_NOTE.trim()).not.toBe('');
    expect(send.statusFor(...send.routeNoteFrom({ ok: true })).bad).toBe(false);
  });

  test('anything but ok is the failure path, in the engine’s words', () => {
    const refused = { ok: false, error: { code: 'x', message: '  Apple Books did not open.  ' } };
    expect(send.routeNoteFrom(refused)).toEqual(['failed', { detail: 'Apple Books did not open.' }]);
    expect(send.statusFor(...send.routeNoteFrom(refused)))
      .toEqual({ line: 'Apple Books did not open.', bad: true });
    // A refusal with no sentence gets the stand-in, still as an alarm.
    for (const answer of [{ ok: false }, null, undefined, { ok: 'true', note: 'Added.' }]) {
      const status = send.statusFor(...send.routeNoteFrom(answer));
      expect(status).toEqual({ line: send.NO_MESSAGE, bad: true });
    }
    // A note on a refusal is not a success.
    const [phase] = send.routeNoteFrom({ ok: false, note: 'Added to Apple Books.' });
    expect(phase).toBe('failed');
  });
});

describe('statusFor: the route phases, beside the device ones', () => {
  test('opening names the route being opened', () => {
    expect(send.statusFor('opening', { route: { title: 'Apple Books' } }))
      .toEqual({ line: 'Opening Apple Books…', bad: false });
    expect(send.statusFor('opening', { route: { title: 'Send to Kindle web' } }).line)
      .toBe('Opening Send to Kindle web…');
    expect(send.statusFor('opening', { route: { title: '  Apple Books ' } }).line)
      .toBe('Opening Apple Books…');
    // No title to name: still a line, and still not an alarm.
    for (const route of [undefined, null, {}, { title: '  ' }, { title: 7 }]) {
      expect(send.statusFor('opening', { route })).toEqual({ line: 'Opening…', bad: false });
    }
  });

  test('saving, and building the Kindle file with the wait said up front', () => {
    expect(send.statusFor('saving')).toEqual({ line: 'Saving…', bad: false });
    expect(send.statusFor('building-kindle')).toEqual({
      line: 'Building the Kindle file (Kindle Previewer can take about twenty seconds)…',
      bad: false,
    });
  });

  test('done shows the detail it is handed, as good news', () => {
    expect(send.statusFor('done', { detail: 'Saved.' })).toEqual({ line: 'Saved.', bad: false });
  });

  test('the device phases say what they said before', () => {
    const device = { id: '/m/Kindle', kind: 'kindle', name: 'Kindle', volume: '/m/Kindle' };
    expect(send.statusFor('building', { device }).line).toBe('Building the file Kindle can open…');
    expect(send.statusFor('preparing', { device }).line).toBe('Getting the book ready for Kindle…');
    expect(send.statusFor('copying', { device }).line).toBe('Copying it to Kindle…');
    expect(send.statusFor('sent', { detail: 'Sent to Kindle.' })).toEqual({ line: 'Sent to Kindle.', bad: false });
    expect(send.statusFor('failed', { detail: '' })).toEqual({ line: send.NO_MESSAGE, bad: true });
    expect(send.statusFor('idle')).toEqual({ line: '', bad: false });
  });
});

// -------------------------------------------------------- emailSetupHint

describe('emailSetupHint: the one route that needs a first-time step', () => {
  const LINE = 'First time? Amazon needs your sender address approved, or it drops the email without a word.';

  test('the email row gets the hint and the key the engine opens the page by', () => {
    expect(send.emailSetupHint({ key: 'email-to-kindle', available: true }))
      .toEqual({ line: LINE, key: 'kindle-email-setup' });
    // Unavailable too: attaching the EPUB by hand needs the same approval.
    expect(send.emailSetupHint({ key: 'email-to-kindle', available: false, unavailable: 'platform' }))
      .toEqual({ line: LINE, key: 'kindle-email-setup' });
  });

  test('no other row does', () => {
    for (const key of ['apple-books', 'send-to-kindle', 'save-epub', 'save-kindle', 'device:kindle', 'remarkable', 'email']) {
      expect(`${key}: ${send.emailSetupHint({ key })}`).toBe(`${key}: null`);
    }
    for (const route of [null, undefined, {}, 'email-to-kindle']) {
      expect(send.emailSetupHint(route)).toBe(null);
    }
  });

  test('each call hands back its own object', () => {
    const first = send.emailSetupHint({ key: 'email-to-kindle' })!;
    first.line = 'changed';
    expect(send.emailSetupHint({ key: 'email-to-kindle' })!.line).toBe(LINE);
  });

  test('on every engine answer, exactly the email row carries it', () => {
    for (const facts of everyFacts()) {
      const hinted = routes(facts).filter((r) => send.emailSetupHint(r) !== null).map((r) => r.key);
      expect(hinted).toEqual(['email-to-kindle']);
    }
  });
});

// ------------------------------------------------ what the page draws (W3)

describe('connectedDevices: what is plugged in, read off the route list', () => {
  test('the device of every available device row, in the engine’s order', () => {
    const list = routes({
      platform: 'darwin', booksApp: true, sendToKindleApp: false, appleMailDefault: true,
      devices: [kindle, kobo, rm],
    });
    const shown = send.routesFrom(answerFor(list, undefined))!;
    const got = send.connectedDevices(shown)!;
    expect(got.map((d) => d.kind)).toEqual(['kindle', 'kobo', 'remarkable']);
    // Exactly the device objects the rows carry, in the shape `send --device`
    // takes, so the KFX block and ctx.state.devices read what they read from
    // `devices` before.
    expect(got).toEqual(shown.routes.filter((r) => r.device).map((r) => r.device!));
    // Copies, so a reader of ctx.state.devices cannot edit the rows on screen.
    expect(got[0]).not.toBe(shown.routes[0]!.device);
  });

  test('a dimmed device row is not a connected device', () => {
    // Nothing plugged in: every device row is dimmed, and the answer is an
    // empty list, which is what the KFX block reads as "the reader is still
    // deciding" (kindleRelevant).
    const list = routes({
      platform: 'darwin', booksApp: true, sendToKindleApp: false, appleMailDefault: true, devices: [],
    });
    expect(send.connectedDevices(send.routesFrom(answerFor(list, undefined)))).toEqual([]);
  });

  test('no list on screen is not known, rather than nothing connected', () => {
    // null keeps the KFX block from flashing up before the first answer.
    for (const shown of [null, undefined, {}, { routes: 'x' }]) {
      expect(send.connectedDevices(shown)).toBe(null);
    }
  });

  test('on every engine answer, one device per available device row', () => {
    for (const facts of everyFacts()) {
      const list = routes(facts);
      const got = send.connectedDevices(send.routesFrom(answerFor(list, undefined)))!;
      expect(got.length).toBe(facts.devices.length);
    }
  });
});

describe('sameRoutes: the rows are rebuilt only when something on them changed', () => {
  const list = routes({
    platform: 'darwin', booksApp: true, sendToKindleApp: false, appleMailDefault: false,
    devices: [kindle],
  });
  const shown = () => send.routesFrom(answerFor(list, undefined))!;

  test('the same answer twice is the same list', () => {
    // The poll ticks every two seconds; a rebuild on every tick would take
    // the focus off a button someone had just tabbed to.
    expect(send.sameRoutes(shown(), shown())).toBe(true);
  });

  test('a different choice, detail, availability, title, button or order is not', () => {
    const base = shown();
    const changed = (edit: (s: ReturnType<typeof shown>) => void) => {
      const next = structuredClone(base);
      edit(next);
      return send.sameRoutes(base, next);
    };
    expect(changed((s) => { s.chosen = 'save-epub'; })).toBe(false);
    expect(changed((s) => { s.routes[1]!.detail = 'something else'; })).toBe(false);
    expect(changed((s) => { s.routes[1]!.title = 'Books'; })).toBe(false);
    expect(changed((s) => { s.routes[1]!.button = 'Open'; })).toBe(false);
    expect(changed((s) => { s.routes[0]!.id = 'device:kindle#/Volumes/KINDLE2'; })).toBe(false);
    expect(changed((s) => {
      const r = s.routes[1]!;
      r.available = false;
      (r as { unavailable?: string }).unavailable = 'setup';
    })).toBe(false);
    expect(changed((s) => { s.routes.reverse(); })).toBe(false);
    expect(changed((s) => { s.routes.pop(); })).toBe(false);
  });

  test('nothing on screen is never the same as a list', () => {
    expect(send.sameRoutes(null, shown())).toBe(false);
    expect(send.sameRoutes(shown(), null)).toBe(false);
    expect(send.sameRoutes(null, null)).toBe(false);
  });
});

describe('performerFor: which flow a row’s button runs', () => {
  test('a device or a reMarkable goes through export then send', () => {
    for (const key of ['device:kindle', 'device:kobo', 'device:someday', 'remarkable']) {
      expect(`${key}: ${send.performerFor({ key })}`).toBe(`${key}: device`);
    }
  });

  test('each save is its own flow, and every app or page is opened by the engine', () => {
    expect(send.performerFor({ key: 'save-epub' })).toBe('save-epub');
    expect(send.performerFor({ key: 'save-kindle' })).toBe('save-kindle');
    for (const key of ['apple-books', 'send-to-kindle', 'email-to-kindle']) {
      expect(`${key}: ${send.performerFor({ key })}`).toBe(`${key}: open`);
    }
    // A route this window is older than is still handed to the engine, which
    // performs it or refuses in its own words, rather than drawn as a dead
    // button.
    expect(send.performerFor({ key: 'someday-route' })).toBe('open');
  });

  test('the email row’s setup link is its own flow, and the three names for it agree', async () => {
    const hint = send.emailSetupHint({ key: 'email-to-kindle' })!;
    expect(send.performerFor({ key: hint.key })).toBe('setup');
    // The key the hint carries is the one app.js's builder sends: one page,
    // named once on each side of the boundary, checked here to match.
    const { argv } = await import(join(UI, 'app.js'));
    expect(argv.emailSetup()).toContain(hint.key);
  });

  test('a row with no key runs nothing', () => {
    for (const route of [null, undefined, {}, { key: 7 }, { key: '  ' }]) {
      expect(send.performerFor(route)).toBe(null);
    }
  });

  test('on every engine answer, every available row has a flow', () => {
    for (const facts of everyFacts()) {
      for (const route of routes(facts)) {
        if (!route.available) continue;
        const how = send.performerFor(route);
        expect(`${route.id}: ${how !== null && how !== 'setup'}`).toBe(`${route.id}: true`);
        expect(how === 'device').toBe(route.device !== undefined);
      }
    }
  });
});

describe('routeLines: what a row says', () => {
  test('a mounted reader keeps its volume line and every device its unproven caveat', () => {
    const list = routes({
      platform: 'darwin', booksApp: true, sendToKindleApp: false, appleMailDefault: true,
      devices: [kindle, kobo, rm],
    });
    const rows = send.routesFrom(answerFor(list, undefined))!.routes;
    const [k, ko, r] = [rows[0]!, rows[1]!, rows[2]!];
    expect(send.routeLines(k, 'MacIntel')).toEqual({
      title: 'Kindle', detail: k.detail, where: '/Volumes/Kindle', caveat: null,
    });
    const kobos = send.routeLines(ko, 'MacIntel');
    expect(kobos.where).toBe('/Volumes/KOBOeReader');
    expect(kobos.caveat).toBe(send.caveatFor(ko.device, 'MacIntel'));
    expect(kobos.caveat).not.toBe(null);
    // The Kindle is proven on a Mac only.
    expect(send.routeLines(k, 'Linux x86_64').caveat).not.toBe(null);
    // A reMarkable never mounts: no volume line at all, because the engine's
    // detail ("the EPUB, over its USB connection") already says how it goes.
    expect(send.routeLines(r, 'MacIntel').where).toBe(null);
    expect(send.routeLines(r, 'MacIntel').detail).toBe(r.detail);
    // A volume that is only spaces is no volume.
    expect(send.routeLines({ ...k, device: { ...k.device!, volume: '  ' } }, 'MacIntel').where).toBe(null);
  });

  test('every other row, available or dimmed, is its title and the engine’s detail', () => {
    const list = routes({
      platform: 'darwin', booksApp: true, sendToKindleApp: false, appleMailDefault: false, devices: [],
    });
    for (const route of send.routesFrom(answerFor(list, undefined))!.routes) {
      expect(send.routeLines(route, 'MacIntel')).toEqual({
        title: route.title, detail: route.detail, where: null, caveat: null,
      });
    }
  });
});

describe('kindleFileFrom: what the Kindle save learns from the export', () => {
  test('the extension and the engine’s label for the file it built', () => {
    expect(send.kindleFileFrom({
      ok: true, path: '/lib/s.azw3', extension: 'azw3', label: 'AZW3 for USB sideload',
    })).toEqual(['built', { extension: 'azw3', label: 'AZW3 for USB sideload' }]);
    expect(send.kindleFileFrom({ ok: true, extension: '.kfx', label: '  KFX  ' }))
      .toEqual(['built', { extension: 'kfx', label: 'KFX' }]);
    // No label: the filter falls back to the extension (saveFiltersFor).
    expect(send.kindleFileFrom({ ok: true, extension: 'mobi' }))
      .toEqual(['built', { extension: 'mobi', label: null }]);
  });

  test('a refusal is the export’s own sentence, and nothing is saved', () => {
    const refused = { ok: false, error: { code: 'export-failed', message: 'Calibre could not build it.' } };
    expect(send.kindleFileFrom(refused)).toEqual(['failed', { detail: 'Calibre could not build it.' }]);
    expect(send.kindleFileFrom({ ok: false })).toEqual(['failed', { detail: send.NO_MESSAGE }]);
    expect(send.kindleFileFrom(null)).toEqual(['failed', { detail: send.NO_MESSAGE }]);
    expect(send.statusFor(...send.kindleFileFrom(refused) as [string, { detail: string }]).bad).toBe(true);
  });

  test('a success that does not say what it built opens no dialog', () => {
    // The extension names the file in the dialog and filters it; one that is
    // missing, or is not a bare word, is not something to hand a Save box.
    for (const extension of [undefined, null, '', '  ', 7, '../x', 'az w3', '.']) {
      const [phase, detail] = send.kindleFileFrom({ ok: true, extension, label: 'AZW3' });
      expect(`${JSON.stringify(extension)}: ${phase}`).toBe(`${JSON.stringify(extension)}: failed`);
      expect(detail.detail).toBe(send.NO_EXTENSION);
    }
  });
});

describe('routesFailure: the line in place of a list the page cannot draw', () => {
  test('a refusal is the engine’s own sentence', () => {
    expect(send.routesFailure({ ok: false, error: { code: 'unreadable', message: 'Cannot read the book.' } }))
      .toBe('Cannot read the book.');
    expect(send.routesFailure({ ok: false })).toBe(send.NO_MESSAGE);
    expect(send.routesFailure(null)).toBe(send.NO_MESSAGE);
  });

  test('an ok answer in the wrong shape says so, not that the engine refused', () => {
    expect(send.routesFailure({ ok: true, routes: 'x' })).toBe(send.NO_ROUTES);
    expect(send.NO_ROUTES).not.toBe(send.NO_MESSAGE);
  });
});

describe('the words this adds', () => {
  test('carry no em dash', () => {
    const lines = [
      send.NO_NOTE,
      send.NO_ROUTES,
      send.NO_EXTENSION,
      send.LEDE,
      send.SETUP_BUTTON,
      send.SETUP_TITLE,
      send.emailSetupHint({ key: 'email-to-kindle' })!.line,
      send.statusFor('opening', { route: { title: 'Apple Books' } }).line,
      send.statusFor('opening', { route: { title: send.SETUP_TITLE } }).line,
      send.statusFor('opening').line,
      send.statusFor('saving').line,
      send.statusFor('building-kindle').line,
    ];
    for (const line of lines) expect(line).not.toContain(EM_DASH);
  });

  test('the page no longer promises that nothing leaves this computer', () => {
    // It did when every row was a cable. Send to Kindle and email go through
    // Amazon, so the page-wide promise would now be false; the device rows
    // still say it, in the engine's words, where it is true.
    expect(send.LEDE).not.toContain('nothing leaves');
  });
});

// ------------------------------------------- the page, drawn and performed

describe('the Send page, drawn from the route list and performed row by row', () => {
  // A stub document just big enough for dom.js, focus.js and what send.js and
  // kfx.js ask of a node; the model is desktop-ui.test.ts's "what a reader
  // sees across redraws" block. activeElement falls back to the body when the
  // focused node is detached, disabled or inside something hidden, as a
  // browser's focus fixup does. Disabling the focused button drops the focus
  // for good, as that fixup does too: re-enabling it does not hand it back,
  // so a test of putting the keyboard back cannot pass on the stub's memory. The engine and the save dialog are queues of
  // unanswered calls the test answers in whatever order it wants, and the
  // two-second poll is a callback the test fires by hand.
  class StubNode {
    childNodes: StubNode[] = [];
    parentNode: StubNode | null = null;
    attrs = new Map<string, string>();
    listeners = new Map<string, ((event: unknown) => void)[]>();
    hidden = false;
    dead = false;
    className = '';
    data = '';
    constructor(readonly tagName: string, readonly doc: StubDocument) {}
    get disabled() { return this.dead; }
    set disabled(on: boolean) {
      this.dead = on;
      if (on && this.doc.focused === this) this.doc.focused = null;
    }
    get firstChild() { return this.childNodes[0] ?? null; }
    append(...nodes: (StubNode | string)[]) {
      for (const each of nodes) {
        const node = typeof each === 'string' ? this.doc.createTextNode(each) : each;
        node.parentNode?.removeChild(node);
        node.parentNode = this;
        this.childNodes.push(node);
      }
    }
    removeChild(node: StubNode) {
      this.childNodes.splice(this.childNodes.indexOf(node), 1);
      node.parentNode = null;
      return node;
    }
    get textContent(): string {
      return this.tagName === '#text' ? this.data : this.childNodes.map((c) => c.textContent).join('');
    }
    set textContent(value: string) {
      if (this.tagName === '#text') { this.data = value; return; }
      for (const child of this.childNodes) child.parentNode = null;
      this.childNodes = [];
      if (value !== '') this.append(value);
    }
    setAttribute(name: string, value: string) { this.attrs.set(name, value); }
    getAttribute(name: string) { return this.attrs.get(name) ?? null; }
    get dataset(): Record<string, string> {
      return Object.fromEntries([...this.attrs].filter(([k]) => k.startsWith('data-'))
        .map(([k, v]) => [k.slice(5).replace(/-(\w)/g, (_, c: string) => c.toUpperCase()), v]));
    }
    get classList() {
      const names = () => this.className.split(/\s+/).filter(Boolean);
      return {
        contains: (name: string) => names().includes(name),
        toggle: (name: string, on: boolean) => {
          const rest = names().filter((n) => n !== name);
          this.className = (on ? [...rest, name] : rest).join(' ');
          return on;
        },
      };
    }
    addEventListener(type: string, fn: (event: unknown) => void) {
      this.listeners.set(type, [...(this.listeners.get(type) ?? []), fn]);
    }
    click() {
      if (this.disabled) return;
      for (const fn of this.listeners.get('click') ?? []) fn({ type: 'click' });
    }
    get isConnected(): boolean {
      let node: StubNode = this;
      while (node.parentNode !== null) node = node.parentNode;
      return node === this.doc.body;
    }
    contains(other: StubNode | null): boolean {
      for (let node = other; node !== null; node = node.parentNode) if (node === this) return true;
      return false;
    }
    closest(selector: string): StubNode | null {
      if (selector !== '[hidden]') throw new Error(`the stub has no closest(${selector})`);
      for (let node: StubNode | null = this; node !== null; node = node.parentNode) {
        if (node.hidden) return node;
      }
      return null;
    }
    /** A bare tag name only, which is all anything here asks for. */
    querySelectorAll(tag: string): StubNode[] {
      const found: StubNode[] = [];
      const walk = (node: StubNode) => {
        for (const child of node.childNodes) {
          if (child.tagName === tag.toUpperCase()) found.push(child);
          walk(child);
        }
      };
      walk(this);
      return found;
    }
    focus() {
      if (this.isConnected && !this.disabled && this.closest('[hidden]') === null) this.doc.focused = this;
    }
    /** Every node under this one, in document order. */
    all(): StubNode[] {
      const found: StubNode[] = [];
      const walk = (node: StubNode) => { for (const c of node.childNodes) { found.push(c); walk(c); } };
      walk(this);
      return found;
    }
  }
  class StubDocument {
    body: StubNode;
    focused: StubNode | null = null;
    constructor() { this.body = new StubNode('BODY', this); }
    createElement(tag: string) { return new StubNode(tag.toUpperCase(), this); }
    createTextNode(value: string) {
      const node = new StubNode('#text', this);
      node.data = value;
      return node;
    }
    get activeElement() {
      const node = this.focused;
      if (node === null || !node.isConnected || node.disabled || node.closest('[hidden]') !== null) {
        return this.body;
      }
      return node;
    }
  }
  type SendDrawing = {
    mount: (node: StubNode, ctx: unknown) => void;
    show: () => void;
    hide: () => void;
    scriptChanged: () => void;
  };

  const g = globalThis as unknown as {
    window?: unknown; document?: unknown;
    setInterval: typeof setInterval; clearInterval: typeof clearInterval;
  };
  const realSetInterval = g.setInterval;
  const realClearInterval = g.clearInterval;
  let hideLast: (() => void) | null = null;
  afterEach(() => {
    hideLast?.();
    hideLast = null;
    g.setInterval = realSetInterval;
    g.clearInterval = realClearInterval;
    delete g.window;
    delete g.document;
  });

  const EPUB = '/lib/field-station/Field Station.epub';
  const FOUNTAIN = '/lib/field-station/Field Station.fountain';
  const script = () => ({
    epubPath: EPUB, fountainPath: FOUNTAIN, settings: { dialogueSideMarginPct: 27 },
  });
  /** The engine's answer for these facts, remembering `last`. */
  const listed = (devices: ConnectedDevice[], last?: string, mail = true) => {
    const list = routes({ platform: 'darwin', booksApp: true, sendToKindleApp: false, appleMailDefault: mail, devices });
    return { ok: true, routes: list, chosen: preselected(list, last).id };
  };
  const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

  let fresh = 0;
  /** kfx.js's probe answer: by default "no checklist", which keeps the block
   *  out of tests that are not about it. */
  async function world(kfxAnswer: unknown = { ok: false }) {
    const doc = new StubDocument();
    const pending: { args: string[]; resolve: (stdout: string) => void }[] = [];
    const dialogs: { options: { defaultPath: string; filters: unknown }; resolve: (path: string | null) => void }[] = [];
    let tick: (() => void) | null = null;
    g.document = doc;
    g.window = {
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      __TAURI__: {
        core: {
          invoke: (_cmd: string, { args }: { args: string[] }) =>
            new Promise<string>((resolve) => pending.push({ args, resolve })),
        },
        dialog: {
          save: (options: { defaultPath: string; filters: unknown }) =>
            new Promise<string | null>((resolve) => dialogs.push({ options, resolve })),
        },
      },
    };
    g.setInterval = ((fn: () => void) => { tick = fn; return 1; }) as unknown as typeof setInterval;
    g.clearInterval = (() => { tick = null; }) as unknown as typeof clearInterval;
    // A module of its own per test: send.js keeps the page's state at module
    // level. kfx.js and app.js are shared, so every call a test starts is
    // answered before it ends.
    fresh += 1;
    const send = (await import(`${join(UI, 'send.js')}?drawn-${fresh}`)) as SendDrawing;
    const pane = doc.createElement('section');
    doc.body.append(pane);
    const ctx = {
      state: { script: script() as unknown, devices: [] as unknown[] },
      restored: 0,
      goTo: () => undefined,
      restoreFocus: () => { ctx.restored += 1; },
    };
    send.mount(pane, ctx);
    const w = {
      doc, send, pane, ctx, pending, dialogs,
      /** The verbs asked so far and not yet answered. */
      asked: () => pending.map((p) => p.args[0]),
      /** Answer the oldest unanswered call to `verb`. */
      async answer(verb: string, value: unknown) {
        const at = pending.findIndex((p) => p.args[0] === verb);
        if (at < 0) throw new Error(`nothing asked the engine for ${verb}: ${w.asked()}`);
        const [call] = pending.splice(at, 1);
        call!.resolve(JSON.stringify(value));
        await settle();
        return call!.args;
      },
      /** The newest unanswered call to `verb`, answered first (a race). */
      async answerNewest(verb: string, value: unknown) {
        const at = pending.map((p) => p.args[0]).lastIndexOf(verb);
        if (at < 0) throw new Error(`nothing asked the engine for ${verb}`);
        const [call] = pending.splice(at, 1);
        call!.resolve(JSON.stringify(value));
        await settle();
      },
      async choose(path: string | null) {
        const dialog = dialogs.shift();
        if (dialog === undefined) throw new Error('no save dialog is open');
        dialog.resolve(path);
        await settle();
        return dialog.options;
      },
      poll() {
        if (tick === null) throw new Error('the page is not polling');
        tick();
      },
      polling: () => tick !== null,
      list: () => pane.all().find((n) => n.className === 'devices')!,
      rows: () => w.list().childNodes.filter((n) => n.className.includes('device-row')),
      titles: () => w.rows().map((r) => r.all().find((n) => n.className === 'device-name')!.textContent),
      buttons: () => w.list().querySelectorAll('button'),
      button(label: string) {
        const found = w.buttons().find((b) => b.textContent === label);
        if (found === undefined) throw new Error(`no ${label} button: ${w.buttons().map((b) => b.textContent)}`);
        return found;
      },
      status: () => pane.all().find((n) => n.className.split(' ').includes('send-status'))!,
      fault: () => w.list().all().find((n) => n.className === 'fault-body')?.textContent ?? null,
    };
    send.show();
    hideLast = () => send.hide();
    // kfx.js asks what the machine can do when the page shows; its answer is
    // not what these tests are about.
    if (w.asked().includes('kfx-status')) await w.answer('kfx-status', kfxAnswer);
    return w;
  }

  test('it polls routes, not devices, for this script’s book', async () => {
    const w = await world();
    expect(w.asked()).toEqual(['routes']);
    expect(await w.answer('routes', listed([]))).toEqual(['routes', EPUB, '--json']);
    w.poll();
    expect(w.asked()).toEqual(['routes']);
    await w.answer('routes', listed([]));
    w.send.hide();
    expect(w.polling()).toBe(false);
  });

  test('every row in the engine’s order: brass for the chosen one, outline for the rest, dimmed ones with no button', async () => {
    const w = await world();
    const answer = listed([kindle, kobo], 'apple-books');
    await w.answer('routes', answer);
    expect(w.titles()).toEqual(answer.routes.map((r) => r.title));
    const rows = w.rows();
    answer.routes.forEach((route, i) => {
      const row = rows[i]!;
      const buttons = row.querySelectorAll('button').filter((b) => b.getAttribute('data-route') === route.id);
      if (route.available) {
        expect(row.className).toBe('device-row');
        expect(buttons.map((b) => b.className)).toEqual([route.id === 'apple-books' ? 'btn btn-brad' : 'btn btn-outline']);
        expect(buttons[0]!.textContent).toBe(route.button);
      } else {
        expect(row.className).toBe('device-row route-unavailable');
        expect(buttons).toEqual([]);
      }
      // The engine's detail on every row, as written (the fix on a dimmed one).
      expect(row.all().find((n) => n.className === 'route-detail')!.textContent).toBe(route.detail);
    });
    // A Kindle row keeps its volume line, a Kobo row its unproven caveat.
    expect(rows[0]!.all().find((n) => n.className === 'device-where')!.textContent).toBe('/Volumes/Kindle');
    expect(rows[1]!.all().some((n) => n.className === 'device-caveat')).toBe(true);
    // Dimmed readers say what the old "Nothing plugged in" said, per reader.
    const tolino = rows[answer.routes.findIndex((r) => r.key === 'device:tolino')]!;
    expect(tolino.textContent).toContain('plug in over USB to send');
    // What is connected reaches the rest of the window.
    expect((w.ctx.state.devices as { kind: string }[]).map((d) => d.kind)).toEqual(['kindle', 'kobo']);
    // The reach table is still there, folded, after the list.
    const reach = w.pane.childNodes.find((n) => n.tagName === 'DETAILS')!;
    expect(reach.className).toBe('reach');
    expect(w.pane.childNodes.indexOf(reach)).toBeGreaterThan(w.pane.childNodes.indexOf(w.list()));
  });

  test('a refusal draws the engine’s sentence and a malformed list draws its own line, never a short list', async () => {
    const w = await world();
    await w.answer('routes', { ok: false, error: { code: 'unreadable', message: 'Cannot read the book.' } });
    expect(w.fault()).toBe('Cannot read the book.');
    expect(w.buttons()).toEqual([]);
    w.poll();
    const broken = listed([]);
    (broken.routes[0] as { title: unknown }).title = '';
    await w.answer('routes', broken);
    expect(w.fault()).toBe('The engine listed the ways to send this book in a shape this window cannot read.');
    w.poll();
    await w.answer('routes', listed([]));
    expect(w.fault()).toBe(null);
    expect(w.buttons().length).toBeGreaterThan(0);
  });

  test('the same answer again leaves every row alone, so the keyboard stays put', async () => {
    const w = await world();
    await w.answer('routes', listed([kindle]));
    const save = w.button('Save the EPUB…');
    save.focus();
    w.poll();
    await w.answer('routes', listed([kindle]));
    expect(save.isConnected).toBe(true);
    expect(w.doc.activeElement).toBe(save);
    expect(w.ctx.restored).toBe(0);
  });

  test('a changed list is rebuilt, and the keyboard goes back to the same route’s button', async () => {
    const w = await world();
    await w.answer('routes', listed([]));
    w.button('Save the EPUB…').focus();
    w.poll();
    await w.answer('routes', listed([kindle])); // a Kindle turned up: a new first row
    const now = w.doc.activeElement;
    expect(now.textContent).toBe('Save the EPUB…');
    expect(now.isConnected).toBe(true);
    expect(w.ctx.restored).toBe(0);
  });

  test('when the focused route is gone, the page’s own plan takes the keyboard', async () => {
    const w = await world();
    await w.answer('routes', listed([kindle]));
    w.button('Copy to Kindle').focus();
    w.poll();
    await w.answer('routes', listed([])); // unplugged
    expect(w.ctx.restored).toBe(1);
  });

  test('a poll that was out when a route began lands without touching the rows', async () => {
    // A rebuild mid-route would hand back fresh, enabled buttons and let a
    // second route (or a send) start while the first is still writing.
    const w = await world();
    await w.answer('routes', listed([]));
    w.poll();
    w.button('Add to Apple Books').click();
    await w.answer('routes', listed([kindle])); // a Kindle turned up meanwhile
    expect(w.titles()[0]).toBe('Apple Books'); // not the connected Kindle's row
    expect(w.buttons().every((b) => b.disabled)).toBe(true);
    await w.answer('route', { ok: true, note: 'Added to Apple Books.' });
    await w.answer('routes', listed([kindle], 'apple-books'));
    expect(w.titles()[0]).toBe('Kindle');
  });

  test('an answer about the last script is not drawn on the next one’s page', async () => {
    // The routes answer is about a BOOK: a refusal for the old one ("cannot
    // read it") would stand under the new one's title as if it were its.
    const w = await world();
    w.ctx.state.script = { ...script(), epubPath: '/lib/other/Other.epub' };
    w.send.scriptChanged();
    if (w.asked().includes('kfx-status')) await w.answer('kfx-status', { ok: false });
    await w.answer('routes', { ok: false, error: { code: 'unreadable', message: 'Cannot read the book.' } });
    expect(w.fault()).toBe(null);
    expect(w.list().textContent).toBe('Looking for every way to send it…');
    w.poll();
    expect(await w.answer('routes', listed([]))).toEqual(['routes', '/lib/other/Other.epub', '--json']);
    expect(w.buttons().length).toBeGreaterThan(0);
  });

  test('the KFX block waits for the first list, then follows what is plugged in', async () => {
    // Kindle advice is for Kindles: shown with nothing connected (the reader
    // is deciding) or a Kindle, hidden with only other readers, and not
    // shown at all before the first answer, or it would flash up and vanish.
    const notReady = {
      ok: true,
      ...kfxSetup({ calibre: true, previewer: true, pluginInstalled: false, ready: false }, 'darwin'),
    };
    const w = await world(notReady);
    const block = w.pane.all().find((n) => n.className === 'kfx-setup')!;
    expect(block.hidden).toBe(true);
    await w.answer('routes', listed([]));
    expect(block.hidden).toBe(false);
    w.poll();
    await w.answer('routes', listed([kobo]));
    expect(block.hidden).toBe(true);
    w.poll();
    await w.answer('routes', listed([kobo, kindle]));
    expect(block.hidden).toBe(false);
  });

  test('the keyboard goes back to Save the EPUB after its Save box is cancelled', async () => {
    const w = await world();
    await w.answer('routes', listed([]));
    const save = w.button('Save the EPUB…');
    save.focus();
    save.click(); // Return on the focused button
    // The Save box has the focus now; when it closes, the window's own
    // handler (main.js) puts it on the page's first live stop, which with
    // every route button dead is the reach table.
    w.pane.all().find((n) => n.tagName === 'SUMMARY')!.focus();
    await w.choose(null);
    expect(w.doc.activeElement).toBe(w.button('Save the EPUB…'));
    expect(w.ctx.restored).toBe(0);
  });

  test('the keyboard goes back to the route’s button after a refusal, and after a success', async () => {
    const w = await world();
    await w.answer('routes', listed([]));
    const books = w.button('Add to Apple Books');
    books.focus();
    books.click();
    expect(w.doc.activeElement).not.toBe(books); // a dead button holds nothing
    await w.answer('route', { ok: false, error: { code: 'open-failed', message: 'Books did not open.' } });
    expect(w.doc.activeElement).toBe(w.button('Add to Apple Books'));

    w.button('Add to Apple Books').click();
    await w.answer('route', { ok: true, note: 'Added to Apple Books.' });
    expect(w.doc.activeElement).toBe(w.button('Add to Apple Books'));
    // The repoll moves the brass and rebuilds the rows; the keyboard stays.
    await w.answer('routes', listed([], 'apple-books'));
    expect(w.doc.activeElement).toBe(w.button('Add to Apple Books'));
    expect(w.doc.activeElement.className).toBe('btn btn-brad');
  });

  test('a device send and the setup link hand the keyboard back the same way', async () => {
    const w = await world();
    await w.answer('routes', listed([kobo]));
    w.button('Copy to KOBOeReader').focus();
    w.button('Copy to KOBOeReader').click();
    await settle();
    await w.answer('export', { ok: false, error: { code: 'export-failed', message: 'No book.' } });
    expect(w.doc.activeElement).toBe(w.button('Copy to KOBOeReader'));

    const link = w.button('Open Amazon’s page');
    link.focus();
    link.click();
    await w.answer('route', { ok: false, error: { code: 'open-failed', message: 'No browser.' } });
    expect(w.doc.activeElement).toBe(w.button('Open Amazon’s page'));
  });

  test('a mouse press, a new script or another page leaves the keyboard where it is', async () => {
    // Nothing to put back when the keyboard was not in the list, and nothing
    // to take it from when the reader has moved on.
    const w = await world();
    await w.answer('routes', listed([]));
    const summary = w.pane.all().find((n) => n.tagName === 'SUMMARY')!;
    summary.focus();
    w.button('Add to Apple Books').click(); // a click does not focus a button in WebKit
    await w.answer('route', { ok: false, error: { code: 'x', message: 'No.' } });
    expect(w.doc.activeElement).toBe(summary);

    w.button('Add to Apple Books').focus();
    w.button('Add to Apple Books').click();
    w.pane.hidden = true; // the reader went to Read meanwhile
    await w.answer('route', { ok: false, error: { code: 'x', message: 'No.' } });
    expect(w.ctx.restored).toBe(0);
    w.pane.hidden = false;

    w.button('Add to Apple Books').focus();
    w.button('Add to Apple Books').click();
    w.ctx.state.script = { ...script(), epubPath: '/lib/other/Other.epub' };
    w.send.scriptChanged();
    if (w.asked().includes('kfx-status')) await w.answer('kfx-status', { ok: false });
    await w.answer('route', { ok: false, error: { code: 'x', message: 'No.' } });
    expect(w.ctx.restored).toBe(0);
  });

  test('a docked reMarkable is described once, in the engine’s words', async () => {
    // It never mounts, so it has no volume line; the engine's detail already
    // says how it is reached. A mounted reader keeps its volume line.
    const w = await world();
    await w.answer('routes', listed([kobo, rm]));
    const [koboRow, rmRow] = w.rows();
    expect(rmRow!.all().filter((n) => n.className === 'route-detail').map((n) => n.textContent))
      .toEqual(['the EPUB, over its USB connection']);
    expect(rmRow!.all().some((n) => n.className === 'device-where')).toBe(false);
    expect(koboRow!.all().find((n) => n.className === 'device-where')!.textContent).toBe('/Volumes/KOBOeReader');
  });

  test('Apple Books: every button dead while it runs, the engine’s note after, then the list again', async () => {
    const w = await world();
    await w.answer('routes', listed([kindle], 'device:kindle'));
    w.button('Add to Apple Books').click();
    expect(w.status().textContent).toBe('Opening Apple Books…');
    expect(w.buttons().every((b) => b.disabled)).toBe(true);
    // The poll leaves the rows alone while it runs.
    w.poll();
    expect(w.asked()).toEqual(['route']);
    const args = await w.answer('route', { ok: true, key: 'apple-books', note: 'Added to Apple Books.' });
    expect(args).toEqual(['route', 'apple-books', EPUB, '--json']);
    expect(w.status().textContent).toBe('Added to Apple Books.');
    expect(w.status().classList.contains('bad')).toBe(false);
    expect(w.buttons().every((b) => !b.disabled)).toBe(true);
    // Asked again at once, so the brass moves to the route just used.
    expect(w.asked()).toEqual(['routes']);
    await w.answer('routes', listed([kindle], 'apple-books'));
    expect(w.button('Add to Apple Books').className).toBe('btn btn-brad');
    expect(w.button('Copy to Kindle').className).toBe('btn btn-outline');
  });

  test('a refused route says the engine’s sentence as an alarm, and asks for nothing more', async () => {
    const w = await world();
    await w.answer('routes', listed([]));
    w.button('Send to Kindle web').click();
    await w.answer('route', { ok: false, error: { code: 'open-failed', message: 'Could not open the page.' } });
    expect(w.status().textContent).toBe('Could not open the page.');
    expect(w.status().classList.contains('bad')).toBe(true);
    expect(w.asked()).toEqual([]);
  });

  test('an older poll that lands after the repoll cannot put the brass back', async () => {
    const w = await world();
    await w.answer('routes', listed([], 'save-kindle'));
    w.poll(); // out before the route below starts...
    w.button('Add to Apple Books').click();
    await w.answer('route', { ok: true, note: 'Added to Apple Books.' });
    expect(w.asked()).toEqual(['routes', 'routes']);
    await w.answerNewest('routes', listed([], 'apple-books'));
    await w.answer('routes', listed([], 'save-kindle')); // ...and back last
    expect(w.button('Add to Apple Books').className).toBe('btn btn-brad');
  });

  test('Save the EPUB: the Save box first, named after the book; a cancel does nothing and says nothing', async () => {
    const w = await world();
    await w.answer('routes', listed([]));
    w.button('Save the EPUB…').click();
    expect(w.asked()).toEqual([]);
    const options = await w.choose(null);
    expect(options).toEqual({ defaultPath: 'Field Station.epub', filters: [{ name: 'EPUB', extensions: ['epub'] }] });
    expect(w.asked()).toEqual([]);
    expect(w.status().textContent).toBe('');
    expect(w.buttons().every((b) => !b.disabled)).toBe(true);

    w.button('Save the EPUB…').click();
    await w.choose('/Users/me/Desktop/Field Station.epub');
    expect(w.status().textContent).toBe('Saving…');
    const args = await w.answer('route', { ok: true, key: 'save-epub', path: '/Users/me/Desktop/Field Station.epub', note: 'Saved.' });
    expect(args).toEqual(['route', 'save-epub', EPUB, '--json', '--out', '/Users/me/Desktop/Field Station.epub']);
    expect(w.status().textContent).toBe('Saved.');
    expect(w.asked()).toEqual(['routes']);
    await w.answer('routes', listed([], 'save-epub'));
  });

  test('Save a Kindle file: built first with this script’s settings, then the Save box, then the copy', async () => {
    const w = await world();
    await w.answer('routes', listed([]));
    w.button('Save a Kindle file…').click();
    await settle(); // past ensureSettings(), which has nothing to fetch here
    expect(w.status().textContent).toBe('Building the Kindle file (Kindle Previewer can take about twenty seconds)…');
    expect(w.dialogs).toEqual([]);
    const options = JSON.stringify({ dialogueSideMarginPct: 27 });
    const built = await w.answer('export', {
      ok: true, path: '/lib/field-station/Field Station.azw3', extension: 'azw3', label: 'AZW3 for USB sideload',
    });
    expect(built).toEqual(['export', EPUB, '--json', '--for', 'kindle', '--fountain', FOUNTAIN, '--options-json', options]);
    // The wait is over while the Save box is up.
    expect(w.status().textContent).toBe('');
    const dialog = await w.choose('/Users/me/Desktop/Field Station.azw3');
    expect(dialog).toEqual({
      defaultPath: 'Field Station.azw3', filters: [{ name: 'AZW3 for USB sideload', extensions: ['azw3'] }],
    });
    const args = await w.answer('route', { ok: true, key: 'save-kindle', note: 'Saved the AZW3.' });
    expect(args).toEqual([
      'route', 'save-kindle', EPUB, '--json', '--out', '/Users/me/Desktop/Field Station.azw3',
      '--fountain', FOUNTAIN, '--options-json', options,
    ]);
    expect(w.status().textContent).toBe('Saved the AZW3.');
    await w.answer('routes', listed([], 'save-kindle'));
  });

  test('Save a Kindle file: a refused build is said, and no Save box opens; a cancel after it asks nothing more', async () => {
    const w = await world();
    await w.answer('routes', listed([]));
    w.button('Save a Kindle file…').click();
    await settle();
    await w.answer('export', { ok: false, error: { code: 'export-failed', message: 'Calibre could not build it.' } });
    expect(w.dialogs).toEqual([]);
    expect(w.status().textContent).toBe('Calibre could not build it.');
    expect(w.status().classList.contains('bad')).toBe(true);
    expect(w.asked()).toEqual([]);

    w.button('Save a Kindle file…').click();
    await settle();
    await w.answer('export', { ok: true, path: '/lib/x.kfx', extension: 'kfx', label: 'KFX' });
    await w.choose(null);
    expect(w.asked()).toEqual([]);
    expect(w.status().textContent).toBe('');
    expect(w.buttons().every((b) => !b.disabled)).toBe(true);
  });

  test('a script replaced mid-route hears nothing about it', async () => {
    const w = await world();
    await w.answer('routes', listed([]));
    w.button('Add to Apple Books').click();
    w.ctx.state.script = { ...script(), epubPath: '/lib/other/Other.epub' };
    w.send.scriptChanged();
    // The new page's KFX block asks about the machine; not this test's business.
    if (w.asked().includes('kfx-status')) await w.answer('kfx-status', { ok: false });
    await w.answer('route', { ok: true, note: 'Added to Apple Books.' });
    expect(w.status().textContent).toBe('');
    // No repoll for the old script's route either.
    expect(w.asked()).toEqual([]);
  });

  test('the email row carries its first-time step, and the link asks the engine to open Amazon’s page', async () => {
    const w = await world();
    await w.answer('routes', listed([]));
    const email = w.rows().find((r) => r.textContent.startsWith('Send to Kindle email'))!;
    expect(email.textContent).toContain('First time? Amazon needs your sender address approved');
    const link = email.querySelectorAll('button').find((b) => b.textContent === 'Open Amazon’s page')!;
    expect(link.className).toBe('btn-quiet');
    link.click();
    expect(w.status().textContent).toBe('Opening Amazon’s page…');
    expect(await w.answer('route', { ok: true, note: 'Opened Amazon’s page.' }))
      .toEqual(['route', 'kindle-email-setup', '--json']);
    expect(w.status().textContent).toBe('Opened Amazon’s page.');
    await w.answer('routes', listed([]));
  });

  test('a dimmed email row still offers the setup link, and no send button', async () => {
    const w = await world();
    await w.answer('routes', listed([], undefined, false));
    const email = w.rows().find((r) => r.textContent.startsWith('Send to Kindle email'))!;
    expect(email.className).toContain('route-unavailable');
    expect(email.querySelectorAll('button').map((b) => b.textContent)).toEqual(['Open Amazon’s page']);
  });

  test('a device row still exports then sends, and the list is asked for again after', async () => {
    const w = await world();
    await w.answer('routes', listed([kobo]));
    w.button('Copy to KOBOeReader').click();
    await settle();
    const exported = await w.answer('export', { ok: true, path: EPUB, extension: 'epub', label: 'EPUB' });
    expect(exported.slice(0, 5)).toEqual(['export', EPUB, '--json', '--for', 'epub']);
    const sent = await w.answer('send', { ok: true, destination: '/Volumes/KOBOeReader/Field Station.epub' });
    expect(sent).toEqual(['send', EPUB, '--json', '--device', '/Volumes/KOBOeReader']);
    expect(w.status().textContent).toContain('Sent to KOBOeReader');
    expect(w.asked()).toEqual(['routes']);
    await w.answer('routes', listed([kobo], 'device:kobo'));
    expect(w.button('Copy to KOBOeReader').className).toBe('btn btn-brad');
  });
});
