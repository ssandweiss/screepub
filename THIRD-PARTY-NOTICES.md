# Third-party notices

Screepub itself is licensed under the GNU Affero General Public License
v3.0 or later: see [`LICENSE`](LICENSE).

## What ships, and what it carries

- **The conversion engine** is compiled into a single binary, so every
  download embeds the JavaScript libraries below. It ships as the
  command-line archives (macOS, Linux, Windows), as `screepub-engine` inside
  the window's bundles, and inside the Mac app.
- **The window** (*Screepub Desktop* on a Mac; the `.dmg`, the Windows
  installer, the `.deb` and the `.rpm`) also carries Rust crates, Tauri and
  its plugins chief among them (see [The window's Rust crates](#the-windows-rust-crates)),
  and the two typefaces below. This file travels inside each bundle beside
  `LICENSE`.
- **The Mac app** (`Screepub.app`, from `Screepub-macOS.dmg`) links only
  Apple's system frameworks besides the engine, and carries this file in
  its `Contents/Resources/` folder.
- **The command-line archives** hold only the binary; this file is their
  notice.

---

## pdfjs-dist 6.3.289: Apache License 2.0

PDF parsing and text extraction. Copyright Mozilla Foundation and pdf.js
contributors. <https://github.com/mozilla/pdf.js>

Licensed under the Apache License, Version 2.0 (the "License"); you may
not use this file except in compliance with the License. You may obtain a
copy of the License at <http://www.apache.org/licenses/LICENSE-2.0>.

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS, WITHOUT
WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied. See the
License for the specific language governing permissions and limitations
under the License.

## jszip 3.10.1: MIT (dual-licensed MIT or GPL-3.0)

EPUB container writing. Copyright (c) 2009-2016 Stuart Knightley, David
Duponchel, Franz Buchinger, António Afonso. <https://stuk.github.io/jszip/>

JSZip is dual licensed; Screepub uses it under the MIT license.

Permission is hereby granted, free of charge, to any person obtaining a
copy of this software and associated documentation files (the "Software"),
to deal in the Software without restriction, including without limitation
the rights to use, copy, modify, merge, publish, distribute, sublicense,
and/or sell copies of the Software, and to permit persons to whom the
Software is furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in
all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL
THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING
FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER
DEALINGS IN THE SOFTWARE.

jszip brings its own small dependencies, also embedded: pako 1.0.11 (MIT
and Zlib), lie 3.3.0, immediate 3.0.6, setimmediate 1.0.5,
readable-stream 2.3.8, safe-buffer 5.1.2, string_decoder 1.1.1,
util-deprecate 1.0.2, core-util-is 1.0.3, isarray 1.0.0 and
process-nextick-args 2.0.1 (all MIT), and inherits 2.0.4 (ISC). Exact
versions are in `bun.lock`; each package's licence text is in its own
package.

## fountain-js 1.2.4: MIT

Fountain tokenizing. Copyright (c) 2020 Jonny Greenwald, Matt Daly.
<https://github.com/jonnygreenwald/fountain-js>

Permission is hereby granted, free of charge, to any person obtaining a
copy of this software and associated documentation files (the "Software"),
to deal in the Software without restriction, including without limitation
the rights to use, copy, modify, merge, publish, distribute, sublicense,
and/or sell copies of the Software, and to permit persons to whom the
Software is furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in
all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL
THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING
FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER
DEALINGS IN THE SOFTWARE.

---

## The window's Rust crates

The window's Rust side is built from the crates pinned in
`desktop/src-tauri/Cargo.lock`, which is the full list. The ones it names
directly:

| Crate | Version | License |
| --- | --- | --- |
| tauri | 2.11.5 | Apache-2.0 OR MIT |
| tauri-plugin-shell | 2.3.6 | Apache-2.0 OR MIT |
| tauri-plugin-dialog | 2.7.3 | Apache-2.0 OR MIT |
| tauri-plugin-opener | 2.5.5 | Apache-2.0 OR MIT |
| tauri-plugin-updater | 2.12.0 | Apache-2.0 OR MIT |
| tauri-plugin-process | 2.3.1 | Apache-2.0 OR MIT |
| serde_json | 1.0.151 | MIT OR Apache-2.0 |

Beneath them Tauri draws on wry 0.55.1 (Apache-2.0 OR MIT), tao 0.35.3
(Apache-2.0) and tauri-plugin-fs 2.5.2 (Apache-2.0 OR MIT). The lockfile
spans every platform, and each bundle carries only its own platform's share.
Across the whole lockfile the licences are permissive (MIT, Apache-2.0,
BSD-3-Clause, ISC, Zlib, Unlicense, Unicode-3.0, CDLA-Permissive-2.0 and
CC0 or MIT-0 alternatives), plus five crates under MPL-2.0, used unmodified:
cssparser, cssparser-macros, dtoa-short, selectors and option-ext. MPL-2.0
source is available from crates.io at the versions the lockfile names.

No generated per-crate notice file is produced yet: the lockfile is the
record, and each crate's licence text is in its published source.

---

## KFX Output plugin for Calibre 2.12.0: GPL-3.0 (aggregated, not linked)

Copyright John Howell (jhowell), with a Traditional-Chinese rendering fix by
lcandy2. Carried inside the Mac app only, as an unmodified zip
(`KFXKit_KFXKit.bundle/Vendor/KFX_Output_plugin.zip`, full GPL-3 text beside
it), and installed into **your own copy of Calibre** only when you choose to,
where it runs as part of Calibre, a separate GPL-3 program. It is never
linked into Screepub or KFXKit. Provenance:
`app/Packages/KFXKit/Sources/KFXKit/Vendor/PROVENANCE.md`. The `KFXKit`
package itself is MIT: see `app/Packages/KFXKit/LICENSE`.

The window and the command line carry no copy: `screepub kfx-install`
downloads the plugin from Calibre's own plugin index and has Calibre install
it.

Either way the plugin drives Amazon's **Kindle Previewer** (not bundled,
proprietary, installed by you) to perform the actual KFX conversion.

## Courier Prime 1.203: SIL Open Font License 1.1

Copyright (c) 2015 Alan Dague-Greene, Quote-Unquote Apps.
<https://quoteunquoteapps.com/courierprime/>

Bundled as WOFF2 subsets in `site/fonts/` and in `desktop/ui/fonts/`,
self-hosted so neither the website nor the window makes a third-party
request. Not shipped inside any converted book: the EPUB and MOBI ask the
device for Courier Prime by name and fall back to whatever typewriter face it
carries.

## Literata 3.103: SIL Open Font License 1.1

Copyright (c) 2017 Type Together, commissioned by Google.
<https://github.com/googlefonts/literata>

Bundled as WOFF2 subsets in `site/fonts/` and in `desktop/ui/fonts/`, for
the window's running prose.

The OFL requires that the fonts be redistributed under the same licence, that
this notice travel with them, and that they not be sold on their own. It also
forbids using the reserved font names on a modified version. The files here
are unmodified upstream builds. Full licence text:
<https://openfontlicense.org/>

## Not bundled

[Calibre](https://calibre-ebook.com) (GPL-3.0) and Amazon's Kindle
Previewer are optional and used only if you installed them yourself:
Screepub runs your copy of `ebook-convert` to produce AZW3, and, with the KFX
plugin, KFX. No Calibre or Amazon code is distributed with Screepub.
