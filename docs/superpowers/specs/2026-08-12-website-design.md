# The website

Date: 2026-08-12
Status: shipped (screepub.com is live)
Supersedes parts of: [2026-07-30-visual-identity-design.md](2026-07-30-visual-identity-design.md)

Written after the fact. The site was designed by building it and reacting to
it rather than by speccing it first, so this records what was decided and why,
before the reasoning survives only in a transcript. Where it contradicts the
visual identity spec, this file is the newer decision and says so explicitly.

## What it is

One page at `site/index.html`. No build step, no framework, no dependency, no
third-party request at runtime. Four fonts and a favicon sit beside it. The
whole payload is 176K.

Four beats:

1. **Hero.** The headline and the download.
2. **The reader.** A scroll-driven act carrying the entire argument.
3. **Drag and drop.** What using the app is.
4. **Who it's for.** Audience, the honest device sentence, and the download again.

## The decisions that are not obvious

### The site lives in this repo, but not for the original reason

The visual identity spec rejected a separate repo because splitting would
create a second copy of the device support table, and a stale copy of that
table is worse than a stale copy of anything else.

**That reason no longer applies.** The site does not carry the table; it
carries one honest sentence and links to the README. The argument for one repo
is now `brand/tokens.css`, which is pinned to `Theme.swift` by
`tests/brand-tokens.test.ts`. A site in its own repo would need an unpinned
copy of those tokens, and that failure is silent: a colour drifts and nobody
notices until someone puts the site and the app side by side. Plus the
screenshots in `assets/`.

Same conclusion, different load-bearing wall. Worth knowing if the table ever
comes back or the tokens ever move.

### Pages deploys from the Actions source, not a branch

Branch deploys only offer `/` and `/docs`. They cannot publish a `site/`
subfolder. `.github/workflows/pages.yml` uploads `site/` as an artifact
instead. **Settings → Pages → Source must be set to "GitHub Actions" by hand**
or the workflow goes green and publishes nothing, which is the failure mode
most likely to eat an hour.

### Scroll drives composition. It does not drive settings.

The reader act's devices move, grow and leave on scroll progress. The reader's
own settings — text size, margins, line spacing — do not. They run on a timer,
one parameter per tick, walking a single step at a time so something is always
moving but never everything at once. A click hands control to the visitor and
freezes the cycle for 18 seconds.

This started as scroll-driven and had to change. Scrolling down to reach a
control was also changing the value you were reaching for, which made the
demo feel broken in a way that was hard to name.

### Discrete steps, never continuous ramps

Type size steps through five values. It does not interpolate. Two reasons, and
the second is the one that matters: an e-reader steps between text sizes and
has no continuous slider, and scrubbing `font-size` per frame reflows every
line on every frame, which reads as jitter.

### The PDF panel scales. It never reflows.

Device A lays its page out once at a fixed 320px width and is then
`transform: scale()`d. Never touch its `font-size` to resize it.

This is the fix for the same jitter class, and it is also the argument the
section is making: a PDF scales, an e-book reflows. Having device A scale
while device B reflows puts the product's whole thesis into the mechanics
rather than only into the copy. The scale is *cover*, not fit-to-width,
because the screen and the page are near but not identical aspects (0.770
against 0.773) and a width-only scale leaves a grey band that reads as
off-centre.

### The devices carry wordmarks on the chin

`PDF` in neutral grey, `SCREEPUB` in brass, set where a real e-reader puts its
brand. This replaced `A. THE PDF, AS SENT` / `B. THE SAME PAGE, CONVERTED`
captions floating above them. The brass does the arguing without a caption.

### The download URL maintains itself

`releases/latest/download/Screepub-macOS.dmg`. The DMG asset name carries no
version, so this permanent URL always redirects to the newest build. No
JavaScript, no API call, nothing to update at release time.

## The voice rule changed

The visual identity spec says, in as many words: *"No superlatives. Not
'effortless', not 'beautiful', not 'revolutionary'. The README earns trust by
declining to sell, and the site inherits that or loses it."*

**The shipped headline is "Reading scripts on an e-reader shouldn't be
difficult. Screepub makes it easy."** That is the register the old rule ruled
out, and it was a deliberate call by the owner after the objection was raised.

The rule as written is therefore stale, and the spec that carries it now
contradicts the site it governs. The narrower rule that still holds, and that
the rest of the site obeys: **claims about what has been tested stay exact.**
The device sentence names MTP Kindles as the email-only route rather than
saying USB works on Kindles, and it says nobody has plugged in a Kobo. That is
the sentence the identity spec called the most trustworthy on the site, and it
is the one that cannot move.

## Plumbing that had to change

Both would have bitten on the first site commit:

- `tools/release-notes.ts` treats `site/` and `brand/` as non-shipping.
  Without it a week of copy edits reports `userVisible: true` and pulls
  `/release` into drafting notes for a release where nothing a reader can see
  changed. `brand/` was already an unlisted gap before the site existed.
- `ci.yml` path-ignores both. Safe **only** because no check in this repo is a
  required status: a filtered-out job never reports, which would hang a PR
  forever under branch protection. Re-check if protection is ever enabled.

## Accessibility floor

`prefers-reduced-motion` collapses the reader act entirely: sticky off, both
devices static and side by side, every copy phase visible, the settings panel
and pager inline and operable. The drop animation does not run. This is not a
degraded view, it is the whole page in a static form.

## Fonts

Courier Prime and Literata, self-hosted as WOFF2 latin and latin-ext subsets
in `site/fonts/`, 128K for six files. Both SIL Open Font License 1.1, recorded
in `THIRD-PARTY-NOTICES.md`. Self-hosting means the page renders identically
with no network and asks nothing of a third party, which is the line the app
already holds.

They are **website-only**. Nothing is embedded in a converted book today.
Bundling Courier Prime inside the EPUB is a separate roadmap item.

## Non-goals, still

- Analytics, cookies, forms, or anything needing a consent dialog. There is
  nothing to consent to, which is why there is no privacy page: one was
  written and deleted rather than shipped unlinked, since an orphaned page
  promising "this site collects nothing" would be worse than none at all if
  that ever stops being true.
- A second page. If one arrives, the shared CSS has to be extracted first;
  today it is inline so the page is genuinely self-contained.

## Known gaps

- The Mac app's own interface never appears. The drag-and-drop well is the
  only app moment, and `assets/screenshot-reader.png` is the obvious thing to
  put there.
- No dark mode. `brand/tokens.css` has the dark values; the site does not use
  them yet.
- The demo script is five invented pages. It is long enough to page through
  and no longer.
