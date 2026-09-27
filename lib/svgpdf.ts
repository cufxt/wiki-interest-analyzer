/**
 * Translate the SVG charts produced by plot_chart.ts into PDF drawing calls.
 *
 * This is intentionally a small, focused parser: it understands exactly the
 * subset of SVG that plot_chart.ts emits (rect, line, polyline, circle, text
 * with optional rotate transform and text-anchor). It does not aim to be a
 * general SVG renderer.
 */

import { PdfDocument, hexToColor } from "./pdf.ts";
import type { Color } from "./pdf.ts";

interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

function attrMap(attrs: string): Record<string, string> {
  const map: Record<string, string> = {};
  const re = /([a-zA-Z-]+)\s*=\s*"([^"]*)"/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(attrs)) !== null) {
    map[match[1]] = match[2];
  }
  return map;
}

const ENTITIES: Record<string, string> = {
  "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"', "&apos;": "'",
};

function unescapeXml(text: string): string {
  return text.replace(/&(amp|lt|gt|quot|apos);/g, (entity) => ENTITIES[entity] ?? entity);
}

function color(value: string | undefined): Color | null {
  if (!value || value === "none") {
    return null;
  }
  return hexToColor(value);
}

function number(value: string | undefined, fallback = 0): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function rotatePoint(px: number, py: number, cx: number, cy: number, degrees: number): [number, number] {
  const radians = (degrees * Math.PI) / 180;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  const dx = px - cx;
  const dy = py - cy;
  return [cx + dx * cos - dy * sin, cy + dx * sin + dy * cos];
}

export function drawSvg(doc: PdfDocument, svgText: string, box: Box): void {
  const viewBoxMatch = /viewBox\s*=\s*"([^"]*)"/.exec(svgText);
  let vbWidth = 1000;
  let vbHeight = 450;
  if (viewBoxMatch) {
    const parts = viewBoxMatch[1].trim().split(/\s+/).map(Number);
    if (parts.length === 4 && parts[2] > 0 && parts[3] > 0) {
      vbWidth = parts[2];
      vbHeight = parts[3];
    }
  }

  const scale = Math.min(box.width / vbWidth, box.height / vbHeight);
  const usedWidth = vbWidth * scale;
  const usedHeight = vbHeight * scale;
  const offsetX = box.x + (box.width - usedWidth) / 2;
  const offsetY = box.y + (box.height - usedHeight) / 2;
  const mapX = (x: number): number => offsetX + x * scale;
  const mapY = (y: number): number => offsetY + (vbHeight - y) * scale;

  const elementRe =
    /<\s*(rect|line|polyline|circle)\b([^>]*?)\/>|<\s*text\b([^>]*?)>([\s\S]*?)<\/text>/g;

  let match: RegExpExecArray | null;
  while ((match = elementRe.exec(svgText)) !== null) {
    const tag = match[1] ?? "text";
    const attrs = attrMap(match[1] ? match[2] : match[3]);

    if (tag === "rect") {
      const x = number(attrs.x);
      const y = number(attrs.y);
      const width = number(attrs.width);
      const height = number(attrs.height);
      doc.rect(mapX(x), mapY(y + height), width * scale, height * scale, {
        fill: color(attrs.fill),
        stroke: color(attrs.stroke),
        width: number(attrs["stroke-width"], 1) * scale,
      });
    } else if (tag === "line") {
      doc.line(mapX(number(attrs.x1)), mapY(number(attrs.y1)), mapX(number(attrs.x2)), mapY(number(attrs.y2)), {
        color: color(attrs.stroke) ?? [0, 0, 0],
        width: number(attrs["stroke-width"], 1) * scale,
        dash: attrs["stroke-dasharray"]
          ? attrs["stroke-dasharray"].trim().split(/[\s,]+/).map(Number).map((v) => v * scale)
          : undefined,
      });
    } else if (tag === "polyline") {
      const points = (attrs.points ?? "")
        .trim()
        .split(/\s+/)
        .map((pair) => pair.split(",").map(Number))
        .filter((pair) => pair.length === 2 && pair.every(Number.isFinite))
        .map(([x, y]) => [mapX(x), mapY(y)] as [number, number]);
      doc.polyline(points, {
        color: color(attrs.stroke) ?? [0, 0, 0],
        width: number(attrs["stroke-width"], 1.5) * scale,
        fill: color(attrs.fill),
      });
    } else if (tag === "circle") {
      doc.circle(mapX(number(attrs.cx)), mapY(number(attrs.cy)), number(attrs.r) * scale, {
        fill: color(attrs.fill),
        stroke: color(attrs.stroke),
        width: number(attrs["stroke-width"], 1) * scale,
      });
    } else {
      const text = unescapeXml(match[4] ?? "");
      const size = number(attrs["font-size"], 12) * scale;
      const font = (attrs["font-weight"] ?? "").includes("bold") ? "F2" : "F1";
      const anchor = (attrs["text-anchor"] as "start" | "middle" | "end" | undefined) ?? "start";
      let x = number(attrs.x);
      let y = number(attrs.y);
      let rotate = 0;
      const transform = /rotate\(\s*(-?[\d.]+)(?:\s+(-?[\d.]+)\s+(-?[\d.]+))?\s*\)/.exec(attrs.transform ?? "");
      if (transform) {
        const degrees = Number(transform[1]);
        if (transform[2] !== undefined && transform[3] !== undefined) {
          [x, y] = rotatePoint(x, y, Number(transform[2]), Number(transform[3]), degrees);
        }
        rotate = -degrees;
      }
      doc.text(mapX(x), mapY(y), text, {
        size,
        font,
        color: color(attrs.fill) ?? [0, 0, 0],
        rotate,
        anchor,
      });
    }
  }
}
