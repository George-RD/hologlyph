import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createAudioEngine } from '../src/audio';
import type { AudioEngine } from '../src/contracts';

// Lightweight fake of the Web Audio surface the engine touches.
class FakeAnalyser {
  fftSize = 2048;
  private _connected = true; // a source is wired into this analyser
  private readonly _fill: number;
  constructor(fill: number) {
    this._fill = fill;
  }
  connect(): void {}
  disconnect(): void {}
  setSourceConnected(connected: boolean): void {
    this._connected = connected;
  }
  getByteTimeDomainData(buf: Uint8Array): void {
    // A disconnected analyser has no input and reads silence (128 -> 0 RMS).
    buf.fill(this._connected ? this._fill : 128);
  }
}

class FakeAudioContext {
  state: 'suspended' | 'running' = 'suspended';
  readonly destination = {} as AudioNode;
  closed = false;
  private readonly _fill: number;
  private _analyser: FakeAnalyser | null = null;
  constructor(fill: number) {
    this._fill = fill;
  }
  createAnalyser(): FakeAnalyser {
    if (!this._analyser) this._analyser = new FakeAnalyser(this._fill);
    return this._analyser;
  }
  createMediaElementSource(): MediaElementAudioSourceNode {
    const analyser = this._analyser ??= new FakeAnalyser(this._fill);
    return {
      connect: () => analyser.setSourceConnected(true),
      disconnect: () => analyser.setSourceConnected(false),
    } as unknown as MediaElementAudioSourceNode;
  }
  async resume(): Promise<void> {
    this.state = 'running';
  }
  async suspend(): Promise<void> {
    this.state = 'suspended';
  }
  async close(): Promise<void> {
    this.closed = true;
  }
}

function makeContextFactory(fill: number): () => AudioContext {
  return (): AudioContext => new FakeAudioContext(fill) as unknown as AudioContext;
}

describe('AudioEngine', () => {
  it('keeps the context null until resumeFromGesture', () => {
    const engine = createAudioEngine({ contextFactory: makeContextFactory(128) });
    expect(engine.context).toBeNull();
    expect(engine.readEnergy()).toBe(0);
  });

  it('reuses a single AudioContext across utterances', async () => {
    let calls = 0;
    const factory = (): AudioContext => {
      calls += 1;
      return new FakeAudioContext(128) as unknown as AudioContext;
    };
    const engine = createAudioEngine({ contextFactory: factory });
    await engine.resumeFromGesture();
    expect(engine.context).not.toBeNull();

    const el1 = document.createElement('audio');
    const el2 = document.createElement('audio');
    engine.connectElement(el1);
    engine.connectElement(el2);
    engine.connectElement(el1); // cached, must not create a second source
    expect(calls).toBe(1);
  });

  it('creates a MediaElementSource only once per element', async () => {
    const ctx = new FakeAudioContext(128) as unknown as AudioContext;
    const engine = createAudioEngine({ contextFactory: () => ctx });
    await engine.resumeFromGesture();
    const spy = vi.spyOn(ctx, 'createMediaElementSource');

    const el1 = document.createElement('audio');
    const el2 = document.createElement('audio');
    engine.connectElement(el1);
    engine.connectElement(el1);
    engine.connectElement(el2);
    expect(spy).toHaveBeenCalledTimes(2);
  });

  it('resumes a suspended context from a gesture', async () => {
    const ctx = new FakeAudioContext(128) as unknown as AudioContext;
    const engine = createAudioEngine({ contextFactory: () => ctx });
    await engine.resumeFromGesture();
    expect((ctx as unknown as FakeAudioContext).state).toBe('running');
  });

  it('suspends a running context', async () => {
    const ctx = new FakeAudioContext(128) as unknown as AudioContext;
    const engine = createAudioEngine({ contextFactory: () => ctx });
    await engine.resumeFromGesture();
    engine.suspend();
    expect((ctx as unknown as FakeAudioContext).state).toBe('suspended');
  });

  it('computes RMS energy from a known buffer', async () => {
    const fill = 200;
    const engine = createAudioEngine({ contextFactory: makeContextFactory(fill) });
    await engine.resumeFromGesture();
    const expected = (fill - 128) / 128; // 0.5625
    expect(engine.readEnergy()).toBeCloseTo(expected, 5);
  });

  it('normalises a fully negative buffer to 1', async () => {
    const engine = createAudioEngine({ contextFactory: makeContextFactory(0) });
    await engine.resumeFromGesture();
    expect(engine.readEnergy()).toBeCloseTo(1, 5);
  });

  it('disposes idempotently and drops the context', async () => {
    const ctx = new FakeAudioContext(128) as unknown as AudioContext;
    const engine = createAudioEngine({ contextFactory: () => ctx });
    await engine.resumeFromGesture();
    engine.connectElement(document.createElement('audio'));

    engine.dispose();
    expect(engine.context).toBeNull();
    expect((ctx as unknown as FakeAudioContext).closed).toBe(true);
    expect(engine.readEnergy()).toBe(0);

    // second dispose must be a no-op
    engine.dispose();
    expect(engine.readEnergy()).toBe(0);
  });
  it('disconnectElement releases the source and silences energy', async () => {
    const ctx = new FakeAudioContext(200) as unknown as AudioContext;
    const engine = createAudioEngine({ contextFactory: () => ctx });
    await engine.resumeFromGesture();
    const el = document.createElement('audio');
    engine.connectElement(el);
    expect(engine.readEnergy()).toBeCloseTo((200 - 128) / 128, 5);

    engine.disconnectElement(el);
    expect(engine.readEnergy()).toBe(0);

    // reconnecting a fresh element still works
    const el2 = document.createElement('audio');
    engine.connectElement(el2);
    expect(engine.readEnergy()).toBeCloseTo((200 - 128) / 128, 5);
    engine.disconnectElement(el2);
    expect(engine.readEnergy()).toBe(0);
  });
});
