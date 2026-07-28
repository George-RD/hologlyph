/**
 * Compositor glass: rung 2 of the backdrop ladder (`dec.liquid-glass-compositor`,
 * `dec.liquid-glass-architecture` item 6).
 *
 * Script cannot read the page behind a transparent canvas (`res.dom-backdrop-capture`),
 * but the compositor can show it. This module inserts one absolutely
 * positioned `div` immediately before the canvas, gives it a `backdrop-filter`,
 * and rewrites its `clip-path` every frame from the projected silhouette hull.
 * The WebGL head keeps drawing glyphs, fresnel, specular and ink on top, so the
 * two layers only have to agree on the outline within a frame.
 *
 * Three things about this module are load bearing and none of them is obvious.
 *
 * The clip goes on the filter element ITSELF and the library authors no
 * wrapper. `backdrop-filter` samples only as far back as its backdrop root, and
 * `tools/smoke/backdrop-root-spike.mjs` measured that a wrapper carrying
 * `opacity` below 1, or a clipping `overflow` with a rounded corner, promotes
 * one and leaves the frost sampling an empty backdrop. Containment on the
 * shadow host is safe, which is why `<hologlyph-head>` needs no style change.
 *
 * The layer is `pointer-events: none` and always will be. It covers the canvas
 * box exactly, so anything else would swallow clicks the host expects to reach
 * its own page.
 *
 * Nothing here runs at `compositor.amount: 0`. The engine does not construct
 * the module at all, so there is no element, no ancestor walk and no per-frame
 * string.
 */

import type { Disposable, HeadCompositorConfig } from '../contracts';

/**
 * Does this engine composite a `backdrop-filter` at all?
 *
 * The only gate. An engine without the property installs no layer and keeps
 * the shipped flat-colour backdrop adaptation, unchanged. Firefox is NOT
 * excluded: the bug that made it suspect (Mozilla 1579957, backdrop-filter not
 * respecting clip-path) is RESOLVED FIXED since 2022-05-18 and shipped before
 * the property was ever unflagged in a release build
 * (`dec.liquid-glass-compositor`).
 */
export function supportsBackdropFilter(): boolean {
  if (typeof CSS === 'undefined' || typeof CSS.supports !== 'function') return false;
  try {
    return CSS.supports('backdrop-filter', 'blur(1px)') || CSS.supports('-webkit-backdrop-filter', 'blur(1px)');
  } catch {
    return false;
  }
}

/**
 * Walk from the canvas to the document root, crossing shadow boundaries, and
 * name the first ancestor that promotes a backdrop root above the layer.
 *
 * Returns null when the chain is clean. Exported for the test suite and for
 * anyone debugging a head that frosts nothing.
 */
export function findBackdropRootAncestor(canvas: Element): { element: Element; reason: string } | null {
  const view = canvas.ownerDocument?.defaultView;
  if (!view || typeof view.getComputedStyle !== 'function') return null;

  let node: Node | null = canvas.parentNode;
  while (node) {
    if (node.nodeType === 11) {
      // ShadowRoot: hop to the host and keep going up the light tree.
      node = (node as ShadowRoot).host ?? null;
      continue;
    }
    if (node.nodeType !== 1) break;
    const element = node as Element;
    if (element === canvas.ownerDocument?.documentElement) break;

    let style: CSSStyleDeclaration;
    try {
      style = view.getComputedStyle(element);
    } catch {
      break;
    }
    const reason = backdropRootReason(style);
    if (reason) return { element, reason };
    node = element.parentNode;
  }
  return null;
}

/**
 * The promoting properties, in the order they are worth reporting.
 *
 * `opacity`, `filter`, `backdrop-filter` and `mask` are backdrop roots by
 * Filter Effects 2. The rounded-clip case is not in the spec: it is a Blink
 * behaviour the spike measured directly, and it is the same shape Mozilla bug
 * 1782876 comment 3 still lists as broken in Firefox 133, so it is reported
 * whatever the engine.
 */
