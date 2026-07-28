/**
 * Compositor glass (dec.liquid-glass-compositor): the DOM layer, the backdrop
 * root walk, and the outline it writes.
 *
 * happy-dom composites nothing, so nothing here asserts a pixel. What it does
 * assert is everything that decides whether a real browser will show anything:
 * where the layer is inserted, what promotes a backdrop root above it, that the
 * clip only reaches the DOM when the outline actually moved, and that a missing
 * `backdrop-filter` installs nothing at all. The pixel leg is
 * `tools/smoke/backdrop-root-spike.mjs`.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createCompositorGlass,
  findBackdropRootAncestor,
  supportsBackdropFilter,
} from '../src/core/compositor-glass';
import { DEFAULT_HEAD_CONFIG, type HeadCompositorConfig } from '../src/contracts';

/** happy-dom's `CSS.supports` is unreliable for prefixed values; pin it. */
function withBackdropSupport(supported: boolean): void {
  vi.stubGlobal('CSS', {
    supports: (property: string) => supported && property.endsWith('backdrop-filter'),
  });
}

/** Config with the gate open, so the tests exercise a live layer. */
function config(overrides: Partial<HeadCompositorConfig> = {}): HeadCompositorConfig {
  return { ...DEFAULT_HEAD_CONFIG.compositor, amount: 1, ...overrides };
}

/** A positioned parent holding a canvas, as `<hologlyph-head>` builds it. */
function mount(parentStyle = 'position:relative'): HTMLCanvasElement {
  const parent = document.createElement('div');
  parent.setAttribute('style', parentStyle);
  const canvas = document.createElement('canvas');
  parent.appendChild(canvas);
  document.body.appendChild(parent);
  return canvas;
}

/** A square outline, as the projector would hand one over. */
function square(size = 100, offset = 0): Float32Array {
  return new Float32Array([offset, offset, offset + size, offset, offset + size, offset + size, offset, offset + size]);
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  document.body.innerHTML = '';
});

describe('supportsBackdropFilter', () => {
  it('is the only engine gate, and takes the prefixed spelling', () => {
    vi.stubGlobal('CSS', { supports: (p: string) => p === '-webkit-backdrop-filter' });
    expect(supportsBackdropFilter()).toBe(true);

    vi.stubGlobal('CSS', { supports: () => false });
    expect(supportsBackdropFilter()).toBe(false);
  });

  it('reports false rather than throwing when CSS.supports is absent or hostile', () => {
    vi.stubGlobal('CSS', undefined);
    expect(supportsBackdropFilter()).toBe(false);

    vi.stubGlobal('CSS', {
      supports() {
        throw new Error('nope');
      },
    });
    expect(supportsBackdropFilter()).toBe(false);
  });
});

describe('findBackdropRootAncestor', () => {
  it('passes a clean chain, including a shadow host with containment', () => {
    // The shipped element's own shape. If this ever starts reporting, the
    // element's `:host` rule and this feature have stopped being compatible.
    const host = document.createElement('div');
    host.setAttribute('style', 'display:block;position:relative;contain:layout paint');
    document.body.appendChild(host);
    const root = host.attachShadow({ mode: 'open' });
    const canvas = document.createElement('canvas');
    root.appendChild(canvas);

    expect(findBackdropRootAncestor(canvas)).toBeNull();
  });

  it('names the promoting ancestor and why, across a shadow boundary', () => {
    const outer = document.createElement('div');
    outer.setAttribute('style', 'opacity:0.99');
    document.body.appendChild(outer);
    const host = document.createElement('div');
    outer.appendChild(host);
    const root = host.attachShadow({ mode: 'open' });
    const canvas = document.createElement('canvas');
    root.appendChild(canvas);

    const found = findBackdropRootAncestor(canvas);
    expect(found?.element).toBe(outer);
    expect(found?.reason).toContain('opacity');
  });

  it('reports a rounded clip, which is the shape both engines still break on', () => {
    const canvas = mount('overflow:hidden;border-radius:24px;position:relative');
    const found = findBackdropRootAncestor(canvas);
    expect(found?.reason).toContain('overflow');
    expect(found?.reason).toContain('border-radius');
  });

  it('leaves a clip alone when the corners are square', () => {
    // `overflow: hidden` on its own is not a backdrop root in either engine;
    // reporting it would train hosts to ignore the warning.
    expect(findBackdropRootAncestor(mount('overflow:hidden;position:relative'))).toBeNull();
  });

  it('reports a filtered or masked ancestor', () => {
    expect(findBackdropRootAncestor(mount('filter:blur(2px)'))?.reason).toContain('filter');
    expect(findBackdropRootAncestor(mount('mask-image:linear-gradient(#000,#0000)'))?.reason).toContain('mask');
  });
});

