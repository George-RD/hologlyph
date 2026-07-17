/**
 * Demo TTS adapter: browser SpeechSynthesis. There are no phonemes, so mouth
 * motion is derived from `boundary` word events. Each boundary yields the word
 * under the caret; that word is mapped to a viseme sequence and walked on a
 * timer at a fixed 75 ms cadence, emitting `viseme` frames. After the last
 * viseme of a word a single silence frame closes the mouth until the next
 * boundary. SpeechSynthesis is feature detected; when it is missing the
 * adapter emits `error` then `end`.
 *
 * The demo adapter no longer emits `energy`; the analyser-energy path is the
 * fallback adapter's alone.
 */

import type {
  AudioEngine,
  SpeechMode,
  TTSAdapter,
  UtteranceHandle,
} from '../../contracts';
import { UtteranceHandleImpl } from '../emitter';
import {
  SILENCE_FRAME_WEIGHTS,
  visemeSequenceForWord,
  weightsForViseme,
  wordAt,
} from '../visemes';

// Timer cadence: poll every 30 ms but advance one viseme every 75 ms.
const VISEME_TICK_MS = 30;
const VISEME_MS = 75;

// Structural view of the fields we read from a `boundary` event. Not every
// TypeScript DOM lib types `charLength`, so we describe exactly what we need.
interface SpeechBoundaryEvent {
  charIndex: number;
  charLength?: number;
}

// Return type of `setInterval` (Node vs DOM timer handles differ).
type TimerHandle = ReturnType<typeof setInterval>;

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
    let timer: TimerHandle | null = null;

    // Viseme walk state. `sequence` is the visemes for the current word and
    // `cursor` is how many have been emitted. Cadence is measured against the
    // wall clock so a throttled interval still advances by real elapsed time.
    let sequence: string[] = [];
    let cursor = 0;
    let emittedSilence = false;

    // Utterance-relative clock for `VisemeFrame.time` (seconds since start).
    let utteranceStartMs = 0;
    let boundaryStartMs = 0;

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
      utteranceStartMs = Date.now();
      handle.begin();
    };
    utter.onboundary = (event: unknown) => {
      if (!alive) return;
      const e = event as SpeechBoundaryEvent;
      const word = wordAt(text, e.charIndex, e.charLength ?? 0);
      sequence = visemeSequenceForWord(word);
      cursor = 0;
      emittedSilence = false;
      boundaryStartMs = Date.now();
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
      const step = Math.floor((Date.now() - boundaryStartMs) / VISEME_MS);
      while (cursor < sequence.length && cursor <= step) {
        const viseme = sequence[cursor]!;
        const time = (boundaryStartMs - utteranceStartMs + cursor * VISEME_MS) / 1000;
        handle.viseme({ time, weights: weightsForViseme(viseme) });
        cursor++;
      }
      // Past the word: emit exactly one silence frame to close the mouth.
      if (sequence.length > 0 && cursor >= sequence.length && !emittedSilence && step >= sequence.length) {
        const time = (boundaryStartMs - utteranceStartMs + sequence.length * VISEME_MS) / 1000;
        handle.viseme({ time, weights: SILENCE_FRAME_WEIGHTS });
        emittedSilence = true;
      }
    }, VISEME_TICK_MS);

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
