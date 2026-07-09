/**
 * Audio engine: owns a single lazily created AudioContext and a shared
 * analyser chain used for energy read-back. The context is created on the
 * first user-gesture resume and then reused for every utterance, per
 * dec.performance-budget. The AudioContext constructor is injectable so the
 * engine can be exercised under happy-dom without a real Web Audio backend.
 */

import type { AudioEngine } from '../contracts';

export interface AudioEngineOptions {
  /** Injectable AudioContext factory for tests. Defaults to `new AudioContext()`. */
  contextFactory?: () => AudioContext;
}

const DEFAULT_FFT_SIZE = 512;

class AudioEngineImpl implements AudioEngine {
  private _context: AudioContext | null = null;
  private _analyser: AnalyserNode | null = null;
  private readonly _sources = new Map<HTMLMediaElement, MediaElementAudioSourceNode>();
  private readonly _factory: () => AudioContext;
  private _disposed = false;

  constructor(options?: AudioEngineOptions) {
    this._factory = options?.contextFactory ?? (() => new AudioContext());
  }

  get context(): AudioContext | null {
    return this._context;
  }

  private ensureContext(): AudioContext {
    if (this._disposed) {
      throw new Error('AudioEngine has been disposed');
    }
    if (!this._context) {
      this._context = this._factory();
      this._analyser = this._context.createAnalyser();
      this._analyser.fftSize = DEFAULT_FFT_SIZE;
      this._analyser.connect(this._context.destination);
    }
    return this._context;
  }

  async resumeFromGesture(): Promise<void> {
    const ctx = this.ensureContext();
    if (ctx.state === 'suspended') {
      await ctx.resume();
    }
  }

  connectElement(el: HTMLMediaElement): void {
    if (this._disposed) return;
    const ctx = this.ensureContext();
    if (this._sources.has(el)) return;
    const source = ctx.createMediaElementSource(el);
    const analyser = this._analyser;
    if (analyser) source.connect(analyser);
    this._sources.set(el, source);
  }
  disconnectElement(el: HTMLMediaElement): void {
    if (this._disposed) return;
    const source = this._sources.get(el);
    if (!source) return;
    // Detach the cached source from the analyser chain so the analyser stops
    // sampling this utterance's energy. The source node itself can never be
    // recreated for the same element (the Web Audio API forbids a second
    // createMediaElementSource); adapters create a fresh element per
    // utterance, so a stale node is simply dropped here.
    try {
      source.disconnect();
    } catch {
      /* node already detached from the graph */
    }
    this._sources.delete(el);
  }

  readEnergy(): number {
    if (this._disposed || !this._context || !this._analyser) return 0;
    const buffer = new Uint8Array(this._analyser.fftSize);
    this._analyser.getByteTimeDomainData(buffer);
    let sumSquares = 0;
    for (let i = 0; i < buffer.length; i++) {
      const sample = (buffer[i] ?? 0) / 128 - 1;
      sumSquares += sample * sample;
    }
    const rms = Math.sqrt(sumSquares / buffer.length);
    return rms < 0 ? 0 : rms > 1 ? 1 : rms;
  }

  suspend(): void {
    if (this._context && this._context.state === 'running') {
      void this._context.suspend();
    }
  }

  dispose(): void {
    if (this._disposed) return;
    this._disposed = true;
    this._sources.clear();
    if (this._context) {
      void this._context.close();
      this._context = null;
    }
    this._analyser = null;
  }
}

export function createAudioEngine(options?: AudioEngineOptions): AudioEngine {
  return new AudioEngineImpl(options);
}
