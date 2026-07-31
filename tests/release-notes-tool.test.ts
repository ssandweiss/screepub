import { describe, test, expect } from 'bun:test';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { collectCommits } from '../tools/release-notes';

/** A throwaway git repo, so tests never depend on live history. */
function scratchRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), 'relnotes-'));
  const run = (cmd: string) => Bun.spawnSync(['sh', '-c', cmd], { cwd: dir });
  run('git init -q');
  run('git config user.email dev@example.com');
  run('git config user.name Dev');
  writeFileSync(join(dir, 'a.txt'), 'one');
  run('git add -A && git commit -q -m "first"');
  run('git tag v0.1.0');
  return dir;
}

describe('collectCommits', () => {
  test('returns subjects since the given tag', () => {
    const dir = scratchRepo();
    const run = (cmd: string) => Bun.spawnSync(['sh', '-c', cmd], { cwd: dir });
    writeFileSync(join(dir, 'b.txt'), 'two');
    run('git add -A && git commit -q -m "add the second thing"');

    const commits = collectCommits(dir, 'v0.1.0');
    expect(commits).toHaveLength(1);
    expect(commits[0].subject).toBe('add the second thing');
  });

  test('truncates a very long subject and strips control characters', () => {
    const dir = scratchRepo();
    const run = (cmd: string) => Bun.spawnSync(['sh', '-c', cmd], { cwd: dir });
    // \x1B is the ANSI escape introducer, written as an escape on purpose:
    // a literal control character does not survive copy-paste.
    const nasty = 'x'.repeat(400) + '\x1B[31mred';
    writeFileSync(join(dir, 'c.txt'), 'three');
    run(`git add -A && git commit -q -m ${JSON.stringify(nasty)}`);

    const [commit] = collectCommits(dir, 'v0.1.0');
    expect(commit.subject.length).toBeLessThanOrEqual(200);
    expect(commit.subject).not.toContain('\x1B');
  });
});

import { parseVerdicts, diffVerdicts } from '../tools/release-notes';

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
});

import { changedRegistryEntries } from '../tools/release-notes';

describe('changedRegistryEntries', () => {
  test('reports entries whose text differs between the two refs', () => {
    const before = `### 1. Continuous scene flow\n- **What:** scenes flow.\n\n### 2. Column\n- **What:** narrow.\n`;
    const after = `### 1. Continuous scene flow\n- **What:** scenes flow.\n- **MOBI arm:** pagebreaks.\n\n### 2. Column\n- **What:** narrow.\n`;
    expect(changedRegistryEntries(before, after)).toEqual(['1']);
  });

  test('reports a brand new entry', () => {
    const before = `### 1. One\n- a\n`;
    const after = `### 1. One\n- a\n\n### 17. Print split minimums\n- b\n`;
    expect(changedRegistryEntries(before, after)).toEqual(['17']);
  });

  test('reports nothing when the registry is untouched', () => {
    const same = `### 1. One\n- a\n`;
    expect(changedRegistryEntries(same, same)).toEqual([]);
  });
});
