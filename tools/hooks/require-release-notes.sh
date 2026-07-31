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
# Recovery is never blocked: deleting a tag (`git tag -d ...`) or pushing
# a tag deletion (`:refs/tags/...`) always passes, checked before
# anything else that could block. A guard that blocks the fix is worse
# than no guard, because it fires exactly when someone is already undoing
# a mistake. Recovery matching is anchored to the actual command form (not
# a bare substring) and is refused outright on compound commands (`;`,
# `&&`, or an embedded newline) -- a real tag creation must not be able to
# ride along after a real tag deletion in the same line. The same
# anchoring/compound rule gates the read-only tag-listing allowlist
# (`git tag`, `--list`, `-l`, `--contains`, `--points-at`, `--sort`,
# `--merged`, `--no-merged`, `--format`), since listing tags is a normal
# step inside the release flow and must not be blocked either.
#
# `git push` is treated as tag-touching both for the explicit bulk forms
# (`--tags`, `--follow-tags`, `refs/tags/`) AND whenever the command also
# names a vX.Y.Z token, because `git push --atomic origin main v0.5.0` --
# pushing a single tag by name, no flag at all -- is the exact command the
# release flow is designed to print.
#
# Version extraction mirrors release.yml's own regex
# (`^[0-9]+\.[0-9]+\.[0-9]+(-[A-Za-z0-9.]+)?$` against the tag with the
# leading `v` stripped), so a prerelease like v0.5.0-rc1 requires
# docs/releases/0.5.0-rc1.md, not docs/releases/0.5.0.md -- CI would
# reject exactly the tag this hook would otherwise wave through. Every
# vX.Y.Z(-prerelease)? token in the command is checked, not just the
# first, so `git push --tags origin v0.5.0 v99.0.0` blocks regardless of
# which order the tags are listed in.
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
cmd=""
extracted=0
if command -v jq >/dev/null 2>&1; then
  if cmd="$(printf '%s' "$raw" | jq -r '.tool_input.command // empty' 2>/dev/null)"; then
    extracted=1
  fi
fi

if [ "$extracted" -eq 0 ]; then
  # jq missing, or the JSON did not parse: we truly cannot read the
  # command out. Fall back to the raw payload as the text to scan. If
  # that does not look tag-touching either, we exit 0 below --
  # under-blocking on a hook malfunction beats blocking unrelated work
  # (e.g. `bun test`) just because `jq` was not on PATH.
  cmd="$raw"
fi

# ---------------------------------------------------------------------
# Step 3: cheap bail-out for anything that is not tag-touching, before
# doing any git work or deciding anything about recovery.
# ---------------------------------------------------------------------
has_version_token=0
if printf '%s' "$cmd" | grep -qE 'v[0-9]+\.[0-9]+\.[0-9]+(-[A-Za-z0-9.]+)?'; then
  has_version_token=1
fi

is_tag_touching=0
if [[ "$cmd" == *"git tag"* ]]; then
  is_tag_touching=1
elif [[ "$cmd" == *"gh release create"* ]]; then
  is_tag_touching=1
elif [[ "$cmd" == *"git push"* ]] \
  && { [[ "$cmd" == *"--tags"* ]] || [[ "$cmd" == *"--follow-tags"* ]] || [[ "$cmd" == *"refs/tags/"* ]] || [ "$has_version_token" -eq 1 ]; }; then
  is_tag_touching=1
fi

if [ "$is_tag_touching" -eq 0 ]; then
  exit 0
fi

# ---------------------------------------------------------------------
# Step 4: recovery forms and read-only tag listing are never blocked.
# Both are anchored to the actual command form and refused outright on
# compound commands (`;`, `&&`, an embedded newline) -- a real tag
# creation must not be able to hide behind a delete or a listing flag
# elsewhere in the same line.
# ---------------------------------------------------------------------
is_compound=0
if [[ "$cmd" == *';'* ]] || [[ "$cmd" == *'&&'* ]] || [[ "$cmd" == *$'\n'* ]]; then
  is_compound=1
