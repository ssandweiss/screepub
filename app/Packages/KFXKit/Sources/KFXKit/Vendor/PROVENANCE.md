# Vendored: KFX Output plugin for Calibre

`KFX_Output_plugin.zip` is John Howell (jhowell)'s **KFX Output** Calibre
plugin, version 2.12.0 (kfxlib 20241108), obtained from the GitHub mirror
[lcandy2/calibre-kfx-output-fix-traditional-chinese](https://github.com/lcandy2/calibre-kfx-output-fix-traditional-chinese)
— jhowell's 2.12.0 plus a Traditional-Chinese vertical-text fix that does
not affect Latin-script output. The canonical distribution is jhowell's
MobileRead thread and Calibre's official plugin index.

It is licensed **GPL-3.0** — full text in `COPYING` beside this file.

## Why it is here, and what it is not

KFXKit installs this zip into the **user's own Calibre** (via
`calibre-customize -a`) when the user asks for best-quality Kindle
sideloading, and then invokes Calibre's `ebook-convert` as a separate
process. The plugin is **not linked** into KFXKit or any app that uses
KFXKit; carrying it here is aggregation of an independent work, and it
runs entirely inside Calibre (itself GPL-3).

The plugin in turn drives Amazon's **Kindle Previewer** (not bundled —
proprietary, installed by the user) to perform the actual EPUB→KFX
conversion, then repackages the result for sideloading. No part of that
chain makes a network request.

## Updating

Replace the zip with a newer plugin release and update the version above.
Beware old mirrors: pre-2022 copies use `import imp` (removed in Python
3.12) and their kfxlib predates the Ion symbols newer Kindle Previewer
versions emit ("Unexpected Ion symbols used" at conversion time).
