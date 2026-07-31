# Release notes: draft, review, publish — design

Date: 2026-07-31
Status: approved (brainstorm complete)
Branch: release-notes-automation (off main)

## Goal

Every release ships notes an average reader can understand, written in a
fixed template's voice, reviewed by Sam before anything publishes, and
carried into the GitHub release automatically. Make the failure mode
(tagging a release with no notes) unreachable rather than merely detected.

Today `release.yml` hardcodes a five-line body: install instructions plus
a DMG checksum. Four releases shipped that way. There is no CHANGELOG.

## Decisions from the brainstorm

- **Who drafts:** Claude, on request, from the commits since the last tag.
  The judgment this needs (plain language, what an average reader cares
  about, what is device-verified) is not scriptable.
- **Where notes live:** one committed file per release,
  `docs/releases/<version>.md`, keyed on the version without the `v`
  (matching `package.json`, and reading well as a future website path).
- **Command scope:** drafts notes and PROPOSES the version. It also
  commits and tags. It never pushes. Pushing publishes; that stays Sam's.
  - **This widened mid-brainstorm, deliberately.** Asked first, Sam chose
    "notes plus propose the version, you bump and tag yourself." The
    later "can we prevent failure" question changed it: if the command
    does not create the tag, nothing stops a tag from existing without
    notes, and prevention degrades to detection. Commit-then-tag inside
    one command is the whole mechanism. Sam approved that framing, but it
    is called out here because it contradicts an earlier answer and is
    worth a second look. If he would rather keep tagging by hand, layers
    2 through 4 still stand and layer 1 is simply lost.
- **Honesty section:** built from `docs/formatting-options-log.md`
  entries still marked `Device verdict: pending`, not from memory.
- **Prevention over detection:** see the four layers below.

## The failure being designed against

`release.yml` reading a notes file that does not exist is an expensive
failure: the tag is already public and notarization has already burned
15 to 25 minutes (three sequential `notarytool --wait` submissions).
Recovery means deleting a public tag and re-tagging.

Four layers, cheapest first:

1. **Prevent by ordering (the real fix).** `/release` writes the notes,
   waits for approval, then commits notes + version bump and creates the
   annotated tag ON that commit. The tag cannot exist without the notes
   because one command makes both, in that order.
2. **Harness hook.** A `PreToolUse` hook blocks any Bash call creating or
   pushing a `v*` tag when `docs/releases/<version>.md` is absent at that
   commit. This enforces the rule on CLAUDE, in future sessions with no
   memory of this one. Limit, stated plainly: hooks only fire on tool
   calls made through Claude Code. A tag typed in Sam's own terminal is
   not intercepted, which is why layer 3 exists.
3. **CI backstop on main.** On every push: if `package.json`'s version
   changed, `docs/releases/<version>.md` must exist at that commit. Universal,
   covers hand-made tags, fails in seconds before a tag exists.
4. **Fail cheap in release.yml.** Validate the notes file in the FIRST
   step, before Rosetta, signing or notarization. 20 seconds, not 20
   minutes. `workflow_dispatch` already allows re-running without
   re-tagging.

**Rejected: auto-generating placeholder notes when the file is missing.**
It guarantees the job never fails and reintroduces exactly the bug this
project has: a boilerplate body nobody noticed for four releases. Silent
success is worse than a loud stop.

**The subtle trap this must handle:** notes must exist at the TAGGED
COMMIT, not merely in the working tree. Tagging first and committing
notes second yields a tag without them, and a filesystem check would pass
locally while CI fails. Every check reads `git show <ref>:<path>`, never
the filesystem.

## Deliverables

### 1. `docs/release-notes-template.md`

The durable artifact. Section shape: **New / Improved / Fixed / Good to
know**, plus an optional italic closing paragraph for the curious. Voice
rules, all derived from the approved 0.5.0 draft:

- Written for a non-technical reader (a screenwriter, producer or exec).
- KEEP screenplay vocabulary (dialogue, slugline, title page). DROP ebook
  jargon (keep, kepub, EPUB/MOBI as user-facing words, rendering engine,
  sideload, ragged-right). Say what the reader sees instead.
