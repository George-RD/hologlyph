/**
 * Provider TTS adapter: a cloud synthesis function returns an audio URL plus
 * viseme metadata. The audio is played through an `HTMLAudioElement` routed
 * via the shared AudioEngine; viseme frames are emitted in time order against
 * the element's `currentTime` on an injectable frame scheduler. Playback
 * stalls (`waiting`/`stalled`) are forwarded as `stall`; `ended` finishes.
 */

import type {
  AudioEngine,
  SpeechMode,
  TTSAdapter,
  UtteranceHandle,
  VisemeFrame,
} from '../../contracts';
import { UtteranceHandleImpl } from '../emitter';

export interface ProviderSynthesisResult {
  audioUrl: string;
  visemes: VisemeFrame[];
}

export type ProviderSynthesize = (text: string) => Promise<ProviderSynthesisResult>;

export interface FrameScheduler {
  /** Begin invoking `callback` each frame; returns a stop function. */
  start(callback: () => void): () => void;
}

// Single typed view of the browser globals used here.
const browserGlobals = globalThis as {
  Audio?: typeof Audio;
  requestAnimationFrame?: (cb: FrameRequestCallback) => number;
  cancelAnimationFrame?: (handle: number) => void;
};

function createDefaultScheduler(): FrameScheduler {
  const raf = browserGlobals.requestAnimationFrame;
  if (typeof raf === 'function') {
    const caf = browserGlobals.cancelAnimationFrame;
    return {
      start(callback: () => void): () => void {
        let stopped = false;
        const loop = (): void => {
          if (stopped) return;
          callback();
          raf(loop);
        };
        raf(loop);
        return () => {
          stopped = true;
          if (typeof caf === 'function') caf(0);
        };
      },
    };
  }
  return {
    start(callback: () => void): () => void {
      const timer = setInterval(callback, 16);
      return () => clearInterval(timer);
    },
  };
}


class ProviderTTSAdapter implements TTSAdapter {
  readonly mode: SpeechMode = 'provider';
  private readonly _synthesize: ProviderSynthesize;
  private readonly _scheduler: FrameScheduler;
  private _disposed = false;
  private _handle: UtteranceHandleImpl | null = null;

  constructor(opts: { synthesize: ProviderSynthesize; scheduler?: FrameScheduler }) {
    this._synthesize = opts.synthesize;
    this._scheduler = opts.scheduler ?? createDefaultScheduler();
  }

  speak(text: string, audio: AudioEngine): UtteranceHandle {
    if (this._disposed) throw new Error('ProviderTTSAdapter has been disposed');
    const handle = new UtteranceHandleImpl();
    this._handle = handle;

    let aborted = false;
    let el: HTMLAudioElement | null = null;
    let stop: (() => void) | null = null;

    handle.setCancel(() => {
      aborted = true;
      if (stop) stop();
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

    this._synthesize(text)
      .then((result) => {
        if (aborted || handle.ended) return;
        const AudioCtor = browserGlobals.Audio ?? Audio;
        el = new AudioCtor(result.audioUrl);
        audio.connectElement(el);

        const visemes = result.visemes;
        let next = 0;
        stop = this._scheduler.start(() => {
          const element = el;
          if (!element) return;
          const t = element.currentTime;
          while (next < visemes.length) {
            const frame = visemes[next]!;
            if (frame.time > t) break;
            handle.viseme(frame);
            next += 1;
          }
        });

        el.addEventListener('waiting', () => handle.stall());
        el.addEventListener('stalled', () => handle.stall());
        el.addEventListener('ended', () => {
          if (stop) stop();
          if (el) audio.disconnectElement(el);
          handle.finish();
        });
        el.addEventListener('error', () => {
          if (stop) stop();
          if (el) audio.disconnectElement(el);
          handle.fail(new Error('audio playback failed'));
        });

        handle.begin();
        void el.play().catch(() => {
          if (stop) stop();
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

export function createProviderTTSAdapter(opts: {
  synthesize: ProviderSynthesize;
  scheduler?: FrameScheduler;
}): TTSAdapter {
  return new ProviderTTSAdapter(opts);
}
