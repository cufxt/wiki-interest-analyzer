/**
 * Minimal PDF writer built on Node.js built-ins only.
 *
 * Supports the subset needed for a short report: multiple pages, core
 * Helvetica fonts (F1/F2/F3), text with optional rotation/anchor, lines,
 * polylines, rectangles and circles. Text is encoded as WinAnsi (Latin-1);
 * characters outside that range are transliterated so nothing crashes.
 */

import { writeFileSync } from "node:fs";

export type Color = [number, number, number];

export const A4_WIDTH = 595.28;
export const A4_HEIGHT = 841.89;

const NARROW = new Set("iljItf.,:;'|!()[]{}/\\`".split(""));
const WIDE = new Set("MWmw@%&".split(""));

function num(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(3).replace(/0+$/, "").replace(/\.$/, "");
}

function rgb(color: Color): string {
  return `${num(color[0])} ${num(color[1])} ${num(color[2])}`;
}

export function hexToColor(hex: string): Color | null {
  const match = /^#?([0-9a-fA-F]{6})$/.exec(hex.trim());
  if (!match) {
    return null;
  }
  const value = Number.parseInt(match[1], 16);
  return [((value >> 16) & 0xff) / 255, ((value >> 8) & 0xff) / 255, (value & 0xff) / 255];
}

const TRANSLITERATION: Record<string, string> = {
  "–": "-", "—": "-", "‘": "'", "’": "'", "“": '"', "”": '"', "…": "...",
  "ł": "l", "Ł": "L", "đ": "d", "Đ": "D", "ø": "o", "Ø": "O",
  "æ": "ae", "Æ": "AE", "þ": "th", "Þ": "Th", "ð": "d", "Ð": "D", "ŋ": "n",
  а: "a", б: "b", в: "v", г: "h", ґ: "g", д: "d", е: "e", є: "ie", ж: "zh",
  з: "z", и: "y", і: "i", ї: "i", й: "i", к: "k", л: "l", м: "m", н: "n",
  о: "o", п: "p", р: "r", с: "s", т: "t", у: "u", ф: "f", х: "kh", ц: "ts",
  ч: "ch", ш: "sh", щ: "shch", ь: "", ю: "iu", я: "ia", ы: "y", э: "e",
  ё: "e", ъ: "",
  А: "A", Б: "B", В: "V", Г: "H", Ґ: "G", Д: "D", Е: "E", Є: "Ie", Ж: "Zh",
  З: "Z", И: "Y", І: "I", Ї: "I", Й: "I", К: "K", Л: "L", М: "M", Н: "N",
  О: "O", П: "P", Р: "R", С: "S", Т: "T", У: "U", Ф: "F", Х: "Kh", Ц: "Ts",
  Ч: "Ch", Ш: "Sh", Щ: "Shch", Ь: "", Ю: "Iu", Я: "Ia", Ы: "Y", Э: "E",
  Ё: "E",
};

function toWinAnsi(text: string): string {
  let out = "";
  for (const char of text) {
    const code = char.codePointAt(0) ?? 0;
    if (code <= 0xff) {
      out += char;
      continue;
    }
    if (char in TRANSLITERATION) {
      out += TRANSLITERATION[char];
      continue;
    }
    const base = char.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
    if (base.length === 1 && (base.codePointAt(0) ?? 0) <= 0xff) {
      out += base;
      continue;
    }
    out += "?";
  }
  return out;
}

function escapeText(text: string): string {
  return toWinAnsi(text)
    .replace(/\\/g, "\\\\")
    .replace(/\(/g, "\\(")
    .replace(/\)/g, "\\)");
}

export function textWidth(text: string, size: number, font = "F1"): number {
  let total = 0;
  for (const char of toWinAnsi(text)) {
    let factor: number;
    if (char === " ") {
      factor = 0.278;
    } else if (NARROW.has(char)) {
      factor = 0.30;
    } else if (WIDE.has(char)) {
      factor = 0.87;
    } else if (char >= "A" && char <= "Z") {
      factor = 0.67;
    } else if (char >= "0" && char <= "9") {
      factor = 0.556;
    } else {
      factor = 0.55;
    }
    total += factor;
  }
  return total * size * (font === "F2" ? 1.06 : 1.0);
}

