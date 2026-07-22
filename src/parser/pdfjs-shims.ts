// pdf.js's modern build references DOMMatrix at module scope. It's only used
// for canvas rendering — never for getTextContent — but it must exist for the
// module to load headless. Identity stub is enough; no rendering happens here.
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
