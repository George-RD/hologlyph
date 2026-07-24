import * as THREE from 'three';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { visemeTap } from '../src/core';
import { createMotionEngine } from '../src/motion';
import {
  RIG_VISEME_MORPHS,
  type AudioEngine,
  type LoadedAvatar,
  type VisemeFrame,
} from '../src/contracts';
import {
  createKokoroTTSAdapter,
  ipaToCanonicalVisemes,
  type KokoroTTSAdapterOptions,
} from '../src/speech/adapters/kokoro';
import type { FrameScheduler } from '../src/speech/adapters/provider';

function makeAudioEngine(overrides: Partial<AudioEngine> = {}): AudioEngine {
  return {
    context: null,
    resumeFromGesture: async () => {},
    connectElement: () => {},
    disconnectElement: () => {},
    readEnergy: () => 0,
    suspend: () => {},
    dispose: () => {},
    ...overrides,
  };
}

function makeAvatar(): LoadedAvatar {
  const root = new THREE.Group();
  const head = new THREE.Bone();
  head.name = 'head';
  const morphStore: Record<string, number> = {};
  return {
    root,
    morphMeshes: [],
    animations: [],
    bones: { head },
    setMorph(name: string, w: number) {
      morphStore[name] = Math.min(1, Math.max(0, w));
    },
    getMorph(name: string) {
      return morphStore[name] ?? 0;
    },
    dispose() {},
  };
}

class ManualScheduler implements FrameScheduler {
  private readonly callbacks = new Set<() => void>();

  start(callback: () => void): () => void {
    this.callbacks.add(callback);
    return () => this.callbacks.delete(callback);
  }

  tick(): void {
    for (const callback of [...this.callbacks]) callback();
  }

  get active(): number {
    return this.callbacks.size;
  }
}

class FakeMediaElement extends EventTarget {
  src = '';
  currentTime = 0;
  pause = vi.fn();
  load = vi.fn();
  play = vi.fn<() => Promise<void>>(() => Promise.resolve());
  removeAttribute = vi.fn((name: string) => {
    if (name === 'src') this.src = '';
  });

  constructor(src: string) {
    super();
    this.src = src;
  }

  emit(type: string): void {
    this.dispatchEvent(new Event(type));
  }
}

interface TestChunk {
  phonemes: string;
  audio: { audio: Float32Array; sampling_rate: number };
}

function makeModel(chunks: TestChunk[]) {
  return {
    stream: vi.fn(async function* () {
      for (const chunk of chunks) yield chunk;
    }),
  };
}

function makeHarness(
  chunks: TestChunk[] = [
    {
      phonemes: 'pa',
      audio: { audio: new Float32Array([0, 0.5, -0.5, 0]), sampling_rate: 4 },
    },
  ],
  overrides: Partial<KokoroTTSAdapterOptions> = {},
) {
  const model = makeModel(chunks);
  const fromPretrained = vi.fn(async () => model);
  const loader = vi.fn(async () => ({ KokoroTTS: { from_pretrained: fromPretrained } }));
  const scheduler = new ManualScheduler();
  const elements: FakeMediaElement[] = [];
  const createObjectURL = vi.fn(() => 'blob:kokoro');
  const revokeObjectURL = vi.fn();
  const blobFactory = vi.fn((parts: BlobPart[], options?: BlobPropertyBag) => new Blob(parts, options));
  const adapter = createKokoroTTSAdapter({
    loader,
    scheduler,
    mediaFactory: (url) => {
      const element = new FakeMediaElement(url);
      elements.push(element);
      return element as unknown as HTMLAudioElement;
    },
    blobFactory,
    urlFactory: { createObjectURL, revokeObjectURL },
    ...overrides,
  });
  return {
    adapter,
    model,
    loader,
    fromPretrained,
    scheduler,
    elements,
    createObjectURL,
    revokeObjectURL,
    blobFactory,
  };
}

