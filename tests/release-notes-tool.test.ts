import { describe, test, expect } from 'bun:test';
import { existsSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  collectCommits,
  sanitize,
  parseVerdicts,
  diffVerdicts,
  changedRegistryEntries,
  isUserVisible,
} from '../tools/release-notes';

/** Run a setup command in a scratch repo and fail loudly if it didn't
 *  work, instead of silently leaving the repo half set up. Without this,
 *  ambient config (a global commit.gpgsign=true, for example) can make a
 *  `git commit` fail silently, and the failure only surfaces two calls
 *  later as a baffling "ambiguous argument" from `git log`. */
function run(dir: string, cmd: string): void {
  const proc = Bun.spawnSync(['sh', '-c', cmd], { cwd: dir });
  if (proc.exitCode !== 0) {
    throw new Error(`setup command failed (${proc.exitCode}): ${cmd}\n${proc.stderr.toString()}`);
  }
}

/** A throwaway git repo, so tests never depend on live history. gpgsign is
 *  forced off: it is a common developer-machine default and, left on,
 *  makes every `git commit` in this file fail silently in an environment
 *  that has no signing key configured for tests. */
function scratchRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), 'relnotes-'));
  run(dir, 'git init -q');
  run(dir, 'git config user.email dev@example.com');
  run(dir, 'git config user.name Dev');
  run(dir, 'git config commit.gpgsign false');
  writeFileSync(join(dir, 'a.txt'), 'one');
  run(dir, 'git add -A && git commit -q -m "first"');
  run(dir, 'git tag v0.1.0');
  return dir;
}

describe('sanitize', () => {
  // Direct unit coverage of the stated security property, independent of
  // git or shell quoting: see the collectCommits tests below for why the
  // original git-backed test could not actually prove this.
  test('strips C0 control characters and DEL, but keeps everything else', () => {
    const nasty = 'real' + '\x1B' + '[31m' + 'esc' + '\t' + 'tab' + '\x7F' + 'del';
    expect(sanitize(nasty)).toBe('real[31mesctabdel');
  });

  test('truncates to 200 characters', () => {
    expect(sanitize('x'.repeat(250))).toBe('x'.repeat(200));
  });
});

describe('collectCommits', () => {
  test('returns subjects since the given tag', () => {
    const dir = scratchRepo();
    writeFileSync(join(dir, 'b.txt'), 'two');
    run(dir, 'git add -A && git commit -q -m "add the second thing"');

    const commits = collectCommits(dir, 'v0.1.0');
    expect(commits).toHaveLength(1);
    expect(commits[0].subject).toBe('add the second thing');
  });

  test('truncates a subject longer than 200 characters', () => {
    const dir = scratchRepo();
    const long = 'x'.repeat(400);
    writeFileSync(join(dir, 'c.txt'), 'three');
    run(dir, `git add -A && git commit -q -m ${JSON.stringify(long)}`);

    const [commit] = collectCommits(dir, 'v0.1.0');
    expect(commit.subject).toBe('x'.repeat(200));
  });

  test('strips real control bytes from the subject (proved via git commit -F)', () => {
    // JSON.stringify(nasty) passed to `-m` turns a real ESC byte into the
    // six literal characters \, u, 0, 0, 1, b — git never receives a
    // control character, and a test built that way passes even with the
    // strip removed. Writing the raw bytes to a file and using `-F`
    // avoids the shell-escaping step entirely, so git receives exactly
    // the bytes below.
    const dir = scratchRepo();
    const nasty = 'real' + '\x1B' + '[31m' + 'esc' + '\t' + 'tab' + '\x7F' + 'del';
    const msgFile = join(dir, 'MSG');
    writeFileSync(msgFile, nasty);
    writeFileSync(join(dir, 'd.txt'), 'four');
    run(dir, 'git add -A');
    run(dir, `git commit -q -F ${JSON.stringify(msgFile)}`);

    const [commit] = collectCommits(dir, 'v0.1.0');
    expect(commit.subject).toBe('real[31mesctabdel');
  });

  test('returns commits oldest-first and flags authors who are not the owner', () => {
    // Both .reverse() and ownerAuthored are untestable with a single
    // fixture commit: removing .reverse() only matters with 2+ commits,
    // and there is no way to assert ownerAuthored is ever false without a
    // second author.
    const dir = scratchRepo();
    writeFileSync(join(dir, 'b.txt'), 'two');
    run(dir, 'git add -A && git commit -q -m "add the second thing"');
    run(dir, 'git config user.name "Someone Else"');
    run(dir, 'git config user.email someone@example.com');
    writeFileSync(join(dir, 'c.txt'), 'three');
    run(dir, 'git add -A && git commit -q -m "add the third thing"');

    const commits = collectCommits(dir, 'v0.1.0', 'Dev');
    expect(commits.map((c) => c.subject)).toEqual(['add the second thing', 'add the third thing']);
    expect(commits.map((c) => c.ownerAuthored)).toEqual([true, false]);
  });

  test('defaults the owner to the repo\'s own git config, not a hardcoded name', () => {
    // scratchRepo configures user.name to "Dev". The hardcoded literal
    // ('Sam Sandweiss') would mark this commit ownerAuthored: false even
    // though "Dev" is both the author and the configured owner — exactly
    // the false alarm a fork's maintainer would see on every commit.
    const dir = scratchRepo();
    writeFileSync(join(dir, 'b.txt'), 'two');
    run(dir, 'git add -A && git commit -q -m "add the second thing"');

    const [commit] = collectCommits(dir, 'v0.1.0');
    expect(commit.ownerAuthored).toBe(true);
  });

  test('sinceTag reaches git as one argv element, not a shell command', () => {
    const dir = scratchRepo();
    const marker = join(dir, 'PWNED');
    // A ref name cannot contain a space or semicolon, so git rejects this
    // as a bad revision and collectCommits throws — proving the whole
    // string reached git as ONE opaque token instead of being handed to a
    // shell that would have run `touch` as a second command.
    expect(() => collectCommits(dir, `v0.1.0 ; touch ${marker} ; echo`)).toThrow();
    expect(existsSync(marker)).toBe(false);
  });
});

