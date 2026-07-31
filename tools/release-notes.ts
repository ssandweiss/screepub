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
