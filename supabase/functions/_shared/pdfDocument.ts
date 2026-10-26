/**
 * WHAT:  renderPdf — a tiny, dependency-free PDF writer: lines of text in the
 *        built-in Helvetica (regular / bold), wrapped to the page width,
 *        paginated on A4, with optional clickable links. Returns the file's
 *        bytes.
 * WHY:   "Download your data" became a PDF (owner, 2026-10-23: phones can't
 *        open JSON without another app; every phone opens a PDF). The export
 *        is plain text — headings, label/value lines, links — so a ~200-line
 *        writer beats a third-party PDF library in a money-adjacent Edge
 *        Function: no supply chain, no Deno/npm compatibility risk, and the
 *        same code is unit-tested in Jest (./pdfDocument.test.ts).
 *
 *        ⚠️ TEXT IS WinAnsi (the standard fonts' encoding). Characters outside
 *        it (emoji, most non-Latin scripts) can't be drawn by Helvetica; they
 *        become "?" (and → becomes ->) rather than breaking the file. The
 *        machine-readable copy linked from the PDF keeps every character.
 * LINKS: ./dataExportPdf.ts (the layout); ../export-my-data/index.ts.
 */

export type PdfFont = 'regular' | 'bold';
export type PdfTone = 'normal' | 'muted' | 'link';

export interface PdfLine {
  text: string;
  font?: PdfFont;
  /** Point size (default 10). */
  size?: number;
  /** Left indent in points. */
  indent?: number;
  /** Extra space above, in points. */
  gapBefore?: number;
  tone?: PdfTone;
  /** Makes the line clickable. */
  link?: string;
}

const PAGE_WIDTH = 595.28; // A4
const PAGE_HEIGHT = 841.89;
const MARGIN = 48;
const LINE_HEIGHT = 1.35;

// Helvetica advance widths (1/1000 em) for ASCII 32–126 (Adobe AFM).
const HELVETICA_WIDTHS = [
  278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278, 556, 556, 556,
  556, 556, 556, 556, 556, 556, 556, 278, 278, 584, 584, 584, 556, 1015, 667, 667, 722, 722, 667,
  611, 778, 722, 278, 500, 667, 556, 833, 722, 778, 667, 778, 722, 667, 611, 722, 667, 944, 667,
  667, 611, 278, 278, 278, 469, 556, 333, 556, 556, 500, 556, 556, 278, 556, 556, 222, 222, 500,
  222, 833, 556, 556, 556, 556, 333, 500, 278, 556, 500, 722, 500, 500, 500, 334, 260, 334, 584,
];

// Helvetica-Bold, the same range (Adobe AFM).
const HELVETICA_BOLD_WIDTHS = [
  278, 333, 474, 556, 556, 889, 722, 238, 333, 333, 389, 584, 278, 333, 278, 278, 556, 556, 556,
  556, 556, 556, 556, 556, 556, 556, 333, 333, 584, 584, 584, 611, 975, 722, 722, 722, 722, 667,
  611, 778, 722, 278, 556, 722, 611, 833, 722, 778, 667, 778, 722, 667, 611, 722, 667, 944, 667,
  667, 611, 333, 278, 333, 584, 556, 333, 556, 611, 556, 611, 556, 333, 611, 611, 278, 278, 556,
  278, 889, 611, 611, 611, 611, 389, 556, 333, 611, 556, 778, 556, 556, 500, 389, 280, 389, 584,
];

/** Non-ASCII WinAnsi characters that aren't an accented ASCII letter: the
 *  wider of the two fonts' widths. Accented letters take their base letter's
 *  width (as in the AFM); anything else counts 1000, so text never overflows. */
const HIGH_WIDTHS: Record<string, number> = {
  '€': 556,
  '‚': 278,
  ƒ: 556,
  '„': 500,
  '…': 1000,
  '†': 556,
  '‡': 556,
  ˆ: 333,
  '‰': 1000,
  '‹': 333,
  Œ: 1000,
  '‘': 278,
  '’': 278,
  '“': 500,
  '”': 500,
  '•': 350,
  '–': 556,
  '—': 1000,
  '˜': 333,
  '™': 1000,
  '›': 333,
  œ: 944,
  '¡': 333,
  '¢': 556,
  '£': 556,
  '¤': 556,
  '¥': 556,
  '¦': 280,
  '§': 556,
  '¨': 333,
  '©': 737,
  ª: 370,
  '«': 556,
  '¬': 584,
  '®': 737,
  '¯': 333,
  '°': 400,
  '±': 584,
  '²': 333,
  '³': 333,
  '´': 333,
  µ: 611,
  '¶': 556,
  '·': 278,
  '¸': 333,
  '¹': 333,
  º: 365,
  '»': 556,
  '¼': 834,
  '½': 834,
  '¾': 834,
  '¿': 611,
  Æ: 1000,
  æ: 889,
  Ø: 778,
  ø: 611,
  ß: 611,
  Ð: 722,
  ð: 611,
  Þ: 667,
  þ: 611,
  '×': 584,
  '÷': 584,
};

