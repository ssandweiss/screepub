// Runs src/export/kfx.ts's plugin install snippet for real, under the
// system python3, against a stand-in for the few `calibre.*` names it
// imports. The snippet is Python inside a TypeScript string, so a test that
// only reads its text (where an except clause sits, which line comes first)
// passes on a snippet that fails the moment Python runs it. This runs it.
//
// The real Calibre is never involved: the stand-in package lives in a
// scratch folder put FIRST on PYTHONPATH, user site-packages are switched off, and
// the two network fetches are answered from a scenario file instead of the
// network. The snippet reaches the stubs through installKfxPlugin's own
// runner seam, so the JSON parsing on our side runs too.
//
// What each stub does is set by a scenario (see SnippetScenario), and every
// call the snippet makes into the stubs is appended to a log, one event per
// line, so a test can check the ORDER things happened in.
import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

/** python3, when the machine has one that runs. Null otherwise, and the
 *  tests that need it skip. */
export function systemPython(): string | null {
  const r = spawnSync('python3', ['-c', 'import bz2, json, zipfile; print("ok")'], {
    encoding: 'utf8',
  });
  return r.status === 0 && r.stdout.trim() === 'ok' ? 'python3' : null;
}

export interface StubPlugin {
  name: string;
  /** True when Calibre lists it among its conversion OUTPUT plugins. */
  output: boolean;
}

export interface SnippetScenario {
  /** The index fetch: 'offline' raises, 'ok' answers with an entry for
   *  KFX Output, 'no-file' answers with an entry that has no 'file'. */
  index: 'offline' | 'ok' | 'no-file';
  /** The zip download: 'offline' raises, 'ok' returns a zip holding an
   *  __init__.py, 'not-plugin' returns a zip without one. */
  zip: 'offline' | 'ok' | 'not-plugin';
  /** Added to the zip's real size when the index states it, so a non-zero
   *  value is a size mismatch. */
  sizeDelta?: number;
  /** What Calibre already has installed. */
  plugins: StubPlugin[];
  /** When set, add_plugin raises with this message. */
  addFails?: string;
  /** When true, the stub plugin_updater module has no INDEX_URL, so the
   *  snippet's imports fail before anything else runs. */
  noIndexUrl?: boolean;
}

const CALIBRE_INIT = `
import json, os, urllib.request

LOG = os.environ['SCREEPUB_STUB_LOG']
with open(os.environ['SCREEPUB_STUB_SCENARIO']) as f:
    SCENARIO = json.load(f)

def log(event):
    with open(LOG, 'a') as f:
        f.write(event + '\\n')

def zip_bytes():
    import io, zipfile
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, 'w') as z:
        if SCENARIO['zip'] != 'not-plugin':
            z.writestr('__init__.py', 'x = 1\\n')
        z.writestr('kfxlib/stub.py', 'y = 2\\n')
    return buf.getvalue()

class _Response:
    def __init__(self, data):
        self._data = data
    def read(self):
        return self._data

def _urlopen(url, timeout=None):
    log('zip ' + url)
    if SCENARIO['zip'] == 'offline':
        raise OSError('<urlopen error [Errno 8] nodename nor servname provided>')
    return _Response(zip_bytes())

# The snippet calls urllib.request.urlopen by attribute at call time, after
# it has imported calibre, so replacing the attribute here answers its zip
# download without any network.
urllib.request.urlopen = _urlopen
`;

const HTTPS = `
import bz2, json
from calibre import SCENARIO, log, zip_bytes

def get_https_resource_securely(url):
    log('index ' + url)
    if SCENARIO['index'] == 'offline':
        raise OSError('<urlopen error [Errno 8] nodename nor servname provided>')
    entry = {'version': [2, 20, 1], 'size': len(zip_bytes()) + SCENARIO.get('sizeDelta', 0)}
    if SCENARIO['index'] != 'no-file':
        entry['file'] = 'kfx_output.zip'
    return bz2.compress(json.dumps({'KFX Output': entry}).encode('utf-8'))
`;

const PLUGIN_UPDATER = `
from calibre import SCENARIO
if not SCENARIO.get('noIndexUrl'):
    INDEX_URL = 'https://stub.invalid/plugins/index.json.bz2'
`;

const CUSTOMIZE_UI = `
import os
from calibre import SCENARIO, log

class _Plugin:
    def __init__(self, name):
        self.name = name

_installed = [_Plugin(p['name']) for p in SCENARIO['plugins']]

def initialized_plugins():
    return iter(_installed)

def output_format_plugins():
    return iter([p for p, s in zip(_installed, SCENARIO['plugins']) if s['output']])

def remove_plugin(p):
    log('remove ' + p.name)

def add_plugin(path):
    log('add ' + ('zip-present' if os.path.exists(path) else 'zip-missing'))
    if SCENARIO.get('addFails'):
        raise RuntimeError(SCENARIO['addFails'])
`;

export interface SnippetRun {
  /** The runner to hand installKfxPlugin: it runs argv[2] (the snippet)
   *  under python3 with the stubs, ignoring the calibre-debug path. */
  run: (argv: string[]) => Promise<{ code: number; stdout: string; stderr: string }>;
  /** Every stub call, in order: 'index <url>', 'zip <url>',
   *  'remove <name>', 'add zip-present'. */
  events: () => string[];
  /** The raw stdout and stderr of the last run, for a failing test's message. */
  last: () => { stdout: string; stderr: string };
}

/** A stub package for one scenario, written into `dir`: an empty folder
 *  the caller makes inside its own scratch folder and removes (the rule in
 *  tests/temp-hygiene.test.ts, which is why this module makes none). */
export function snippetStubs(dir: string, python: string, scenario: SnippetScenario): SnippetRun {
  const pkg = join(dir, 'calibre');
  for (const sub of ['', 'utils', 'gui2', 'gui2/dialogs', 'customize']) {
    mkdirSync(join(pkg, sub), { recursive: true });
    if (sub !== '') writeFileSync(join(pkg, sub, '__init__.py'), '');
  }
  writeFileSync(join(pkg, '__init__.py'), CALIBRE_INIT);
  writeFileSync(join(pkg, 'utils', 'https.py'), HTTPS);
  writeFileSync(join(pkg, 'gui2', 'dialogs', 'plugin_updater.py'), PLUGIN_UPDATER);
  writeFileSync(join(pkg, 'customize', 'ui.py'), CUSTOMIZE_UI);
  const scenarioPath = join(dir, 'scenario.json');
  writeFileSync(scenarioPath, JSON.stringify(scenario));
  const logPath = join(dir, 'events.log');
  let last = { stdout: '', stderr: '' };
  return {
    run: async (argv) => {
      rmSync(logPath, { force: true });
      const r = spawnSync(python, ['-c', argv[2]!], {
        encoding: 'utf8',
        env: {
          ...process.env,
          PYTHONPATH: dir,
          PYTHONNOUSERSITE: '1',
          PYTHONDONTWRITEBYTECODE: '1',
          SCREEPUB_STUB_LOG: logPath,
          SCREEPUB_STUB_SCENARIO: scenarioPath,
        },
        timeout: 30_000,
      });
      last = { stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
      return { code: r.status ?? 1, stdout: last.stdout, stderr: last.stderr };
    },
    events: () =>
      existsSync(logPath) ? readFileSync(logPath, 'utf8').split('\n').filter((l) => l !== '') : [],
    last: () => last,
  };
}
