// EPUB3 packaging: OCF zip with mimetype first (stored), package.opf,
// nav.xhtml TOC from scene chapters, generated title page.
import JSZip from 'jszip';
import type { Chapter } from './html';
import { escapeXml } from './html';
import { SCREENPLAY_CSS } from './css';

export interface BookMeta {
  title: string;
  author?: string;
  language?: string;
  /** stable identifier; defaults to a random urn:uuid */
  identifier?: string;
}

function containerXml(): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="OEBPS/package.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>
`;
}

function packageOpf(meta: BookMeta, chapters: Chapter[], modified: string): string {
  const manifest = chapters
    .map((c) => `    <item id="${c.id}" href="text/${c.id}.xhtml" media-type="application/xhtml+xml"/>`)
    .join('\n');
  const spine = chapters.map((c) => `    <itemref idref="${c.id}"/>`).join('\n');
  const creator = meta.author ? `    <dc:creator>${escapeXml(meta.author)}</dc:creator>\n` : '';

  return `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="uid" xml:lang="en">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="uid">${escapeXml(meta.identifier!)}</dc:identifier>
    <dc:title>${escapeXml(meta.title)}</dc:title>
${creator}    <dc:language>${meta.language ?? 'en'}</dc:language>
    <meta property="dcterms:modified">${modified}</meta>
  </metadata>
  <manifest>
    <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
    <item id="css" href="style.css" media-type="text/css"/>
    <item id="titlepage" href="titlepage.xhtml" media-type="application/xhtml+xml"/>
${manifest}
  </manifest>
  <spine>
    <itemref idref="titlepage"/>
${spine}
  </spine>
</package>
`;
}

function navXhtml(meta: BookMeta, chapters: Chapter[]): string {
  const items = chapters
    .map((c) => `      <li><a href="text/${c.id}.xhtml">${escapeXml(c.title)}</a></li>`)
    .join('\n');

  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops">
<head>
<title>${escapeXml(meta.title)}</title>
<link rel="stylesheet" type="text/css" href="style.css"/>
</head>
<body>
<nav epub:type="toc" id="toc">
  <h1>Scenes</h1>
  <ol>
${items}
  </ol>
</nav>
<nav epub:type="landmarks" hidden="hidden">
  <ol>
    <li><a epub:type="titlepage" href="titlepage.xhtml">Title Page</a></li>
    <li><a epub:type="bodymatter" href="text/${chapters[0]?.id ?? 'ch001'}.xhtml">Begin Reading</a></li>
  </ol>
</nav>
</body>
</html>
`;
}

function titlePageXhtml(meta: BookMeta): string {
  const author = meta.author
    ? `<p class="credit">Written by</p>\n<p class="author">${escapeXml(meta.author)}</p>\n`
    : '';
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops">
<head>
<title>${escapeXml(meta.title)}</title>
<link rel="stylesheet" type="text/css" href="style.css"/>
</head>
<body>
<section class="titlepage" epub:type="titlepage">
<h1>${escapeXml(meta.title)}</h1>
${author}</section>
</body>
</html>
`;
}

/** Assemble a complete EPUB3 file. */
export async function buildEpub(meta: BookMeta, chapters: Chapter[]): Promise<Uint8Array> {
  const resolved: BookMeta = {
    identifier: `urn:uuid:${crypto.randomUUID()}`,
    ...meta,
  };
  const modified = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');

  const zip = new JSZip();
  // OCF: mimetype must be the first entry and stored uncompressed.
  zip.file('mimetype', 'application/epub+zip', { compression: 'STORE' });
  zip.file('META-INF/container.xml', containerXml());
  zip.file('OEBPS/package.opf', packageOpf(resolved, chapters, modified));
  zip.file('OEBPS/nav.xhtml', navXhtml(resolved, chapters));
  zip.file('OEBPS/style.css', SCREENPLAY_CSS);
  zip.file('OEBPS/titlepage.xhtml', titlePageXhtml(resolved));
  for (const c of chapters) {
    zip.file(`OEBPS/text/${c.id}.xhtml`, c.xhtml);
  }

  return zip.generateAsync({
    type: 'uint8array',
    compression: 'DEFLATE',
    compressionOptions: { level: 9 },
  });
}