/** One character's advance width, 1/1000 em. */
function charUnits(char: string, font: PdfFont): number {
  const table = font === 'bold' ? HELVETICA_BOLD_WIDTHS : HELVETICA_WIDTHS;
  const code = char.codePointAt(0) ?? 0;
  if (code >= 32 && code <= 126) return table[code - 32];
  if (code === 0xa0) return 278; // no-break space
  if (code === 0xad) return 333; // soft hyphen
  const known = HIGH_WIDTHS[char];
  if (known !== undefined) return known;
  // é, Š, ÿ… are as wide as e, S, y.
  const base = char.normalize('NFD').codePointAt(0) ?? 0;
  if (base >= 65 && base <= 122 && base !== code) return table[base - 32];
  return 1000;
}

/** Windows-1252 bytes 0x80–0x9F, by the character they stand for. */
const CP1252_EXTRAS: Record<string, number> = {
  '€': 0x80,
  '‚': 0x82,
  ƒ: 0x83,
  '„': 0x84,
  '…': 0x85,
  '†': 0x86,
  '‡': 0x87,
  ˆ: 0x88,
  '‰': 0x89,
  Š: 0x8a,
  '‹': 0x8b,
  Œ: 0x8c,
  Ž: 0x8e,
  '‘': 0x91,
  '’': 0x92,
  '“': 0x93,
  '”': 0x94,
  '•': 0x95,
  '–': 0x96,
  '—': 0x97,
  '˜': 0x98,
  '™': 0x99,
  š: 0x9a,
  '›': 0x9b,
  œ: 0x9c,
  ž: 0x9e,
  Ÿ: 0x9f,
};

/** Readable stand-ins for common characters Helvetica can't draw. */
const SUBSTITUTES: Record<string, string> = {
  '→': '->',
  '←': '<-',
  '✓': 'v',
  ' ': ' ',
  ' ': ' ',
};

/** The WinAnsi byte for one character, or null if it has none. */
function winAnsiByte(char: string): number | null {
  const code = char.codePointAt(0) ?? 0;
  if (code >= 0x20 && code <= 0x7e) return code;
  if (code >= 0xa0 && code <= 0xff) return code;
  return CP1252_EXTRAS[char] ?? null;
}

/** Text Helvetica can draw: unknown characters substituted or "?", control
 *  characters (tabs, stray newlines) as spaces. */
export function toWinAnsi(text: string): string {
  let out = '';
  // NFC first: an "e" + combining accent becomes "é", which WinAnsi has.
  for (const char of text.normalize('NFC')) {
    const code = char.codePointAt(0) ?? 0;
    if (code < 0x20) {
      out += ' ';
    } else if (winAnsiByte(char) !== null) {
      out += char;
    } else if (SUBSTITUTES[char] !== undefined) {
      out += SUBSTITUTES[char];
    } else {
      out += '?';
    }
  }
  return out;
}

/** Width in points of WinAnsi-safe text. */
export function textWidth(text: string, size: number, font: PdfFont = 'regular'): number {
  let units = 0;
  for (const char of text) units += charUnits(char, font);
  return (units / 1000) * size;
}

/** Words onto lines no wider than `max`; an over-long word is broken.
 *  ⚠️ LINEAR in the text: another person's 2000-character message with no
 *  spaces lands in your export, and re-measuring per cut made it cubic —
 *  enough to time the export out (review of #272). */
export function wrap(text: string, max: number, size: number, font: PdfFont): string[] {
  const lines: string[] = [];
  const space = textWidth(' ', size, font);
  let current = '';
  let currentWidth = 0;
  for (const word of text.split(' ')) {
    const wordWidth = textWidth(word, size, font);
    const candidateWidth = current ? currentWidth + space + wordWidth : wordWidth;
    if (candidateWidth <= max) {
      current = current ? `${current} ${word}` : word;
      currentWidth = candidateWidth;
      continue;
    }
    if (current) lines.push(current);
    if (wordWidth <= max) {
      current = word;
      currentWidth = wordWidth;
      continue;
    }
    // A single word wider than the line (a long link): break it by character,
    // at least one per line so a too-narrow column can't loop for ever.
    let piece = '';
    let pieceWidth = 0;
    for (const char of word) {
      const width = (charUnits(char, font) / 1000) * size;
      if (piece && pieceWidth + width > max) {
        lines.push(piece);
        piece = '';
        pieceWidth = 0;
      }
      piece += char;
      pieceWidth += width;
    }
    current = piece;
    currentWidth = pieceWidth;
  }
  lines.push(current);
  return lines;
}

/** A PDF literal string: WinAnsi bytes, with ( ) \ and non-ASCII escaped. */
function pdfString(text: string): string {
  let out = '(';
  for (const char of toWinAnsi(text)) {
    const byte = winAnsiByte(char) ?? 0x3f;
    if (char === '(' || char === ')' || char === '\\') out += `\\${char}`;
    else if (byte < 0x20 || byte > 0x7e) out += `\\${byte.toString(8).padStart(3, '0')}`;
    else out += char;
  }
  return `${out})`;
}

const fmt = (n: number) => (Math.round(n * 100) / 100).toString();