describe('createCompositorGlass', () => {
  it('installs nothing on an engine without backdrop-filter', () => {
    withBackdropSupport(false);
    const canvas = mount();
    expect(createCompositorGlass({ canvas })).toBeNull();
    expect(canvas.parentElement?.querySelector('[data-hologlyph-compositor]')).toBeNull();
  });

  it('inserts one layer immediately before the canvas, click-through and hidden', () => {
    withBackdropSupport(true);
    const canvas = mount();
    const glass = createCompositorGlass({ canvas });
    expect(glass).not.toBeNull();
    if (!glass) return;

    // Immediately before: the canvas must paint over the frost, and equal
    // stacked siblings paint in tree order.
    expect(canvas.previousElementSibling).toBe(glass.layer);
    expect(glass.layer.style.pointerEvents).toBe('none');
    // Hidden until an outline arrives; an unclipped layer would frost the whole
    // canvas box for a frame.
    expect(glass.layer.style.visibility).toBe('hidden');
    expect(glass.layer.style.position).toBe('absolute');
  });

  it('warns about a promoting ancestor but still installs', () => {
    withBackdropSupport(true);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const canvas = mount('opacity:0.5;position:relative');

    const glass = createCompositorGlass({ canvas });
    expect(glass).not.toBeNull();
    // Installing anyway keeps the host in charge: the library must not overrule
    // a layout it does not own, and Blink may stop promoting at any release.
    expect(canvas.previousElementSibling).toBe(glass?.layer);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]?.[0])).toContain('backdrop root');
  });

  it('warns when the canvas parent cannot position the layer', () => {
    withBackdropSupport(true);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    createCompositorGlass({ canvas: mount('') });
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]?.[0])).toContain('position: relative');
  });

  it('writes the filter and the tint, with amount as the single master mix', () => {
    withBackdropSupport(true);
    const glass = createCompositorGlass({ canvas: mount() });
    if (!glass) throw new Error('no layer');

    glass.setConfig(config({ blur: 12, saturate: 2, tint: '#204080', tintOpacity: 0.5, amount: 0.5 }));
    expect(glass.layer.style.backdropFilter).toBe('blur(12px) saturate(2)');
    expect(glass.layer.style.getPropertyValue('-webkit-backdrop-filter')).toBe('blur(12px) saturate(2)');
    // The tint alpha is the CONFIGURED value, not the configured value times
    // the amount. Element opacity already carries the amount, so scaling here
    // as well would fade the colour quadratically and it would never reach
    // what the host asked for.
    expect(glass.layer.style.backgroundColor).toBe('rgba(32, 64, 128, 0.5)');
    expect(glass.layer.style.opacity).toBe('0.5');
  });

  it('writes the outline as a pixel polygon and reveals the layer', () => {
    withBackdropSupport(true);
    const glass = createCompositorGlass({ canvas: mount() });
    if (!glass) throw new Error('no layer');

    glass.sync(square(100, 10), 4);
    expect(glass.layer.style.clipPath).toBe('polygon(10px 10px, 110px 10px, 110px 110px, 10px 110px)');
    expect(glass.layer.style.visibility).toBe('visible');
  });

  it('does not touch the DOM again when the outline has not moved', () => {
    withBackdropSupport(true);
    const glass = createCompositorGlass({ canvas: mount() });
    if (!glass) throw new Error('no layer');

    const outline = square();
    glass.sync(outline, 4);
    // A still head, a frozen demo and a reduced-motion session all land here,
    // and a `clip-path` write is the expensive half of this feature.
    let writes = 0;
    Object.defineProperty(glass.layer.style, 'clipPath', {
      configurable: true,
      get: () => '',
      set: () => {
        writes++;
      },
    });
    glass.sync(outline, 4);
    glass.sync(outline, 4);
    expect(writes).toBe(0);

    glass.sync(square(101), 4);
    expect(writes).toBe(1);
  });

  it('rewrites when the vertex count changes but the shared prefix does not', () => {
    withBackdropSupport(true);
    const glass = createCompositorGlass({ canvas: mount() });
    if (!glass) throw new Error('no layer');

    glass.sync(square(), 4);
    const four = glass.layer.style.clipPath;
    // Same first four vertices, one more behind them: comparing only the cached
    // length would keep the stale four-gon on screen.
    const five = new Float32Array([...square(), 50, 150]);
    glass.sync(five, 5);
    expect(glass.layer.style.clipPath).not.toBe(four);
    expect(glass.layer.style.clipPath.split(',')).toHaveLength(5);
  });

  it('hides rather than unclipping when the outline is undefined', () => {
    withBackdropSupport(true);
    const glass = createCompositorGlass({ canvas: mount() });
    if (!glass) throw new Error('no layer');

    glass.sync(square(), 4);
    expect(glass.layer.style.visibility).toBe('visible');
    // Fewer than three points is the projector saying the camera is inside the
    // head. Clearing the clip would frost the entire canvas box instead.
    glass.sync(new Float32Array(0), 0);
    expect(glass.layer.style.visibility).toBe('hidden');
    expect(glass.layer.style.clipPath).toBe('polygon(0px 0px, 100px 0px, 100px 100px, 0px 100px)');
  });

  it('removes the layer on dispose, idempotently, and goes inert after', () => {
    withBackdropSupport(true);
    const canvas = mount();
    const glass = createCompositorGlass({ canvas });
    if (!glass) throw new Error('no layer');

    glass.dispose();
    expect(canvas.parentElement?.querySelector('[data-hologlyph-compositor]')).toBeNull();
    glass.dispose();

    // A frame already in flight must not resurrect a disposed layer's styles.
    glass.sync(square(), 4);
    glass.setConfig(config({ blur: 3 }));
    expect(glass.layer.style.clipPath).toBe('');
    expect(glass.layer.isConnected).toBe(false);
  });
});
