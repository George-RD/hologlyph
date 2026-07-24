/**
 * Opt-in Kokoro-82M TTS adapter (`mode: 'provider'`).
 *
 * Dynamically imports `kokoro-js` so the model and runtime remain lazy and out
 * of the core/root entry chunk. Audio is rendered to a WAV Blob and played
 * through an `HTMLAudioElement` routed via the shared `AudioEngine`. IPA
 * phoneme streams are mapped to canonical `RIG_VISEME_MORPHS` and distributed
 * over measured audio chunk durations without claiming provider timestamps.
 */

import type {
  AudioEngine,
  BlendshapeWeights,
  SpeechMode,
  TTSAdapter,
  UtteranceHandle,
  VisemeFrame,
} from '../../contracts';
import { UtteranceHandleImpl } from '../emitter';
import { SILENCE_FRAME_WEIGHTS, weightsForViseme } from '../visemes';
import type { FrameScheduler } from './provider';

export interface KokoroProgressPayload {
  status?: string;
  file?: string;
  progress?: number;
  loaded?: number;
  total?: number;
}

export type KokoroProgressCallback = (progress: KokoroProgressPayload) => void;

export type KokoroDevice = 'wasm' | 'webgpu' | 'cpu';
export type KokoroDtype = 'fp32' | 'fp16' | 'q8' | 'q4' | 'q4f16';

export interface KokoroTTSAdapterOptions {
  modelId?: string;
  dtype?: KokoroDtype;
  voice?: string;
  speed?: number;
  device?: KokoroDevice;
  onProgress?: KokoroProgressCallback;
  scheduler?: FrameScheduler;
  loader?: () => Promise<unknown>;
  mediaFactory?: (url: string) => HTMLAudioElement;
  blobFactory?: (parts: BlobPart[], options?: BlobPropertyBag) => Blob;
  urlFactory?: {
    createObjectURL: (blob: Blob) => string;
    revokeObjectURL: (url: string) => void;
  };
}

export interface KokoroTTSAdapter extends TTSAdapter {
  readonly loaded: boolean;
  load(): Promise<void>;
}

interface KokoroStreamChunk {
  text?: string;
  phonemes?: string;
  audio?: {
    audio?: Float32Array;
    sampling_rate?: number;
  };
}

interface KokoroTextStream {
  push(...texts: string[]): void;
  close(): void;
}

interface KokoroModelInstance {
  stream(
    text: string | KokoroTextStream,
    options?: { voice?: string; speed?: number },
  ): AsyncGenerator<KokoroStreamChunk, void, void>;
}

interface KokoroModuleShape {
  KokoroTTS: {
    from_pretrained(
      modelId: string,
      options?: {
        dtype?: string;
        device?: string | null;
        progress_callback?: (payload: Record<string, unknown>) => void;
      },
    ): Promise<KokoroModelInstance>;
  };
  TextSplitterStream?: new () => KokoroTextStream;
}

function normaliseKokoroText(text: string): string {
  // kokoro-js 1.2.1's splitter can loop forever on a newline immediately
  // following an @mention or URL. Remove line boundaries before either the
  // explicit or package-internal splitter receives caller-controlled text.
  return text.replace(/[^\S\r\n]*(?:\r\n?|\n)+[^\S\r\n]*/g, ' ');
}

interface LoadedKokoroModel {
  model: KokoroModelInstance;
  createTextStream: (() => KokoroTextStream) | null;
}

const IPA_VIS_RULES: ReadonlyArray<readonly [RegExp, string]> = [
  [/^(tʃ|dʒ|ʧ|ʤ)/i, 'viseme_ch'],
  [/^[pbm]/i, 'viseme_pp'],
  [/^[fv]/i, 'viseme_ff'],
  [/^[θð]/i, 'viseme_th'],
  [/^[td]/i, 'viseme_dd'],
  [/^[kg]/i, 'viseme_kk'],
  [/^[sz]/i, 'viseme_ss'],
  [/^[ʃʒ]/i, 'viseme_ch'],
  [/^[nŋ]/i, 'viseme_nn'],
  [/^[ɹr]/i, 'viseme_rr'],
  [/^[aɑæʌ]/i, 'viseme_aa'],
  [/^[eɛ]/i, 'viseme_ee'],
  [/^[iɪy]/i, 'viseme_ih'],
  [/^[oɔɒ]/i, 'viseme_oh'],
  [/^[uʊw]/i, 'viseme_ou'],
];

