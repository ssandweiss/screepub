#!/usr/bin/env bash
# Render site/og-card.html to site/og.png at 1200x630, the size every social
# unfurler expects. Headless Chrome because nothing else on a stock Mac
# rasterises HTML+webfonts faithfully. Re-run after editing og-card.html.
set -euo pipefail
cd "$(dirname "$0")/.."
CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
[ -x "$CHROME" ] || { echo "Google Chrome not found at $CHROME" >&2; exit 1; }
"$CHROME" --headless --disable-gpu --hide-scrollbars \
  --screenshot="$PWD/site/og.png" --window-size=1200,630 \
  --default-background-color=00000000 \
  "file://$PWD/site/og-card.html" >/dev/null 2>&1
sips -g pixelWidth -g pixelHeight site/og.png
