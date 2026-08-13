# Screepub

[![Release](https://img.shields.io/github/v/release/ssandweiss/screepub?cacheSeconds=300)](https://github.com/ssandweiss/screepub/releases/latest)
[![License: AGPL-3.0](https://img.shields.io/badge/license-AGPL--3.0-blue)](LICENSE)
![macOS 14+](https://img.shields.io/badge/macOS-14%2B-black?logo=apple)

**Read screenplays on your Kindle the way they're meant to be read.**

<p align="center">
  <a href="https://github.com/ssandweiss/screepub/releases/latest/download/Screepub-macOS.dmg">
    <strong>⬇️ Download for macOS</strong>
  </a>
  &nbsp;·&nbsp;
  <a href="https://screepub.com"><strong>screepub.com</strong></a>
</p>

<p align="center">
  <img src="assets/screenshot-drop.png" alt="Screepub's window, waiting for a screenplay PDF" width="46%">
  <img src="assets/screenshot-result.png" alt="The same window after converting, offering to preview, save, or send to Kindle" width="46%">
</p>

You get scripts as PDFs, and an ordinary PDF-to-ebook converter wrecks them:
dialogue collapses into paragraphs and character names drift away from their
lines. Screepub reads how the scenes, cues and dialogue actually sit on the
page and rebuilds a real e-book from that structure, so it reflows at any text
size and still holds its shape.

## What it does

- **Drop a PDF, get a clean e-book.** No settings to wrestle with first.
- **Send it straight to your reader.** Plug in a Kindle and it copies over in
  the right format, or save a copy and email it yourself.
- **Look before you send.** A built-in reader shows exactly how the script will
  read on the device, with margins, spacing and page numbers updating live.
- **Built for real scripts.** Dual dialogue, revision marks, watermarks,
  page-break interruptions and offbeat character cues, plus bold, italic and
  underline surviving the trip.
- **Free and open source.** No account, no subscription, nothing uploaded.

![The built-in reader, with the formatting rail open beside a converted script](assets/screenshot-reader.png)

*Everything on the right updates the page on the left, and what you see is what
the e-reader gets.*

## Which readers?

Screepub was built for the **Kindle**, and that's the device it's actually been
tested on. On an **iPhone or iPad**, *Open in Apple Books* gets you the sharpest
result Screepub produces: Books renders with the same engine as Safari, so it
honours the rules that keep a character cue attached to the line it introduces,
which a Kindle ignores on sideloaded files. **Kobo**, **tolino** and a docked
**reMarkable** are supported in code but have never been run on real hardware.

| Device | How it's sent | Status |
| --- | --- | --- |
| Kindle (USB mass storage) | AZW3 over USB, or the engine's MOBI | ✅ Verified on hardware, firmware 5.19.2 |
| Kindle (email) | EPUB to your `@kindle.com` address | ✅ Verified, and the better-looking route |
| Newer Kindles that don't appear as a drive | Email — see below | ✅ Use email delivery |
| iPhone / iPad / Mac (Apple Books) | Added to your Books library, syncs via iCloud | ✅ Verified, best-looking output of any route |
| Kobo | EPUB (or KEPUB) over USB | ⚠️ Built and code-tested, never run on a real device |
| tolino | EPUB into the device's `Books` folder | ⚠️ Built and code-tested, never run on a real device |
| reMarkable | Original PDF over its USB web interface | ⚠️ Built and code-tested, never run on a real device |

**If your Kindle doesn't show up as a drive**, it's one of the newer ones that
speaks MTP, a protocol macOS has no built-in support for, which is why nothing
appears in Finder either. Email it instead: see
[Emailing scripts to your Kindle](docs/send-to-kindle.md). That isn't a
consolation prize. Amazon re-typesets what you send with its modern renderer,
so scene and page breaks land where they should, while sideloading uses an
older path that can strand a character cue at the bottom of a page. **USB's
real advantage is that it works offline and your script never leaves your
machine**, which is worth choosing deliberately if the material is confidential.

The ⚠️ rows are not a hedge. They mean nobody has plugged one in. The code paths
are written and checked, but device firmware is where e-book formatting goes to
die, and I only own a Kindle. **If you own one of these, a five-minute report
either way is the single most useful thing you can send me:**
[open an issue](https://github.com/ssandweiss/screepub/issues/new/choose).

## What Screepub isn't

- **Not a screenwriting app.** It doesn't write, edit, or format scripts. It's
  for *reading* ones that already exist.
- **Not a coverage or analysis tool.** No summaries, no notes, no AI anything.
- **Not a PDF viewer.** It converts a screenplay into an e-book you read
  somewhere else, on a device built for reading.

## Install

1. **Download** the `.dmg` (button above).
2. **Open it** and drag Screepub into your Applications folder.
3. **Double-click** it. Notarized by Apple, so no security warnings to click
   through.

Or with Homebrew:

```bash
brew install --cask ssandweiss/tap/screepub
```

**Requirements:** macOS 14 (Sonoma) or later, Apple Silicon or Intel.
[Calibre](https://calibre-ebook.com) is optional and only needed for the AZW3
Kindle-sideload format.

## Your script stays on your machine

Scripts are confidential. Screepub is built accordingly.

- **No AI, no machine learning.** The conversion is ordinary code that measures
  where text sits on the page and applies screenplay layout rules. No model is
  involved, local or remote. The engine's entire dependency list is three
  libraries: a Fountain parser, a zip library, and Mozilla's PDF renderer.
- **Nothing is uploaded.** The conversion engine makes no network requests of
  any kind. Your PDF is read from disk and the e-book is written back to disk.
- **No training data, ever.** There is no server to send scripts to.
- **No accounts, no telemetry, no analytics.** Screepub does not track usage,
  report crashes, or phone home. It works fully offline.

The app touches the network in five places, each needing your click: uploading
to a **docked reMarkable** over USB (your own hardware, not the internet),
opening **Amazon's Send-to-Kindle page**, opening **GitHub** to report a bug,
**only if you opt in** asking GitHub whether a newer release exists, and
downloading that release when you choose **Install and Relaunch**.

About that update check, since "does not phone home" deserves precision: it is
**off by default**, and the first-launch page asks once. When on, it is a single
unauthenticated request to `api.github.com`, at most once a day, carrying the
app name and version and nothing else. **Install and Relaunch** verifies the
DMG's Apple signature against this project's Developer ID *and* checks it is the
exact version offered before swapping anything.

The one thing worth being clear about: **you** can choose to send a script
somewhere. If you email it to your `@kindle.com` address, Amazon receives it and
their terms apply, not ours. That's your call, and Screepub never makes it for
you.

Don't take our word for any of it. The [source is right here](src/), and the
licence guarantees it stays inspectable.

## For developers

Screepub is a three-stage pipeline (PDF → Fountain → EPUB3/MOBI) with a small
Mac app on top; the `.fountain` intermediate is kept as a durable, editable
artifact. All formatting behaviors are options (`src/options.ts`), exposed in
the app's preview window and on the CLI via `--options file.json`. The registry
with rationale for each is in [`docs/formatting-options-log.md`](docs/formatting-options-log.md).

### CLI

```bash
bun src/cli.ts <input.pdf | input.fountain> [options]
```

| Option | Effect |
| --- | --- |
| `-o, --output <file>` | EPUB path (default `<input>.epub`; companions follow it) |
| `--mobi` | also write a MOBI 6 (dependency-free USB sideload) |
| `--preview-html <file>` | also write the script as one self-contained HTML file |
| `--fountain <file>` / `--no-fountain` | intermediate `.fountain` control |
| `--options <file.json>` | formatting knobs (see the registry) |
| `--title` / `--author` | override detected metadata |
| `--force` | convert even if it doesn't look like a screenplay |
| `--json` | machine-readable result (the app↔engine contract) |
| `--progress` | NDJSON progress on **stderr** while converting |
| `--debug` | dump classified elements JSON |

`.fountain` input is partially supported: 16 of the 18 formatting options
apply, and one piece of syntax renders differently than another tool would
render it. See [Fountain input](docs/fountain-input.md).

### Development

```bash
bun test                    # engine suite
bunx tsc --noEmit           # typecheck
app/build-app.sh            # build the Mac app
(cd app && swift run -c release kit-check)   # Swift-side checks
epubcheck out.epub          # validate
```

Integration tests run against small invented screenplays in `tests/fixtures/`,
committed and regenerated by `tools/make-fixture.py`. A root-level `fixtures/`
directory is gitignored for testing against real scripts locally; tests that
need it self-skip when it's absent. Read
[`docs/screenplay-format-reference.md`](docs/screenplay-format-reference.md)
(print geometry and what Kindle's renderer actually honors) before changing
layout code. [`CONTRIBUTING.md`](CONTRIBUTING.md) has the rest.

### Architecture

```
src/
  parser/     PDF → classified elements (geometry-driven: elements are
              classified by where they sit on the page, never by regex)
  fountain/   elements → Fountain (title block, CONT'D normalization,
              dual-dialogue-safe, styled-text pass-through, font-shift
              notes; slug.ts and notes.ts are shared by both renderers)
  epub/       fountain-js tokens → EPUB3 (jszip, options-driven CSS)
  mobi/       tokens → MOBI 6 (hand-built PalmDB container)
  options.ts  FormatOptions — the single knob surface
  convert.ts  orchestration + guards
app/
  Sources/ScreepubKit/   engine bridge, transfer routes (USB/email/web)
  Sources/ScreepubApp/   script-page UI + preview window with live render
site/         screepub.com — one static page, no build step
```

## License

Screepub is licensed under the **GNU Affero General Public License v3.0 or
later** (AGPL-3.0-or-later) — see [`LICENSE`](LICENSE). You're free to use,
study, modify, and share it; but if you distribute it, or run a modified
version as a network service, the corresponding source must be made available
under the same license.

Bundled third-party components are listed in
[`THIRD-PARTY-NOTICES.md`](THIRD-PARTY-NOTICES.md), which also ships inside the
app.

Copyright © 2026 Darkwell Entertainment LLC.
