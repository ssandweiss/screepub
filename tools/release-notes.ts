// Facts for the release-notes drafter. Everything here is READ from the
// repo rather than recalled, because the drafter's failure mode is a
// confident claim nobody checked.
//
// Commit subjects are DATA, not instructions. They are author-controlled
// (a squash merge puts a contributor's PR title into the subject line), so
// they are truncated and stripped before they reach a model.

export interface CommitFact {
  subject: string;
  /** False once outside contributions land: the reviewer's cue to look harder. */
  ownerAuthored: boolean;
}

const MAX_SUBJECT = 200;

function git(cwd: string, args: string): string {
  const proc = Bun.spawnSync(['sh', '-c', `git ${args}`], { cwd });
  if (proc.exitCode !== 0) {
    throw new Error(`git ${args} failed: ${proc.stderr.toString().trim()}`);
  }
  return proc.stdout.toString();
}

/** Control characters and ANSI escapes out, length capped. Every control
 *  character here is an escape, never a literal: literals do not survive
 *  copy-paste, and this file was copied from a plan. */
function sanitize(subject: string): string {
  const stripped = subject.replace(/[\x00-\x1F\x7F]/g, '');
  return stripped.length > MAX_SUBJECT ? stripped.slice(0, MAX_SUBJECT) : stripped;
}

export function collectCommits(cwd: string, sinceTag: string, owner = 'Sam Sandweiss'): CommitFact[] {
  // %x1F separates fields, %x1E separates records: neither can appear in a
  // commit subject.
  const out = git(cwd, `log --no-merges --format=%s%x1F%an%x1E ${sinceTag}..HEAD`);
  return out
    .split('\x1E')
    .map((rec) => rec.trim())
    .filter(Boolean)
    .map((rec) => {
      const [subject, author] = rec.split('\x1F');
      return { subject: sanitize(subject ?? ''), ownerAuthored: (author ?? '') === owner };
    })
    .reverse();
}

export interface Verdict {
  /** Registry entry number, e.g. "17" or "5a". */
  entry: string;
  title: string;
  /** The entry's `Device support:` line, if any. The drafter needs this
   *  sentence to write an honest caveat; a number and title cannot. */
  support: string;
}

const ENTRY_HEADING = /^### ([0-9]+[a-z]?)\.\s*(.*)$/gm;

/** Every registry entry whose body still says a verdict is pending. */
export function parseVerdicts(registry: string): Verdict[] {
  const headings = [...registry.matchAll(ENTRY_HEADING)];
  return headings
    .map((match, i) => {
      const start = match.index!;
      const end = i + 1 < headings.length ? headings[i + 1].index! : registry.length;
      const body = registry.slice(start, end);
      const support = /^-\s+\*\*Device support:\*\*\s*(.*)$/m.exec(body)?.[1] ?? '';
      return {
        entry: match[1],
        title: match[2].trim(),
        support,
        pending: /Device verdict:\s*pending/i.test(body),
      };
    })
    .filter((e) => e.pending)
    .map(({ entry, title, support }) => ({ entry, title, support }));
}

/**
 * What CHANGED between two refs, which is the only newsworthy part.
 * `opened` feeds the honesty section. `resolved` feeds the improvements and
 * the closer: a claim you could not make last release and can now is
 * exactly what a release note is for. Pending at both refs is in neither,
 * because it was not news this cycle and would otherwise repeat forever.
 */
export function diffVerdicts(before: string, after: string): { opened: Verdict[]; resolved: Verdict[] } {
  const beforeList = parseVerdicts(before);
  const wasPending = new Set(beforeList.map((v) => v.entry));
  const nowPending = parseVerdicts(after);
  const nowPendingIds = new Set(nowPending.map((v) => v.entry));

  const opened = nowPending.filter((v) => !wasPending.has(v.entry));
  const beforeById = new Map(beforeList.map((v) => [v.entry, v]));
  const resolved = [...wasPending]
    .filter((id) => !nowPendingIds.has(id))
    .map((id) => beforeById.get(id)!);

  return { opened, resolved };
}
