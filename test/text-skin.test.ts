import { describe, expect, it } from 'vitest';
import { createStaticTextSource, createTextSkinEngine, type CanvasLike } from '../src/text-skin';
import { drawText, wrapText, DEFAULT_GRID } from '../src/text-skin/grid';

interface CallCounts {
  fillText: number;
  fillRect: number;
  clearRect: number;
}

/** Build a stub 2D context (CanvasLike) that counts draw calls, plus a factory. */
function stubFactory(): { factory: () => { canvas: unknown; ctx: CanvasLike }; counts: CallCounts } {
  const counts: CallCounts = { fillText: 0, fillRect: 0, clearRect: 0 };
  const ctx: CanvasLike = {
    fillStyle: '#000',
    font: '',
    textBaseline: 'top',
    textAlign: 'left',
    clearRect() {
      counts.clearRect++;
    },
    fillRect() {
      counts.fillRect++;
    },
    fillText() {
      counts.fillText++;
    },
  };
  let made = false;
  const factory = () => {
    if (made) throw new Error('canvasFactory called more than once');
    made = true;
    return { canvas: {}, ctx };
  };
  return { factory, counts };
}

describe('text-skin engine', () => {
  it('redraws only on content change, not on update', () => {
    const { factory, counts } = stubFactory();
    const engine = createTextSkinEngine({ canvasFactory: factory });
    const source = createStaticTextSource('hello world');

    // No draw before a source is attached.
    expect(counts.fillText).toBe(0);

    engine.setSource(source);
    const afterSet = counts.fillText;
    expect(afterSet).toBeGreaterThan(0);

    // update() must NOT trigger a redraw.
    engine.update(0.1);
    engine.update(0.1);
    engine.update(0.25);
    expect(counts.fillText).toBe(afterSet);

    // A content change must trigger exactly one more redraw.
    source.update('a much longer stream of code that flows across the skin');
    expect(counts.fillText).toBeGreaterThan(afterSet);
  });

  it('advances scrollOffset on update without redrawing', () => {
    const { factory, counts } = stubFactory();
    const engine = createTextSkinEngine({ canvasFactory: factory });
    engine.setSource(createStaticTextSource('idle'));

    const drawnBefore = counts.fillText;
    engine.setScrollSpeed(2);
    engine.update(0.5);
    engine.update(0.5);

    expect(engine.scrollOffset).toBeCloseTo(2.0, 5);
    expect(counts.fillText).toBe(drawnBefore);
  });

  it('unsubscribes from the source on dispose and is idempotent', () => {
    const { factory, counts } = stubFactory();
    const engine = createTextSkinEngine({ canvasFactory: factory });
    const source = createStaticTextSource('before');
    engine.setSource(source);

    const drawnBeforeDispose = counts.fillText;
    engine.dispose();
    engine.dispose(); // idempotent, must not throw

    // After dispose the engine no longer redraws on content change.
    source.update('after');
    expect(counts.fillText).toBe(drawnBeforeDispose);

    // A disposed engine must not resurrect a draw if setSource is called.
    engine.setSource(createStaticTextSource('revived'));
    expect(counts.fillText).toBe(drawnBeforeDispose);
  });
});
describe('grid fill (text-skin texture)', () => {
  it('repeats wrapped text so every row is non-empty and far denser than a single pass', () => {
    const { rows, cols, padding, cellHeight } = DEFAULT_GRID;
    const seenRows = new Set<number>();
    let fillText = 0;

    const ctx: CanvasLike = {
      fillStyle: '#000',
      font: '',
      textBaseline: 'top',
      textAlign: 'left',
      clearRect() {},
      fillRect() {},
      fillText(_ch: string, _x: number, y: number) {
        fillText++;
        // y = padding + r * cellHeight; recover the row index from it.
        seenRows.add(Math.round((y - padding) / cellHeight));
      },
    };

    const short = 'Hi';
    drawText(ctx, short, DEFAULT_GRID);

    // Every grid row received at least one glyph (no 99% black skin).
    expect(seenRows.size).toBe(rows);

    // Single-pass baseline: the wrapped lines that fit in `rows` drawn once
    // (here a single short line). The repeated pass must be far denser.
    const baseline = wrapText(short, cols)
      .slice(0, rows)
      .reduce((n, line) => n + line.length, 0);
    expect(fillText).toBeGreaterThan(baseline * 10);
  });
});
