#!/usr/bin/env bash
#
# tools/bump-tap.sh <version> <tap-checkout>
#
# Rewrite a homebrew-tap checkout to serve <version>. Edits only; it does
# not commit, so it can be run locally to see the diff, and release.yml's
# `tap` job does the committing.
#
# WHY A SCRIPT AND NOT YAML: this is the step that has silently failed
# before. Inline in a workflow it can only be tested by cutting a release.
# Here it can be run against a real checkout, and its most useful property
# checked directly: run it at the version the tap already serves and the
# diff must be EMPTY.
#
# SHAs come from the digests GitHub reports for the release assets, so
# nothing is downloaded and nothing is re-hashed. The release body quotes
# the same values, but that is prose; this is the API's own record.
#
# bash 3.2 safe (macOS runners): no arrays, no process substitution. A
# bash-3.2 array trap has already killed one release here after
# notarization.
set -euo pipefail

VERSION="${1:-}"
TAP="${2:-}"
if [ -z "$VERSION" ] || [ -z "$TAP" ]; then
  echo "usage: tools/bump-tap.sh <version> <tap-checkout>" >&2
  exit 2
fi
VERSION="${VERSION#v}"
REPO="${SCREEPUB_REPO:-ssandweiss/screepub}"

CASK="$TAP/Casks/screepub.rb"
FORMULA="$TAP/Formula/screepub.rb"
for f in "$CASK" "$FORMULA"; do
  [ -f "$f" ] || { echo "not a tap checkout: $f missing" >&2; exit 1; }
done

digest() {
  gh api "repos/$REPO/releases/tags/v$VERSION" \
    -q ".assets[] | select(.name == \"$1\") | .digest" 2>/dev/null \
    | sed 's/^sha256://'
}
DMG_SHA="$(digest Screepub-macOS.dmg || true)"
ARM_SHA="$(digest screepub-cli-macos-arm64.tar.gz || true)"
X64_SHA="$(digest screepub-cli-macos-x64.tar.gz || true)"

# Check the SHAPE, not merely that something came back. For a tag with no
# release, `gh api` prints its 404 JSON body on STDOUT — so a non-empty
# answer is not evidence of success, and an emptiness test happily wrote
# `{"message":"Not Found",...}` into the tap as a checksum. Caught by
# running the failure case rather than reasoning about it.
#
# Called plainly, never inside $(...): `exit` in a command substitution
# only leaves the subshell, which is the same class of trap.
check_sha() { # <value> <asset-name>
  if [ ${#1} -ne 64 ] || [ -n "$(printf '%s' "$1" | tr -d '0-9a-f')" ]; then
    echo "bump-tap: no usable sha256 for $2 at v$VERSION" >&2
    echo "bump-tap: got: ${1:-<empty>}" >&2
    echo "bump-tap: is release v$VERSION published, with its assets uploaded?" >&2
    exit 1
  fi
}
check_sha "$DMG_SHA" Screepub-macOS.dmg
check_sha "$ARM_SHA" screepub-cli-macos-arm64.tar.gz
check_sha "$X64_SHA" screepub-cli-macos-x64.tar.gz

# --- cask: an explicit version stanza, and the DMG's sha256 -------------
# Anchored to line starts so nothing inside a comment or a url can match.
/usr/bin/sed -i.bak \
  -e "s|^  version \".*\"|  version \"$VERSION\"|" \
  -e "s|^  sha256 \".*\"|  sha256 \"$DMG_SHA\"|" \
  "$CASK"
rm -f "$CASK.bak"

# --- formula: no version stanza (it audits as redundant), so the tag is
# literal in BOTH urls, and each sha256 is the line after its own url.
# Positional by design: keyed off the url immediately above it, so the two
# checksums can never be swapped.
awk -v arm="$ARM_SHA" -v x64="$X64_SHA" -v v="$VERSION" '
  /screepub-cli-macos-arm64\.tar\.gz/ {
    sub(/\/download\/v[^\/]*\//, "/download/v" v "/"); print; want = "arm"; next
  }
  /screepub-cli-macos-x64\.tar\.gz/ {
    sub(/\/download\/v[^\/]*\//, "/download/v" v "/"); print; want = "x64"; next
  }
  want != "" && /^[[:space:]]*sha256 "/ {
    sub(/"[0-9a-f]*"/, "\"" (want == "arm" ? arm : x64) "\""); print; want = ""; next
  }
  { print }
' "$FORMULA" > "$FORMULA.new"
mv "$FORMULA.new" "$FORMULA"

# --- prove the edits actually landed -----------------------------------
# Both rewrites are pattern matches against a structure this script
# assumes. If the tap is ever restructured, the patterns stop matching and
# every edit becomes a silent no-op that commits cleanly and serves the
# OLD version — the exact shape of failure this whole thread is about. So
# assert the result rather than trusting the substitution.
fail() { echo "bump-tap: $1" >&2; exit 1; }
grep -q "^  version \"$VERSION\"\$"   "$CASK"    || fail "cask version did not take"
grep -q "^  sha256 \"$DMG_SHA\"\$"    "$CASK"    || fail "cask sha256 did not take"
grep -q "/download/v$VERSION/screepub-cli-macos-arm64\.tar\.gz" "$FORMULA" \
  || fail "formula arm64 url did not take"
grep -q "/download/v$VERSION/screepub-cli-macos-x64\.tar\.gz"   "$FORMULA" \
  || fail "formula x64 url did not take"
grep -q "\"$ARM_SHA\"" "$FORMULA" || fail "formula arm64 sha256 did not take"
grep -q "\"$X64_SHA\"" "$FORMULA" || fail "formula x64 sha256 did not take"
if grep -q "/download/v[^/]*/" "$FORMULA" \
   && grep "/download/v[^/]*/" "$FORMULA" | grep -qv "/download/v$VERSION/"; then
  fail "formula still carries a url for some other version"
fi

echo "tap rewritten to $VERSION"
echo "  cask    dmg   $DMG_SHA"
echo "  formula arm64 $ARM_SHA"
echo "  formula x64   $X64_SHA"