async function flush(count = 12): Promise<void> {
  for (let index = 0; index < count; index++) await Promise.resolve();
}
function required<T>(value: T | null | undefined): T {
  if (value === null || value === undefined) {
    throw new Error('Expected test value');
  }
  return value;
}


afterEach(() => {
  vi.unstubAllGlobals();
});

describe('Kokoro adapter loading', () => {
  it('loads lazily once, defaults to q8/WASM, and forwards package-independent progress', async () => {
    const progress = vi.fn();
    const harness = makeHarness(undefined, { onProgress: progress });

    expect(harness.loader).not.toHaveBeenCalled();
    const first = harness.adapter.load();
    const second = harness.adapter.load();
    expect(first).toBe(second);
    await first;

    expect(harness.loader).toHaveBeenCalledTimes(1);
    expect(harness.fromPretrained).toHaveBeenCalledTimes(1);
    const calls = harness.fromPretrained.mock.calls as unknown as Array<
      [string, { dtype?: string; device?: string; progress_callback?: (p: Record<string, unknown>) => void }]
    >;
    const [modelId, options] = required(calls[0]);
    expect(modelId).toBe('onnx-community/Kokoro-82M-v1.0-ONNX');
    expect(options).toMatchObject({ dtype: 'q8', device: 'wasm' });
    options.progress_callback?.({
      status: 'progress',
      file: 'model.onnx',
      progress: 25,
      loaded: 1,
      total: 4,
      irrelevant: true,
    });
    expect(progress).toHaveBeenCalledWith({
      status: 'progress',
      file: 'model.onnx',
      progress: 25,
      loaded: 1,
      total: 4,
    });
    expect(harness.adapter.loaded).toBe(true);
  });

  it('uses deliberate WebGPU support or an explicit device override', async () => {
    vi.stubGlobal('navigator', { gpu: {} });
    const webgpu = makeHarness();
    await webgpu.adapter.load();
    const calls1 = webgpu.fromPretrained.mock.calls as unknown as Array<[string, { device?: string }]>;
    expect(required(calls1[0])[1].device).toBe('webgpu');

    const cpu = makeHarness(undefined, { device: 'cpu' });
    await cpu.adapter.load();
    const calls2 = cpu.fromPretrained.mock.calls as unknown as Array<[string, { device?: string }]>;
    expect(required(calls2[0])[1].device).toBe('cpu');
  });

  it('shares concurrent loads but permits a retry after failure', async () => {
    const model = makeModel([{ phonemes: 'a', audio: { audio: new Float32Array(4), sampling_rate: 4 } }]);
    const fromPretrained = vi
      .fn()
      .mockRejectedValueOnce(new Error('network down'))
      .mockResolvedValueOnce(model);
    const loader = vi.fn(async () => ({ KokoroTTS: { from_pretrained: fromPretrained } }));
    const adapter = createKokoroTTSAdapter({ loader });

    await expect(adapter.load()).rejects.toThrow('network down');
    expect(adapter.loaded).toBe(false);
    await expect(adapter.load()).resolves.toBeUndefined();
    expect(loader).toHaveBeenCalledTimes(2);
    expect(fromPretrained).toHaveBeenCalledTimes(2);
    expect(adapter.loaded).toBe(true);
  });
  it('does not retain a model that resolves after disposal', async () => {
    const model = makeModel([
      { phonemes: 'a', audio: { audio: new Float32Array(4), sampling_rate: 4 } },
    ]);
    let resolveModel: ((value: typeof model) => void) | undefined;
    const pending = new Promise<typeof model>((resolve) => {
      resolveModel = resolve;
    });
    const loader = vi.fn(async () => ({
      KokoroTTS: { from_pretrained: () => pending },
    }));
    const adapter = createKokoroTTSAdapter({ loader });

    const loading = adapter.load();
    adapter.dispose();
    resolveModel?.(model);

    await expect(loading).rejects.toThrow('disposed');
    expect(adapter.loaded).toBe(false);
  });

  it('falls back to WASM when automatic WebGPU initialisation fails', async () => {
    vi.stubGlobal('navigator', { gpu: {} });
    const model = makeModel([]);
    const devices: string[] = [];
    const fromPretrained = vi.fn(async (_modelId: string, options?: { device?: string }) => {
      devices.push(options?.device ?? '');
      if (options?.device === 'webgpu') throw new Error('WebGPU unavailable');
      return model;
    });
    const loader = vi.fn(async () => ({ KokoroTTS: { from_pretrained: fromPretrained } }));
    const adapter = createKokoroTTSAdapter({ loader });

    await expect(adapter.load()).resolves.toBeUndefined();
    expect(devices).toEqual(['webgpu', 'wasm']);
    expect(adapter.loaded).toBe(true);
  });
});


