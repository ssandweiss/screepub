#!/usr/bin/env bash
#
# tools/hooks/require-release-notes.sh
#
# Claude Code PreToolUse hook body for Bash tool calls.
#
# THIS IS AN ERGONOMICS GUARD, NOT A SECURITY BOUNDARY. It only runs when
# Claude Code is about to execute a Bash command through this hook; a tag
# typed directly into a terminal, created by a different tool, or pushed
# from another machine entirely is never intercepted. The checks that
# actually gate a release live in .github/workflows/ci.yml and the
# `checks` job of release.yml, and those run in CI no matter how the tag
# got there.
#
# Purpose: block creating or pushing a version tag (`git tag`, tag-moving
# `git push` forms, `gh release create`) when docs/releases/<version>.md
# is not committed at HEAD. Exit 2 blocks the pending tool call and shows
# stderr to the model; any other exit (this script always uses 0) lets it
# proceed.
#
# Recovery is never blocked: deleting a tag (`tag -d`) or pushing a tag
# deletion (`:refs/tags/...`) always passes, checked before anything else
# that could block. A guard that blocks the fix is worse than no guard,
# because it fires exactly when someone is already undoing a mistake.
#
# The pending command arrives as model-generated JSON on stdin, at
# .tool_input.command. That string is ONLY EVER matched against with
# plain substring/regex checks -- it is never eval'd, never passed to
# `bash -c`, and never allowed to undergo command substitution. Doing
# otherwise would let a crafted command execute before this guard, or the
# user's own permission prompt, ever sees it.

set -euo pipefail

# ---------------------------------------------------------------------
# Step 1: read stdin without ever crashing, even on no input at all.
# ---------------------------------------------------------------------
if [ -t 0 ]; then
  # Nothing piped in (e.g. run by hand with no input). Nothing to block.
  exit 0
fi

raw="$(cat 2>/dev/null || true)"

if [ -z "$raw" ]; then
  exit 0
fi

# ---------------------------------------------------------------------
# Step 2: pull .tool_input.command out of the JSON with jq. Tolerate jq
# being missing or the JSON being malformed: fall back to scanning the
# raw payload itself so a broken/absent jq degrades to "match on raw
# text", never to "crash" and never to "silently allow everything".
# ---------------------------------------------------------------------
command=""
extracted=0
if command -v jq >/dev/null 2>&1; then
  if command="$(printf '%s' "$raw" | jq -r '.tool_input.command // empty' 2>/dev/null)"; then
    extracted=1
  fi
fi

if [ "$extracted" -eq 0 ]; then
  # jq missing, or the JSON did not parse: we truly cannot read the
  # command out. Fall back to the raw payload as the text to scan. If
  # that does not look tag-touching either, we exit 0 below --
  # under-blocking on a hook malfunction beats blocking unrelated work
  # (e.g. `bun test`) just because `jq` was not on PATH.
  command="$raw"
fi

# ---------------------------------------------------------------------
# Step 3: cheap bail-out for anything that is not tag-touching, before
# doing any git work or deciding anything about recovery.
# ---------------------------------------------------------------------
is_tag_touching=0
if [[ "$command" == *"git tag"* ]]; then
  is_tag_touching=1
elif [[ "$command" == *"gh release create"* ]]; then
  is_tag_touching=1
elif [[ "$command" == *"git push"* ]] \
  && { [[ "$command" == *"--tags"* ]] || [[ "$command" == *"--follow-tags"* ]] || [[ "$command" == *"refs/tags/"* ]]; }; then
  is_tag_touching=1
fi

if [ "$is_tag_touching" -eq 0 ]; then
  exit 0
fi

# ---------------------------------------------------------------------
# Step 4: recovery forms are never blocked. Checked before version
# resolution so recovery always works even if notes are missing.
# ---------------------------------------------------------------------
if [[ "$command" == *"tag -d"* ]]; then
  exit 0
fi
if [[ "$command" == *":refs/tags/"* ]]; then
  exit 0
fi

# ---------------------------------------------------------------------
# Step 5: extract the version. Strict vX.Y.Z only, leading v stripped.
# ---------------------------------------------------------------------
version=""
if match="$(printf '%s' "$command" | grep -oE 'v[0-9]+\.[0-9]+\.[0-9]+' | head -n1)"; then
  version="${match#v}"
fi

if [ -z "$version" ]; then
  cat >&2 <<EOF
require-release-notes: blocked -- this command touches version tags but
no vX.Y.Z version could be found in it:

  $command

Failing closed: this guard cannot tell whether release notes exist for
an unresolved version, so it blocks rather than risk a tag shipping
without docs/releases/<version>.md. This is an ergonomics guard, not a
security boundary -- CI (.github/workflows/ci.yml and the release.yml
checks job) is what actually gates a release.

Run /release to create the tag and its release notes together.

This never blocks recovery: deleting a tag ("git tag -d ...") or pushing
a tag deletion (":refs/tags/...") is always allowed.
EOF
  exit 2
fi

# ---------------------------------------------------------------------
# Step 6: check git, not the filesystem. A file present in the working
# tree but not committed would otherwise pass while the tag ships
# without it.
# ---------------------------------------------------------------------
notes_path="docs/releases/${version}.md"
if git cat-file -e "HEAD:${notes_path}" 2>/dev/null; then
  exit 0
fi

cat >&2 <<EOF
require-release-notes: blocked -- ${notes_path} is not committed at HEAD.

Tagging v${version} without release notes ships a version nobody can
read the changelog for. This is an ergonomics guard, not a security
boundary -- CI (.github/workflows/ci.yml and the release.yml checks job)
is what actually gates a release.

Run /release to write ${notes_path} and create the tag together.

This never blocks recovery: deleting a tag ("git tag -d ...") or pushing
a tag deletion (":refs/tags/...") is always allowed.
EOF
exit 2
