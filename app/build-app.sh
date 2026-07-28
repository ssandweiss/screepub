#!/usr/bin/env bash
# Dev build: host-arch Screepub.app, ad-hoc signed. No Xcode required.
set -euo pipefail
source "$(cd "$(dirname "$0")" && pwd)/build-lib.sh"
sp_paths
sp_build_engine
sp_build_icon
sp_assemble_bundle "0.1.0-dev"
codesign --force --deep -s - "$BUNDLE"
echo "built: $BUNDLE"
