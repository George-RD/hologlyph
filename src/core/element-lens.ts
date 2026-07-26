/**
 * Chromium HTML-in-Canvas lensing: a capability-gated enhancement that swaps
 * the frozen snapshot for live DOM (dec.liquid-glass-architecture, rung 3,
 * item 5).
 *
 * `createPageLens` works on every engine and refracts a rasterised copy, so
 * content behind the head is frozen between captures. Chromium behind
 * `--enable-blink-features=CanvasDrawElement` can paint real DOM into a canvas
 * at vsync instead, which is the only route to a lens that shows a running CSS
 * animation, a per-frame ticker, or the value someone is typing.
 *
 * It is an ENHANCEMENT and never load-bearing. Absence is the normal case: the
 * flag is Chromium-only, the origin trial ran Chrome 148 to 150, and nothing
 * built against it keeps working when the trial lapses. When the capability is
 * missing, or the named subtree is not shaped for it, the engine builds the
 * snapshot lens exactly as before and nothing about the shipped head changes.
 *
 * Four measured constraints shape the whole design
 * (`src.dom-capture-survey-2026-07-25`):
 *
 * - Only IMMEDIATE CHILDREN of the canvas being drawn into may be drawn.
 *   Ancestors and loose elements throw `InvalidStateError`. So the enhancement
 *   engages only when the host has already put the subtree inside a
 *   `<canvas layoutsubtree>`, and it draws into THAT canvas, which is the only
 *   arrangement the spike actually measured.
 * - Cross-origin images are silently omitted and cross-origin iframes paint as
 *   a blank box. Nothing here can detect either, so both are documented rather
 *   than guarded.
 * - Hit-testing follows the undistorted layout box, and `getElementTransform`
 *   returns a `DOMMatrix`, so a lens distortion can never be reconciled with
 *   it. The subtree stays interactive where it is laid out, inside the source
 *   canvas; the head merely refracts a copy somewhere else. If the head canvas
 *   overlaps the source, the controls inside it become unreachable, so that
 *   overlap is warned about at build time.
 * - `texElementImage2D` has arity 3, `(target, internalformat, element)`, with
 *   a sized internalformat. The Chrome blog's six-argument form throws.
 *
 * The direct GPU route, `texElementImage2D` into a WebGL2 texture, is the
 * cheaper one and it is deliberately NOT the route taken. The head renders
 * through three's `WebGPURenderer`, which may be running either backend and
 * owns every texture in the TSL graph, so a raw GL texture cannot be handed to
 * it without reaching inside the renderer and pinning the WebGL2 backend. The
 * 2D `drawElementImage` route costs one canvas upload per frame, which is the
 * same cost the text skin already pays, and works on both backends. The
 * capability check still requires `texElementImage2D` because the two ship
 * together behind one flag, so its absence is the honest signal that the
 * feature is gone.
 */

import { LinearFilter, SRGBColorSpace, Texture } from 'three';
import type * as THREE from 'three';
import type { LensBinding } from '../contracts.js';
import {
  documentRect,
  lensDisplacement,
  lensWindow,
  type LensRect,
  type LensSource,
} from './lens.js';

/**
 * The 2D context surface this module uses. `drawElementImage` is not in the
 * TypeScript DOM lib, and will not be while it is trial-gated, so the shape is
 * declared here rather than widening the global types for an experiment.
 */
export interface ElementDrawingContext {
  clearRect(x: number, y: number, w: number, h: number): void;
  setTransform(a: number, b: number, c: number, d: number, e: number, f: number): void;
  drawElementImage(element: Element, x: number, y: number): void;
}

/** A canvas that may know how to render its own laid-out subtree. */
interface PaintableCanvas extends HTMLCanvasElement {
  requestPaint?: () => void;
}

export interface ElementLensCapability {
  /** `CanvasRenderingContext2D.prototype.drawElementImage`: the route taken. */
  readonly drawElementImage: boolean;
  /** `WebGL2RenderingContext.prototype.texElementImage2D`: the flag's other half. */
  readonly texElementImage2D: boolean;
  readonly supported: boolean;
}

const UNSUPPORTED: ElementLensCapability = Object.freeze({
  drawElementImage: false,
  texElementImage2D: false,
  supported: false,
});

