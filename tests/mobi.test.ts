import { describe, test, expect } from 'bun:test';
import { Fountain } from 'fountain-js';
import { buildMobi } from '../src/mobi/writer';
import { tokensToMobiHtml } from '../src/mobi/html';

const SAMPLE = `INT. KITCHEN - DAY

Jack enters, exhausted.

@JACK
(tired)
Long day. 5 < 6 & "quotes" too.

EXT. YARD - NIGHT

> FADE OUT.
`;

function sampleHtml(): string {
  const { tokens } = new Fountain().parse(SAMPLE, true);
  return tokensToMobiHtml(tokens, { title: 'Test Script', author: 'Jane Doe' });
}

// ── binary reader helpers (independent re-parse of our own output) ──

function u16(b: Uint8Array, o: number): number {
  return (b[o] << 8) | b[o + 1];
}
function u32(b: Uint8Array, o: number): number {
  return ((b[o] << 24) | (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]) >>> 0;
}
function ascii(b: Uint8Array, o: number, len: number): string {
  return new TextDecoder('ascii').decode(b.slice(o, o + len));
}
function recordOffsets(b: Uint8Array): number[] {
  const count = u16(b, 76);
  const offsets: number[] = [];
  for (let i = 0; i < count; i++) offsets.push(u32(b, 78 + i * 8));
  return offsets;
}

// ── MOBI HTML mapping ────────────────────────────────────

describe('tokensToMobiHtml', () => {
  test('title page is centered and followed by a page break', () => {
    const html = sampleHtml();
    expect(html).toContain('<center>');
    expect(html).toContain('Test Script');
    expect(html).toContain('Jane Doe');
    expect(html).toContain('<mbp:pagebreak/>');
  });

  test('scene headings are bold paragraphs', () => {
    expect(sampleHtml()).toContain('<p><b>INT. KITCHEN - DAY</b></p>');
  });

  test('dialogue renders as a blockquote with bold cue and italic parenthetical', () => {
    const html = sampleHtml();
    expect(html).toMatch(/<blockquote><b>JACK<\/b><br\/><i>\(tired\)<\/i><br\/>Long day\./);
  });

  test('transitions are right-aligned without the forcing prefix', () => {
    expect(sampleHtml()).toContain('<p align="right">FADE OUT.</p>');
  });

  test('text is HTML-escaped', () => {
    expect(sampleHtml()).toContain('5 &lt; 6 &amp; &quot;quotes&quot; too.');
  });
});

// ── MOBI container ───────────────────────────────────────

describe('buildMobi', () => {
  const build = () => buildMobi({ title: 'Test Script', author: 'Jane Doe', html: sampleHtml() });

  test('PDB header carries BOOK/MOBI type and consistent record offsets', () => {
    const mobi = build();
    expect(ascii(mobi, 60, 8)).toBe('BOOKMOBI');
    const offsets = recordOffsets(mobi);
    expect(offsets.length).toBeGreaterThanOrEqual(5); // rec0 + text + FLIS + FCIS + EOF
    for (let i = 1; i < offsets.length; i++) {
      expect(offsets[i]).toBeGreaterThan(offsets[i - 1]);
    }
    expect(offsets[offsets.length - 1]).toBeLessThan(mobi.length);
  });

  test('record 0 has uncompressed PalmDOC and a MOBI 6 header', () => {
    const mobi = build();
    const r0 = recordOffsets(mobi)[0];
    expect(u16(mobi, r0)).toBe(1); // compression: none
    expect(ascii(mobi, r0 + 16, 4)).toBe('MOBI');
    expect(u32(mobi, r0 + 24)).toBe(2); // mobi type: book
    expect(u32(mobi, r0 + 28)).toBe(65001); // UTF-8
    expect(u32(mobi, r0 + 36)).toBe(6); // version
  });

  test('text records reassemble to the exact source HTML', () => {
    const mobi = build();
    const html = sampleHtml();
    const offsets = recordOffsets(mobi);
    const r0 = offsets[0];
    const textLength = u32(mobi, r0 + 4);
    const textRecords = u16(mobi, r0 + 8);
    expect(textLength).toBe(new TextEncoder().encode(html).length);

    let bytes = new Uint8Array(0);
    for (let i = 1; i <= textRecords; i++) {
      const end = offsets[i + 1] ?? mobi.length;
      const merged = new Uint8Array(bytes.length + end - offsets[i]);
      merged.set(bytes);
      merged.set(mobi.slice(offsets[i], end), bytes.length);
      bytes = merged;
    }
    expect(new TextDecoder().decode(bytes.slice(0, textLength))).toBe(html);
  });

  test('full name and EXTH metadata are present', () => {
    const mobi = build();
    const r0 = recordOffsets(mobi)[0];
    const nameOffset = u32(mobi, r0 + 84);
    const nameLength = u32(mobi, r0 + 88);
    expect(ascii(mobi, r0 + nameOffset, nameLength)).toBe('Test Script');
    expect(ascii(mobi, r0 + 248, 4)).toBe('EXTH');
    const whole = new TextDecoder('latin1').decode(mobi);
    expect(whole).toContain('Jane Doe'); // EXTH 100
    expect(whole).toContain('EBOK'); // EXTH 501
  });

  test('FLIS, FCIS, and EOF trailer records are in place', () => {
    const mobi = build();
    const offsets = recordOffsets(mobi);
    const n = offsets.length;
    expect(ascii(mobi, offsets[n - 3], 4)).toBe('FLIS');
    expect(ascii(mobi, offsets[n - 2], 4)).toBe('FCIS');
    expect([...mobi.slice(offsets[n - 1], offsets[n - 1] + 4)]).toEqual([0xe9, 0x8e, 0x0d, 0x0a]);
  });

  test('multi-record text never splits a UTF-8 codepoint', () => {
    // >4096 bytes of curly-quoted text forces multiple records.
    const long = Array.from({ length: 300 }, (_, i) => `<p>Line ${i} — “quoted” he said.</p>`).join('\n');
    const mobi = buildMobi({ title: 'Long', author: 'A', html: long });
    const offsets = recordOffsets(mobi);
    const r0 = offsets[0];
    const textRecords = u16(mobi, r0 + 8);
    expect(textRecords).toBeGreaterThan(1);
    const decoder = new TextDecoder('utf-8', { fatal: true });
    for (let i = 1; i <= textRecords; i++) {
      const end = offsets[i + 1] ?? mobi.length;
      // fatal decoder throws if a record starts/ends mid-codepoint
      expect(() => decoder.decode(mobi.slice(offsets[i], end))).not.toThrow();
    }
  });
});
