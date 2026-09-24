# Design: keep a script's settings, or follow the defaults

Date: 2026-09-24 · Status: approved by the owner on 2026-09-24. Follows the
pin decided during the gear build ([2026-09-23-app-settings-gear-design.md](2026-09-23-app-settings-gear-design.md),
"Decided during the build") and commit 27c6289.

## What

One app-wide choice on the Settings page, under the heading **When a PDF is
converted**:

- **Keep its settings** (the default, and what Screepub does today): "The
  script keeps the settings it was made with. Changing the defaults later
  won't change it."
- **Follow the defaults**: "Scripts you haven't tuned change when the
  defaults do. Scripts that already have their own settings keep them."

## Why

Since 27c6289, the first `--library` conversion of a PDF with no settings
sidecar of its own saves the app defaults it started from as that script's
sidecar (the "pin"). That keeps "Use these for new scripts" and "Reset new
scripts to Screepub's defaults" from reaching backward into books already on
a reader's device. The owner likes that as the default, but some readers
want the opposite: tune the defaults once and have every untuned script
follow them. Both are reasonable, so it becomes a choice.

## Decisions

1. **Stored in the app settings file** (`src/settings/app.ts`), key
   `keepScriptSettings`, a boolean. Absent, or anything that is not a
   boolean, reads as `true`: today's behaviour stays the default, and a
   hand-edited file cannot switch it off by accident. A write keeps every
   other key in the file (`lastRoute`, `libraryPath`, `formatDefaults`),
   through `writeAppSettings`, which already merges.
2. **Written through `screepub app-settings --set`**, the verb that already
   writes the other two keys the Settings page owns. `keepScriptSettings`
   joins `libraryPath` and `formatDefaults` as a writable key: `true` or
   `false` stores it, `null` removes it (back to the default), anything else
   is refused with `bad-settings` before anything is written. Every other
   refusal rule of that verb stays as it is. The answer gains
   `keepScriptSettings` (the value in force).
3. **Read by the Settings page from the answer it already gets.** The
   `screepub settings` answer gains `keepScriptSettings` beside
   `appDefaults`, so the page draws the choice from its one existing round
   trip, the same way it draws the defaults caption. The window never reads
   a file, and only `desktop/ui/app.js` spells an engine flag.
4. **OFF skips the pin, and nothing else.** A `--library` conversion of a
   PDF that finds no sidecar writes none. Adopting a sidecar from beside the
   PDF still happens: that file is tuning the reader did, not a pin.
5. **Switching affects conversions from then on, and never undoes a pin.**
   A pinned sidecar and one the reader tuned are the same file with the
   same shape; nothing records which is which. Deleting or rewriting
   sidecars when the choice is turned OFF could wipe real tuning, so the
   engine never deletes or rewrites an existing sidecar because of this
   setting. A script that already has one keeps it, which is what the
   "Follow the defaults" line says.
6. **Read once per conversion**, beside the app defaults, so one conversion
   makes its whole decision from one look at the settings file.

## The window

- A real radio group (`fieldset` + `legend`, two native radios with
  `label for`, each option's line tied on with `aria-describedby`), drawn
  beside the defaults foot at the bottom of the Settings page. Native
  radios give one Tab stop and arrow keys between the two options.
- A change sends `app-settings --set {"keepScriptSettings": ...}`. Writes
  are queued one behind the other rather than disabling the radios while a
  write is in flight: an arrow key both moves focus and changes the choice,
  and disabling the focused radio would drop the keyboard user's place.
  Only the latest choice's answer is painted; a refusal puts the radios
  back to what the engine holds and shows the engine's sentence.
- A confirmation line in a `role="status"` node: "Saved. It applies to PDFs
  you convert from now on."
- Styled from tokens only in `surfaces.css`, with a visible
  `:focus-visible` ring.

## Out of scope

- Unpinning, listing which scripts were pinned, or a per-script switch.
- Changing what a pin contains (still the app defaults, never a one-off
  `--options` flag).
- The Swift app.
