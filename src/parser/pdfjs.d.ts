// pdfjs-dist ships types for the package root but not the build subpaths.
declare module 'pdfjs-dist/build/pdf.mjs' {
  export * from 'pdfjs-dist';
}

declare module 'pdfjs-dist/build/pdf.worker.mjs' {
  export const WorkerMessageHandler: unknown;
}