/** Only the two prototype slots the probe reads; nothing else is needed. */
interface HtmlInCanvasScope {
  CanvasRenderingContext2D?: { prototype?: { drawElementImage?: unknown } };
  WebGL2RenderingContext?: { prototype?: { texElementImage2D?: unknown } };
}

/**
 * Probe the HTML-in-Canvas API without constructing a context. Both halves are
 * prototype methods, so this costs two property reads and allocates nothing,
 * which is what lets it sit on the mount path of every head that never
 * refracts anything.
 */
export function elementLensCapability(scope: unknown = globalThis): ElementLensCapability {
  const global = scope as HtmlInCanvasScope | null | undefined;
  if (!global) return UNSUPPORTED;
  const drawElementImage =
    typeof global.CanvasRenderingContext2D?.prototype?.drawElementImage === 'function';
  const texElementImage2D =
    typeof global.WebGL2RenderingContext?.prototype?.texElementImage2D === 'function';
  return {
    drawElementImage,
    texElementImage2D,
    supported: drawElementImage && texElementImage2D,
  };
}

/**
 * The canvas a live upload must be issued against, or null if this subtree
 * cannot be drawn at all.
 *
 * `layoutsubtree` is required, not merely expected: without it the child is
 * never laid out, there is no cached paint record, and the draw throws
 * `InvalidStateError` on the first frame. Requiring the attribute turns a
 * per-frame exception into a clean fall-through to the snapshot lens.
 */
export function liveLensCanvas(element: Element): HTMLCanvasElement | null {
  const parent = element.parentElement;
  if (parent?.tagName !== 'CANVAS') return null;
  if (!parent.hasAttribute('layoutsubtree')) return null;
  return parent as HTMLCanvasElement;
}

/**
 * Both gates at once: the capability, then the shape of the named subtree.
 * Returns the canvas to draw into, or null, which is the normal answer.
 */
export function resolveLiveLens(
  element: Element,
  scope: unknown = globalThis,
): HTMLCanvasElement | null {
  if (!elementLensCapability(scope).supported) return null;
  return liveLensCanvas(element);
}

/**
 * Consecutive failed uploads before the live lens gives up for good. Half a
 * second at 60 Hz: long enough to sit out a missing paint record on the first
 * frames after a reflow, short enough that a genuinely broken source is not
 * throwing once a frame for the life of the page.
 */
export const MAX_LIVE_LENS_FAILURES = 30;

export interface ElementLensOptions {
  /** The subtree to refract. MUST be an immediate child of `source`. */
  readonly element: Element;
  /** The head canvas, whose position decides which part of the source shows. */
  readonly canvas: HTMLCanvasElement;
  /** The `<canvas layoutsubtree>` that owns `element`, and the upload target. */
  readonly source: HTMLCanvasElement;
  /** Upload failures are reported once, never thrown: the head keeps rendering. */
  readonly onError?: (error: Error) => void;
  /** Injected for tests: document-space measurement of an element. */
  readonly measure?: (element: Element) => LensRect;
  /** Injected for tests: the drawing context of the source canvas. */
  readonly context?: (canvas: HTMLCanvasElement) => ElementDrawingContext | null;
}

function defaultContext(canvas: HTMLCanvasElement): ElementDrawingContext | null {
  return canvas.getContext('2d') as unknown as ElementDrawingContext | null;
}

/**
 * Live DOM as a lens source. Same binding, same projection maths and the same
 * `LensSource` shape as the snapshot lens, so nothing downstream knows which
 * one it is holding.
 */
