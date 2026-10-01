#!/usr/bin/env bash
#
# tools/check-tap.sh [version]
#
# Exit 0 if ssandweiss/homebrew-tap serves `version` (default: the newest
# published non-prerelease) with checksums matching that release's assets.
# Exit 1 otherwise, having said which part is wrong.
#
# Reads the tap FROM GITHUB, never from a checkout. That distinction is the
# entire point: the tap sat at 0.3.0 for five releases while a local
# checkout showed 0.4.2, because the edits were never committed and
# `homebrew-tap/` is hidden from `git status` by `.git/info/exclude`.
#
# Needs no secret. Both repos are public.
# bash 3.2 safe: no arrays, no process substitution.
set -euo pipefail

REPO="${SCREEPUB_REPO:-ssandweiss/screepub}"
TAP="${SCREEPUB_TAP:-ssandweiss/homebrew-tap}"

VERSION="${1:-}"
if [ -z "$VERSION" ]; then
  VERSION="$(gh release list --repo "$REPO" \
    --exclude-drafts --exclude-pre-releases --limit 1 \
    --json tagName -q '.[0].tagName')"
fi
VERSION="${VERSION#v}"
if [ -z "$VERSION" ]; then
  echo "check-tap: no published, non-prerelease release to compare against" >&2
  exit 1
fi

fetch() { gh api "repos/$TAP/contents/$1" -q .content | base64 -d; }
CASK="$(fetch Casks/screepub.rb)"
FORMULA="$(fetch Formula/screepub.rb)"

# The CASK was retired at the identifier release (owner, 2026-10-01): it is
# never bumped again, so its version is not compared. What must hold is
# that it says so: a cask that is frozen and NOT deprecated serves an old
# app to anyone who installs it, silently, which is the failure this file
# exists to catch. The formula deliberately has no `version` (it audits as
# redundant), so its version is literal in both urls, and both must agree.
FORMULA_V="$(printf '%s\n' "$FORMULA" \
  | sed -n 's|.*/releases/download/v\([^/]*\)/.*|\1|p' | sort -u)"

echo "newest release: $VERSION"
echo "cask:           $(printf '%s\n' "$CASK" | grep -q '^  deprecate! ' && echo 'retired (deprecated)' || echo 'NOT deprecated')"
echo "formula pins:   $(printf '%s' "$FORMULA_V" | tr '\n' ' ')"

FAIL=0
if ! printf '%s\n' "$CASK" | grep -q '^  deprecate! '; then
  echo "::error::the cask is frozen but carries no deprecate! stanza, so brew serves an old app without saying so"
  FAIL=1
fi
if [ "$(printf '%s\n' "$FORMULA_V" | grep -c .)" -ne 1 ]; then
  echo "::error::the formula's two download urls disagree: $(printf '%s' "$FORMULA_V" | tr '\n' ' ')"
  FAIL=1
elif [ "$FORMULA_V" != "$VERSION" ]; then
  echo "::error::the formula pins $FORMULA_V but the newest release is $VERSION"
  FAIL=1
fi

# Checksums, from the digests GitHub reports per asset, so nothing is
# downloaded. A right version with a wrong SHA still breaks every install.
digest() {
  gh api "repos/$REPO/releases/tags/v$VERSION" \
    -q ".assets[] | select(.name == \"$1\") | .digest" 2>/dev/null \
    | sed 's/^sha256://'
}
check_sha() { # <asset> <human name> <file contents>
  want="$(digest "$1" || true)"
  # Shape, not emptiness: `gh api` prints its 404 body on stdout, so a
  # non-empty answer is not evidence of success.
  if [ ${#want} -ne 64 ] || [ -n "$(printf '%s' "$want" | tr -d '0-9a-f')" ]; then
    echo "::error::release v$VERSION has no usable digest for $1"
    FAIL=1
  elif ! printf '%s\n' "$3" | grep -q "$want"; then
    echo "::error::$2 does not carry the SHA-256 of $1 ($want)"
    FAIL=1
  fi
}
check_sha "screepub-cli-macos-arm64.tar.gz" "the formula" "$FORMULA"
check_sha "screepub-cli-macos-x64.tar.gz"   "the formula" "$FORMULA"

if [ "$FAIL" -ne 0 ]; then
  echo "::notice::Bump https://github.com/$TAP — tools/bump-tap.sh does it (and deprecates the cask once), and the release run's summary carries the two SHAs. See docs/release-secrets.md."
  exit 1
fi
echo "The tap serves $VERSION, with matching checksums."
