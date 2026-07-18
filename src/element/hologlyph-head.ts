/**
 * <hologlyph-head> custom element.
 *
 * Declarative, drop-in talking head. The element lazily builds the imperative
 * engine (hologlyph.runtime.core) on connect, mounts it on a shadow-hosted
 * canvas, and tears it down hard on disconnect so SPA route changes and A/B
 * variants never leak GPU or audio resources (dec.api-emphasis,
 * dec.performance-budget).
 *
 * Import surface is deliberately narrow: this module imports ONLY the shared
 * contract types and the core factory. The default engine factory loads
 * `../core` lazily so that:
 *   - tests can override it with a fake (no real GPU engine is ever built), and
 *   - importing this module never hard-requires core to exist at load time.
 */

import type {
  BehaviorState,
  Engine,
  EngineOptions,
  Expression,
  TextSkinSource,
  TTSAdapter,
} from '../contracts';

/** Factory that builds an engine from attribute-derived options. */
export type EngineFactory = (options?: EngineOptions) => Engine;

/**
 * Inline text-skin source for the `text-skin` attribute (static placeholder
 * copy). Implemented locally so the element need not import the text-skin
 * module (it is outside this node's dependency edge).
 */
type EngineWithResize = Engine & {
  resize(width: number, height: number): void;
};
function staticTextSource(text: string): TextSkinSource {
  return {
    getText: () => text,
    onChange: () => () => {},
  };
}

/** Resolved default factory cache (populated on first real connect). */
let defaultFactoryCache: EngineFactory | null = null;

/**
 * Lazily resolve the real engine factory from core. Only invoked when the
 * static override is unset, so test runs that inject a fake never touch core.
 */
async function loadDefaultFactory(): Promise<EngineFactory> {
  if (defaultFactoryCache) return defaultFactoryCache;
  const specifier = '../core';
  const mod = (await import(/* @vite-ignore */ specifier)) as {
    createEngine?: EngineFactory;
  };
  if (typeof mod.createEngine !== 'function') {
    throw new Error('hologlyph: src/core does not export createEngine');
  }
  defaultFactoryCache = mod.createEngine;
  return defaultFactoryCache;
}

interface SpeakQueued {
  text: string;
  resolve: () => void;
  reject: (err: unknown) => void;
}

const DEFAULT_CANVAS_SIZE = 480;

export class HologlyphHeadElement extends HTMLElement {
  /**
   * Test/advanced override. When set, `connectedCallback` uses this factory
   * instead of the real core engine, so tests never build a GPU engine.
   * Reset to `null` between tests.
   */
  static engineFactory: EngineFactory | null = null;

  static get observedAttributes(): string[] {
    return ['src', 'text-skin', 'reduced-motion'];
  }

  private _engine: Engine | null = null;
  private _ready = false;
  private _connecting = false;
  /**
   * Monotonic generation counter for the connect/boot lifecycle. Bumped on
   * every connect AND every disconnect so an in-flight `_boot()` can detect
   * that the element was reconnected or torn down while it was awaiting (e.g.
   * a deferred engine factory or mount) and abort its own work.
   */
  private _bootGen = 0;
  private _needsRecreate = false;
  private _offs: Array<() => void> = [];
  /** Latest normalised pointer position pending a throttled flush. */
  private _latestGaze: { x: number; y: number } | null = null;
  /** Handle for the rAF-throttled flush of the latest pointer position. */
  private _gazeRaf: number | null = null;
  private _speakQueue: SpeakQueued[] = [];
  private _emotionQueue: Expression[] = [];
  private _textSource: TextSkinSource | null = null;
  private _ttsAdapter: TTSAdapter | null = null;
  /** Canvas ResizeObserver, retained so it can be disconnected on teardown. */
  private _resizeObserver: ResizeObserver | null = null;

  // -- Lifecycle ------------------------------------------------------------
  connectedCallback(): void {
    if (this._connecting) return;
    if (this._engine && !this._needsRecreate) return;

    this._connecting = true;
    // A new connection starts a fresh boot generation. Any in-flight boot
    // from a prior connect sees its generation go stale and self-cleans.
    this._bootGen++;
    void this._boot().finally(() => {
      this._connecting = false;
    });
  }
  disconnectedCallback(): void {
    this._teardown();
  }

