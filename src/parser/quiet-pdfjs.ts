// Silence pdf.js's console diagnostics unless --debug asks for them.
//
// pdf.js writes straight to console.warn, and two notices fire constantly
// through no fault of the user's file: the modern-build notice (our
// deliberate choice — the legacy build breaks under `bun test`) and the
// standard-font notice (every base-14 PDF, which is most screenplays, since
// they are set in Courier). Both read as errors to anyone converting a
// script, and neither is actionable.
//
// This lives in its own module, imported FIRST by pdfjs-shims, because ES
// import declarations are hoisted: a guard written inline there would be
// installed only after pdf.js had already been evaluated. pdf.js's own
// setVerbosityLevel is no help either — the modern-build notice fires at
// module scope, before any exported setter can be called. For the same
// reason argv is read here rather than threaded down from the CLI.
if (!process.argv.includes('--debug')) {
  const realWarn = console.warn.bind(console);
  console.warn = (...args: unknown[]) => {
    const first = args[0];
    if (typeof first === 'string' && first.startsWith('Warning: ')) return;
    realWarn(...args);
  };
}

export {};