export function wrapText(text: string, size: number, font: string, maxWidth: number): string[] {
  const lines: string[] = [];
  for (const paragraph of text.split("\n")) {
    let current = "";
    for (const word of paragraph.split(" ")) {
      const candidate = current ? `${current} ${word}` : word;
      if (textWidth(candidate, size, font) <= maxWidth || !current) {
        current = candidate;
      } else {
        lines.push(current);
        current = word;
      }
    }
    lines.push(current);
  }
  return lines;
}

export interface TextOptions {
  size?: number;
  font?: string;
  color?: Color;
  rotate?: number;
  anchor?: "start" | "middle" | "end";
}

function dashOp(dash?: number[]): string {
  return dash && dash.length ? `[${dash.map(num).join(" ")}] 0 d` : "[] 0 d";
}

export class PdfDocument {
  readonly width: number;
  readonly height: number;
  private pages: string[] = [];

  constructor(width = A4_WIDTH, height = A4_HEIGHT) {
    this.width = width;
    this.height = height;
  }

  get pageCount(): number {
    return this.pages.length;
  }

  newPage(): void {
    this.pages.push("");
  }

  private op(operator: string): void {
    if (this.pages.length === 0) {
      this.newPage();
    }
    this.pages[this.pages.length - 1] += operator + "\n";
  }

  text(x: number, y: number, text: string, options: TextOptions = {}): void {
    const size = options.size ?? 10;
    const font = options.font ?? "F1";
    const color = options.color ?? [0, 0, 0];
    const rotate = ((options.rotate ?? 0) * Math.PI) / 180;
    const width = textWidth(text, size, font);
    const dx = options.anchor === "middle" ? -width / 2 : options.anchor === "end" ? -width : 0;
    const cos = Math.cos(rotate);
    const sin = Math.sin(rotate);
    const tx = x + dx * cos;
    const ty = y + dx * sin;
    this.op(
      `BT /${font} ${num(size)} Tf ${rgb(color)} rg ` +
        `${num(cos)} ${num(sin)} ${num(-sin)} ${num(cos)} ${num(tx)} ${num(ty)} Tm ` +
        `(${escapeText(text)}) Tj ET`,
    );
  }

  line(x1: number, y1: number, x2: number, y2: number, options: { width?: number; color?: Color; dash?: number[] } = {}): void {
    const color = options.color ?? [0, 0, 0];
    this.op(`${rgb(color)} RG ${num(options.width ?? 1)} w ${dashOp(options.dash)}`);
    this.op(`${num(x1)} ${num(y1)} m ${num(x2)} ${num(y2)} l S`);
  }

  polyline(points: Array<[number, number]>, options: { width?: number; color?: Color; dash?: number[]; fill?: Color | null } = {}): void {
    if (points.length < 2) {
      return;
    }
    this.op(`${num(options.width ?? 1)} w ${dashOp(options.dash)}`);
    const path = [`${num(points[0][0])} ${num(points[0][1])} m`];
    for (const [x, y] of points.slice(1)) {
      path.push(`${num(x)} ${num(y)} l`);
    }
    if (options.fill) {
      this.op(`${rgb(options.fill)} rg ${rgb(options.color ?? [0, 0, 0])} RG`);
      path.push("B");
    } else {
      this.op(`${rgb(options.color ?? [0, 0, 0])} RG`);
      path.push("S");
    }
    this.op(path.join(" "));
  }

