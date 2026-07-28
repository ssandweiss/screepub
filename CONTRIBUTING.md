# Contributing to Screepub

Bug reports are as welcome as patches — especially reports from people
reading scripts on devices nobody here owns.

## Reporting a bug

[Open an issue](https://github.com/ssandweiss/screepub/issues/new/choose).
For a conversion problem, the useful details are: what the PDF was written
in (Final Draft, Highland, Fade In, Celtx, WriterDuet…), what came out
wrong, and what you expected.

**Please don't attach a confidential script.** Most conversion bugs are
about *layout*, not words — a description of where the text sat on the page
is usually enough, and if not, `tools/make-fixture.py` shows how to build a
small invented script that reproduces a given shape.

Kobo, tolino, and reMarkable are implemented but have not been tested on
real hardware. If you own one, a report either way is genuinely valuable.

## Getting set up

You need [Bun](https://bun.sh). For the Mac app you also need Xcode
Command Line Tools — there is no `.xcodeproj`, and full Xcode is not
required.

```bash
bun install
bun test                    # engine suite
bunx tsc --noEmit           # typecheck
app/build-app.sh            # → app/dist/Screepub.app
(cd app && swift run -c release kit-check)   # Swift-side behavior checks
```

`epubcheck` (`brew install epubcheck`) validates output and is worth
running after any change to the EPUB or CSS builders.

## Fixtures

`tests/fixtures/` holds small invented screenplays, committed and used by
CI. Regenerate them with:

```bash
python3 tools/make-fixture.py screenplay tests/fixtures/screenplay.pdf
```

A root-level `fixtures/` directory is gitignored, for testing against real
scripts locally. If you use it: **never commit those files, and never let a
real title, author, or character name reach a test assertion, a doc, or a
screenshot.** Some tests self-skip when it's absent — that's expected.

## Before you send a change

- **Write the failing test first.** The suite is `bun:test`.
- **Read the invariants** in [`CLAUDE.md`](CLAUDE.md) before touching the
  parser or the EPUB CSS. They look arbitrary and are not: each one is a
  device behavior someone verified on real hardware, and
  [`docs/screenplay-format-reference.md`](docs/screenplay-format-reference.md)
  explains why Kindle's renderer forces several of them.
- **Log formatting changes** in
  [`docs/formatting-options-log.md`](docs/formatting-options-log.md). It is
  the registry the app's settings are generated against, so a new knob that
  isn't in it is a knob nobody can find.
- **Keep defaults in sync.** `src/options.ts` and the app's
  `FormatSettings.swift` describe the same knobs and have to agree.
- Run `bun test` and `bunx tsc --noEmit`. CI runs both, plus a macOS job
  that builds the app and runs `kit-check`.

## Licensing of contributions

Screepub is AGPL-3.0-or-later. By opening a pull request you agree your
contribution ships under that license, and you confirm you have the right
to contribute it — the [Developer Certificate of Origin](https://developercertificate.org).
Add a `Signed-off-by:` line to your commits (`git commit -s`) to certify it.
