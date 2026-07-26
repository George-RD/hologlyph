/**
 * Page snapshot lens: rasterise a subtree the host names, upload it, and hand
 * the glass materials a window to sample it through
 * (dec.liquid-glass-architecture, rung 3, item 4).
 *
 * This is the only cross-engine route to true per-pixel refraction of real
 * page content. `res.dom-backdrop-capture` measured every alternative: the
 * compositor can show live page pixels inside an arbitrary shape but never
 * hands them to script, and Chromium's HTML-in-Canvas can only draw immediate
 * children of the canvas being drawn into. A snapshot is the price of working
 * everywhere.
 *
 * The limits are inherent and belong in the API, not hidden behind it:
 *
 * - Content is FROZEN between captures. A CSS animation behind the head does
 *   not move in the refraction.
 * - Cross-origin images need CORS headers or they rasterise blank, silently.
 * - `position: fixed` subtrees are typically excluded by DOM rasterisers.
 * - The first capture costs 10 to 150 ms of main thread on a real page.
 *
 * No rasteriser ships with the library. The default lazily imports the
 * optional `@zumer/snapdom` peer the first time a host actually names a
 * subtree, so a consumer who never opts in pays nothing and installs nothing;
 * a host with its own rasteriser passes it in and needs no peer at all.
 */

import { LinearFilter, SRGBColorSpace, Texture } from 'three';
import type * as THREE from 'three';
import type { LensBinding, LensRasteriser } from '../contracts.js';
import {
  createLensScheduler,
  documentRect,
  IDENTITY_LENS_WINDOW,
  lensDisplacement,
  lensWindow,
  lensWindowsDiffer,
  type LensRect,
  type LensScheduler,
  type LensSource,
} from './lens.js';

export interface PageLensOptions {
  /** The subtree to refract. NEVER `document.body` by default. */
  readonly element: Element;
  /** The head canvas, whose position decides which part of the snapshot shows. */
  readonly canvas: HTMLCanvasElement;
  readonly rasterise?: LensRasteriser;
  /** Stillness before a moved or resized source recaptures. */
  readonly recaptureMs?: number;
  /** Capture failures are reported, never thrown: the head keeps rendering. */
  readonly onError?: (error: Error) => void;
  /** Injected for tests: document-space measurement of an element. */
  readonly measure?: (element: Element) => LensRect;
  readonly setTimer?: (fn: () => void, ms: number) => unknown;
  readonly clearTimer?: (handle: unknown) => void;
}

/** The snapshot flavour of `LensSource`: rasterise on demand, sample everywhere. */
export type PageLens = LensSource;

/** Sub-pixel tolerance on the source rect, so float jitter never recaptures. */
const RECT_EPSILON = 0.5;

function rectsDiffer(a: LensRect, b: LensRect): boolean {
  return (
    Math.abs(a.x - b.x) > RECT_EPSILON ||
    Math.abs(a.y - b.y) > RECT_EPSILON ||
    Math.abs(a.width - b.width) > RECT_EPSILON ||
    Math.abs(a.height - b.height) > RECT_EPSILON
  );
}

/**
 * Lazily resolved default rasteriser. One module-level promise, so a page with
 * several heads loads the rasteriser once. A REJECTION is not cached: a
 * dynamic import can fail on a transient network error as easily as on a
 * missing peer, and a cached rejection would make the first failure permanent
 * for the life of the page.
 */
let snapdomLoader: Promise<LensRasteriser> | null = null;

function defaultRasteriser(): Promise<LensRasteriser> {
  snapdomLoader ??= import('@zumer/snapdom').then(
    ({ snapdom }) =>
      (element: Element) =>
        snapdom.toCanvas(element, {
          // The snapshot is sampled through a distorting surface at well under
          // 1:1, so device-pixel fidelity buys nothing and costs capture time.
          dpr: 1,
          fast: true,
          embedFonts: true,
        }),
    (err: unknown) => {
      snapdomLoader = null;
      throw err;
    },
  );
  return snapdomLoader;
}