describe('Kokoro IPA mapping and timing', () => {
  it('maps IPA deterministically onto canonical visemes and explicit silence', () => {
    expect(ipaToCanonicalVisemes('pbm fv θð td kg tʃdʒ s z ʃʒ nŋ ɹr aɛɪɔu,')).toEqual([
      'viseme_pp', 'viseme_pp', 'viseme_pp', 'viseme_sil',
      'viseme_ff', 'viseme_ff', 'viseme_sil',
      'viseme_th', 'viseme_th', 'viseme_sil',
      'viseme_dd', 'viseme_dd', 'viseme_sil',
      'viseme_kk', 'viseme_kk', 'viseme_sil',
      'viseme_ch', 'viseme_ch', 'viseme_sil',
      'viseme_ss', 'viseme_sil', 'viseme_ss', 'viseme_sil',
      'viseme_ch', 'viseme_ch', 'viseme_sil',
      'viseme_nn', 'viseme_nn', 'viseme_sil',
      'viseme_rr', 'viseme_rr', 'viseme_sil',
      'viseme_aa', 'viseme_ee', 'viseme_ih', 'viseme_oh', 'viseme_ou',
      'viseme_sil',
    ]);
  });

  it('distributes phonemes within measured chunk durations and emits only canonical weights', async () => {
    const harness = makeHarness([
      { phonemes: 'pa', audio: { audio: new Float32Array(4), sampling_rate: 4 } },
      { phonemes: 'tʃ!', audio: { audio: new Float32Array(8), sampling_rate: 4 } },
    ]);
    const frames: VisemeFrame[] = [];
    const handle = harness.adapter.speak('patch', makeAudioEngine());
    handle.on('viseme', (frame) => frames.push(frame));
    await flush();

    const element = required(harness.elements[0]);
    element.currentTime = 3;
    harness.scheduler.tick();

    expect(frames.map((frame) => frame.time)).toEqual([0, 0.5, 1, 2]);
    expect(frames.map((frame) => Object.keys(frame.weights)[0])).toEqual([
      'viseme_pp',
      'viseme_aa',
      'viseme_ch',
      'viseme_sil',
    ]);
    for (const frame of frames) {
      expect(Object.keys(frame.weights).every((name) => name === 'jaw_open' || name.startsWith('viseme_'))).toBe(true);
      expect(frame.weights.jaw_open).toBe(0);
    }
  });
});

