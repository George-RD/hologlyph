import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  createSpeechEngine,
  createDemoTTSAdapter,
  createProviderTTSAdapter,
  createFallbackTTSAdapter,
} from '../src/speech';
import { UtteranceHandleImpl } from '../src/speech/emitter';
import {
  SILENCE_FRAME_WEIGHTS,
  visemeSequenceForWord,
  weightsForViseme,
  wordAt,
} from '../src/speech/visemes';
import type { FrameScheduler } from '../src/speech/adapters/provider';
import type {
  AudioEngine,
  Listener,
  SpeechMode,
  TTSAdapter,
  UtteranceEvents,
  UtteranceHandle,
  VisemeFrame,
} from '../src/contracts';

// Browser globals are overridden per test through a single typed view.
const env = globalThis as {
  speechSynthesis?: unknown;
  SpeechSynthesisUtterance?: unknown;
  Audio?: unknown;
};

function makeFakeAudio(overrides: Partial<AudioEngine> = {}): AudioEngine {
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

// --- Demo fakes -----------------------------------------------------------
class FakeUtterance {
  text: string;
  onstart: (() => void) | null = null;
  onboundary: ((e: unknown) => void) | null = null;
  onend: (() => void) | null = null;
  onerror: ((e: unknown) => void) | null = null;
  constructor(text: string) {
    this.text = text;
  }
}

class FakeSynth {
  last: FakeUtterance | null = null;
  cancelCount = 0;
  speak(u: FakeUtterance): void {
    this.last = u;
  }
  cancel(): void {
    this.cancelCount++;
  }
}

// --- Provider / fallback fakes -------------------------------------------
class FakeAudioElement {
  src = '';
  currentTime = 0;
  private readonly _listeners = new Map<string, Array<() => void>>();
  constructor(src?: string) {
    if (src) this.src = src;
  }
  play(): Promise<void> {
    return Promise.resolve();
  }
  pause(): void {}
  load(): void {}
  removeAttribute(): void {}
  addEventListener(type: string, fn: () => void): void {
    const list = this._listeners.get(type) ?? [];
    list.push(fn);
    this._listeners.set(type, list);
  }
  emit(type: string): void {
    for (const fn of this._listeners.get(type) ?? []) fn();
  }
}

let lastAudio: FakeAudioElement | null = null;
const FakeAudioCtor = class extends FakeAudioElement {
  constructor(src?: string) {
    super(src);
    lastAudio = this;
  }
};

class ManualScheduler implements FrameScheduler {
  private readonly _cbs: Array<() => void> = [];
  start(callback: () => void): () => void {
    this._cbs.push(callback);
    return () => {
      const idx = this._cbs.indexOf(callback);
      if (idx >= 0) this._cbs.splice(idx, 1);
    };
  }
  tick(): void {
    for (const cb of [...this._cbs]) cb();
  }
}

// Scripted adapter used to drive the engine deterministically.
class ScriptedAdapter implements TTSAdapter {
  readonly mode: SpeechMode = 'demo';
  last: UtteranceHandleImpl | null = null;
  speak(_text: string, _audio: AudioEngine): UtteranceHandle {
    const h = new UtteranceHandleImpl();
    this.last = h;
    return h;
  }
  dispose(): void {}
}

async function flushMicrotasks(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

// Handle whose cancel does NOT finish, used to simulate a stale utterance
// whose terminal 'end' is delivered only after a newer speak has started.
class ControllableHandle extends UtteranceHandleImpl {
  override cancel(): void {
    // Intentionally do not finish: the underlying engine delivers 'end' later.
  }
}

class ControllableAdapter implements TTSAdapter {
  readonly mode: SpeechMode = 'demo';
  last: ControllableHandle | null = null;
  speak(_text: string, _audio: AudioEngine): UtteranceHandle {
    const h = new ControllableHandle();
    this.last = h;
    return h;
  }
  dispose(): void {}
}
describe('demo adapter', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal('speechSynthesis', new FakeSynth());
    vi.stubGlobal('SpeechSynthesisUtterance', FakeUtterance);
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('extracts boundary words and maps digraphs and skipped letters', () => {
    expect(wordAt('Hello, world', 0)).toBe('Hello');
    expect(wordAt('Hello, world', 5)).toBe('');
    expect(wordAt('Hello, world', 7, 5)).toBe('world');
    expect(wordAt("can't stop", 0, 0)).toBe("can't");
    expect(wordAt('abc', 0, 2)).toBe('ab');
    expect(visemeSequenceForWord('three')).toEqual([
      'viseme_th',
      'viseme_rr',
      'viseme_ee',
    ]);
    expect(visemeSequenceForWord('tchow')).toEqual([
      'viseme_ch',
      'viseme_ou',
    ]);
    expect(visemeSequenceForWord('phoo')).toEqual([
      'viseme_ff',
      'viseme_ou',
    ]);
    expect(visemeSequenceForWord('qux')).toEqual([
      'viseme_kk',
      'viseme_ou',
    ]);
  });

  it('does not double the authored jaw: viseme weights pin jaw_open to 0', () => {
    // The authored viseme morph targets already embed their own jawOpen
    // deltas, so the frame must not add a second jaw_open on top.
    expect(weightsForViseme('viseme_aa')).toEqual({ viseme_aa: 1, jaw_open: 0 });
    expect(weightsForViseme('viseme_pp')).toEqual({ viseme_pp: 1, jaw_open: 0 });
    expect(weightsForViseme('viseme_sil')).toEqual(SILENCE_FRAME_WEIGHTS);
    for (const weight of Object.values(weightsForViseme('viseme_oh'))) {
      expect(weight).toBeGreaterThanOrEqual(0);
      expect(weight).toBeLessThanOrEqual(1);
    }
  });

  it('emits boundary visemes at 75 ms cadence and one silence frame', () => {
    const adapter = createDemoTTSAdapter();
    const frames: VisemeFrame[] = [];
    const energies: number[] = [];
    const handle = adapter.speak('ae', makeFakeAudio());
    handle.on('viseme', (frame) => frames.push(frame));
    handle.on('energy', (energy) => energies.push(energy));

    const synth = env.speechSynthesis as FakeSynth;
    synth.last!.onstart!();
    synth.last!.onboundary!({ charIndex: 0, charLength: 2 });
    vi.advanceTimersByTime(30); // first viseme (aa) at t=0
    expect(frames).toHaveLength(1);
    expect(frames[0]!.weights).toEqual(weightsForViseme('viseme_aa'));
    expect(frames[0]!.time).toBeCloseTo(0, 5);
    vi.advanceTimersByTime(90); // second viseme (ee) at t=0.075
    expect(frames).toHaveLength(2);
    expect(frames[1]!.weights).toEqual(weightsForViseme('viseme_ee'));
    expect(frames[1]!.time - frames[0]!.time).toBeCloseTo(0.075, 5);
    vi.advanceTimersByTime(300); // silence frame after the word at t=0.15
    expect(frames).toHaveLength(3);
    expect(frames[2]!.weights).toEqual(SILENCE_FRAME_WEIGHTS);
    expect(frames[2]!.time - frames[1]!.time).toBeCloseTo(0.075, 5);
    expect(energies).toEqual([]);
  });

  it('cancel stops viseme emission', () => {
    const adapter = createDemoTTSAdapter();
    const frames: VisemeFrame[] = [];
    const handle = adapter.speak('hello', makeFakeAudio());
    handle.on('viseme', (frame) => frames.push(frame));
    const synth = env.speechSynthesis as FakeSynth;
    synth.last!.onstart!();
    synth.last!.onboundary!({ charIndex: 0, charLength: 5 });
    vi.advanceTimersByTime(30);
    expect(frames).toHaveLength(1);
    handle.cancel();
    vi.advanceTimersByTime(300);
    expect(frames).toHaveLength(1);
  });

  it('dispose cancels the active utterance and stops viseme emission', () => {
    const adapter = createDemoTTSAdapter();
    const frames: VisemeFrame[] = [];
    let ended = 0;
    const handle = adapter.speak('hello', makeFakeAudio());
    handle.on('viseme', (frame) => frames.push(frame));
    handle.on('end', () => ended++);
    const synth = env.speechSynthesis as FakeSynth;
    synth.last!.onstart!();
    synth.last!.onboundary!({ charIndex: 0, charLength: 5 });
    vi.advanceTimersByTime(30);
    expect(frames).toHaveLength(1);
    adapter.dispose();
    expect(synth.cancelCount).toBe(1);
    expect(ended).toBe(1);
    vi.advanceTimersByTime(300);
    expect(frames).toHaveLength(1);
  });

  it('emits error then end when speechSynthesis is missing', async () => {
    vi.stubGlobal('speechSynthesis', undefined);
    vi.stubGlobal('SpeechSynthesisUtterance', FakeUtterance);
    const adapter = createDemoTTSAdapter();
    let errored = false;
    let ended = false;
    const handle = adapter.speak('hi', makeFakeAudio());
    handle.on('error', () => (errored = true));
    handle.on('end', () => (ended = true));
    await new Promise<void>((r) => queueMicrotask(r));
    expect(errored).toBe(true);
    expect(ended).toBe(true);
  });

  it('cancel emits exactly one end and stops the viseme loop', () => {
    const adapter = createDemoTTSAdapter();
    let ended = 0;
    const handle = adapter.speak('hi', makeFakeAudio());
    handle.on('end', () => ended++);
    const synth = env.speechSynthesis as FakeSynth;
    synth.last!.onstart!();
    handle.cancel();
    expect(ended).toBe(1);
    vi.advanceTimersByTime(100);
    expect(ended).toBe(1);
  });
});

describe('provider adapter', () => {
  beforeEach(() => {
    lastAudio = null;
    vi.stubGlobal('Audio', FakeAudioCtor);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('schedules visemes in time order aligned to currentTime', async () => {
    const scheduler = new ManualScheduler();
    const adapter = createProviderTTSAdapter({
      synthesize: async () => ({
        audioUrl: 'x',
        visemes: [
          { time: 0.1, weights: { mouth: 0.2 } },
          { time: 0.3, weights: { mouth: 0.5 } },
          { time: 0.5, weights: { mouth: 0.8 } },
        ],
      }),
      scheduler,
    });
    const visemes: VisemeFrame[] = [];
    let started = 0;
    let ended = 0;
    const handle = adapter.speak('hi', makeFakeAudio());
    handle.on('viseme', (v) => visemes.push(v));
    handle.on('start', () => started++);
    handle.on('end', () => ended++);

    await flushMicrotasks();
    expect(started).toBe(1);

    scheduler.tick(); // currentTime 0 -> nothing
    lastAudio!.currentTime = 0.2;
    scheduler.tick();
    lastAudio!.currentTime = 0.35;
    scheduler.tick();
    lastAudio!.currentTime = 0.6;
    scheduler.tick();

    expect(visemes.map((v) => v.time)).toEqual([0.1, 0.3, 0.5]);

    lastAudio!.emit('ended');
    expect(ended).toBe(1);
    adapter.dispose();
  });

  it('maps waiting and stalled to stall', async () => {
    const scheduler = new ManualScheduler();
    const adapter = createProviderTTSAdapter({
      synthesize: async () => ({ audioUrl: 'x', visemes: [] }),
      scheduler,
    });
    let stalls = 0;
    const handle = adapter.speak('hi', makeFakeAudio());
    handle.on('stall', () => stalls++);

    await flushMicrotasks();
    lastAudio!.emit('waiting');
    lastAudio!.emit('stalled');
    expect(stalls).toBe(2);

    lastAudio!.emit('ended');
    adapter.dispose();
  });
  it('disconnects the element from the audio engine on ended', async () => {
    const disconnect = vi.fn();
    const audio = makeFakeAudio({ disconnectElement: disconnect });
    const scheduler = new ManualScheduler();
    const adapter = createProviderTTSAdapter({
      synthesize: async () => ({ audioUrl: 'x', visemes: [] }),
      scheduler,
    });
    adapter.speak('hi', audio);
    await flushMicrotasks();
    expect(lastAudio).not.toBeNull();
    lastAudio!.emit('ended');
    expect(disconnect).toHaveBeenCalledTimes(1);
    expect(disconnect).toHaveBeenCalledWith(lastAudio);
  });

  it('disconnects the element from the audio engine on playback error', async () => {
    const disconnect = vi.fn();
    const audio = makeFakeAudio({ disconnectElement: disconnect });
    const scheduler = new ManualScheduler();
    const adapter = createProviderTTSAdapter({
      synthesize: async () => ({ audioUrl: 'x', visemes: [] }),
      scheduler,
    });
    adapter.speak('hi', audio);
    await flushMicrotasks();
    lastAudio!.emit('error');
    expect(disconnect).toHaveBeenCalledTimes(1);
    expect(disconnect).toHaveBeenCalledWith(lastAudio);
  });

  it('disconnects the element from the audio engine on cancel', async () => {
    const disconnect = vi.fn();
    const audio = makeFakeAudio({ disconnectElement: disconnect });
    const scheduler = new ManualScheduler();
    const adapter = createProviderTTSAdapter({
      synthesize: async () => ({ audioUrl: 'x', visemes: [] }),
      scheduler,
    });
    const handle = adapter.speak('hi', audio);
    await flushMicrotasks();
    handle.cancel();
    expect(disconnect).toHaveBeenCalledTimes(1);
    expect(disconnect).toHaveBeenCalledWith(lastAudio);
  });
});

describe('fallback adapter', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    lastAudio = null;
    vi.stubGlobal('Audio', FakeAudioCtor);
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('emits energy sampled from readEnergy on a timer', async () => {
    const fakeAudio = makeFakeAudio({ readEnergy: () => 0.42 });
    const adapter = createFallbackTTSAdapter(async () => 'url');
    const energies: number[] = [];
    let started = 0;
    let ended = 0;
    const handle = adapter.speak('hi', fakeAudio);
    handle.on('energy', (e) => energies.push(e));
    handle.on('start', () => started++);
    handle.on('end', () => ended++);

    await flushMicrotasks();
    expect(started).toBe(1);

    vi.advanceTimersByTime(60); // two 30ms ticks
    expect(energies.length).toBe(2);
    expect(energies.every((e) => e === 0.42)).toBe(true);

    lastAudio!.emit('ended');
    expect(ended).toBe(1);
    adapter.dispose();
  });
  it('disconnects the element from the audio engine on ended', async () => {
    const disconnect = vi.fn();
    const audio = makeFakeAudio({ disconnectElement: disconnect });
    const adapter = createFallbackTTSAdapter(async () => 'url');
    adapter.speak('hi', audio);
    await flushMicrotasks();
    expect(lastAudio).not.toBeNull();
    lastAudio!.emit('ended');
    expect(disconnect).toHaveBeenCalledTimes(1);
    expect(disconnect).toHaveBeenCalledWith(lastAudio);
  });

  it('disconnects the element from the audio engine on playback error', async () => {
    const disconnect = vi.fn();
    const audio = makeFakeAudio({ disconnectElement: disconnect });
    const adapter = createFallbackTTSAdapter(async () => 'url');
    adapter.speak('hi', audio);
    await flushMicrotasks();
    lastAudio!.emit('error');
    expect(disconnect).toHaveBeenCalledTimes(1);
    expect(disconnect).toHaveBeenCalledWith(lastAudio);
  });

  it('disconnects the element from the audio engine on cancel', async () => {
    const disconnect = vi.fn();
    const audio = makeFakeAudio({ disconnectElement: disconnect });
    const adapter = createFallbackTTSAdapter(async () => 'url');
    const handle = adapter.speak('hi', audio);
    await flushMicrotasks();
    handle.cancel();
    expect(disconnect).toHaveBeenCalledTimes(1);
    expect(disconnect).toHaveBeenCalledWith(lastAudio);
  });
});

describe('speech engine', () => {
  it('resolves speak on end and tracks the speaking flag', async () => {
    const engine = createSpeechEngine(makeFakeAudio());
    const adapter = new ScriptedAdapter();
    engine.setAdapter(adapter);

    const p = engine.speak('hi');
    expect(engine.speaking).toBe(true);

    adapter.last!.begin();
    adapter.last!.finish();
    await p;

    expect(engine.speaking).toBe(false);
  });

  it('setAdapter cancels the active utterance', async () => {
    const engine = createSpeechEngine(makeFakeAudio());
    const a1 = new ScriptedAdapter();
    const a2 = new ScriptedAdapter();
    engine.setAdapter(a1);

    const p = engine.speak('hi');
    expect(engine.speaking).toBe(true);

    engine.setAdapter(a2); // cancels a1's active utterance
    await p;
    expect(engine.speaking).toBe(false);
  });

  it('forwards start and stall from the active adapter', async () => {
    const engine = createSpeechEngine(makeFakeAudio());
    const adapter = new ScriptedAdapter();
    engine.setAdapter(adapter);

    let started = 0;
    let stalled = 0;
    engine.on('start', () => started++);
    engine.on('stall', () => stalled++);

    engine.speak('hi');
    adapter.last!.begin();
    adapter.last!.stall();
    adapter.last!.finish();

    expect(started).toBe(1);
    expect(stalled).toBe(1);
  });
  it('ignores a stale handle terminal end while a newer speak is active', async () => {
    const engine = createSpeechEngine(makeFakeAudio());
    const adapter = new ControllableAdapter();
    engine.setAdapter(adapter);

    let endCount = 0;
    engine.on('end', () => endCount++);

    const p1 = engine.speak('first');
    const h1 = adapter.last!;
    expect(engine.speaking).toBe(true);

    // speak('second') cancels h1, but ControllableHandle.cancel does not
    // finish, so h1's terminal 'end' is still delivered later by the test.
    const p2 = engine.speak('second');
    const h2 = adapter.last!;
    expect(h1).not.toBe(h2);
    expect(engine.speaking).toBe(true);

    // Late terminal event from the first (stale) handle while second is active.
    h1.finish();
    expect(endCount).toBe(0);
    expect(engine.speaking).toBe(true);

    // The newer handle's own end drives the engine 'end' and resolves p2 only.
    let p1Resolved = false;
    void p1.then(() => {
      p1Resolved = true;
    });
    h2.finish();
    await p2;
    expect(endCount).toBe(1);
    expect(engine.speaking).toBe(false);
    // p1 must not resolve from the stale handle's end.
    expect(p1Resolved).toBe(false);
  });

  it('rejects the speak promise when the adapter emits an error', async () => {
    const engine = createSpeechEngine(makeFakeAudio());
    const adapter = new ScriptedAdapter();
    engine.setAdapter(adapter);

    let endCount = 0;
    engine.on('end', () => endCount++);

    const p = engine.speak('hi');
    const err = new Error('synthesis failed');
    adapter.last!.fail(err); // emits 'error' then terminal 'end'

    await expect(p).rejects.toBe(err);
    // speaking is cleared and the engine still emits 'end' so consumers leave
    // the speaking state despite the failure.
    expect(engine.speaking).toBe(false);
    expect(endCount).toBe(1);
  });
});