const TONE_COLOUR: Record<PdfTone, string> = {
  normal: '0 0 0 rg',
  muted: '0.38 0.38 0.38 rg',
  link: '0.06 0.32 0.73 rg',
};

interface PlacedLine {
  text: string;
  font: PdfFont;
  size: number;
  x: number;
  y: number;
  tone: PdfTone;
  link?: string;
}

/** Lays the lines out on A4 pages and returns the PDF's bytes. */
export function renderPdf(lines: PdfLine[], meta: { title: string }): Uint8Array {
  const pages: PlacedLine[][] = [[]];
  let y = PAGE_HEIGHT - MARGIN;
  const usable = PAGE_WIDTH - MARGIN * 2;

  for (const line of lines) {
    const size = line.size ?? 10;
    const font = line.font ?? 'regular';
    const indent = line.indent ?? 0;
    const tone = line.tone ?? (line.link?.startsWith('https://') ? 'link' : 'normal');
    const step = size * LINE_HEIGHT;
    // A bold line is a heading: keep room for one body line under it, so it
    // never sits alone at the foot of a page.
    const keepWithNext = font === 'bold' ? 10 * LINE_HEIGHT : 0;
    y -= line.gapBefore ?? 0;
    const pieces = wrap(toWinAnsi(line.text), usable - indent, size, font);
    pieces.forEach((piece, index) => {
      const reserve = index === pieces.length - 1 ? keepWithNext : 0;
      if (y - step - reserve < MARGIN) {
        pages.push([]);
        y = PAGE_HEIGHT - MARGIN;
      }
      y -= step;
      pages[pages.length - 1].push({
        text: piece,
        font,
        size,
        x: MARGIN + indent,
        y,
        tone,
        // Only web links: nothing else should open from a data export.
        link: line.link?.startsWith('https://') ? line.link : undefined,
      });
    });
  }

  // --- Serialise ------------------------------------------------------------
  // Fixed objects: 1 catalog, 2 pages, 3 Helvetica, 4 Helvetica-Bold, 5 info.
  const objects: string[] = [];
  const add = (body: string) => {
    objects.push(body);
    return objects.length; // object number
  };
  add(''); // 1 catalog, filled in last
  add(''); // 2 pages, filled in last
  add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>');
  add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>');
  add(`<< /Title ${pdfString(meta.title)} /Producer (Trackitdown) >>`);

  const pageRefs: number[] = [];
  pages.forEach((placed, index) => {
    const ops: string[] = [];
    const annots: number[] = [];
    for (const line of placed) {
      ops.push(
        'BT',
        TONE_COLOUR[line.tone],
        `/${line.font === 'bold' ? 'F2' : 'F1'} ${fmt(line.size)} Tf`,
        `1 0 0 1 ${fmt(line.x)} ${fmt(line.y)} Tm`,
        `${pdfString(line.text)} Tj`,
        'ET',
      );
      if (line.link) {
        const width = textWidth(line.text, line.size, line.font);
        annots.push(
          add(
            `<< /Type /Annot /Subtype /Link /Rect [${fmt(line.x)} ${fmt(line.y - 2)} ${fmt(line.x + width)} ${fmt(line.y + line.size)}] /Border [0 0 0] /A << /S /URI /URI ${pdfString(line.link)} >> >>`,
          ),
        );
      }
    }
    // Page number, bottom right.
    const footer = `Page ${index + 1} of ${pages.length}`;
    ops.push(
      'BT',
      TONE_COLOUR.muted,
      '/F1 8 Tf',
      `1 0 0 1 ${fmt(PAGE_WIDTH - MARGIN - textWidth(footer, 8))} ${fmt(MARGIN / 2)} Tm`,
      `${pdfString(footer)} Tj`,
      'ET',
    );
    const stream = ops.join('\n');
    const content = add(`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`);
    const annotList = annots.length ? ` /Annots [${annots.map((n) => `${n} 0 R`).join(' ')}]` : '';
    pageRefs.push(
      add(
        `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${fmt(PAGE_WIDTH)} ${fmt(PAGE_HEIGHT)}] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${content} 0 R${annotList} >>`,
      ),
    );
  });
  objects[0] = '<< /Type /Catalog /Pages 2 0 R >>';
  objects[1] = `<< /Type /Pages /Kids [${pageRefs.map((n) => `${n} 0 R`).join(' ')}] /Count ${pageRefs.length} >>`;

  // Every byte is ASCII (pdfString escapes the rest), so string length is the
  // byte offset the cross-reference table needs.
  let out = '%PDF-1.4\n';
  const offsets: number[] = [];
  objects.forEach((body, index) => {
    offsets.push(out.length);
    out += `${index + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xrefAt = out.length;
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets) out += `${String(offset).padStart(10, '0')} 00000 n \n`;
  out += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R /Info 5 0 R >>\nstartxref\n${xrefAt}\n%%EOF\n`;

  const bytes = new Uint8Array(out.length);
  for (let i = 0; i < out.length; i += 1) bytes[i] = out.charCodeAt(i);
  return bytes;
}
