/**
 * Fallback TTS adapter: a synthesis function returns only an audio URL. The
 * audio is played through the shared AudioEngine and the engine's analyser
 * energy is sampled on a timer and emitted as `energy`. This coarse energy
 * drives jaw articulation downstream (dec.speech-architecture mode 3).
 */

import type { AudioEngine, SpeechMode, TTSAdapter, UtteranceHandle } from '../../contracts';
import { UtteranceHandleImpl } from '../emitter';

const ENERGY_INTERVAL_MS = 30;

const browserGlobals = globalThis as {
  Audio?: typeof Audio;
};


class FallbackTTSAdapter implements TTSAdapter {
  readonly mode: SpeechMode = 'fallback';
  private readonly _synthesizeAudio: (text: string) => Promise<string>;
  private _disposed = false;
  private _handle: UtteranceHandleImpl | null = null;

  constructor(synthesizeAudio: (text: string) => Promise<string>) {
    this._synthesizeAudio = synthesizeAudio;
  }

  speak(text: string, audio: AudioEngine): UtteranceHandle {
    if (this._disposed) throw new Error('FallbackTTSAdapter has been disposed');
    const handle = new UtteranceHandleImpl();
    this._handle = handle;

    let aborted = false;
    let el: HTMLAudioElement | null = null;
    let timer: ReturnType<typeof setInterval> | null = null;

    handle.setCancel(() => {
      aborted = true;
      if (timer !== null) {
        clearInterval(timer);
        timer = null;
      }
      if (el) {
        try {
          el.pause();
          el.removeAttribute('src');
          el.load();
        } catch {
          /* element already detached */
        }
        audio.disconnectElement(el);
      }
    });

    this._synthesizeAudio(text)
      .then((audioUrl) => {
        if (aborted || handle.ended) return;
        const AudioCtor = browserGlobals.Audio ?? Audio;
        el = new AudioCtor(audioUrl);
        audio.connectElement(el);

        handle.begin();
        timer = setInterval(() => {
          if (handle.ended) return;
          handle.energy(audio.readEnergy());
        }, ENERGY_INTERVAL_MS);
        el.addEventListener('ended', () => {
          if (timer !== null) {
            clearInterval(timer);
            timer = null;
          }
          if (el) audio.disconnectElement(el);
          handle.finish();
        });
        el.addEventListener('error', () => {
          if (timer !== null) {
            clearInterval(timer);
            timer = null;
          }
          if (el) audio.disconnectElement(el);
          handle.fail(new Error('audio playback failed'));
        });

        void el.play().catch(() => {
          if (timer !== null) {
            clearInterval(timer);
            timer = null;
          }
          if (el) audio.disconnectElement(el);
          handle.fail(new Error('audio playback was rejected'));
        });
      })
      .catch((err: unknown) => {
        if (!handle.ended) {
          handle.fail(err instanceof Error ? err : new Error(String(err)));
        }
      });

    return handle;
  }

  dispose(): void {
    this._disposed = true;
    this._handle?.cancel();
    this._handle = null;
  }
}

export function createFallbackTTSAdapter(synthesizeAudio: (text: string) => Promise<string>): TTSAdapter {
  return new FallbackTTSAdapter(synthesizeAudio);
}
