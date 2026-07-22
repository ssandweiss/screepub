// EPUB3 packaging: OCF zip with mimetype first (stored), package.opf,
// nav.xhtml TOC from scene chapters, generated title page.
import JSZip from 'jszip';
import type { BookBody } from './html';
import { escapeXml } from './html';
import { screenplayCss } from './css';
import type { FormatOptions } from '../options';
import { DEFAULT_FORMAT_OPTIONS } from '../options';

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

function packageOpf(meta: BookMeta, body: BookBody, modified: string, includeTitlePage: boolean): string {
  const manifest = body.files
    .map((f) => `    <item id="${f.id}" href="text/${f.id}.xhtml" media-type="application/xhtml+xml"/>`)
    .join('\n');
  const spine = body.files.map((f) => `    <itemref idref="${f.id}"/>`).join('\n');
  const creator = meta.author ? `    <dc:creator>${escapeXml(meta.author)}</dc:creator>\n` : '';

  const titleItem = includeTitlePage
    ? '    <item id="titlepage" href="titlepage.xhtml" media-type="application/xhtml+xml"/>\n'
    : '';
  const titleRef = includeTitlePage ? '    <itemref idref="titlepage"/>\n' : '';
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
${titleItem}${manifest}
  </manifest>
  <spine>
${titleRef}${spine}
  </spine>
</package>
`;
}

function navXhtml(meta: BookMeta, body: BookBody, includeTitlePage: boolean): string {
  const items = body.toc
    .map((e) => `      <li><a href="${e.href}">${escapeXml(e.title)}</a></li>`)
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
${includeTitlePage ? '    <li><a epub:type="titlepage" href="titlepage.xhtml">Title Page</a></li>\n' : ''}    <li><a epub:type="bodymatter" href="text/${body.files[0]?.id ?? 'body001'}.xhtml">Begin Reading</a></li>
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
export async function buildEpub(
  meta: BookMeta,
  body: BookBody,
  format: FormatOptions = DEFAULT_FORMAT_OPTIONS,
): Promise<Uint8Array> {
  const resolved: BookMeta = {
    identifier: `urn:uuid:${crypto.randomUUID()}`,
    ...meta,
  };
  const modified = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');

  const zip = new JSZip();
  // OCF: mimetype must be the first entry and stored uncompressed.
  zip.file('mimetype', 'application/epub+zip', { compression: 'STORE' });
  zip.file('META-INF/container.xml', containerXml());
  zip.file('OEBPS/package.opf', packageOpf(resolved, body, modified, format.includeTitlePage));
  zip.file('OEBPS/nav.xhtml', navXhtml(resolved, body, format.includeTitlePage));
  zip.file('OEBPS/style.css', screenplayCss(format));
  if (format.includeTitlePage) {
    zip.file('OEBPS/titlepage.xhtml', titlePageXhtml(resolved));
  }
  for (const f of body.files) {
    zip.file(`OEBPS/text/${f.id}.xhtml`, f.xhtml);
  }

  return zip.generateAsync({
    type: 'uint8array',
    compression: 'DEFLATE',
    compressionOptions: { level: 9 },
  });
}
