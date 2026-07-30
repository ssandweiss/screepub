#!/usr/bin/env bash
# Dev build: host-arch Screepub.app, ad-hoc signed. No Xcode required.
set -euo pipefail
source "$(cd "$(dirname "$0")" && pwd)/build-lib.sh"
sp_paths
sp_build_engine
sp_build_icon
# Nearest tag + distance + sha (e.g. 0.3.0-1-g965cb10, -dirty if modified),
# so parallel dev builds are tellable apart in the UI. Releases pass the tag.
version="$(git -C "$REPO_DIR" describe --tags --always --dirty 2>/dev/null || echo 0.0.0-dev)"
sp_assemble_bundle "${version#v}"
codesign --force --deep -s - "$BUNDLE"
echo "built: $BUNDLE"