describe('Kokoro PCM playback lifecycle', () => {
  it('closes the package text splitter so synthesis reaches playback', async () => {
    class TestSplitter {
      readonly texts: string[] = [];
      closed = false;
      push(...texts: string[]): void {
        this.texts.push(...texts);
      }
      close(): void {
        this.closed = true;
      }
    }
    const chunk: TestChunk = {
      phonemes: 'haɪ',
      audio: { audio: new Float32Array([0, 0.5, -0.5, 0]), sampling_rate: 4 },
    };
    const stream = vi.fn(async function* (input: unknown) {
      expect(input).toBeInstanceOf(TestSplitter);
      expect(input).toMatchObject({
        texts: ['Hello @ChrisGillett world. Visit https://example.com next.'],
        closed: true,
      });
      yield chunk;
    });
    const loader = vi.fn(async () => ({
      KokoroTTS: { from_pretrained: async () => ({ stream }) },
      TextSplitterStream: TestSplitter,
    }));
    const harness = makeHarness([], { loader });

    harness.adapter.speak('Hello @ChrisGillett\n world. Visit https://example.com\r\nnext.', makeAudioEngine());
    await flush();

    expect(stream).toHaveBeenCalledTimes(1);
    expect(harness.elements).toHaveLength(1);
    expect(required(harness.elements[0]).play).toHaveBeenCalledTimes(1);
  });

  it('encodes one mono PCM WAV blob, connects once, and forwards stalls', async () => {
    const connect = vi.fn();
    const disconnect = vi.fn();
    const harness = makeHarness();
    const stalls: number[] = [];
    const handle = harness.adapter.speak('hello', makeAudioEngine({ connectElement: connect, disconnectElement: disconnect }));
    handle.on('stall', () => stalls.push(1));
    await flush();

    expect(harness.blobFactory).toHaveBeenCalledTimes(1);
    const blob = required(harness.blobFactory.mock.results[0]).value;
    expect(blob.type).toBe('audio/wav');
    const view = new DataView(await blob.arrayBuffer());
    expect(String.fromCharCode(...new Uint8Array(view.buffer, 0, 4))).toBe('RIFF');
    expect(String.fromCharCode(...new Uint8Array(view.buffer, 8, 4))).toBe('WAVE');
    expect(view.getUint32(24, true)).toBe(4);
    expect(view.getUint32(40, true)).toBe(8);
    expect(harness.createObjectURL).toHaveBeenCalledTimes(1);
    expect(connect).toHaveBeenCalledTimes(1);
    const element = required(harness.elements[0]);
    expect(element.play).toHaveBeenCalledTimes(1);

    element.emit('waiting');
    element.emit('stalled');
    expect(stalls).toHaveLength(2);
    expect(disconnect).not.toHaveBeenCalled();
  });

  it('cleans the element, scheduler, connection, and URL exactly once on end', async () => {
    const disconnect = vi.fn();
    const harness = makeHarness();
    let ended = 0;
    const handle = harness.adapter.speak('hello', makeAudioEngine({ disconnectElement: disconnect }));
    handle.on('end', () => ended++);
    await flush();

    const element = required(harness.elements[0]);
    expect(harness.scheduler.active).toBe(1);
    element.emit('ended');
    element.emit('ended');

    expect(ended).toBe(1);
    expect(harness.scheduler.active).toBe(0);
    expect(element.pause).toHaveBeenCalledTimes(1);
    expect(element.removeAttribute).toHaveBeenCalledWith('src');
    expect(element.load).toHaveBeenCalledTimes(1);
    expect(disconnect).toHaveBeenCalledTimes(1);
    expect(harness.revokeObjectURL).toHaveBeenCalledTimes(1);
  });

  it('emits error before one end and cleans resources on playback error', async () => {
    const disconnect = vi.fn();
    const harness = makeHarness();
    const events: string[] = [];
    const handle = harness.adapter.speak('hello', makeAudioEngine({ disconnectElement: disconnect }));
    handle.on('error', (error) => events.push(`error:${error.message}`));
    handle.on('end', () => events.push('end'));

    await flush();
    required(harness.elements[0]).emit('error');
    expect(events).toEqual(['error:audio playback failed', 'end']);
    expect(disconnect).toHaveBeenCalledTimes(1);
    expect(harness.revokeObjectURL).toHaveBeenCalledTimes(1);
  });

  it('handles play rejection with error then end and exact cleanup', async () => {
    const disconnect = vi.fn();
    let element: FakeMediaElement | null = null;
    const harness = makeHarness(undefined, {
      mediaFactory: (url) => {
        element = new FakeMediaElement(url);
        element.play.mockRejectedValue(new Error('blocked'));
        return element as unknown as HTMLAudioElement;
      },
    });
    const events: string[] = [];
    const handle = harness.adapter.speak('hello', makeAudioEngine({ disconnectElement: disconnect }));
    handle.on('error', (error) => events.push(`error:${error.message}`));
    handle.on('end', () => events.push('end'));
    await flush();

    expect(events).toEqual(['error:audio playback was rejected', 'end']);
    expect(disconnect).toHaveBeenCalledTimes(1);
    expect(harness.revokeObjectURL).toHaveBeenCalledTimes(1);
    expect(required<FakeMediaElement>(element).pause).toHaveBeenCalledTimes(1);
  });

  it('revokes a created URL when media construction fails', async () => {
    const harness = makeHarness(undefined, {
      mediaFactory: () => {
        throw new Error('media unavailable');
      },
    });
    const events: string[] = [];
    const handle = harness.adapter.speak('hello', makeAudioEngine());
    handle.on('error', (error) => events.push(`error:${error.message}`));
    handle.on('end', () => events.push('end'));
    await flush();

    expect(events).toEqual(['error:media unavailable', 'end']);
    expect(harness.createObjectURL).toHaveBeenCalledTimes(1);
    expect(harness.revokeObjectURL).toHaveBeenCalledTimes(1);
  });

  it('revokes URL and disconnects when audio.connectElement throws', async () => {
    const harness = makeHarness();
    const audio = makeAudioEngine({
      connectElement: () => {
        throw new Error('connect failed');
      },
    });
    const events: string[] = [];
    const handle = harness.adapter.speak('hello', audio);
    handle.on('error', (error) => events.push(`error:${error.message}`));
    handle.on('end', () => events.push('end'));
    await flush();

    expect(events).toEqual(['error:connect failed', 'end']);
    expect(harness.createObjectURL).toHaveBeenCalledTimes(1);
    expect(harness.revokeObjectURL).toHaveBeenCalledTimes(1);
  });
});