  attributeChangedCallback(
    name: string,
    _oldValue: string | null,
    _newValue: string | null,
  ): void {
    // Before the engine exists, attribute changes are captured at next connect
    // via _readOptions(). Once live, map what the engine supports in place.
    if (!this._engine) return;

    if (name === 'reduced-motion') {
      this._engine.motion.setReducedMotion(this.reducedMotion);
    } else if (name === 'text-skin') {
      const text = this.getAttribute('text-skin');
      if (text) this._engine.setTextSkinSource(staticTextSource(text));
    } else if (name === 'src') {
      // Live avatar hot-swap is unsupported by the engine contract; recreate
      // the engine on the next connect.
      this._needsRecreate = true;
    }
  }
  private async _boot(): Promise<void> {
    // Snapshot the generation at boot start; every await below re-checks it
    // so a disconnect (or reconnect) that advanced it invalidates this boot.
    const gen = this._bootGen;

    if (this._needsRecreate && this._engine) {
      this._engine.dispose();
      this._engine = null;
      this._ready = false;
      this._needsRecreate = false;
    }

    const root = this._ensureShadow();
    const canvas = this._ensureCanvas(root);
    const options = this._readOptions();

    const factory =
      HologlyphHeadElement.engineFactory ?? (await loadDefaultFactory());

    // The default factory resolves asynchronously; the element may have been
    // disconnected while it was in flight.
    if (gen !== this._bootGen || !this.isConnected) return;

    const engine = factory(options);
    this._engine = engine;
    this._wire(engine);
    this._ensureResizeObserver();

    try {
      await engine.mount(canvas, this);
    } catch (err) {
      this._dispatchError(err instanceof Error ? err : new Error(String(err)));
    }

    // If we were disconnected while the (possibly deferred) mount was in
    // flight, discard the engine we just built rather than leaving it mounted
    // on a detached element. Teardown already disposed the engine if it was
    // live, so only clean up here when we still own it.
    if (gen !== this._bootGen || !this.isConnected) {
      if (this._engine === engine) {
        this._engine = null;
        this._ready = false;
        engine.dispose();
      }
      return;
    }
  }

  private _ensureResizeObserver(): void {
    if (this._resizeObserver) return;
    if (typeof ResizeObserver === 'undefined') return;

    try {
      const ro = new ResizeObserver(() => {
        const width = Math.max(1, Math.floor(this.clientWidth || DEFAULT_CANVAS_SIZE));
        const height = Math.max(1, Math.floor(this.clientHeight || DEFAULT_CANVAS_SIZE));
        const engine = this._engine as EngineWithResize | null;
        if (engine && typeof engine.resize === 'function') {
          engine.resize(width, height);
        }
      });
      ro.observe(this);
      this._resizeObserver = ro;
    } catch {
      /* Observation is best-effort. */
    }
  }

  private _teardown(): void {
    // Advance the boot generation so any in-flight `_boot()` aborts and
    // self-cleans instead of mounting a now-detached element.
    this._bootGen++;
    this._connecting = false;
    this._resetGaze();

    if (this._resizeObserver) {
      this._resizeObserver.disconnect();
      this._resizeObserver = null;
    }

    for (const off of this._offs) off();
    this._offs = [];

    if (this._engine) {
      this._engine.dispose();
      this._engine = null;
    }
    this._ready = false;

    // Reject any speaks that were queued before ready so callers do not hang.
    const queued = this._speakQueue;
    this._speakQueue = [];
    for (const item of queued) {
      item.reject(new Error('hologlyph-head was disconnected before speech'));
    }
    this._emotionQueue = [];
  }
  // -- Shadow / canvas ------------------------------------------------------

  private _ensureShadow(): ShadowRoot {
    if (this.shadowRoot) return this.shadowRoot;
    return this.attachShadow({ mode: 'open' });
  }

  private _ensureCanvas(root: ShadowRoot): HTMLCanvasElement {
    const existing = root.querySelector('canvas');
    if (existing) return existing as HTMLCanvasElement;

    const style = document.createElement('style');
    style.textContent =
      ':host{display:block;position:relative;contain:layout paint}' +
      'canvas{display:block;width:100%;height:100%}';
    root.appendChild(style);

    const canvas = document.createElement('canvas');
    const w = Math.max(1, Math.floor(this.clientWidth || DEFAULT_CANVAS_SIZE));
    const h = Math.max(1, Math.floor(this.clientHeight || DEFAULT_CANVAS_SIZE));
    canvas.width = w;
    canvas.height = h;
    root.appendChild(canvas);

    return canvas;
  }

  // -- Options --------------------------------------------------------------

  private _readOptions(): EngineOptions {
    const avatarUrl = this.getAttribute('src') ?? undefined;
    const textAttr = this.getAttribute('text-skin');
    const textSource = this._textSource ?? (textAttr ? staticTextSource(textAttr) : undefined);
    const reducedMotion = this.reducedMotion || this._prefersReducedMotion();
    const ttsAdapter = this._ttsAdapter ?? undefined;
    return { avatarUrl, textSource, reducedMotion, ttsAdapter };
  }

  private _prefersReducedMotion(): boolean {
    if (typeof matchMedia === 'undefined') return false;
    try {
      return matchMedia('(prefers-reduced-motion: reduce)').matches;
    } catch {
      return false;
    }
  }

  // -- Event wiring ---------------------------------------------------------

