# Device map: every reading surface a screenplay EPUB could land on

Date: 2026-07-30
Status: approved (brainstorm complete)
Branch: worktree-device-map

## Goal

Catalog every e-reader and reading app that could reasonably display a
screenplay in a reflowable EPUB-like format, with every transfer route
from a Mac, so we can see which devices and routes Screepub is missing
and let that guide UX work. This is a research deliverable: no app or
engine code changes.

## Decisions from the brainstorm

- **Device scope:** tier 1 is hardware (current and legacy; Calibre's
  device-driver list is the floor for coverage). Tier 2 is major
  reading apps (Apple Books, Kindle app, Play Books, KOReader, peers).
  Oddballs (smartwatches, consoles, car displays) are out.
- **Deliverable:** `docs/device-map.md`, registry style in the spirit
  of `formatting-options-log.md`. No JSON/YAML sidecar for now.
- **Research method:** parallel background research agents running on
  Opus (not Fable), one per ecosystem cluster, with live web access.
  Fable does only coordination and synthesis.

## Structure of docs/device-map.md

1. **Transfer-method taxonomy.** USB mass storage, USB MTP, cloud sync
   services, email ingestion, on-device web upload, app share/AirDrop,
   OPDS/local wireless, SD-card sneakernet. For each: what it demands
   from a Mac app, whether it works offline (USB-first ethos is the
   organizing principle), and how a Mac can detect the opportunity.
2. **Tier 1: hardware, by ecosystem.** Kindle; Kobo; tolino;
   PocketBook; Onyx Boox and Android e-ink peers; reMarkable, Supernote
   and other note-takers; Nook; the legacy USB era (Sony, Bookeen,
   etc.); 2026-era newcomers. Per family: models/generations with
   years, formats accepted, transfer routes with the macOS detection
   mechanism for each, screenplay-rendering quirks (margin/line-height
   handling is what breaks scripts), rough install base, and what
   Screepub would need to do to support it.
3. **Tier 2: apps.** Same fields, lighter depth.
4. **The matrix.** Device family x transfer route, one glance = gaps.
5. **Gap analysis.** Current Screepub support (grounded in the code
   sweep of Device.swift, Export.swift, ExportPanel.swift, etc.)
   versus the map, ending in prioritized UX recommendations.

## Execution plan

1. Code-context sweep of current device/transfer support (running).
2. Six research agents on Opus, in parallel, one per cluster:
   Kindle; Kobo/tolino; PocketBook/Boox/Android e-ink; note-takers
   (reMarkable, Supernote, Daylight); legacy USB era + Nook; tier-2
   apps. Each returns dense structured facts with source URLs, using
   manufacturer docs, Calibre's device-driver source on GitHub, and
   MobileRead as preferred references.
3. Synthesis into `docs/device-map.md` on this branch, cross-checking
   detection claims (volume labels, VID/PID, MTP) against Calibre's
   driver source where agents disagree.

## Acceptance criteria

- Every brand with a Calibre device driver is at least classified:
  covered in a family section, or explicitly binned as legacy with a
  one-line reason.
- No matrix cell is left both empty and unexplained.
- Gap analysis cites actual Screepub code paths.
- No real script title, author, or character name appears anywhere
  (standing repo rule).

## Out of scope

- Implementing new device support or changing UI code.
- DRM: Screepub outputs are DRM-free; routes that would require
  touching a store's DRM are simply noted as closed, not explored.