function backdropRootReason(style: CSSStyleDeclaration): string | null {
  // `getPropertyValue` rather than the camel-cased accessors throughout: the
  // accessors are optional on `CSSStyleDeclaration` implementations (happy-dom
  // returns `undefined` for `maskImage` while the property is set), and a
  // silently-undefined read here is a warning that never fires.
  const read = (name: string): string => style.getPropertyValue(name) || '';
  const opacity = Number.parseFloat(read('opacity'));
  if (Number.isFinite(opacity) && opacity < 1) return `opacity: ${opacity}`;
  const filter = read('filter');
  if (filter && filter !== 'none') return `filter: ${filter}`;
  const backdrop = read('backdrop-filter') || read('-webkit-backdrop-filter');
  if (backdrop && backdrop !== 'none') return `backdrop-filter: ${backdrop}`;
  const mask = read('mask-image') || read('-webkit-mask-image');
  if (mask && mask !== 'none') return `mask-image: ${mask}`;
  const overflow = read('overflow');
  const radius = read('border-radius');
  const clips = overflow !== '' && overflow !== 'visible';
  const rounded = radius !== '' && radius !== '0px' && radius !== '0';
  if (clips && rounded) return `overflow: ${overflow} with border-radius: ${radius}`;
  return null;
}

export interface CompositorGlassInit {
  /** The mounted canvas. The layer becomes its immediately preceding sibling. */
  readonly canvas: HTMLCanvasElement;
}

export interface CompositorGlass extends Disposable {
  /** The layer, for tests and for anyone inspecting the shadow tree. */
  readonly layer: HTMLElement;
  /** Push a new configuration. Cheap and idempotent on an unchanged object. */
  setConfig(config: HeadCompositorConfig): void;
  /**
   * Push this frame's outline as raw screen-space xy pairs, in CSS pixels.
   * Fewer than three points hides the layer rather than clearing the clip,
   * which would flash an unclipped full-canvas frost for one frame.
   */
  sync(xy: Float32Array, count: number): void;
}

/**
 * Build the layer, or return null when the engine cannot composite one.
 *
 * The canvas's parent must be a positioned containing block for `inset: 0` to
 * mean the canvas box. `<hologlyph-head>` sets `:host{position:relative}` and
 * already is; a bare-canvas host that is not gets a warning and a layer that
 * covers whatever the nearest positioned ancestor is, which is visibly wrong
 * and therefore self-reporting.
 */