  private _wire(engine: Engine): void {
    this._offs = [
      engine.on('ready', () => this._onReady()),
      engine.on('statechange', (detail) =>
        this.dispatchEvent(
          new CustomEvent('hologlyph-statechange', {
            detail: { from: detail.from, to: detail.to },
          }),
        ),
      ),
      engine.on('speechstart', () =>
        this.dispatchEvent(new CustomEvent('hologlyph-speechstart')),
      ),
      engine.on('speechend', () =>
        this.dispatchEvent(new CustomEvent('hologlyph-speechend')),
      ),
      engine.on('error', (err) =>
        this.dispatchEvent(
          new CustomEvent('hologlyph-error', { detail: { error: err } }),
        ),
      ),
      () => this.removeEventListener('pointermove', this._onPointerMove),
      () => this.removeEventListener('pointerleave', this._onPointerLeave),
    ];
    // Follow the pointer with the gaze: observe passive pointer moves on the
    // host and flush the latest position once per animation frame.
    this.addEventListener('pointermove', this._onPointerMove, { passive: true });
    this.addEventListener('pointerleave', this._onPointerLeave, { passive: true });
  }
  private _resetGaze(): void {
    if (this._gazeRaf !== null) {
      cancelAnimationFrame(this._gazeRaf);
      this._gazeRaf = null;
    }
    this._latestGaze = null;
  }

  private _onPointerMove = (ev: PointerEvent): void => {
    const rect = this.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return;
    const x = ((ev.clientX - rect.left) / rect.width) * 2 - 1;
    const y = ((ev.clientY - rect.top) / rect.height) * 2 - 1;
    this._latestGaze = { x, y };
    if (this._gazeRaf === null) {
      this._gazeRaf = requestAnimationFrame(this._flushGaze);
    }
  };

  private _flushGaze = (): void => {
    this._gazeRaf = null;
    if (this._latestGaze && this._engine?.motion) {
      this._engine.motion.setGazeTarget(this._latestGaze.x, this._latestGaze.y);
    }
  };

  private _onPointerLeave = (): void => {
    this._resetGaze();
    this._engine?.motion.clearGazeFollow();
  };

  private _onReady(): void {
    this._ready = true;

    const emotions = this._emotionQueue;
    this._emotionQueue = [];
    for (const expr of emotions) this._engine?.setEmotion(expr);

    const speaks = this._speakQueue;
    this._speakQueue = [];
    for (const item of speaks) {
      const engine = this._engine;
      if (!engine) {
        item.reject(new Error('hologlyph-head disconnected before speech'));
        continue;
      }
      engine
        .speak(item.text)
        .then(() => item.resolve())
        .catch((err) => item.reject(err));
    }

    this.dispatchEvent(new CustomEvent('hologlyph-ready'));
  }

  private _dispatchError(err: Error): void {
    this.dispatchEvent(
      new CustomEvent('hologlyph-error', { detail: { error: err } }),
    );
  }

  // -- Public imperative surface (dec.api-emphasis) ------------------------

  /** Advanced imperative engine. `null` until the element is connected. */
  get engine(): Engine | null {
    return this._engine;
  }

  /** Current behaviour state; `hidden` until the engine reports ready. */
  get state(): BehaviorState {
    if (!this._ready) return 'hidden';
    return this._engine?.state ?? 'hidden';
  }

  speak(text: string): Promise<void> {
    if (this._ready && this._engine) return this._engine.speak(text);
    return new Promise<void>((resolve, reject) => {
      this._speakQueue.push({ text, resolve, reject });
    });
  }

  setEmotion(expression: Expression): void {
    if (this._ready && this._engine) {
      this._engine.setEmotion(expression);
      return;
    }
    this._emotionQueue.push(expression);
  }

  setScrollProgress(progress: number): void {
    this._engine?.setScrollProgress(progress);
  }

  setTextSkinSource(source: TextSkinSource): void {
    this._textSource = source;
    this._engine?.setTextSkinSource(source);
  }

  setVoiceAdapter(adapter: TTSAdapter): void {
    this._ttsAdapter = adapter;
    this._engine?.setVoiceAdapter(adapter);
  }

  // -- Declarative attribute mirrors ---------------------------------------

  get src(): string | null {
    return this.getAttribute('src');
  }
  set src(value: string | null) {
    if (value == null) this.removeAttribute('src');
    else this.setAttribute('src', value);
  }

  get textSkin(): string | null {
    return this.getAttribute('text-skin');
  }
  set textSkin(value: string | null) {
    if (value == null) this.removeAttribute('text-skin');
    else this.setAttribute('text-skin', value);
  }

  get reducedMotion(): boolean {
    return this.hasAttribute('reduced-motion');
  }
  set reducedMotion(value: boolean) {
    if (value) this.setAttribute('reduced-motion', '');
    else this.removeAttribute('reduced-motion');
  }
}

/**
 * Register the `<hologlyph-head>` custom element. Idempotent: a second call
 * with the same tag is a no-op (customElements.define throws on duplicates).
 *
 * A custom element constructor may only be registered under one tag, so a
 * non-default tag is bound to a lightweight subclass of the canonical class.
 */
export function defineHologlyphHead(tagName = 'hologlyph-head'): void {
  if (typeof customElements === 'undefined') return;
  if (customElements.get(tagName)) return;
  const ctor =
    tagName === 'hologlyph-head'
      ? HologlyphHeadElement
      : class extends HologlyphHeadElement {};
  customElements.define(tagName, ctor);
}
