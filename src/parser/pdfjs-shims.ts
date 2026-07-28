// pdf.js's modern build references DOMMatrix at module scope. It's only used
// for canvas rendering — never for getTextContent — but it must exist for the
// module to load headless. Identity stub is enough; no rendering happens here.
//
// The worker is imported STATICALLY and handed to pdf.js via
// globalThis.pdfjsWorker (checked before any dynamic import) — pdf.js's
// fallback dynamically imports "./pdf.worker.mjs" at runtime, which breaks
// inside a `bun build --compile` binary where that file doesn't exist.
import * as pdfjsWorker from 'pdfjs-dist/build/pdf.worker.mjs';

(globalThis as Record<string, unknown>).pdfjsWorker = pdfjsWorker;

if (typeof (globalThis as Record<string, unknown>).DOMMatrix === 'undefined') {
  class DOMMatrixShim {
    a = 1; b = 0; c = 0; d = 1; e = 0; f = 0;
    scale(): DOMMatrixShim { return this; }
    translate(): DOMMatrixShim { return this; }
    transform(): DOMMatrixShim { return this; }
    multiply(): DOMMatrixShim { return this; }
    invertSelf(): DOMMatrixShim { return this; }
  }
  (globalThis as Record<string, unknown>).DOMMatrix = DOMMatrixShim;
}

export {};