export function createElementLens(options: ElementLensOptions): LensSource {
  const measure = options.measure ?? documentRect;
  const getContext = options.context ?? defaultContext;
  const source = options.source as PaintableCanvas;

  let disposed = false;
  let failed = false;
  let failures = 0;
  let texture: THREE.Texture | null = null;
  let binding: LensBinding | null = null;
  let context: ElementDrawingContext | null = null;

  function ensureContext(): ElementDrawingContext | null {
    context ??= getContext(source);
    return context;
  }

  function fail(err: unknown): void {
    failures += 1;
    // A fresh subtree has no cached paint record until the canvas has painted
    // once. Asking for one costs nothing when it is already there and is the
    // documented recovery when it is not.
    source.requestPaint?.();
    if (failures < MAX_LIVE_LENS_FAILURES) return;
    failed = true;
    binding = null;
    options.onError?.(err instanceof Error ? err : new Error(String(err)));
  }

  /** Paint the live subtree into the source canvas. False means no fresh pixels. */
  function draw(rect: LensRect): boolean {
    const ctx = ensureContext();
    if (!ctx) {
      fail(new Error('source canvas has no 2d context'));
      return false;
    }
    const width = source.width;
    const height = source.height;
    if (rect.width <= 0 || rect.height <= 0 || width <= 0 || height <= 0) return false;
    try {
      // Scale the element's layout box onto the whole backing store, so the
      // texture covers exactly the rect `lensWindow` projects against. On the
      // natural authoring, a canvas sized to its child, this is the identity.
      ctx.setTransform(width / rect.width, 0, 0, height / rect.height, 0, 0);
      ctx.clearRect(0, 0, rect.width, rect.height);
      ctx.drawElementImage(options.element, 0, 0);
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      failures = 0;
      return true;
    } catch (err) {
      fail(err);
      return false;
    }
  }

  function adopt(): void {
    if (texture) {
      texture.needsUpdate = true;
      return;
    }
    const next = new Texture(source);
    // Live DOM is sRGB exactly as a rasterised snapshot is. Without the decode
    // the refracted page reads washed out and too bright against the head.
    next.colorSpace = SRGBColorSpace;
    next.minFilter = LinearFilter;
    next.magFilter = LinearFilter;
    next.generateMipmaps = false;
    next.needsUpdate = true;
    texture = next;
  }

  return {
    get binding(): LensBinding | null {
      return binding;
    },

    // Live pixels are never stale, so there is nothing to recapture. The
    // engine calls this once on build and hosts call it through
    // `captureLens()`; both are correctly no-ops here.
    capture(): void {},

    sync(strength: number): void {
      if (disposed || failed) return;
      const sourceRect = measure(options.element);
      if (!draw(sourceRect)) {
        if (failed) binding = null;
        return;
      }
      adopt();
      if (!texture) return;
      const canvasRect = measure(options.canvas);
      // Rebuilt every frame rather than diffed: the pixels changed anyway, so
      // there is no still-page case to protect and a comparison would cost
      // more than the object.
      binding = {
        texture,
        window: lensWindow(canvasRect, sourceRect),
        displacement: lensDisplacement(canvasRect, strength),
      };
    },

    dispose(): void {
      if (disposed) return;
      disposed = true;
      binding = null;
      context = null;
      // Nothing else owns this texture: it lives inside a TSL node graph, and
      // the renderer's scene walk only disposes textures held as direct
      // material properties. The CANVAS belongs to the host and is left alone.
      texture?.dispose();
      texture = null;
    },
  };
}

/**
 * Whether the head would sit on top of the subtree it refracts. Both rects are
 * in document space, so this is true only for a real overlap, not for a scroll
 * that happens to line them up in the viewport.
 */
export function lensRegionsOverlap(a: LensRect, b: LensRect): boolean {
  return (
    a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height
  );
}

/**
 * Anything a user could click, focus or type into. Deliberately broad: a false
 * positive costs one console warning, a false negative costs a control nobody
 * can reach.
 */
const INTERACTIVE_SELECTOR =
  'a[href], area[href], button, details, embed, iframe, input, label, select, textarea, video[controls], audio[controls], [tabindex], [contenteditable]';

/**
 * How many controls a distorted region would swallow: the subtree, and the
 * named element itself when a host points `refract` straight at a control.
 * Hit-testing follows the undistorted layout box and `getElementTransform`
 * returns a `DOMMatrix`, so a lens, being non-affine, can never be reconciled
 * with it: a head laid over these is a dead zone.
 */
export function countInteractiveDescendants(element: Element): number {
  const self = element.matches(INTERACTIVE_SELECTOR) ? 1 : 0;
  return self + element.querySelectorAll(INTERACTIVE_SELECTOR).length;
}