describe('Kokoro cancellation and disposal races', () => {
  it('cancels before a late model load without creating or playing media', async () => {
    const model = makeModel([]);
    let resolveLoad: ((value: typeof model) => void) | undefined;
    const modelPromise = new Promise<typeof model>((resolve) => {
      resolveLoad = resolve;
    });
    const fromPretrained = vi.fn(() => modelPromise);
    const loader = vi.fn(async () => ({ KokoroTTS: { from_pretrained: fromPretrained } }));
    const mediaFactory = vi.fn(() => new FakeMediaElement('blob:x') as unknown as HTMLAudioElement);
    const adapter = createKokoroTTSAdapter({ loader, mediaFactory });
    let ended = 0;
    const handle = adapter.speak('late', makeAudioEngine());
    handle.on('end', () => ended++);
    handle.cancel();
    required(resolveLoad)(model);
    await flush();

    expect(ended).toBe(1);
    expect(mediaFactory).not.toHaveBeenCalled();
  });

  it('cancels the concrete animation frame scheduled for viseme playback', async () => {
    let nextFrameId = 41;
    const queued = new Map<number, FrameRequestCallback>();
    const requestAnimationFrame = vi.fn((callback: FrameRequestCallback) => {
      const id = nextFrameId++;
      queued.set(id, callback);
      return id;
    });
    const cancelAnimationFrame = vi.fn((id: number) => {
      queued.delete(id);
    });
    vi.stubGlobal('requestAnimationFrame', requestAnimationFrame);
    vi.stubGlobal('cancelAnimationFrame', cancelAnimationFrame);
    const harness = makeHarness(undefined, { scheduler: undefined });
    const handle = harness.adapter.speak('hello', makeAudioEngine());
    await flush();
    const scheduledId = required([...queued.keys()][0]);

    handle.cancel();

    expect(cancelAnimationFrame).toHaveBeenCalledWith(scheduledId);
    expect(queued.has(scheduledId)).toBe(false);
  });

  it('cleans an earlier direct utterance before starting the next one', async () => {
    const disconnect = vi.fn();
    const harness = makeHarness();
    const audio = makeAudioEngine({ disconnectElement: disconnect });
    const first = harness.adapter.speak('first', audio);
    let firstEnded = 0;
    first.on('end', () => firstEnded++);
    await flush();
    expect(harness.scheduler.active).toBe(1);

    const second = harness.adapter.speak('second', audio);

    expect(firstEnded).toBe(1);
    expect(disconnect).toHaveBeenCalledTimes(1);
    expect(harness.scheduler.active).toBe(0);
    await flush();
    expect(harness.scheduler.active).toBe(1);
    second.cancel();
  });

  it('cancels during a late stream without creating a URL', async () => {
    let release: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const model = {
      stream: async function* () {
        await gate;
        yield { phonemes: 'a', audio: { audio: new Float32Array(4), sampling_rate: 4 } };
      },
    };
    const createObjectURL = vi.fn(() => 'blob:x');
    const adapter = createKokoroTTSAdapter({
      loader: async () => ({ KokoroTTS: { from_pretrained: async () => model } }),
      urlFactory: { createObjectURL, revokeObjectURL: vi.fn() },
    });
    const handle = adapter.speak('late', makeAudioEngine());
    await flush(4);
    handle.cancel();
    required(release)();
    await flush();

    expect(createObjectURL).not.toHaveBeenCalled();
  });

  it('dispose cleans an active utterance once and rejects future use', async () => {
    const disconnect = vi.fn();
    const harness = makeHarness();
    const handle = harness.adapter.speak('hello', makeAudioEngine({ disconnectElement: disconnect }));
    let ended = 0;
    handle.on('end', () => ended++);
    await flush();

    harness.adapter.dispose();
    harness.adapter.dispose();
    expect(ended).toBe(1);
    expect(disconnect).toHaveBeenCalledTimes(1);
    expect(harness.revokeObjectURL).toHaveBeenCalledTimes(1);
    expect(() => harness.adapter.speak('again', makeAudioEngine())).toThrow('disposed');
    await expect(harness.adapter.load()).rejects.toThrow('disposed');
  });

  it('reports synthesis errors before exactly one end without allocating media', async () => {
    const mediaFactory = vi.fn();
    const adapter = createKokoroTTSAdapter({
      loader: async () => ({
        KokoroTTS: {
          from_pretrained: async () => ({
            stream: async function* () {
              yield* [];
              throw new Error('synthesis failed');
            },
          }),
        },
      }),
      mediaFactory,
    });
    const events: string[] = [];
    const handle = adapter.speak('broken', makeAudioEngine());
    handle.on('error', (error) => events.push(`error:${error.message}`));
    handle.on('end', () => events.push('end'));
    await flush();

    expect(events).toEqual(['error:synthesis failed', 'end']);
    expect(mediaFactory).not.toHaveBeenCalled();
  });
});

describe('Kokoro adapter to motion integration', () => {
  it('drives canonical visemes through visemeTap to activate avatar morphs', async () => {
    const avatar = makeAvatar();
    const motion = createMotionEngine();
    motion.attach(avatar);

    const harness = makeHarness([
      {
        phonemes: 'pa',
        audio: { audio: new Float32Array(16), sampling_rate: 4 },
      },
    ]);

    const tappedAdapter = visemeTap(
      harness.adapter,
      (frame) => motion.applyVisemeFrame(frame),
      () => {},
    );

    const audio = makeAudioEngine();
    tappedAdapter.speak('pa', audio);
    await flush();

    const element = required(harness.elements[0]);
    element.currentTime = 0.5;
    harness.scheduler.tick();

    motion.update(0.1, 0.5);

    let activeCount = 0;
    for (const morph of RIG_VISEME_MORPHS) {
      if (avatar.getMorph(morph) > 0) {
        activeCount++;
      }
    }
    expect(activeCount).toBeGreaterThan(0);
    expect(avatar.getMorph('viseme_pp')).toBeGreaterThan(0);
  });
});
