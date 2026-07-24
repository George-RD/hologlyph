/**
 * Speech module entry point. Re-exports the engine factory and the three
 * canonical TTS adapters. The engine passes the shared AudioEngine through to
 * the active adapter; adapters never import the audio module directly, only
 * its contract types.
 */

import { createSpeechEngine } from './engine';
import { createDemoTTSAdapter } from './adapters/demo';
import { createProviderTTSAdapter } from './adapters/provider';
import { createFallbackTTSAdapter } from './adapters/fallback';
import { createKokoroTTSAdapter, ipaToCanonicalVisemes } from './adapters/kokoro';

export {
  createSpeechEngine,
  createDemoTTSAdapter,
  createProviderTTSAdapter,
  createFallbackTTSAdapter,
  createKokoroTTSAdapter,
  ipaToCanonicalVisemes,
};

export type {
  ProviderSynthesisResult,
  ProviderSynthesize,
  FrameScheduler,
} from './adapters/provider';

export type {
  KokoroDevice,
  KokoroDtype,
  KokoroProgressCallback,
  KokoroProgressPayload,
  KokoroTTSAdapter,
  KokoroTTSAdapterOptions,
} from './adapters/kokoro';
