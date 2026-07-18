/**
 * GLB loader for hologlyph (hologlyph.asset.loader).
 *
 * Wraps three's GLTFLoader and wires KTX2 (Basis Universal) + Meshopt decoding
 * when available. Plain GLBs load fine without KTX2 support: the KTX2 path is
 * feature-detected and only used when a model actually carries KTX2 textures.
 *
 * The transcoder path is configurable via the factory options (dec.asset-rig-schema),
 * defaulting to a pinned CDN copy of the Basis transcoder.
 */

import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { KTX2Loader } from 'three/examples/jsm/loaders/KTX2Loader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import type { AssetLoader, LoadedAvatar } from '../contracts';
import { buildLoadedAvatar } from './rig';

/** Pinned CDN copy of the Basis Universal transcoder used by KTX2Loader. */
export const DEFAULT_KTX2_TRANSCODER_PATH =
  'https://cdn.jsdelivr.net/npm/three@0.178.0/examples/jsm/libs/basis/';

export interface AssetLoaderOptions {
  /** Override the Basis transcoder path used by KTX2Loader. */
  ktx2TranscoderPath?: string;
}

export function createAssetLoader(options: AssetLoaderOptions = {}): AssetLoader {
  const ktx2Path = options.ktx2TranscoderPath ?? DEFAULT_KTX2_TRANSCODER_PATH;

  const loader = new GLTFLoader();

  // KTX2 support is wired only if we can construct the loader. Plain GLBs
  // (no KTX2 textures) load without it; GLTFLoader ignores KTX2Loader unless a
  // KTX2 texture is encountered. detectSupport() needs a live renderer, so it
  // is triggered by attachRenderer() once the host provides one (dec.asset-rig-schema)
  // rather than at construction (when no renderer exists yet).
  let ktx2: KTX2Loader | null = null;
  try {
    const instance = new KTX2Loader();
    instance.setTranscoderPath(ktx2Path);
    loader.setKTX2Loader(instance);
    ktx2 = instance;
  } catch {
    // KTX2Loader unavailable; plain GLB support remains.
  }

  // Meshopt decoding is bundled and always available.
  loader.setMeshoptDecoder(MeshoptDecoder);

  const rawLoader = loader as unknown as { dispose?: () => void };
  let disposed = false;

  const dispose = (): void => {
    if (disposed) return;
    disposed = true;
    if (ktx2) {
      ktx2.dispose();
      ktx2 = null;
    }
    rawLoader.dispose?.();
  };

  const load = async (url: string): Promise<LoadedAvatar> => {
    const gltf = await loader.loadAsync(url);
    return buildLoadedAvatar(gltf.scene, gltf.animations ?? []);
  };

  // Hand the loader the live renderer and detect KTX2 GPU-format support.
  // Called by the host once its renderer exists (e.g. after WebGPU init); it
  // must work whether invoked right after construction or after some loads.
  // Without a renderer plain GLBs keep loading (KTX2 textures will fail to
  // transcode at draw time as before); when KTX2Loader could not be built,
  // there is nothing to detect.
  const attachRenderer = (renderer: unknown): void => {
    if (!ktx2) return;
    try {
      // detectSupport needs a concrete renderer; the contract passes unknown,
      // so narrow it to exactly what KTX2Loader accepts.
      ktx2.detectSupport(renderer as Parameters<typeof ktx2.detectSupport>[0]);
    } catch (err) {
      console.warn('AssetLoader: KTX2 detectSupport failed; KTX2 textures may not transcode.', err);
    }
  };

  return { load, dispose, attachRenderer };
}
