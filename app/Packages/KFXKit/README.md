# KFXKit

Produce sideload-able **KFX** files on macOS, with setup handled.

KFX is the format that gets Amazon's Enhanced Typesetting renderer on a
Kindle. A sideloaded AZW3 is drawn by the legacy engine — no
`page-break-inside: avoid`, no widow/orphan control; a sideloaded KFX is
drawn by the modern one. The renderer follows the file format, not how the
file arrived.

```swift
import KFXKit

let status = KFXToolchain.status()        // calibre? previewer? plugin?
if status.calibre && !status.pluginInstalled {
    try KFXToolchain.installPlugin()      // one click, from the bundled zip
}
let kfx = try KFXToolchain.convert(epub)  // → sibling .kfx, all local
```

## What the user installs vs. what KFXKit handles

| Piece | Who | Why |
| --- | --- | --- |
| [Calibre](https://calibre-ebook.com) | user | GPL app, hosts the plugin |
| [Kindle Previewer](https://kdp.amazon.com/en_US/help/topic/G202131170) | user | Amazon's converter — the only KFX writer in existence |
| KFX Output plugin (jhowell, GPL-3) | **KFXKit** | vendored zip, installed into the user's Calibre via `calibre-customize -a` |

Everything runs locally. No step makes a network request, and Kindle
Previewer converts headless without an Amazon sign-in.

## Status

Lives inside the [Screepub](https://github.com/ssandweiss/screepub) repo as
a self-contained package; MIT-licensed precisely so it can be lifted out
wholesale (the vendored plugin stays GPL-3 — see
`Sources/KFXKit/Vendor/PROVENANCE.md`). A future goal is dropping the
Calibre leg by porting the plugin's KPF→KFX repack step, leaving Kindle
Previewer as the only dependency.
