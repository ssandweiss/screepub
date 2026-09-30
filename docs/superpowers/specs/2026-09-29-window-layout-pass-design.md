# Design: the window uses a wide screen

Date: 2026-09-29 · Status: approved by the owner on 2026-09-29, from two
mockups (frame option B, Settings option 1). First of two layout designs for
the release after 0.7.3; the second folds the Send page into Convert.

## What

On a wide window the page stops sitting in a 1000-wide column in the middle
of the screen. The paper runs edge to edge, the brads sit near the window's
left edge the way the holes sit on a letter page, the margins get thin, and
the Settings preview gets roughly twice the room it has today.

## Why

The owner's QA notes on 0.7.3, at a window about 1280 wide:

- The brads "get uncomfortably close to the center" on a wide window. They
  belong to the page, and the page is capped at 1000 and centred, so the
  wider the window, the further in they drift. The owner wants them near
  the left edge, like an 8.5 by 11 page, everywhere they appear.
- The margins around the tabs and the content are far wider than they need
  to be: about 310 pixels on the left and 250 on the right at 1280.
- The Settings preview is "tiny tiny": about 320 wide at 1280, so a line of
  action wraps after a handful of words.
- The Settings sections run together; each should be a clearly separate
  box.

## Decisions

### The frame

1. **The paper fills the window.** `--page-max` goes. Nothing caps the
   page's width, and the rail of brads spans the whole window.
2. **The brads are placed from the window's left edge, not the page's:**
   their centres sit 44 pixels in, at every width. They stay fixed while
   the page scrolls, as today, and a window under 560 tall still drops to
   one brad. `--brad-size` is unchanged; against the wider rail it simply
   reaches its 36-pixel cap sooner.
3. **Content starts 100 pixels from the left edge** (the binding margin)
   and stops 48 from the right. Between those, the content is **one block,
   at most 1180 wide, centred** in the space. At 1280 the block fills that
   space (1132 wide); on a wider display the extra room splits evenly on
   both sides of the block.
4. **The tabs sit at the block's left edge; the version stamp, the update
   label and the engine-fault line sit at its right edge**, at the foot as
   today.
5. **The numbers live in `brand/tokens.css`**, the scale block that
   `tools/build-desktop-tokens.ts` copies into `desktop/ui/tokens.css`:
   `--binding-margin: 100px`, `--page-right: 48px`, `--hole-center: 44px`,
   and a new `--block-max: 1180px` in place of `--page-max`. They were
   percentages of a capped page; they are pixels of the window now, because
   the thing they measure from (the window's edge) no longer scales.
6. **Narrow windows keep their own rules.** Under 720 wide the binding
   narrows to 11% and the right margin to `--space-4`, as today. The drag
   strip, the release-notes sheet and dark mode are unchanged.

### Each page inside the block

7. **Convert:** the title, drop area, library line, question line and the
   result screen stay centred, in a column that stops at 820 wide, so the
   drop area does not stretch into a very long dashed box.
8. **Read:** the script keeps the width its frame has today, 706 pixels (the
   content width at the old 1000 cap), so its lines wrap where they wrap
   now. It sits to the right of a **fixed slot for the scene index**, 218
   wide plus a gap. The index opens into that slot, so the script never
   moves and is never covered, which was the rule the current drawer was
   built for. The drawer that slid out over the binding margin cannot stay:
   the margin is 100 wide now and the index is 218. The slot is there
   whether the index is open or shut. Extra room in the block falls to the
   script's right. The header (title, byline, Show or Hide scenes, the rule
   under them) spans the block.
9. **Read, narrower windows:** between 900 and about 1100 wide the script
   gives up width before the slot does (at 900 it is about 500 wide). Under
   900 the index moves above the script, the way it does under 720 today,
   and the script takes the block's width. The narrow breakpoint for Read
   moves from 720 to 900, the same line Settings already uses.
10. **Send:** rows keep today's line length (`--measure`) and sit at the
    block's left edge. The next design folds this page into Convert, so it
    gets no more than that.

### Settings

11. **Two columns: the settings in a fixed 420 on the left, the preview in
    everything else.** At 1280 the preview is about 670 wide; at the block's
    1180 cap, about 720.
12. **The preview stays in view and runs the window's height.** It is
    already sticky; its frame now fills from its pinned top to a bottom
    margin of `--space-9`, instead of a fixed 62% of the window's height.
    At the top of the page it starts below the intro and presets, so its
    foot is below the fold until the page scrolls, as in the mockup.
13. **The text in the preview stays the size it is today.** Lines run
    longer than on a 6-inch Kindle; the preview shows formatting, not the
    device's line breaks. The owner chose this over zooming the text to a
    Kindle's line length, because a reader's own font size changes every
    line break anyway.
14. **Each section is a box:** The page, Dialogue, The text, What the book
    carries, Read from the PDF, and the foot with the new-scripts controls.
    A 1px `--hole` border, `--radius-well` corners, a fill a shade lighter
    than the paper, and the section's heading inside the box. The fill is a
    new colour token, `panel` in `brand/tokens.json` (light and dark), so it
    reaches the window through the generator like every colour after the
    core seven. Each setting's explanation stays under it.
15. **Unchanged:** the intro sentence and the preset buttons at the top,
    and the single column under 900 wide with the preview above the
    settings, unpinned.

### The brand

16. `brand/components/page-frame.html` and `brand/components/_preview.css`
    draw the new frame, so the design system describes what the window does.
    The site keeps its own geometry: it is a different page with its own
    canvas, and the README and site session owns it.

## What this does not do

- It does not fold Send into Convert, add an Eject button after a USB copy,
  or notice a plugged-in Kindle. That is the next design.
- It does not change the preview into a device simulation.
- It does not retake the README and site pictures on this branch. The
  release routine, being rebuilt by the README and site session, retakes
  them and shows them old beside new before the release is approved.
- It does not touch the site, the README, the engine or the frozen Swift
  app.

## Checks

- **Tests first**, in `tests/desktop-tokens.test.ts` and
  `tests/desktop-ui.test.ts`, which already read the window's CSS rule by
  rule: the token list names `--block-max` instead of `--page-max`; `.page`
  and `.rail` carry no width cap; the brads' `left` is `--hole-center`; the
  sheet's block is capped at `--block-max` and centred; Read's reader has a
  slot column for the index and the script frame keeps 706; the Settings
  split is 420 plus the rest and the preview frame's height is measured from
  the window's height; each knob group has a border and the `panel` fill.
  Existing scene-index tests that pin the drawer (the `min()` width cap,
  the hidden state) are rewritten for the slot, keeping what they protect:
  a positioned index for read.js's `offsetTop`, room at both ends of the
  list, and hiding by opacity and visibility rather than by moving.
- **Live, in a real browser over the window's own files** with the real
  engine and scratch settings, at 900, 1280 and 1800 wide, light and dark:
  every page, the scene index opening, closing and jumping to a scene, the
  keyboard's path through the page, the drag strip at rest and scrolled, the
  version stamp and update label, and the Settings preview pinned while
  scrolling.
- **The capture tool** still runs clean: every selector it drives
  (`.rev-stamp`, `.well-library`, `#surface-convert` and its `data-state`,
  `#tab-read`, `#surface-read .script-frame`) survives.
- **The owner's hands** on a test build before anything merges.

## Coordination

The README and site session (branch `site-and-release-skill`) touches none
of these files and merges first; this branch rebases on it. The capture
tool's selectors are listed above so that session can see nothing it drives
moves.