  rect(x: number, y: number, w: number, h: number, options: { fill?: Color | null; stroke?: Color | null; width?: number } = {}): void {
    this.op(`${num(x)} ${num(y)} ${num(w)} ${num(h)} re`);
    const { fill, stroke } = options;
    if (fill && stroke) {
      this.op(`${rgb(fill)} rg ${rgb(stroke)} RG ${num(options.width ?? 1)} w B`);
    } else if (fill) {
      this.op(`${rgb(fill)} rg f`);
    } else if (stroke) {
      this.op(`${rgb(stroke)} RG ${num(options.width ?? 1)} w S`);
    } else {
      this.op("n");
    }
  }

  circle(cx: number, cy: number, r: number, options: { fill?: Color | null; stroke?: Color | null; width?: number } = {}): void {
    const k = 0.552284749831 * r;
    const path = [
      `${num(cx + r)} ${num(cy)} m`,
      `${num(cx + r)} ${num(cy + k)} ${num(cx + k)} ${num(cy + r)} ${num(cx)} ${num(cy + r)} c`,
      `${num(cx - k)} ${num(cy + r)} ${num(cx - r)} ${num(cy + k)} ${num(cx - r)} ${num(cy)} c`,
      `${num(cx - r)} ${num(cy - k)} ${num(cx - k)} ${num(cy - r)} ${num(cx)} ${num(cy - r)} c`,
      `${num(cx + k)} ${num(cy - r)} ${num(cx + r)} ${num(cy - k)} ${num(cx + r)} ${num(cy)} c`,
    ];
    const { fill, stroke } = options;
    if (fill) {
      this.op(`${rgb(fill)} rg`);
      path.push("f");
    } else if (stroke) {
      this.op(`${rgb(stroke)} RG ${num(options.width ?? 1)} w`);
      path.push("S");
    } else {
      path.push("n");
    }
    this.op(path.join(" "));
  }

  save(path: string): void {
    const pageCount = this.pages.length;
    const contentStart = 6;
    const pageStart = 6 + pageCount;
    const objects: string[] = [];
    const kids = Array.from({ length: pageCount }, (_, i) => `${pageStart + i} 0 R`);

    objects[1] = "<< /Type /Catalog /Pages 2 0 R >>";
    objects[2] =
      `<< /Type /Pages /Kids [${kids.join(" ")}] /Count ${pageCount} ` +
      `/MediaBox [0 0 ${num(this.width)} ${num(this.height)}] >>`;
    objects[3] = "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>";
    objects[4] = "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>";
    objects[5] = "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Oblique /Encoding /WinAnsiEncoding >>";

    for (let i = 0; i < pageCount; i += 1) {
      const content = this.pages[i];
      objects[contentStart + i] =
        `<< /Length ${Buffer.byteLength(content, "latin1")} >>\nstream\n${content}\nendstream`;
      objects[pageStart + i] =
        `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${num(this.width)} ${num(this.height)}] ` +
        `/Resources << /Font << /F1 3 0 R /F2 4 0 R /F3 5 0 R >> >> /Contents ${contentStart + i} 0 R >>`;
    }

    const chunks: Buffer[] = [Buffer.from("%PDF-1.4\n%\xe2\xe3\xcf\xd3\n", "latin1")];
    const offsets: number[] = [];
    let position = chunks[0].length;
    for (let i = 1; i < objects.length; i += 1) {
      offsets[i] = position;
      const buffer = Buffer.from(`${i} 0 obj\n${objects[i]}\nendobj\n`, "latin1");
      chunks.push(buffer);
      position += buffer.length;
    }

    const xrefPosition = position;
    let xref = `xref\n0 ${objects.length}\n0000000000 65535 f \n`;
    for (let i = 1; i < objects.length; i += 1) {
      xref += `${String(offsets[i]).padStart(10, "0")} 00000 n \n`;
    }
    const trailer = `trailer\n<< /Size ${objects.length} /Root 1 0 R >>\nstartxref\n${xrefPosition}\n%%EOF\n`;
    chunks.push(Buffer.from(xref + trailer, "latin1"));

    writeFileSync(path, Buffer.concat(chunks));
  }
}
