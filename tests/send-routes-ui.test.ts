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
import { beforeAll, describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import type { ConnectedDevice } from '../src/device/types';
import { preselected, routes, type Route, type RouteFacts } from '../src/export/routes';

const UI = join(new URL('..', import.meta.url).pathname, 'desktop', 'ui');

const EM_DASH = '\u2014';

type RouteDevice = { id: string; kind: string; name: string; volume: string | null };
type Status = { line: string; bad: boolean };
type SendModule = {
  NO_MESSAGE: string;
  NO_NOTE: string;
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

describe('the words this adds', () => {
  test('carry no em dash', () => {
    const lines = [
      send.NO_NOTE,
      send.emailSetupHint({ key: 'email-to-kindle' })!.line,
      send.statusFor('opening', { route: { title: 'Apple Books' } }).line,
      send.statusFor('opening').line,
      send.statusFor('saving').line,
      send.statusFor('building-kindle').line,
    ];
    for (const line of lines) expect(line).not.toContain(EM_DASH);
  });
});