- No em dashes (house rule for user-facing copy). Colons and periods.
- Never claim device behavior that is not verified. Unverified goes in
  "Good to know", framed as reassurance where honest ("it does nothing on
  readers that ignore it, so it can't hurt").
- No real script titles, authors or character names, ever (standing rule).

`docs/releases/0.5.0.md` ships as the first entry, from the approved draft
now sitting at `docs/release-notes-0.5.0-draft.md` (which this work
deletes, being superseded).

### 2. `tools/release-notes.ts`

Gathers facts that must not be guessed, prints JSON. Committed and unit
tested, so the process survives without Claude Code.

- `commits`: subject lines since the last `v*` tag, flagged by whether
  each is a merge.
- `optionChanges`: keys added to or removed from `FormatOptions` in
  `src/options.ts` across that range (diff of the interface, not prose).
- `pendingVerdicts`: registry entries in `docs/formatting-options-log.md`
  whose body still contains `Device verdict: pending`, with entry number
  and title.
- `proposedVersion` + `reason`: minor when `optionChanges` is non-empty or
  any commit subject announces new behavior; patch otherwise. Never
  applied automatically.
- `userVisible`: false when the range touches only `docs/`, `tests/` and
  `.github/`. Drives the empty-release path below.

### 3. `/release` skill

Thin wrapper. Order is load-bearing:

1. Preflight: `bun test`, `bunx tsc --noEmit`, `kit-check`, plus a check
   that the target version is free: no existing `v<version>` tag and no
   existing `docs/releases/<version>.md`. (The tag itself does not exist
   yet at this point; it is created in step 5. This check catches a
   re-run against an already-released version.) Any failure stops before
   anything is written.
2. Run `tools/release-notes.ts`; show the proposed version and its reason.
3. Draft `docs/releases/<version>.md` per the template. If
   `userVisible` is false, do NOT invent features: offer a one-line
   maintenance note and say so.
4. **Stop. Show Sam the file. Wait.** Edits are his; loop until approved.
5. Commit notes + `package.json` bump together; create the annotated tag
   on that commit.
6. Print the push command. Do not run it.

### 4. `PreToolUse` hook

Matches Bash commands creating or pushing a `v*` tag. Resolves the
version from the tag, checks `git show <commit>:docs/releases/<version>.md`,
blocks with a message naming the missing path when absent.

### 5. Repo plumbing

- **`.gitignore`:** `.claude/` is currently ignored wholesale and nothing
  under it is tracked. Narrow it so `.claude/skills/` and a shared
  `.claude/settings.json` are versioned while `settings.local.json` and
  `worktrees/` stay ignored. Both newly-tracked files get read for machine
  paths and secrets before committing (this repo had a leak scare at
  publication).
- **`release.yml`:** replace the hardcoded `printf` body. Read
  `docs/releases/${VERSION}.md`; append the machine-generated install line
  and DMG SHA-256, which cannot exist before the build. Validation moves
  into the existing `checks` job, which already gates the release job.
- **`ci.yml`:** add the version-bump-requires-notes check to the existing
  `engine` job.

## Testing

`tools/release-notes.ts` gets bun tests over synthetic git state (temp
repo, scripted commits and tags) rather than the live history:

- version proposal for each shape: option added, fixes only, docs only
- `pendingVerdicts` extraction against a fixture registry, including an
  entry whose verdict was cleared (must NOT appear)
- `userVisible` false for a docs-only range
- empty range (tag at HEAD) does not crash

The hook and the CI check get proven the way this repo proves guards: make
the bad state, watch it fail, restore. For the hook, attempt a tag with no
notes file and confirm the block. For CI, a branch bumping the version
without notes must fail the job.

## Out of scope, deliberately

- **Website link.** Future. The committed file gives it a stable path.
- **In-app release notes list.** Future, and cheaper because of this: the
  updater already carries `releaseNotesURL` and opens it in a browser from
  three places; showing text in-app means adding `body` to the
  `GitHubRelease` decode in `UpdateCheck.swift`.
- **Backfilling notes for 0.1.0 through 0.4.2.** Those releases shipped
  with the boilerplate body; rewriting history is not worth it.
- **Conventional-commit enforcement.** The tool reads subjects as prose;
  it does not require a format.

## Sources

The approved 0.5.0 draft (`docs/release-notes-0.5.0-draft.md`) is the
voice reference. `docs/release-secrets.md` documents the six secrets the
release job needs. `.github/workflows/release.yml` lines 111-129 hold the
body being replaced; its `checks` job and `workflow_dispatch` entry point
already exist and are reused rather than added.
