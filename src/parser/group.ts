import type { Fmt, RawLine, TextBlock } from './types';
import { INDENT_RANGES } from './types';

/** Two fmts are the same shift. Both undefined counts as the same. */
function sameFmt(a: Fmt | undefined, b: Fmt | undefined): boolean {
  return a?.family === b?.family && a?.size === b?.size;
}

/**
 * Group raw PDF lines into logical text blocks.
 * Lines that share the same indent type and are contiguous get merged.
 * Scene headings, character names, and type changes always break blocks.
 */
export function groupBlocks(lines: RawLine[]): TextBlock[] {
  const blocks: TextBlock[] = [];
  let currentLines: RawLine[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const prevLine = i > 0 ? lines[i - 1] : null;

    // Check if this line should start a new block
    if (currentLines.length > 0 && shouldBreak(line, prevLine, currentLines)) {
      blocks.push(buildBlock(currentLines));
      currentLines = [];
    }

    // Clean up ellipsis artifacts from PDF extraction
    const cleaned = cleanEllipsis(line);
    currentLines.push(cleaned);
  }

  if (currentLines.length > 0) {
    blocks.push(buildBlock(currentLines));
  }

  return blocks;
}

function shouldBreak(
  line: RawLine,
  prevLine: RawLine | null,
  currentLines: RawLine[]
): boolean {
  if (!prevLine) return false;

  // Empty line detection: large Y gap between lines on same page
  if (line.pageNum === prevLine.pageNum && Math.abs(prevLine.y - line.y) > 20) {
    return true;
  }

  // Page break
  if (line.pageNum !== prevLine.pageNum) return true;

  // A font shift is a block boundary (registry #18): a chyron glued to the
  // action above it must isolate, or the block would carry no fmt at all and
  // the shift would vanish.
  if (!sameFmt(line.fmt, prevLine.fmt)) return true;

  // Scene headings always start new blocks
  if (isSceneHeading(line.text)) return true;

  // Classify both lines
  const prevType = quickClassify(prevLine.indent);
  const currType = quickClassify(line.indent);

  // Character names always start new blocks
  if (currType === 'character') return true;

  // Transitions always break
  if (currType === 'transition' || prevType === 'transition') return true;

  // Type changes break blocks
  if (prevType !== currType) return true;

  // Same type: allow if indent differs by <= 2
  const prevIndent = currentLines[currentLines.length - 1].indent;
  if (Math.abs(line.indent - prevIndent) > 2) return true;

  return false;
}

type QuickType = 'action' | 'dialogue' | 'character' | 'transition';

function quickClassify(indent: number): QuickType {
  if (indent < INDENT_RANGES.ACTION_MAX) return 'action';
  if (indent >= INDENT_RANGES.DIALOGUE_MIN && indent <= INDENT_RANGES.DIALOGUE_MAX) return 'dialogue';
  if (indent > INDENT_RANGES.CHARACTER_MIN && indent <= INDENT_RANGES.CHARACTER_MAX) return 'character';
  if (indent > INDENT_RANGES.TRANSITION_MIN) return 'transition';
  return 'action'; // gap zone defaults to action
}

function isSceneHeading(text: string): boolean {
  return /^(INT\.|EXT\.|INT\.\/EXT\.|I\/E\.)/.test(text);
}

function cleanEllipsis(line: RawLine): RawLine {
  // PDF artifact: character names sometimes get truncated with "..."
  if (/^[A-Z\s().']+\.{3}$/.test(line.text)) {
    return { ...line, text: line.text.replace(/\.{3}$/, '') };
  }
  return line;
}

function buildBlock(lines: RawLine[]): TextBlock {
  const text = lines.map((l) => l.text).join(' ');
  const indents = lines.map((l) => l.indent);
  const styledText = lines.some((l) => l.styled)
    ? lines.map((l) => l.styled ?? l.text).join(' ')
    : undefined;

  // Block-level only, by design: every line must agree, or the block carries
  // no shift. shouldBreak above already splits on disagreement, so this is
  // the belt to that brace rather than a second policy.
  const first = lines[0].fmt;
  const fmt = lines.every((l) => sameFmt(l.fmt, first)) ? first : undefined;

  return {
    lines,
    text,
    styledText,
    fmt,
    dualRight: lines.some((l) => l.dualRight) || undefined,
    indent: lines[0].indent,
    minIndent: Math.min(...indents),
    maxIndent: Math.max(...indents),
    pageNum: lines[0].pageNum,
    yPosition: lines[0].y,
  };
}