export function ipaToCanonicalVisemes(ipa: string): string[] {
  const out: string[] = [];
  let index = 0;
  while (index < ipa.length) {
    const slice = ipa.slice(index);
    if (/^[\s,.?!:;\-–—]/.test(slice)) {
      if (out.length === 0 || out[out.length - 1] !== 'viseme_sil') {
        out.push('viseme_sil');
      }
      index += 1;
      continue;
    }

    let matched = false;
    for (const [pattern, viseme] of IPA_VIS_RULES) {
      const match = pattern.exec(slice);
      if (match) {
        out.push(viseme);
        index += match[0].length;
        matched = true;
        break;
      }
    }

    if (!matched) {
      index += 1;
    }
  }
  return out;
}

const browserGlobals = globalThis as {
  Audio?: typeof Audio;
  URL?: typeof URL;
  navigator?: { gpu?: unknown };
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
        let frameId = 0;
        const loop = (): void => {
          if (stopped) return;
          callback();
          if (!stopped) frameId = raf(loop);
        };
        frameId = raf(loop);
        return () => {
          stopped = true;
          if (typeof caf === 'function') caf(frameId);
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

function encodeWavBlob(
  samples: Float32Array,
  sampleRate: number,
  blobFactory?: (parts: BlobPart[], options?: BlobPropertyBag) => Blob,
): Blob {
  const numChannels = 1;
  const bitsPerSample = 16;
  const bytesPerSample = bitsPerSample / 8;
  const blockAlign = numChannels * bytesPerSample;
  const byteRate = sampleRate * blockAlign;
  const dataSize = samples.length * bytesPerSample;
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);

  const writeString = (offset: number, str: string): void => {
    for (let index = 0; index < str.length; index++) {
      view.setUint8(offset + index, str.charCodeAt(index));
    }
  };

  writeString(0, 'RIFF');
  view.setUint32(4, 36 + dataSize, true);
  writeString(8, 'WAVE');
  writeString(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, byteRate, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bitsPerSample, true);
  writeString(36, 'data');
  view.setUint32(40, dataSize, true);

  let offset = 44;
  for (let index = 0; index < samples.length; index++) {
    const s = Math.max(-1, Math.min(1, samples[index] ?? 0));
    const val = s < 0 ? s * 0x8000 : s * 0x7fff;
    view.setInt16(offset, val, true);
    offset += 2;
  }

  const makeBlob = blobFactory ?? ((parts, opts) => new Blob(parts, opts));
  return makeBlob([buffer], { type: 'audio/wav' });
}

class KokoroTTSAdapterImpl implements KokoroTTSAdapter {
  readonly mode: SpeechMode = 'provider';
  private readonly _options: KokoroTTSAdapterOptions;
  private readonly _scheduler: FrameScheduler;
  private _loadPromise: Promise<void> | null = null;
  private _loadedModel: KokoroModelInstance | null = null;
  private _createTextStream: (() => KokoroTextStream) | null = null;
  private _activeHandle: UtteranceHandleImpl | null = null;
  private _disposed = false;

  constructor(options: KokoroTTSAdapterOptions = {}) {
    this._options = options;
    this._scheduler = options.scheduler ?? createDefaultScheduler();
  }

  get loaded(): boolean {
    return this._loadedModel !== null;
  }

  load(): Promise<void> {
    if (this._disposed) {
      return Promise.reject(new Error('KokoroTTSAdapter has been disposed'));
    }
    if (this._loadedModel) {
      return Promise.resolve();
    }
    if (!this._loadPromise) {
      this._loadPromise = this.fetchModel()
        .then(({ model, createTextStream }) => {
          if (this._disposed) {
            throw new Error('KokoroTTSAdapter has been disposed');
          }
          this._loadedModel = model;
          this._createTextStream = createTextStream;
        })
        .catch((error: unknown) => {
          this._loadPromise = null;
          throw error;
        });
    }
    return this._loadPromise;
  }

  private async fetchModel(): Promise<LoadedKokoroModel> {
    const loader = this._options.loader ?? (() => import('kokoro-js'));
    const module = (await loader()) as KokoroModuleShape;
    const modelId = this._options.modelId ?? 'onnx-community/Kokoro-82M-v1.0-ONNX';
    const requestedDevice =
      this._options.device ??
      (browserGlobals.navigator?.gpu ? 'webgpu' : 'wasm');
    const progressCallback = this._options.onProgress
      ? (payload: Record<string, unknown>): void => {
          this._options.onProgress?.({
            status: typeof payload.status === 'string' ? payload.status : undefined,
            file: typeof payload.file === 'string' ? payload.file : undefined,
            progress: typeof payload.progress === 'number' ? payload.progress : undefined,
            loaded: typeof payload.loaded === 'number' ? payload.loaded : undefined,
            total: typeof payload.total === 'number' ? payload.total : undefined,
          });
        }
      : undefined;
    const loadOn = (device: KokoroDevice): Promise<KokoroModelInstance> =>
      module.KokoroTTS.from_pretrained(modelId, {
        dtype: this._options.dtype ?? 'q8',
        device,
        progress_callback: progressCallback,
      });

    let model: KokoroModelInstance;
    try {
      model = await loadOn(requestedDevice);
    } catch (error) {
      if (this._options.device !== undefined || requestedDevice !== 'webgpu') throw error;
      model = await loadOn('wasm');
    }

    const Splitter = module.TextSplitterStream;
    return {
      model,
      createTextStream: Splitter ? () => new Splitter() : null,
    };
  }

  speak(text: string, audio: AudioEngine): UtteranceHandle {
    if (this._disposed) {
      throw new Error('KokoroTTSAdapter has been disposed');
    }

    if (this._activeHandle && !this._activeHandle.ended) {
      this._activeHandle.cancel();
    }

    const handle = new UtteranceHandleImpl();
    this._activeHandle = handle;
    handle.on('end', () => {
      if (this._activeHandle === handle) this._activeHandle = null;
    });

    let mediaElement: HTMLAudioElement | null = null;
    let stopScheduler: (() => void) | null = null;
    let createdUrl: string | null = null;
    let cleanedUp = false;

    const cleanup = (): void => {
      if (cleanedUp) return;
      cleanedUp = true;

      if (stopScheduler) {
        stopScheduler();
        stopScheduler = null;
      }

      if (mediaElement) {
        try {
          mediaElement.pause();
          mediaElement.removeAttribute('src');
          mediaElement.load();
        } catch {
          /* detached */
        }
        audio.disconnectElement(mediaElement);
        mediaElement = null;
      }

      if (createdUrl) {
        const urlFactory = this._options.urlFactory ?? browserGlobals.URL;
        urlFactory?.revokeObjectURL(createdUrl);
        createdUrl = null;
      }
    };

    handle.setCancel(() => {
      cleanup();
      handle.finish();
    });

    void this.synthesizeAndPlay(
      text,
      audio,
      handle,
      (url) => {
        createdUrl = url;
      },
      (element) => {
        mediaElement = element;
      },
      (stop) => {
        stopScheduler = stop;
      },
      cleanup,
    );

    return handle;
  }

  private async synthesizeAndPlay(
    text: string,
    audio: AudioEngine,
    handle: UtteranceHandleImpl,
    setCreatedUrl: (url: string) => void,
    setMediaElement: (element: HTMLAudioElement) => void,
    setStopScheduler: (stop: () => void) => void,
    cleanup: () => void,
  ): Promise<void> {
    try {
      await this.load();
      if (handle.cancelled || handle.ended) return;

      const model = this._loadedModel;
      if (!model) throw new Error('Kokoro model did not load');
      const safeText = normaliseKokoroText(text);
      let streamInput: string | KokoroTextStream = safeText;
      if (this._createTextStream) {
        const splitter = this._createTextStream();
        splitter.push(safeText);
        splitter.close();
        streamInput = splitter;
      }
      const chunks: Float32Array[] = [];
      const visemes: VisemeFrame[] = [];
      let totalSamples = 0;
      let sampleRate = 24000;
      let currentTimeOffset = 0;

      for await (const chunk of model.stream(streamInput, {
        voice: this._options.voice ?? 'af_heart',
        speed: this._options.speed ?? 1,
      })) {
        if (handle.cancelled || handle.ended) return;

        const pcm = chunk.audio?.audio;
        const sr = chunk.audio?.sampling_rate ?? 24000;
        if (pcm && pcm.length > 0) {
          chunks.push(pcm);
          totalSamples += pcm.length;
          sampleRate = sr;

          const chunkDuration = pcm.length / sr;
          const phonemes = chunk.phonemes ?? '';
          const canonical = ipaToCanonicalVisemes(phonemes);

          if (canonical.length > 0) {
            const timeStep = chunkDuration / canonical.length;
            for (let index = 0; index < canonical.length; index++) {
              const name = canonical[index];
              if (!name) continue;
              const weights: BlendshapeWeights =
                name === 'viseme_sil' ? SILENCE_FRAME_WEIGHTS : weightsForViseme(name);
              visemes.push({
                time: currentTimeOffset + index * timeStep,
                weights,
              });
            }
          }
          currentTimeOffset += chunkDuration;
        }
      }

      if (handle.cancelled || handle.ended) return;

      if (totalSamples === 0 || chunks.length === 0) {
        handle.begin();
        handle.finish();
        return;
      }

      const mergedPcm = new Float32Array(totalSamples);
      let offset = 0;
      for (const chunk of chunks) {
        mergedPcm.set(chunk, offset);
        offset += chunk.length;
      }

      const wavBlob = encodeWavBlob(mergedPcm, sampleRate, this._options.blobFactory);
      const urlFactory = this._options.urlFactory ?? browserGlobals.URL;
      if (!urlFactory?.createObjectURL) {
        throw new Error('URL.createObjectURL is not available');
      }
      const audioUrl = urlFactory.createObjectURL(wavBlob);
      setCreatedUrl(audioUrl);

      if (handle.cancelled || handle.ended) {
        cleanup();
        return;
      }

      const createMedia =
        this._options.mediaFactory ??
        ((url: string) => {
          const AudioCtor = browserGlobals.Audio ?? Audio;
          return new AudioCtor(url);
        });

      const element = createMedia(audioUrl);
      setMediaElement(element);

      audio.connectElement(element);

      let nextIndex = 0;
      const stop = this._scheduler.start(() => {
        if (handle.cancelled || handle.ended) return;
        const t = element.currentTime;
        while (nextIndex < visemes.length) {
          const frame = visemes[nextIndex];
          if (!frame) break;
          if (frame.time > t) break;
          handle.viseme(frame);
          nextIndex += 1;
        }
      });
      setStopScheduler(stop);

      element.addEventListener('waiting', () => handle.stall());
      element.addEventListener('stalled', () => handle.stall());
      element.addEventListener('ended', () => {
        cleanup();
        handle.finish();
      });
      element.addEventListener('error', () => {
        cleanup();
        handle.fail(new Error('audio playback failed'));
      });

      handle.begin();

      try {
        await element.play();
      } catch {
        if (!handle.ended) {
          cleanup();
          handle.fail(new Error('audio playback was rejected'));
        }
      }
    } catch (error) {
      if (!handle.ended) {
        cleanup();
        handle.fail(error instanceof Error ? error : new Error(String(error)));
      }
    }
  }

  dispose(): void {
    if (this._disposed) return;
    this._disposed = true;
    if (this._activeHandle && !this._activeHandle.ended) {
      this._activeHandle.cancel();
    }
    this._activeHandle = null;
    this._loadedModel = null;
    this._createTextStream = null;
    this._loadPromise = null;
  }
}

export function createKokoroTTSAdapter(
  options?: KokoroTTSAdapterOptions,
): KokoroTTSAdapter {
  return new KokoroTTSAdapterImpl(options);
}
