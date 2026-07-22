#!/usr/bin/env bun
// screepub — screenplay PDF → Fountain → reflowable EPUB3.
import { parseArgs } from 'node:util';
import { basename, dirname, extname, join } from 'node:path';
import { readFile, writeFile } from 'node:fs/promises';
import {
  convertPdf,
  convertFountain,
  ScannedPdfError,
  NotAScreenplayError,
  type ConvertResult,
} from './convert';

const USAGE = `screepub — screenplay PDF → reflowable EPUB3 (via Fountain)

Usage:
  screepub <input.pdf | input.fountain> [options]

Options:
  -o, --output <file>    EPUB output path (default: <input>.epub)
  --fountain <file>      Fountain output path (default: <input>.fountain for PDF input)
  --no-fountain          skip writing the intermediate .fountain file
  --title <text>         override detected title
  --author <text>        override detected author
  --force                convert even if it doesn't look like a screenplay
  --debug                also dump classified elements to <input>.elements.json
  -h, --help             show this help
`;

function fail(message: string): never {
  console.error(`screepub: ${message}`);
  process.exit(1);
}

async function main() {
  const { values, positionals } = parseArgs({
    args: process.argv.slice(2),
    allowPositionals: true,
    options: {
      output: { type: 'string', short: 'o' },
      fountain: { type: 'string' },
      'no-fountain': { type: 'boolean', default: false },
      title: { type: 'string' },
      author: { type: 'string' },
      force: { type: 'boolean', default: false },
      debug: { type: 'boolean', default: false },
      help: { type: 'boolean', short: 'h', default: false },
    },
  });

  if (values.help || positionals.length === 0) {
    console.log(USAGE);
    process.exit(values.help ? 0 : 1);
  }
  if (positionals.length > 1) fail('expected exactly one input file');

  const input = positionals[0];
  const ext = extname(input).toLowerCase();
  const stem = join(dirname(input), basename(input, extname(input)));
  const epubPath = values.output ?? `${stem}.epub`;

  const opts = { title: values.title, author: values.author, force: values.force };

  let result: ConvertResult;
  const isPdf = ext === '.pdf';
  try {
    if (isPdf) {
      result = await convertPdf(new Uint8Array(await readFile(input)), opts);
    } else if (ext === '.fountain' || ext === '.txt') {
      result = await convertFountain(await readFile(input, 'utf8'), opts);
    } else {
      fail(`unsupported input type "${ext}" — expected .pdf, .fountain, or .txt`);
    }
  } catch (err) {
    if (err instanceof ScannedPdfError || err instanceof NotAScreenplayError) {
      fail(err.message);
    }
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      fail(`cannot read ${input}`);
    }
    if (String(err).includes('password')) {
      fail('this PDF is password-protected — remove the password first');
    }
    throw err;
  }

  await writeFile(epubPath, result.epub);

  const wrote: string[] = [epubPath];
  if (isPdf && !values['no-fountain']) {
    const fountainPath = values.fountain ?? `${stem}.fountain`;
    await writeFile(fountainPath, result.fountainText, 'utf8');
    wrote.push(fountainPath);
  }
  if (values.debug && result.screenplay) {
    const debugPath = `${stem}.elements.json`;
    await writeFile(debugPath, JSON.stringify(result.screenplay, null, 2), 'utf8');
    wrote.push(debugPath);
  }

  const sp = result.screenplay;
  console.log(`${result.meta.title}${result.meta.author ? ` — ${result.meta.author}` : ''}`);
  if (sp) {
    const top = sp.characters
      .slice(0, 5)
      .map((c) => c.name)
      .join(', ');
    console.log(
      `  ${sp.pageCount} pages · ${sp.scenes.length} scenes · ` +
        `${sp.characters.length} speaking characters${top ? ` (${top}…)` : ''}`,
    );
  }
  for (const w of result.warnings) console.log(`  warning: ${w}`);
  for (const f of wrote) console.log(`  wrote ${f}`);
}

await main();
