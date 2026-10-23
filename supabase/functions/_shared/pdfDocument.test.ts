/**
 * WHAT:  Tests for the tiny PDF writer — a structurally valid file (header,
 *        every cross-reference offset pointing at its object, trailer),
 *        wrapping, pagination, links, and text Helvetica can't draw.
 * WHY:   A hand-written PDF has no library catching mistakes: a wrong xref
 *        offset or an unescaped bracket makes a file some viewers refuse.
 * LINKS: ./pdfDocument.ts.
 */

import { renderPdf, textWidth, toWinAnsi, wrap } from './pdfDocument';

const text = (bytes: Uint8Array) => String.fromCharCode(...bytes);

/** Asserts every xref entry points at "N 0 obj". */
function expectValidXref(pdf: string) {
  const startxref = Number(/startxref\n(\d+)\n%%EOF/.exec(pdf)?.[1]);
  expect(pdf.slice(startxref, startxref + 4)).toBe('xref');
  const header = /xref\n0 (\d+)\n/.exec(pdf.slice(startxref));
  const count = Number(header?.[1]);
  const entries = pdf
    .slice(startxref)
    .split('\n')
    .slice(2, 2 + count);
  expect(entries[0]).toBe('0000000000 65535 f ');
  entries.slice(1).forEach((entry, i) => {
    const offset = Number(entry.slice(0, 10));
    expect(pdf.slice(offset, offset + `${i + 1} 0 obj`.length)).toBe(`${i + 1} 0 obj`);
  });
}

describe('renderPdf', () => {
  it('writes a structurally valid PDF', () => {
    const pdf = text(
      renderPdf([{ text: 'Hello' }, { text: 'World', font: 'bold' }], { title: 'T' }),
    );
    expect(pdf.startsWith('%PDF-1.4\n')).toBe(true);
    expect(pdf.trimEnd().endsWith('%%EOF')).toBe(true);
    expectValidXref(pdf);
    expect(pdf).toContain('(Hello) Tj');
    expect(pdf).toContain('/F2');
  });

  it('every content stream’s /Length matches its bytes', () => {
    const pdf = text(renderPdf([{ text: 'Some text' }], { title: 'T' }));
    for (const match of pdf.matchAll(/<< \/Length (\d+) >>\nstream\n([\s\S]*?)\nendstream/g)) {
      expect(match[2].length).toBe(Number(match[1]));
    }
  });

  it('escapes brackets and backslashes, and non-ASCII as octal', () => {
    const pdf = text(renderPdf([{ text: 'a (b) \\ £5 — ok' }], { title: 'T' }));
    expect(pdf).toContain('(a \\(b\\) \\\\ \\2435 \\227 ok) Tj');
    // Every byte of the file is 7-bit, so offsets are exact.
    expect([...pdf].every((c) => c.charCodeAt(0) < 128)).toBe(true);
  });

  it('a link becomes a URI annotation on its page', () => {
    const pdf = text(renderPdf([{ text: 'Open', link: 'https://x.test/a?b=1' }], { title: 'T' }));
    expect(pdf).toContain('/Subtype /Link');
    expect(pdf).toContain('/URI (https://x.test/a?b=1)');
    expect(pdf).toMatch(/\/Annots \[\d+ 0 R\]/);
    expectValidXref(pdf);
  });

  it('runs onto more pages, each numbered', () => {
    const lines = Array.from({ length: 200 }, (_, i) => ({ text: `Line ${i}` }));
    const pdf = text(renderPdf(lines, { title: 'T' }));
    const pages = Number(/\/Type \/Pages \/Kids \[[^\]]*\] \/Count (\d+)/.exec(pdf)?.[1]);
    expect(pages).toBeGreaterThan(2);
    expect(pdf).toContain(`(Page ${pages} of ${pages}) Tj`);
    expectValidXref(pdf);
  });
});

describe('text helpers', () => {
  it('keeps what Helvetica draws; emoji become "?" and arrows "->"', () => {
    expect(toWinAnsi('Café £5 – “ok” → 🚗\tend')).toBe('Café £5 – “ok” -> ? end');
  });

  it('wraps to the width, never over it', () => {
    const max = 120;
    const lines = wrap(
      'The quick brown fox jumps over the lazy dog again and again',
      max,
      10,
      'regular',
    );
    expect(lines.length).toBeGreaterThan(1);
    for (const line of lines) expect(textWidth(line, 10)).toBeLessThanOrEqual(max);
  });

  it('breaks a word too long for the line (a link)', () => {
    const lines = wrap('x'.repeat(200), 100, 10, 'regular');
    expect(lines.length).toBeGreaterThan(1);
    for (const line of lines) expect(textWidth(line, 10)).toBeLessThanOrEqual(100);
  });
});
