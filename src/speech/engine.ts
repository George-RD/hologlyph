/**
 * Speech engine: owns the active TTS adapter and forwards utterance
 * start/end/stall events to its own emitter. `speak` resolves when the
 * active utterance ends (including on cancel). The engine never creates an
 * AudioContext itself; it receives the shared AudioEngine and passes it
 * through to the active adapter.
 */

import type {
  AudioEngine,
  SpeechEngine,
  SpeechEngineEvents,
  TTSAdapter,
  UtteranceHandle,
} from '../contracts';
import { EmitterImpl } from './emitter';

class SpeechEngineImpl extends EmitterImpl<SpeechEngineEvents> implements SpeechEngine {
  private readonly _audio: AudioEngine;
  private _adapter: TTSAdapter | null = null;
  private _handle: UtteranceHandle | null = null;
  private _speaking = false;

  constructor(audio: AudioEngine) {
    super();
    this._audio = audio;
  }

  setAdapter(adapter: TTSAdapter): void {
    if (this._adapter === adapter) return;
    this.cancel();
    if (this._adapter) this._adapter.dispose();
    this._adapter = adapter;
  }

  get speaking(): boolean {
    return this._speaking;
  }

  speak(text: string): Promise<void> {
    if (!this._adapter) {
      return Promise.reject(new Error('SpeechEngine has no TTS adapter; call setAdapter first'));
    }
    const adapter = this._adapter;
    // Cancel any active utterance first so its late terminal events cannot
    // resolve the wrong promise or flip the speaking flag while the new one
    // runs.
    if (this._handle) {
      this._handle.cancel();
      this._handle = null;
    }
    return new Promise<void>((resolve, reject) => {
      const handle = adapter.speak(text, this._audio);
      this._handle = handle;
      this._speaking = true;

      let settled = false;
      const clearActive = (): void => {
        this._speaking = false;
        if (this._handle === handle) this._handle = null;
      };
      // Emit the terminal 'end' exactly once (success or error path).
      const finishOnce = (): void => {
        if (settled) return;
        settled = true;
        clearActive();
        this.emit('end', undefined);
      };

      const onStart = (): void => {
        if (this._handle !== handle) return;
        this.emit('start', undefined);
      };
      const onStall = (): void => {
        if (this._handle !== handle) return;
        this.emit('stall', undefined);
      };
      const onEnd = (): void => {
        if (this._handle !== handle) return;
        finishOnce();
        resolve();
      };
      const onError = (err: Error): void => {
        if (this._handle !== handle) return;
        if (settled) return;
        settled = true;
        clearActive();
        // Emit engine 'end' so consumers (behaviour machine, speechend) still
        // leave the speaking state even though the utterance failed; the
        // promise carries the failure. The following terminal 'end' is then a
        // no-op (settled guard + handle already cleared).
        this.emit('end', undefined);
        reject(err);
      };

      handle.on('start', onStart);
      handle.on('stall', onStall);
      handle.on('end', onEnd);
      handle.on('error', onError);
    });
  }

  cancel(): void {
    if (this._handle) {
      this._handle.cancel();
      this._handle = null;
    }
    this._speaking = false;
  }

  dispose(): void {
    this.cancel();
    if (this._adapter) {
      this._adapter.dispose();
      this._adapter = null;
    }
  }
}

export function createSpeechEngine(audio: AudioEngine): SpeechEngine {
  return new SpeechEngineImpl(audio);
}
