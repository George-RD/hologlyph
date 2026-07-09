/**
 * Character-grid text drawing for the hologlyph text skin.
 *
 * The grid is a fixed monospace matrix drawn ONCE per content change onto a
 * 2D canvas context. All scrolling/scan motion is performed later in the
 * shader as a GPU UV offset (dec.text-skin): this module never runs per frame.
 *
 * Everything here is pure and side-effect free apart from the injected
 * `CanvasLike` context, so it can be unit tested without a real canvas.
 */

/** Minimal 2D drawing surface. Mirrors the bits of CanvasRenderingContext2D we use. */
export interface CanvasLike {
  fillStyle: string;
  font: string;
  textBaseline: CanvasTextBaseline;
  textAlign: CanvasTextAlign;
  clearRect(x: number, y: number, w: number, h: number): void;
  fillRect(x: number, y: number, w: number, h: number): void;
  fillText(text: string, x: number, y: number): void;
}

/** Layout/colour configuration for the character grid. */
export interface GridConfig {
  cols: number;
  rows: number;
  cellWidth: number;
  cellHeight: number;
  fontFamily: string;
  fontSize: number;
  /** Dim base colour: the "unlit" backdrop behind the glyphs. */
  background: string;
  /** Brighter, emissive-intended glyph colour (selective-bloom ready). */
  glyph: string;
  padding: number;
}

/** Default grid: ~96x64 monospace cells of 16px. */
export const DEFAULT_GRID: GridConfig = {
  cols: 96,
  rows: 64,
  cellWidth: 16,
  cellHeight: 16,
  fontFamily: 'monospace',
  fontSize: 13,
  background: '#05070a',
  glyph: '#9fe7ff',
  padding: 2,
};

/**
 * Word-wrap `text` to `cols` columns.
 *
 * Honours explicit newlines, then wraps on whitespace. Words longer than a
 * line are hard-split so content is never silently dropped. Pure: depends
 * only on its arguments.
 */
export function wrapText(text: string, cols: number): string[] {
  const width = Math.max(1, Math.floor(cols));
  const lines: string[] = [];
  const paragraphs = text.split('\n');

  for (const paragraph of paragraphs) {
    if (paragraph.length === 0) {
      lines.push('');
      continue;
    }

    const words = paragraph.split(/\s+/).filter((w) => w.length > 0);
    let line = '';

    for (const word of words) {
      // Hard-split any word that exceeds the column width.
      let rest = word;
      while (rest.length > width) {
        if (line.length > 0) {
          lines.push(line);
          line = '';
        }
        lines.push(rest.slice(0, width));
        rest = rest.slice(width);
      }

      const candidate = line.length === 0 ? rest : `${line} ${rest}`;
      if (candidate.length > width) {
        lines.push(line);
        line = rest;
      } else {
        line = candidate;
      }
    }

    lines.push(line);
  }

  return lines;
}

/**
 * Draw `text` onto `ctx` as a monospace character grid.
 *
 * The backdrop is filled with the dim base colour, then the wrapped glyphs are
 * painted cell-by-cell in the brighter glyph colour. To keep the skin reading
 * as a dense texture (dec.text-skin), the wrapped lines are cycled so that EVERY
 * grid row is filled rather than leaving the lower 99% of a short text black.
 * No scroll/animation work happens here; that is the shader's job.
 */
export function drawText(ctx: CanvasLike, text: string, config: GridConfig): void {
  const { cols, rows, cellWidth, cellHeight, fontFamily, fontSize, background, glyph, padding } =
    config;

  const width = cols * cellWidth;
  const height = rows * cellHeight;

  // Dim base layer: empty cells read as a faint texture, never pure black.
  ctx.fillStyle = background;
  ctx.fillRect(0, 0, width, height);

  // Glyph layer.
  ctx.font = `${fontSize}px ${fontFamily}`;
  ctx.textBaseline = 'top';
  ctx.textAlign = 'left';
  ctx.fillStyle = glyph;

  const wrapped = wrapText(text, cols);
  // Guard against an empty document: one blank line so the base still paints.
  const lines = wrapped.length > 0 ? wrapped : [''];
  for (let r = 0; r < rows; r++) {
    const line = lines[r % lines.length]!;
    const y = padding + r * cellHeight;
    for (let c = 0; c < line.length; c++) {
      const ch = line[c]!;
      const x = padding + c * cellWidth;
      ctx.fillText(ch, x, y);
    }
  }
}
