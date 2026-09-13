import { describe, test, expect } from 'bun:test';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { TARGETS } from '../tools/build-cli';

const WORKFLOWS = '.github/workflows';
const read = (p: string) => readFileSync(p, 'utf8');

const MACOS_ASSETS = [
  'Screepub-macOS.dmg',
  'screepub-cli-macos-arm64.tar.gz',
  'screepub-cli-macos-x64.tar.gz',
];

describe('the macOS release path is untouched by the cross-platform builder', () => {
  test('the cross builder emits no macOS artifact, by name or by target', () => {
    // app/release.sh signs and NOTARIZES the macOS binaries, which needs
    // Apple's toolchain on a Mac. A cross-compiled Mach-O could not be
    // notarized, so an added darwin row here would quietly replace a
    // Gatekeeper-clean download with a warning screen.
    for (const t of TARGETS) {
      expect(t.bunTarget).not.toContain('darwin');
      expect(t.format.startsWith('macho')).toBe(false);
      expect(t.archiveName.toLowerCase()).not.toContain('macos');
      expect(t.archiveName.toLowerCase()).not.toContain('darwin');
    }
    for (const name of MACOS_ASSETS) {
      expect(TARGETS.some((t) => t.archiveName === name)).toBe(false);
    }
  });

  test('app/release.sh still produces the two tarballs and the DMG', () => {
    const sh = read('app/release.sh');
    expect(sh).toContain('screepub-cli-macos-$ARCH.tar.gz');
    expect(sh).toContain('Screepub-macOS.dmg');
    expect(sh).toContain('notarytool submit');
  });

  test('tools/bump-tap.sh still names exactly the macOS assets, and nothing else', () => {
    // The Homebrew tap serves the macOS CLI. It must not learn about the
    // Linux or Windows artifacts: brew has no business installing either,
    // and tap-freshness.yml would go red on a formula it cannot audit.
    const sh = read('tools/bump-tap.sh');
    for (const name of MACOS_ASSETS) expect(sh).toContain(name);
    expect(sh.toLowerCase()).not.toContain('linux');
    expect(sh.toLowerCase()).not.toContain('windows');
    for (const t of TARGETS) expect(sh).not.toContain(t.archiveName);
  });
});

describe('every workflow action is pinned to a commit', () => {
  test('no `uses:` rides a mutable tag', () => {
    const offenders: string[] = [];
    for (const file of readdirSync(WORKFLOWS).filter((f) => f.endsWith('.yml'))) {
      for (const line of read(join(WORKFLOWS, file)).split('\n')) {
        const m = /^\s*-?\s*uses:\s*(\S+)/.exec(line);
        if (!m) continue;
        if (!/@[0-9a-f]{40}$/.test(m[1]!)) offenders.push(`${file}: ${m[1]}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});

interface Job {
  'runs-on'?: string;
  needs?: string | string[];
  permissions?: Record<string, string>;
  steps?: { name?: string; uses?: string; run?: string; shell?: string; with?: Record<string, unknown> }[];
}
interface Workflow {
  jobs: Record<string, Job>;
}

const workflow = (file: string): Workflow =>
  Bun.YAML.parse(read(join(WORKFLOWS, file))) as Workflow;

const runText = (job: Job): string => (job.steps ?? []).map((s) => s.run ?? '').join('\n');

describe('ci.yml cross-compiles on every push', () => {
  const ci = workflow('ci.yml');

  test('a cross-cli job builds every target on a free runner', () => {
    const job = ci.jobs['cross-cli'];
    expect(job).toBeDefined();
    expect(job!['runs-on']).toBe('ubuntu-latest');
    const text = runText(job!);
    expect(text).toContain('tools/build-cli.ts');
    // No --only: the point is that ALL THREE targets keep compiling.
    expect(text).not.toContain('--only');
  });

  test('it runs the linux-x64 artifact rather than only building it', () => {
    const text = runText(ci.jobs['cross-cli']!);
    expect(text).toContain('screepub-cli-linux-x64.tar.gz');
    expect(text).toContain('tools/smoke-cli.ts');
  });

  test('the macOS artifact job is untouched and still runs epubcheck', () => {
    // The compiled-binary + epubcheck gate predates this piece and is not
    // replaced by the cheap Linux one.
    const artifact = ci.jobs['artifact'];
    expect(artifact!['runs-on']).toBe('macos-15');
    expect(runText(artifact!)).toContain('epubcheck');
  });
});