export function createCompositorGlass(init: CompositorGlassInit): CompositorGlass | null {
  const { canvas } = init;
  const parent = canvas.parentNode;
  if (!parent) return null;
  if (!supportsBackdropFilter()) return null;

  const doc = canvas.ownerDocument;
  const view = doc?.defaultView;

  const promoted = findBackdropRootAncestor(canvas);
  if (promoted) {
    console.warn(
      '[hologlyph] compositor glass will show nothing: an ancestor of the canvas promotes a backdrop root ' +
        `(${promoted.reason}). Move that style off the head's ancestors, or set compositor.amount to 0.`,
      promoted.element,
    );
  }

  if (view && parent.nodeType === 1) {
    try {
      // An empty string is not a real computed `position`; it is a
      // `CSSStyleDeclaration` that does not model the property, and the
      // initial value it would report is `static` either way.
      const position = view.getComputedStyle(parent as Element).getPropertyValue('position');
      if (position === 'static' || position === '') {
        console.warn(
          '[hologlyph] the canvas parent is position: static, so the compositor glass layer cannot ' +
            'cover the canvas box. Give it position: relative.',
          parent,
        );
      }
    } catch {
      // A view that refuses to compute styles is not a reason to skip the
      // feature; the layer is still correct wherever the parent is positioned.
    }
  }

  const layer = (doc ?? document).createElement('div');
  layer.setAttribute('data-hologlyph-compositor', '');
  layer.style.position = 'absolute';
  layer.style.inset = '0';
  layer.style.pointerEvents = 'none';
  // Hidden until the first outline arrives. An unclipped layer would frost the
  // whole canvas box for one frame, which is the most visible way this feature
  // can be wrong.
  layer.style.visibility = 'hidden';
  parent.insertBefore(layer, canvas);

  // The canvas must paint above the layer. Both are position-less siblings in
  // the shipped element, and equal-stacked siblings paint in tree order, so
  // this is already true; setting it explicitly costs nothing and survives a
  // host that gave its canvas a z-index.
  if (canvas.style.position === '') canvas.style.position = 'relative';

  let applied: HeadCompositorConfig | null = null;
  let clipCount = 0;
  let clipXy = new Float32Array(0);
  let visible = false;
  let disposed = false;

  function setConfig(config: HeadCompositorConfig): void {
    if (disposed || config === applied) return;
    applied = config;
    const filter = `blur(${config.blur}px) saturate(${config.saturate})`;
    layer.style.backdropFilter = filter;
    // Safari still needs the prefix; `setProperty` because the camel-cased
    // property is not in every lib.dom.
    layer.style.setProperty('-webkit-backdrop-filter', filter);
    layer.style.backgroundColor = rgba(config.tint, config.tintOpacity);
    // `amount` is the master mix, exactly as it is for the pool and the glass:
    // it fades the whole effect in, frost and tint together. Scaling the tint
    // alpha by it as well would fade the tint quadratically against the frost,
    // so the colour would arrive late and never reach the value configured.
    // Opacity on the FILTER element is safe; only an ancestor's opacity
    // promotes a backdrop root (dec.liquid-glass-compositor).
    layer.style.opacity = `${config.amount}`;
  }

  function sync(xy: Float32Array, count: number): void {
    if (disposed) return;
    if (count < 3) {
      if (visible) {
        visible = false;
        layer.style.visibility = 'hidden';
      }
      clipCount = 0;
      return;
    }
    if (!outlineChanged(xy, count)) {
      if (!visible) {
        visible = true;
        layer.style.visibility = 'visible';
      }
      return;
    }
    // One string per changed frame, which is unavoidable: a `clip-path` value
    // is immutable. The comparison above is what keeps a still head, a frozen
    // demo or a reduced-motion session off this path entirely.
    let out = 'polygon(';
    for (let i = 0; i < count; i++) {
      if (i > 0) out += ', ';
      out += `${round2(xy[i * 2] as number)}px ${round2(xy[i * 2 + 1] as number)}px`;
    }
    layer.style.clipPath = `${out})`;
    if (!visible) {
      visible = true;
      layer.style.visibility = 'visible';
    }
  }

  /** True when the outline differs from the cached one; caches it either way. */
  function outlineChanged(xy: Float32Array, count: number): boolean {
    const n = count * 2;
    if (clipCount !== count) {
      if (clipXy.length < n) clipXy = new Float32Array(n);
      clipXy.set(xy.subarray(0, n));
      clipCount = count;
      return true;
    }
    let changed = false;
    for (let i = 0; i < n; i++) {
      if (clipXy[i] !== xy[i]) {
        changed = true;
        break;
      }
    }
    if (changed) clipXy.set(xy.subarray(0, n));
    return changed;
  }

  return {
    layer,
    setConfig,
    sync,
    dispose(): void {
      if (disposed) return;
      disposed = true;
      layer.remove();
    },
  };
}

/** `#rrggbb` plus an alpha, as the `rgba()` the layer paints its tint with. */
function rgba(hex: string, alpha: number): string {
  const v = Number.parseInt(hex.slice(1), 16);
  const r = (v >> 16) & 255;
  const g = (v >> 8) & 255;
  const b = v & 255;
  return `rgba(${r}, ${g}, ${b}, ${round2(alpha)})`;
}

function round2(v: number): number {
  return Math.round(v * 100) / 100;
}
