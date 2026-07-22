// pdfjs-dist ships types for the package root but not the build subpath.
declare module 'pdfjs-dist/build/pdf.mjs' {
  export * from 'pdfjs-dist';
}
