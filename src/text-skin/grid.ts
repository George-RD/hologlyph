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
 * Normalise `text` into the repeating character stream that fills the grid.
 *
 * Whitespace (including newlines) collapses to single spaces and the text is
 * repeated with a space separator. Spaces are padded onto the repeat unit
 * until its length no longer divides `cols`, so each row starts at a
 * different phase of the stream: otherwise word gaps would stack into
 * continuous dark vertical channels across the skin. Pure: depends only on
 * its arguments.
 */
export function textStream(text: string, cols: number, cells: number): string {
  const src = text.replace(/\s+/g, ' ').trim();
  if (src.length === 0) return '';
  let unit = `${src} `;
  if (cols > 1) {
    while (cols % unit.length === 0) unit += ' ';
  }
  let out = unit;
  while (out.length < cells) out += unit;
  return out.slice(0, cells);
}

/**
 * Draw `text` onto `ctx` as a monospace character grid.
 *
 * The backdrop is filled with the dim base colour, then the glyphs are painted
 * cell-by-cell in the brighter glyph colour. To keep the skin reading as a
 * dense continuous texture (dec.text-skin), every cell is filled from one
 * repeating character stream: rows break at arbitrary character positions, so
 * the grid stays full width and word gaps never align into vertical channels.
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

  const stream = textStream(text, cols, cols * rows);
  for (let i = 0; i < stream.length; i++) {
    const ch = stream[i]!;
    if (ch === ' ') continue;
    const r = Math.floor(i / cols);
    const c = i % cols;
    ctx.fillText(ch, padding + c * cellWidth, padding + r * cellHeight);
  }
}
