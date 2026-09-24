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

### Linux and Windows (command line)

There is no window to open yet on Linux or Windows: what ships is the
converter itself, run from a terminal. From version 0.6.0 onward, download the
file for your machine from the
[latest release](https://github.com/ssandweiss/screepub/releases/latest),
unpack it, and run it. Earlier releases carry the macOS downloads only.

| Machine | File |
| --- | --- |
| Linux, Intel or AMD | `screepub-cli-linux-x64.tar.gz` |
| Linux, ARM (Asahi, Raspberry Pi, ARM servers) | `screepub-cli-linux-arm64.tar.gz` |
| Windows, 64-bit | `screepub-cli-windows-x64.zip` |

```bash
tar -xzf screepub-cli-linux-x64.tar.gz
./screepub script.pdf
```

`SHA256SUMS` on the release page covers these three files, for anyone who
wants to check what they downloaded.

**Windows will warn you.** The Windows build is unsigned: it carries no
code-signing certificate, so SmartScreen shows a "publisher unknown" screen the
first time you run it. Choose **More info**, then **Run anyway**. Certificates
cost money this project does not spend yet; this note exists so the warning is
expected rather than alarming.

**Device support off macOS is unproven.** `screepub devices` and
`screepub send` are built for all three platforms and code-tested on all
three, but the only device transfer anyone has ever run on real hardware was a
Kindle, on a Mac. Windows drive enumeration has never run against a real
reader, and a tolino cannot be detected on Windows at all: it is identified by
the name of its volume, and a Windows drive root carries none. Converting is
the part that is well tested everywhere; sending is not.

### Desktop app

From 0.6.0 there is a window as well as a command line, built on Tauri in
`desktop/` around this same engine: the app spawns the engine binary and
renders its `--json` answer, so there is exactly one implementation of
everything that thinks. It has five surfaces — convert a script, read it,
tune its formatting, send it to a reader, and the release notes.

| Machine | File |
| --- | --- |
| Linux, Debian or Ubuntu, Intel or AMD | `Screepub-linux-amd64.deb` |
| Linux, Fedora or openSUSE, Intel or AMD | `Screepub-linux-x86_64.rpm` |
| macOS, Apple Silicon or Intel | `Screepub-Desktop-macOS-universal.dmg` |
| Windows, 64-bit | `Screepub-windows-x64-setup.exe` |

These names carry no version from 0.7.2 on, so they are the same at every
release. Releases up to 0.7.1 put the version in the Linux and Windows
names.

```bash
sudo apt install ./Screepub-linux-amd64.deb      # Debian, Ubuntu
sudo dnf install ./Screepub-linux-x86_64.rpm     # Fedora
sudo zypper install ./Screepub-linux-x86_64.rpm  # openSUSE
```

`SHA256SUMS-app` on the release page covers these four files. (`SHA256SUMS`,
beside it, covers the three command-line downloads.) There is no Linux ARM
package: no ARM runner builds one, and shipping a filename nothing produces
is worse than shipping nothing. `tools/build-app-bundle.ts` makes one by
hand on an ARM machine if you want it.

**On a Mac, `Screepub-macOS.dmg` is still the supported download.** It
installs `Screepub.app` and it is the one this project has been shipping.
`Screepub-Desktop-macOS-universal.dmg` is the new cross-platform app, one
download that runs on Apple Silicon and Intel alike; it installs
`Screepub Desktop.app`, a different name and a different bundle identifier
from the Mac app's, so installing it is not installing over the other. Both write into `~/Documents/Screepub/` by default, in different
shapes — see [the library](#the-library) below. When the new app replaces the
old one, that name goes back to `Screepub.app`.

**Windows will warn you, the same way the command-line download does.** The
installer is unsigned too: it carries no code-signing certificate, so
SmartScreen shows a "publisher unknown" screen the first time you run it.
Choose **More info**, then **Run anyway**. It is the same warning, for the
same reason, from the same missing certificate — not a second problem.

**The Windows installer may need the network once.** It installs Microsoft's
WebView2 runtime if the machine has none — Windows 11 ships it, Windows 10
may not — and fetches it from Microsoft at install time. Converting itself
never touches the network, on any platform, and never has.

**What has been installed, and by whom.** On a Mac, one person has mounted
the universal `.dmg`, dragged the app to `/Applications`, launched it past
Gatekeeper and converted two real feature scripts with it. That is one
person on one machine, and it is the most anyone has done with any of these.
The `.deb`, the `.rpm` and the Windows installer have never been installed
on a real machine by anyone. The release path opens all four bundles and
runs the engine out of each before anything is published: that catches a
broken payload, and catches nothing a person would notice about the window.
It has not run yet either, because 0.6.0 is the first release that will
exercise it. The window itself has been opened on Linux and on macOS, never
on Windows: no build runner has a display, so nobody has started, clicked or
looked at it there. And half of the Mac download is unexercised. It is a
universal build, and only its Apple Silicon slice has ever been run: the
Intel slice ships built, signed, and executed nowhere. Treat 0.6.0's app
downloads as a first release that wants your bug reports.

Build instructions, and a ledger of exactly who has verified what:
[`desktop/README.md`](desktop/README.md).

The macOS app in `app/` remains the supported Mac app.

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
  report crashes, or phone home. Converting works fully offline, on every
  platform. The one exception is not the converter but the Windows
  *installer*, which fetches Microsoft's WebView2 runtime once if the machine
  has none; see [Desktop app](#desktop-app) above.

The Mac app touches the network in five places, each needing your click: uploading
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

The cross-platform window touches the network in five places, each needing
your click: the upload to a docked reMarkable over USB, GitHub when you choose
**Report a bug**, which opens a pre-filled issue in your browser, Calibre's or
Amazon's download page when you choose **Get Calibre** or **Get Kindle
Previewer** on the Send page's KFX checklist, that same checklist's own
**Install** button, which fetches the KFX plugin from Calibre's own plugin
index, and this project's `latest.json` on GitHub. That last one is asked
once a day only if you say yes when the window first asks (one line under the
drop area, which stays until you answer; the switch in the release notes
changes your answer later), and once whenever you press **Check for updates**
in the release notes. The download follows only when you choose **Update to**
beside the version number, or **Install** in the release notes. Its signature
is checked against a key built into the app before anything is swapped, and
the app then restarts itself, waiting first for any conversion, send or
export that is still running. It has no Send-to-Kindle
page yet. Showing a book in your file manager is local and reaches nothing.

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
| `--library` | write into the library instead of beside the input (see below) |
| `--mobi` | also write a MOBI 6 (dependency-free USB sideload) |
| `--preview-html <file>` | also write the script as one self-contained HTML file |
| `--fountain <file>` / `--no-fountain` | intermediate `.fountain` control |
| `--options <file.json>` | formatting knobs (see the registry) |
| `--title` / `--author` | override detected metadata |
| `--force` | convert even if it doesn't look like a screenplay |
| `--json` | machine-readable result (the app↔engine contract) |
| `--progress` | NDJSON progress on **stderr** while converting |
| `--debug` | dump classified elements JSON |

#### The library

Without `--library` the CLI writes beside its input, which is what a
command-line tool is expected to do. `--library` — what the desktop window
passes, so a converted script never litters the folder the PDF was dragged
from — puts the book, its `.fountain` and its settings sidecar together in
one folder per script:

| Platform | Library |
| --- | --- |
| macOS | `~/Documents/Screepub` |
| Windows | `%USERPROFILE%\Documents\Screepub` |
| Linux / other | `<Documents>/Screepub`, where `<Documents>` is `XDG_DOCUMENTS_DIR` — from the environment, else from `~/.config/user-dirs.dirs` — and `~/Documents` when neither says otherwise |

Under **Documents**, not under application state: a converted `.epub` is a
document the reader opens, copies to a device and backs up, not something the
program keeps for itself. It is also the SwiftUI app's DEFAULT
output folder, so on a Mac the two usually write into the same place — but
only usually, and never into the same shape. The app's folder is settable, so
a Mac user who moved it does end up with two libraries; and the app writes
flat (`<folder>/<stem>.epub`) where the window writes one folder per script
(`<folder>/<stem>/<stem>.epub`). The window does not list, reuse, or inherit
tuning from books the app left flat in that folder.

`SCREEPUB_LIBRARY` overrides all three. Two different scripts with the same
filename do not share a folder: the second gets `<stem>-<hash>`, keyed on its
own path, so neither book can overwrite the other. A `<stem>.screepub.json`
sitting beside the PDF from an earlier conversion is copied in the first time
that script reaches the library, so tuning is not silently lost. The
`source.json` in each script folder records which PDF it came from; it is the
one file a library listing should skip.

The default folder above is not fixed. `screepub app-settings --set '{"libraryPath": "/some/folder"}'` chooses a different one (it must be a
full path), and `'{"libraryPath": null}'` goes back to the default.
Precedence is `SCREEPUB_LIBRARY` > the chosen folder > the platform default.
Choosing a new folder moves nothing: books already converted stay where they
are, and conversions from then on land in the new one. A script converted
again after the change starts a fresh folder there, without the tuning
saved in its old one. The desktop window offers the same choice from the
Convert page: a Change… button next to the library line opens a folder
picker, and Reset goes back to the default.

The same command sets the app's format defaults too: what a new script
starts from. Precedence there is explicit flags > the script's saved
settings (`screepub settings`) > these app defaults > Screepub's own.
`screepub app-settings [--set <json>] [--json]` reads or writes both
`libraryPath` and `formatDefaults` in one call (`formatDefaults` replaces
the whole set; see `--help`). The per-script Settings page's foot has the
window's equivalent, "Use these for new scripts", which sends that
script's current settings as the new app defaults.

The first `--library` conversion of a PDF that has no settings sidecar of
its own saves the settings it started from as that script's own, so a
later change to the app defaults reaches only scripts converted
afterwards. Scripts already in the library from before this release saved
nothing, so they keep following the app defaults until a knob is moved
once on their own Settings page.

`screepub reveal <file> [--json]` shows a converted file (given as a full
path) in the system's file manager: Finder with the file selected on
macOS, the containing folder on Windows and Linux.

Both settings live in one small file outside the library:
`~/Library/Application Support/Screepub/settings.json` on macOS,
`%APPDATA%\Screepub\settings.json` on Windows, and
`$XDG_CONFIG_HOME/screepub/settings.json` on Linux
(`~/.config/screepub/settings.json` by default). `SCREEPUB_CONFIG_DIR`
overrides that folder everywhere.

#### Device commands

```bash
bun src/cli.ts devices [--json]                          # list connected e-readers
bun src/cli.ts send <file> [--device <id>] [--json]      # send an existing file to one
bun src/cli.ts kfx-status [--json]                       # can this computer make KFX for a Kindle?
bun src/cli.ts kfx-install [--json]                      # install the KFX plugin into Calibre (online)
```

`devices` lists every reader it can reach: USB-mounted Kindle, Kobo and
tolino volumes, plus a reMarkable if its USB web interface is answering.
`send` delivers an existing file — it does **not** convert, so run a
conversion first. For a mounted volume that means copying the file where that
vendor actually indexes it; for a reMarkable it means uploading over HTTP to
the docked tablet, which accepts **only PDF and EPUB** (anything else is
refused before a byte moves). With one reader connected `--device` is
optional; with several it is required, and `devices` prints the ids it
accepts.

A Kindle gets its best rendering from KFX, which needs three free tools:
Calibre, Amazon's Kindle Previewer, and the KFX Output plugin inside
Calibre. `kfx-status` says which are installed and where to get the rest;
`kfx-install` installs the plugin from Calibre's own plugin index. Amazon
makes no Kindle Previewer for Linux, so `kfx-install` does not work there.
Until all three are there, a Kindle gets AZW3 (with Calibre) or the
engine's MOBI. The desktop app shows the same checklist on its Send page.

The same hardware caveat as everywhere else applies here: only the Kindle
route has been run on a real device. Kobo, tolino and reMarkable are built and
code-tested against injected mounts and a stub tablet — see the table in
[Which readers?](#which-readers) above.

On Linux and Windows this caveat is stronger still: no device of any kind has
been connected to Screepub on either operating system. See
[Linux and Windows](#linux-and-windows-command-line) above.

A verb is only a verb when no file of that name exists, so a script saved as
`devices` still converts and `./devices` always means the file.

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
