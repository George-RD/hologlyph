/**
 * Default bust delivery (dec.default-asset-delivery: the package IS a digital
 * head, so the engine loads a real bust by default).
 *
 * The static `new URL('<literal>', import.meta.url)` pattern below is what
 * bundlers understand:
 * - Running unbundled source (demo dev server, vitest) it resolves the
 *   committed repo asset at <repo>/assets/hologlyph-bust.glb.
 * - In the published library build, Vite (lib mode) inlines the GLB as a
 *   data: URL, so the default head travels inside the package with no runtime
 *   path resolution at all.
 *
 * This module is imported DYNAMICALLY by the engine, so the inlined asset
 * lives in its own lazy chunk: consumers who pass an explicit avatarUrl never
 * download the default head.
 */

/** Ordered candidate URLs for the packaged bust GLB. May be empty. */
export function defaultAvatarUrls(): string[] {
  try {
    return [new URL('../../assets/hologlyph-bust.glb', import.meta.url).href];
  } catch {
    return [];
  }
}