const REGISTRY_BEFORE = `
### 5a. Scene heading keeps its context
- **Device verdict: pending 2026-07-30 —** does the chain bind alone?
- **Code:** src/epub/css.ts

### 16. Transitions never begin a page
- **Device verdict: pending 2026-07-30 —** does a transition start a page?

### 8c. Whole-speech keep
- **Device verdict: pending 2026-07-30 —** does a kept speech move whole?
`;

const REGISTRY_AFTER = `
### 5a. Scene heading keeps its context
- **Device verdict 2026-07-30: BINDS — the chain holds without the wrapper.**
- **Code:** src/epub/css.ts

### 16. Transitions never begin a page
- **Device verdict: pending 2026-07-30 —** does a transition start a page?

### 8c. Whole-speech keep
- **Device verdict: pending 2026-07-30 —** does a kept speech move whole?

### 17. Print split minimums
- **Device support:** KFX honors widows/orphans from fw 5.12.3.
- **Device verdict: pending —** next KFX pass.
`;

describe('verdict diffing', () => {
  test('parseVerdicts finds every entry still marked pending', () => {
    expect(parseVerdicts(REGISTRY_BEFORE).map((v) => v.entry).sort()).toEqual(['16', '5a', '8c']);
  });

  test('an entry pending at BOTH refs appears in neither bucket', () => {
    // The case that decays the section over a series: 16 and 8c were
    // pending before this cycle and are not news now.
    const { opened, resolved } = diffVerdicts(REGISTRY_BEFORE, REGISTRY_AFTER);
    const names = [...opened, ...resolved].map((v) => v.entry);
    expect(names).not.toContain('16');
    expect(names).not.toContain('8c');
  });

  test('a verdict that became pending this cycle is OPENED', () => {
    expect(diffVerdicts(REGISTRY_BEFORE, REGISTRY_AFTER).opened.map((v) => v.entry)).toEqual(['17']);
  });

  test('a verdict filled in this cycle is RESOLVED', () => {
    expect(diffVerdicts(REGISTRY_BEFORE, REGISTRY_AFTER).resolved.map((v) => v.entry)).toEqual(['5a']);
  });

  test('an opened verdict carries its Device support line, not just a number', () => {
    // "17. Print split minimums" alone cannot produce "it does nothing on
    // readers that ignore it". The drafter needs the sentence.
    expect(diffVerdicts(REGISTRY_BEFORE, REGISTRY_AFTER).opened[0].support)
      .toContain('KFX honors widows/orphans');
  });

  test('a resolved verdict carries the after-ref Device verdict sentence', () => {
    // The doc comment on diffVerdicts promises resolved "feeds ... the
    // closer": a claim you could not make last release and can now. That
    // sentence lives only in the AFTER ref; the before-ref entry only
    // ever says "pending".
    const resolved = diffVerdicts(REGISTRY_BEFORE, REGISTRY_AFTER).resolved[0];
    expect(resolved.verdict).toContain('BINDS — the chain holds without the wrapper');
  });

  test('a Device verdict sentence that wraps across a markdown line break is not truncated', () => {
    // The live registry wraps entry 5a's verdict exactly like this: the
    // bolded sentence ends on the SECOND physical line. A naive `.*$`
    // match against one physical line would clip it at "without the".
    const before = `### 5a. Wraps\n- **Device verdict: pending —** tbd\n`;
    const after =
      '### 5a. Wraps\n' +
      '- **Device verdict 2026-07-30: BINDS — the chain holds without the\n' +
      '  wrapper.** First isolated evidence follows in unbolded prose.\n';
    const resolved = diffVerdicts(before, after).resolved[0];
    expect(resolved.verdict).toBe('**Device verdict 2026-07-30: BINDS — the chain holds without the wrapper.**');
  });

  test('a Device support sentence that wraps across a markdown line break is not truncated', () => {
    const after =
      '### 17. Wraps\n' +
      '- **Device support:** KFX honors widows/orphans from fw 5.12.3 (Kindle\n' +
      '  Previewer 3.35 added them ~2019); ignored elsewhere.\n' +
      '- **Device verdict: pending —** next pass\n';
    expect(parseVerdicts(after)[0].support).toBe(
      'KFX honors widows/orphans from fw 5.12.3 (Kindle Previewer 3.35 added them ~2019); ignored elsewhere.',
    );
  });
});

