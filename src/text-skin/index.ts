/**
 * Text skin engine (dec.text-skin).
 *
 * Draws a static high-density character grid onto a 2D canvas context ONCE per
 * content change, wraps it in a THREE.CanvasTexture, and exposes a scalar
 * `scrollOffset` that the shader consumes as a GPU UV scroll. The engine never
 * redraws on `update` (no per-frame fillText), which is what keeps the skin on
 * the GPU path.
 *
 * In happy-dom tests a stub 2D context is injected through `canvasFactory` so
 * the drawing routine is exercised without a real canvas. In a browser the
 * engine feature-detects OffscreenCanvas and falls back to a document canvas.
 */

import { CanvasTexture } from 'three';
import type * as THREE from 'three';
import type { Disposable, TextSkinEngine, TextSkinSource } from '../contracts';
import { type CanvasLike, DEFAULT_GRID, drawText, type GridConfig } from './grid';

export type { CanvasLike, GridConfig } from './grid';

/** Optional factory for the backing canvas + 2D context (test seam). */
export interface TextSkinEngineOptions {
  /** Inject a stub canvas/context for headless testing. */
  canvasFactory?: () => { canvas: unknown; ctx: CanvasLike };
  cols?: number;
  rows?: number;
  cellWidth?: number;
  cellHeight?: number;
}

/** Minimal typing for the canvas the engine uploads as a texture. */
type AnyCanvas = HTMLCanvasElement | OffscreenCanvas;

/**
 * Default canvas factory: OffscreenCanvas when available, else a document
 * canvas. Both are feature-detected at call time (never at module load).
 */
function defaultCanvasFactory(
  cols: number,
  rows: number,
  cellWidth: number,
  cellHeight: number,
): () => { canvas: unknown; ctx: CanvasLike } {
  const w = cols * cellWidth;
  const h = rows * cellHeight;
  return () => {
    if (typeof OffscreenCanvas !== 'undefined') {
      const canvas = new OffscreenCanvas(w, h);
      const ctx = canvas.getContext('2d') as unknown as CanvasLike | null;
      if (ctx) return { canvas, ctx };
    }
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d') as unknown as CanvasLike | null;
    if (!ctx) throw new Error('TextSkin: 2D canvas context unavailable');
    return { canvas, ctx };
  };
}

/**
 * Create the text skin engine.
 *
 * `update(dt)` is cheap: it only advances `scrollOffset`. The canvas is redrawn
 * exactly once per content change (initial source set and every `onChange`).
 */
export function createTextSkinEngine(options: TextSkinEngineOptions = {}): TextSkinEngine {
  const config: GridConfig = {
    ...DEFAULT_GRID,
    cols: options.cols ?? DEFAULT_GRID.cols,
    rows: options.rows ?? DEFAULT_GRID.rows,
    cellWidth: options.cellWidth ?? DEFAULT_GRID.cellWidth,
    cellHeight: options.cellHeight ?? DEFAULT_GRID.cellHeight,
  };

  const factory = options.canvasFactory ?? defaultCanvasFactory(config.cols, config.rows, config.cellWidth, config.cellHeight);
  const { canvas, ctx } = factory();

  const texture = new CanvasTexture(canvas as AnyCanvas);
  // Do NOT set needsUpdate here: CanvasTexture already flags an initial upload.
  // needsUpdate is set ONLY inside redraw() (dec.performance-budget discipline).

  let source: TextSkinSource | null = null;
  let unsubscribe: (() => void) | null = null;
  let scrollSpeed = 0;
  let scrollOffset = 0;
  let disposed = false;

  function redraw(): void {
    if (disposed) return;
    const text = source ? source.getText() : '';
    drawText(ctx, text, config);
    texture.needsUpdate = true;
  }

  const engine: TextSkinEngine & Disposable = {
    texture,

    setSource(next: TextSkinSource): void {
      if (disposed) return;
      if (unsubscribe) {
        unsubscribe();
        unsubscribe = null;
      }
      source = next;
      unsubscribe = next.onChange(() => redraw());
      redraw();
    },

    setScrollSpeed(speed: number): void {
      scrollSpeed = speed;
    },

    get scrollSpeed(): number {
      return scrollSpeed;
    },

    update(dt: number): void {
      // No canvas work: GPU UV scroll reads scrollOffset in the shader.
      scrollOffset += scrollSpeed * dt;
    },

    get scrollOffset(): number {
      return scrollOffset;
    },

    dispose(): void {
      if (disposed) return;
      disposed = true;
      if (unsubscribe) {
        unsubscribe();
        unsubscribe = null;
      }
      source = null;
      texture.dispose();
    },
  };

  return engine;
}

/**
 * Create a static text source.
 *
 * Content is fixed at construction but can be reassigned via `update`, which
 * notifies subscribers (triggering a redraw in the engine).
 */
export function createStaticTextSource(
  text: string,
): TextSkinSource & { update(next: string): void } {
  let current = text;
  const listeners = new Set<() => void>();

  return {
    getText(): string {
      return current;
    },

    onChange(fn: () => void): () => void {
      listeners.add(fn);
      return () => {
        listeners.delete(fn);
      };
    },

    update(next: string): void {
      if (next === current) return;
      current = next;
      for (const listener of listeners) listener();
    },
  };
}