export function createPageLens(options: PageLensOptions): PageLens {
  const measure = options.measure ?? documentRect;
  const onError = options.onError;
  const rasterise = options.rasterise;

  let disposed = false;
  let texture: THREE.Texture | null = null;
  /** The source rect AT CAPTURE TIME: the snapshot's own document anchor. */
  let capturedRect: LensRect | null = null;
  let inFlight = false;
  let queued = false;
  let binding: LensBinding | null = null;

  const scheduler: LensScheduler = createLensScheduler(() => void runCapture(), {
    ...(options.recaptureMs === undefined ? {} : { debounceMs: options.recaptureMs }),
    ...(options.setTimer === undefined ? {} : { setTimer: options.setTimer }),
    ...(options.clearTimer === undefined ? {} : { clearTimer: options.clearTimer }),
  });

  // Scroll recapture, debounced. Geometry does not need it, because the
  // snapshot and the window are both in document space, but CONTENT does: a
  // scroll-driven animation or a lazily revealed image inside the source is
  // frozen in the snapshot until something re-rasterises it, and a hero
  // section is exactly the kind of subtree a host names. Capture phase so an
  // inner scrolling container counts too; `scroll` does not bubble.
  const view = options.element.ownerDocument?.defaultView ?? null;
  const onScroll = (): void => {
    scheduler.soon();
  };
  view?.addEventListener('scroll', onScroll, { passive: true, capture: true });

  function adopt(image: CanvasImageSource): void {
    const next = new Texture(image as unknown as HTMLCanvasElement);
    // A rasterised page is sRGB. Without this the sampler skips the decode and
    // the refracted page comes out washed out and too bright against the head.
    next.colorSpace = SRGBColorSpace;
    next.minFilter = LinearFilter;
    next.magFilter = LinearFilter;
    next.generateMipmaps = false;
    next.needsUpdate = true;
    texture?.dispose();
    texture = next;
  }

  async function runCapture(): Promise<void> {
    if (disposed) return;
    // Coalesce rather than queue: a capture is 10 to 150 ms, and three
    // requests during one of them want one fresh snapshot, not three.
    if (inFlight) {
      queued = true;
      return;
    }
    inFlight = true;
    try {
      const raster = rasterise ?? (await defaultRasteriser());
      if (disposed) return;
      const image = await raster(options.element);
      if (disposed) return;
      adopt(image);
      capturedRect = measure(options.element);
    } catch (err) {
      onError?.(err instanceof Error ? err : new Error(String(err)));
    } finally {
      inFlight = false;
      const again = queued && !disposed;
      queued = false;
      if (again) void runCapture();
    }
  }

  return {
    get binding(): LensBinding | null {
      return binding;
    },

    capture(): void {
      if (disposed) return;
      scheduler.now();
    },

    sync(strength: number): void {
      if (disposed) return;
      const live = measure(options.element);
      if (capturedRect && rectsDiffer(live, capturedRect)) scheduler.soon();
      if (!texture || !capturedRect) {
        binding = null;
        return;
      }
      const canvasRect = measure(options.canvas);
      const next = lensWindow(canvasRect, capturedRect);
      const displacement = lensDisplacement(canvasRect, strength);
      // Rebuild only when something moved: the binding is compared by
      // identity nowhere, but a stable object keeps the per-frame allocation
      // off the hot path on a still page.
      if (
        !binding ||
        lensWindowsDiffer(binding.window, next, 0) ||
        binding.displacement[0] !== displacement[0] ||
        binding.displacement[1] !== displacement[1] ||
        binding.texture !== texture
      ) {
        binding = { texture, window: next, displacement };
      }
    },

    dispose(): void {
      if (disposed) return;
      disposed = true;
      view?.removeEventListener('scroll', onScroll, { capture: true });
      scheduler.dispose();
      binding = null;
      capturedRect = null;
      // Nothing else owns this texture: it lives inside a TSL node graph, and
      // the renderer's scene walk only disposes textures held as direct
      // material properties.
      texture?.dispose();
      texture = null;
    },
  };
}

export { IDENTITY_LENS_WINDOW };
