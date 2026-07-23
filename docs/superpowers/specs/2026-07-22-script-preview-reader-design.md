# Script Preview Reader — design

2026-07-22 · approved in brainstorm (option B: separate reader window,
real ebook markup, per-script settings)

## Purpose

An in-app reader showing the *actual converted script* — the same
markup that ships in the EPUB — with live formatting tweaks. Proof a
script, tune its knobs, send it, without leaving the app.

## Components

### 1. Engine: `--preview-html <file>`

New CLI flag emitting a single self-contained HTML document: the
existing tokens→XHTML builders (`src/epub/html.ts`) concatenated across
scenes, with `screenplayCss(options)` inlined in a `<style>` tag, no
zip container. Shares every formatting option with the EPUB path.
No parser changes; works for both PDF and `.fountain` input.

### 2. Per-script settings sidecar

`<Stem>.screepub.json` — a `FormatSettings` JSON encoding — written in
the library folder beside the script's `.fountain`. Precedence: sidecar
if present, else global defaults (`AppSettings.formatSettings()`).
Every rail change writes the sidecar. "Save as defaults" copies the
sidecar's values into the global `@AppStorage` keys. Device-profile
presets (future) are one-click sidecar fills.

### 3. Reader window (ScreepubApp)

- Opened by a READ SCRIPT button on the conversion result page
  (`openWindow` with the script's identity: stem + fountain path).
- Resizable, ~700×800 default. Paper-theme chrome.
- Center: `WKWebView` (NSViewRepresentable) loading the preview HTML.
- Right rail (~220pt): the Formatting controls bound to a per-script
  observable model (NOT @AppStorage), plus "Save as defaults".
- Footer: Copy to <device> — USB / Email to Kindle / Show in Finder,
  reusing the existing transfer logic.

### 4. Live re-render loop

Knob change → 300 ms debounce → `Engine.convert` on the cached
`.fountain` with the sidecar options, writing the library EPUB (no
`--mobi`) and the preview HTML → web view reloads, restoring scroll
position (measure `scrollY` before load, re-apply after). The library
EPUB therefore always matches the last render — sends are WYSIWYG.
MOBI/AZW3 are regenerated at send time (`--mobi` run / ebook-convert).
Engine failure: keep last good render, show the error line in the rail.

## Error handling

- Missing `.fountain` (library moved): READ button disabled with a hint.
- Engine error mid-tweak: rail shows message; web view keeps last HTML.
- Sidecar decode failure: fall back to defaults, overwrite on next tweak.

## Testing

- Engine (bun:test): `--preview-html` writes a file containing
  `dialogue-block` markup and inlined CSS; honors options (e.g. margin
  percentage appears in the style block); works from `.fountain` input.
- Kit (kit-check): sidecar encode/decode round-trip; precedence
  (sidecar overrides globals; absent sidecar → globals).
- Reader interactions: manual verification during the session.
