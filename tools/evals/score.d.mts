import type { Buffer } from 'node:buffer';
// module is plain JavaScript; these signatures let strict tsc type-check the
// vitest suite that exercises the pure estimator.

export interface DecodedImage {
  width: number;
  height: number;
  channels: number;
  data: Uint8Array;
}

export function decodePng(input: string | Buffer): DecodedImage;
export function luminance(r: number, g: number, b: number): number;
export function silhouetteMask(
  img: DecodedImage,
  clear: number[],
  tolerance: number,
  minAlpha: number,
): { mask: Uint8Array; count: number };

// Blend-zone ghosting estimator: mean per-row fraction of bright glyph pixels
// whose twin (another bright pixel) sits 2-6 px away in a different run.
// Higher means more doubled edges (worse).
export function blendZoneGhosting(
  img: DecodedImage,
  mask: Uint8Array,
  lumThreshold: number,
): number;

// Negative-control transform: duplicate bright glyph pixels shifted right by
// `offset` px, producing the doubled-edge signature of ghosting.
export function duplicateAndOffset(
  img: DecodedImage,
  offset: number,
  lumThreshold: number,
): DecodedImage;