fi

if [ "$is_compound" -eq 0 ]; then
  if [[ "$cmd" =~ ^[[:space:]]*git[[:space:]]+tag[[:space:]]+-d([[:space:]]|$) ]]; then
    exit 0
  fi
  if [[ "$cmd" == *":refs/tags/"* ]]; then
    exit 0
  fi

  if [[ "$cmd" =~ ^[[:space:]]*git[[:space:]]+tag([[:space:]]+.*)?$ ]]; then
    if [[ "$cmd" =~ ^[[:space:]]*git[[:space:]]+tag[[:space:]]*$ ]]; then
      exit 0
    fi
    if [[ "$cmd" == *"--list"* ]] || [[ "$cmd" == *"--contains"* ]] || [[ "$cmd" == *"--points-at"* ]] \
      || [[ "$cmd" == *"--sort"* ]] || [[ "$cmd" == *"--merged"* ]] || [[ "$cmd" == *"--no-merged"* ]] \
      || [[ "$cmd" == *"--format"* ]] || [[ "$cmd" =~ [[:space:]]-l([[:space:]]|$) ]]; then
      exit 0
    fi
  fi
fi

# ---------------------------------------------------------------------
# Step 5: extract every vX.Y.Z(-prerelease)? token, deduplicated. Strict
# match, leading v stripped; mirrors release.yml's own version regex.
# ---------------------------------------------------------------------
versions=""
if matches="$(printf '%s' "$cmd" | grep -oE 'v[0-9]+\.[0-9]+\.[0-9]+(-[A-Za-z0-9.]+)?' | sort -u)"; then
  versions="$matches"
fi

if [ -z "$versions" ]; then
  truncated="$cmd"
  if [ "${#truncated}" -gt 200 ]; then
    truncated="${truncated:0:200}...[truncated]"
  fi
  cat >&2 <<EOF
require-release-notes: blocked -- this command touches version tags but
no vX.Y.Z version could be found in it:

  $truncated

Failing closed: this guard cannot tell whether release notes exist for
an unresolved version, so it blocks rather than risk a tag shipping
without docs/releases/<version>.md. This is an ergonomics guard, not a
security boundary -- CI (.github/workflows/ci.yml and the release.yml
checks job) is what actually gates a release.

Run /release to create the tag and its release notes together.

This never blocks recovery: deleting a tag ("git tag -d ...") or pushing
a tag deletion (":refs/tags/...") is always allowed, and neither is
read-only tag listing ("git tag", "git tag --list", ...).
EOF
  exit 2
fi

# ---------------------------------------------------------------------
# Step 6: check git, not the filesystem, for EVERY version found. A file
# present in the working tree but not committed would otherwise pass
# while the tag ships without it; checking only the first version found
# would let a second, unreleased version ride along depending on token
# order.
# ---------------------------------------------------------------------
missing=""
while IFS= read -r v; do
  [ -z "$v" ] && continue
  ver="${v#v}"
  notes_path="docs/releases/${ver}.md"
  if ! git cat-file -e "HEAD:${notes_path}" 2>/dev/null; then
    if [ -z "$missing" ]; then
      missing="$notes_path"
    else
      missing="${missing}, ${notes_path}"
    fi
  fi
done <<< "$versions"

if [ -z "$missing" ]; then
  exit 0
fi

cat >&2 <<EOF
require-release-notes: blocked -- release notes are not committed at
HEAD for: ${missing}

Tagging or pushing a version without release notes ships a version
nobody can read the changelog for. This is an ergonomics guard, not a
security boundary -- CI (.github/workflows/ci.yml and the release.yml
checks job) is what actually gates a release.

Run /release to write the missing notes and create the tag together.

This never blocks recovery: deleting a tag ("git tag -d ...") or pushing
a tag deletion (":refs/tags/...") is always allowed, and neither is
read-only tag listing ("git tag", "git tag --list", ...).
EOF
exit 2
