/**
 * Demo TTS adapter: browser SpeechSynthesis. There are no visemes, so coarse
 * mouth motion is derived from `boundary` word events. Each boundary spikes
 * the energy envelope to 1 and it decays between events; the envelope is
 * sampled on a timer and emitted as `energy`. SpeechSynthesis is feature
 * detected; when it is missing the adapter emits `error` then `end`.
 */

import type { AudioEngine, SpeechMode, TTSAdapter, UtteranceHandle } from '../../contracts';
import { UtteranceHandleImpl } from '../emitter';

const ENERGY_TICK_MS = 30;
const ENERGY_DECAY = 0.8;

// Single typed view of the browser speech globals.
const browserGlobals = globalThis as {
  speechSynthesis?: SpeechSynthesis;
  SpeechSynthesisUtterance?: typeof SpeechSynthesisUtterance;
};

class DemoTTSAdapter implements TTSAdapter {
  readonly mode: SpeechMode = 'demo';
  private _disposed = false;
  private _handle: UtteranceHandleImpl | null = null;

  speak(text: string, _audio: AudioEngine): UtteranceHandle {
    if (this._disposed) throw new Error('DemoTTSAdapter has been disposed');
    const handle = new UtteranceHandleImpl();
    this._handle = handle;

    const synth = browserGlobals.speechSynthesis;
    const UtteranceCtor = browserGlobals.SpeechSynthesisUtterance;
    if (!synth || !UtteranceCtor) {
      queueMicrotask(() => {
        if (!handle.ended) {
          handle.fail(new Error('speechSynthesis is not available in this environment'));
        }
      });
      return handle;
    }

    const utter = new UtteranceCtor(text);
    let alive = true;
    let timer: ReturnType<typeof setInterval> | null = null;
    let energy = 0;

    const stop = (): void => {
      if (timer !== null) {
        clearInterval(timer);
        timer = null;
      }
    };

    handle.setCancel(() => {
      alive = false;
      stop();
      synth.cancel();
    });

    utter.onstart = () => {
      if (!alive) return;
      handle.begin();
    };
    utter.onboundary = () => {
      if (!alive) return;
      energy = 1;
    };
    utter.onend = () => {
      alive = false;
      stop();
      handle.finish();
    };
    utter.onerror = (event: SpeechSynthesisErrorEvent) => {
      alive = false;
      stop();
      handle.fail(event.error ? new Error(event.error) : new Error('speechSynthesis error'));
    };

    timer = setInterval(() => {
      if (!alive) return;
      handle.energy(energy);
      energy *= ENERGY_DECAY;
      if (energy < 0.01) energy = 0;
    }, ENERGY_TICK_MS);

    synth.speak(utter);
    return handle;
  }

  dispose(): void {
    this._disposed = true;
    this._handle?.cancel();
    this._handle = null;
  }
}

export function createDemoTTSAdapter(): TTSAdapter {
  return new DemoTTSAdapter();
}