describe('registry entry body boundaries', () => {
  // The file's LAST ### entry has no following ### entry, so a naive
  // "body runs to the next ENTRY heading" clamp lets it run to the end of
  // the file, swallowing whatever non-### sections come after (on the
  // live registry, an entire "## Mac app notes" tail). Both consequences
  // below are the ones the live file actually exhibits.
  test('an edit under a later non-entry heading is not attributed to the preceding entry', () => {
    const before =
      '### 15. Not-a-screenplay guard\n' +
      '- 0 scenes and 0 dialogue -> error.\n' +
      '\n' +
      '## Mac app notes\n' +
      '- some unrelated note.\n';
    const after =
      '### 15. Not-a-screenplay guard\n' +
      '- 0 scenes and 0 dialogue -> error.\n' +
      '\n' +
      '## Mac app notes\n' +
      '- a COMPLETELY DIFFERENT unrelated note.\n';
    expect(changedRegistryEntries(before, after)).toEqual([]);
  });

  test('a "pending" mention under a later non-entry heading does not make the preceding entry look pending', () => {
    const registry =
      '### 1. Resolved thing\n' +
      '- **Device verdict 2026-07-30: BINDS.**\n' +
      '\n' +
      '## Some other section\n' +
      'Prose here still says: Device verdict: pending on an unrelated topic.\n';
    expect(parseVerdicts(registry).map((v) => v.entry)).toEqual([]);
  });
});

describe('changedRegistryEntries', () => {
  test('reports entries whose text differs between the two refs', () => {
    const before = `### 1. Continuous scene flow\n- **What:** scenes flow.\n\n### 2. Column\n- **What:** narrow.\n`;
    const after = `### 1. Continuous scene flow\n- **What:** scenes flow.\n- **MOBI arm:** pagebreaks.\n\n### 2. Column\n- **What:** narrow.\n`;
    expect(changedRegistryEntries(before, after)).toEqual([
      { entry: '1', title: 'Continuous scene flow' },
    ]);
  });

  test('reports a brand new entry', () => {
    const before = `### 1. One\n- a\n`;
    const after = `### 1. One\n- a\n\n### 17. Print split minimums\n- b\n`;
    expect(changedRegistryEntries(before, after)).toEqual([
      { entry: '17', title: 'Print split minimums' },
    ]);
  });

  test('reports nothing when the registry is untouched', () => {
    const same = `### 1. One\n- a\n`;
    expect(changedRegistryEntries(same, same)).toEqual([]);
  });
});

describe('isUserVisible', () => {
  test('tools/ and tests/ only is not reader-visible (this branch\'s own case)', () => {
    expect(isUserVisible(['tools/release-notes.ts', 'tests/release-notes-tool.test.ts'])).toBe(false);
  });

  test('docs/, tests/ and .github/ together are still not reader-visible', () => {
    expect(isUserVisible(['docs/formatting-options-log.md', 'tests/x.test.ts', '.github/workflows/ci.yml'])).toBe(
      false,
    );
  });

  test('a change under src/ is reader-visible', () => {
    expect(isUserVisible(['src/epub/css.ts', 'tests/x.test.ts'])).toBe(true);
  });
});
