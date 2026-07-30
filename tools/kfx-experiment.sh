#!/usr/bin/env bash
# Does a sideloaded KFX hold keeps where AZW3 doesn't?
#
# docs/formatting-options-log.md §8b records that USB-sideloaded books strand
# character cues at page bottoms, and that four CSS strategies failed to stop
# it. That testing was all done in AZW3, which is rendered by the legacy
# engine. KFX is rendered by Enhanced Typesetting, whose feature list includes
# the widow/orphan control the legacy engine lacks. §8b's conclusion may
# therefore be a fact about a FORMAT, recorded as a fact about the device.
#
# This builds the same script both ways and puts both on the Kindle, so the
# comparison is A/B on one device rather than a memory of last week.
#
#   tools/kfx-experiment.sh <script.pdf|script.fountain>
#
# Needs: Calibre + KFX Output plugin (which needs Kindle Previewer 3),
# and a Kindle mounted as a USB volume.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
INPUT="${1:?usage: kfx-experiment.sh <script.pdf|script.fountain>}"
[ -f "$INPUT" ] || { echo "no such file: $INPUT" >&2; exit 1; }

PREVIEWER="/Applications/Kindle Previewer 3.app/Contents/MacOS/Kindle Previewer 3"
WORK="$(mktemp -d)"; trap 'rm -rf "$WORK"' EXIT
STEM="KFXTEST"

say() { printf '\n\033[1m── %s\033[0m\n' "$1"; }

# 1 ── one EPUB per arm, differing ONLY in title.
#
# The Kindle lists books by their internal title, not by filename, so two
# arms built from the same script both appear as the same book and cannot
# be told apart on the device — and a missing arm looks identical to a
# duplicate. --title makes each one nameable on the shelf.
say "building both EPUBs (distinct titles so the shelf can tell them apart)"
bun "$ROOT/src/cli.ts" "$INPUT" -o "$WORK/kfx-arm.epub"  --no-fountain --title "AAA KFX TEST"
bun "$ROOT/src/cli.ts" "$INPUT" -o "$WORK/azw3-arm.epub" --no-fountain --title "AAA AZW3 TEST"
[ -f "$WORK/kfx-arm.epub" ] || { echo "engine produced no EPUB" >&2; exit 1; }

# 2 ── arm A: a real .kfx, via the KFX Output plugin (which drives Kindle
# Previewer internally, then repacks the KPF into device-ready KFX — copying
# the raw .kpf was tried first and the device never indexed it).
say "arm A — KFX (ebook-convert + KFX Output plugin)"
EBOOK_CONVERT="/Applications/calibre.app/Contents/MacOS/ebook-convert"
[ -x "$EBOOK_CONVERT" ] || { echo "calibre required for both arms" >&2; exit 1; }
"$EBOOK_CONVERT" "$WORK/kfx-arm.epub" "$WORK/AAA KFX TEST.kfx" \
  --disable-remove-fake-margins >"$WORK/kfx.log" 2>&1 \
  || { echo "KFX conversion failed:" >&2; tail -8 "$WORK/kfx.log" >&2; exit 1; }
KPF="$WORK/AAA KFX TEST.kfx"
echo "kfx: $(du -h "$KPF" | cut -f1)"

# 3 ── arm B: AZW3, the current sideload route, as control
say "arm B — AZW3 (current route)"
EBOOK_CONVERT="/Applications/calibre.app/Contents/MacOS/ebook-convert"
if [ -x "$EBOOK_CONVERT" ]; then
  # --disable-remove-fake-margins: Calibre's heuristic strips per-block side
  # margins, which flattens the dialogue column. Registry §2.
  "$EBOOK_CONVERT" "$WORK/azw3-arm.epub" "$WORK/AAA AZW3 TEST.azw3" \
    --disable-remove-fake-margins >"$WORK/calibre.log" 2>&1 \
    && echo "azw3: $(du -h "$WORK/AAA AZW3 TEST.azw3" | cut -f1)" \
    || { echo "AZW3 arm failed — see log"; tail -5 "$WORK/calibre.log"; }
else
  echo "Calibre absent — skipping the control arm"
fi

# 4 ── onto the device
say "copying to the Kindle"
KINDLE=""
for v in /Volumes/*; do [ -d "$v/documents" ] && KINDLE="$v" && break; done
[ -n "$KINDLE" ] || { echo "no Kindle mounted — plug it in and re-run" >&2; exit 1; }

rm -rf "$KINDLE"/documents/AAA*\ TEST.* "$KINDLE"/documents/AAA*\ TEST.sdr \
       "$KINDLE"/documents/KFXTEST.* "$KINDLE"/documents/KFXTEST.sdr 2>/dev/null || true
copied=0
for f in "$KPF" "$WORK/AAA AZW3 TEST.azw3"; do
  [ -f "$f" ] || continue
  cp "$f" "$KINDLE/documents/" && echo "  -> $(basename "$f")" && copied=$((copied+1))
done
[ "$copied" -gt 0 ] || { echo "nothing copied" >&2; exit 1; }
find "$KINDLE/documents" -maxdepth 1 -name "._*" -delete 2>/dev/null || true
sync

cat <<'VERDICT'

── now check on the device ─────────────────────────────────────────────
Eject the Kindle first. Open BOTH "AAA ... TEST" books and compare the SAME
place in each — page through until a character cue lands near a page
bottom.

  Does the cue sit alone at the foot of the page, with its dialogue
  overleaf?

  AZW3  strands it   -> expected; this is what §8b recorded
  KFX   strands it   -> the ceiling is the device, not the format.
                        §8b stands. Stop pursuing KFX.
  KFX   holds it     -> §8b was about AZW3, not the device. Sideloading
                        can be as good as email, offline and private.
                        That changes the roadmap.

If the KFX book does not appear on the device at all, this firmware
won't read a sideloaded .kpf — which is its own answer, and also worth
knowing.
────────────────────────────────────────────────────────────────────────
VERDICT
