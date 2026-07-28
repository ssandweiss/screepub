# Third-party notices

Screepub itself is licensed under the GNU Affero General Public License
v3.0 or later — see [`LICENSE`](LICENSE).

The conversion engine is compiled into a single binary (`screepub-engine`,
shipped inside `Screepub.app` and as the standalone `screepub-macOS` CLI),
so the distributed binaries embed the libraries below. Their licenses are
reproduced in full in each dependency's package under `node_modules/`, and
this file travels with the app bundle in
`Screepub.app/Contents/Resources/`.

The Mac app links only Apple's system frameworks; it has no third-party
Swift dependencies.

---

## pdfjs-dist 6.1.200 — Apache License 2.0

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

## jszip 3.10.1 — MIT (dual-licensed MIT or GPL-3.0)

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

## fountain-js 1.2.4 — MIT

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

## Not bundled

[Calibre](https://calibre-ebook.com) (GPL-3.0) is optional and used only if
you have installed it yourself: Screepub shells out to your copy of
`ebook-convert` to produce AZW3. No Calibre code is distributed with
Screepub.
