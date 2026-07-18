// Pure unit tests for the blend-zone ghosting estimator. No browser, no PNG
// files on disk: we build tiny synthetic RGB buffers (crisp versus an
// artificially doubled glyph pattern) and also round-trip them through a
// minimal truecolour PNG encoder so the test exercises the real decoder path.

import { deflateSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { blendZoneGhosting, duplicateAndOffset, decodePng } from '../tools/evals/score.mjs';

interface RgbImage {
  width: number;
  height: number;
  channels: number;
  data: Uint8Array;
}

const HEAD: [number, number, number] = [110, 110, 110];
const GLYPH: [number, number, number] = [255, 255, 255];
const LUM_THRESHOLD = 200;

function makeImage(width: number, height: number): RgbImage {
  return { width, height, channels: 3, data: new Uint8Array(width * height * 3) };
}

function fillRect(
  img: RgbImage,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  color: [number, number, number],
): void {
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const i = (y * img.width + x) * 3;
      img.data[i] = color[0];
      img.data[i + 1] = color[1];
      img.data[i + 2] = color[2];
    }
  }
}

// Head silhouette = every non-background pixel (the grey shell plus glyphs).
function headMask(img: RgbImage): Uint8Array {
  const mask = new Uint8Array(img.width * img.height);
  for (let p = 0, i = 0; p < mask.length; p++, i += 3) {
    mask[p] = ((img.data[i] ?? 0) + (img.data[i + 1] ?? 0) + (img.data[i + 2] ?? 0)) > 0 ? 1 : 0;
  }
  return mask;
}

// Minimal truecolour (colorType 2), 8-bit, filter-0 PNG encoder so the unit
// test can run the estimator over a decoded buffer, as the scorer does.
const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();
function crc32(buffer: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < buffer.length; i++) c = (CRC_TABLE[(c ^ (buffer[i] ?? 0)) & 0xff] ?? 0) ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function pngChunk(type: string, body: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(body.length);
  const typeBuf = Buffer.from(type, 'ascii');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, body])) >>> 0);
  return Buffer.concat([len, typeBuf, body, crc]);
}
function encodeTruecolorPng(img: RgbImage): Buffer {
  const stride = img.width * 3;
  const raw = Buffer.alloc((stride + 1) * img.height);
  for (let y = 0; y < img.height; y++) {
    raw[y * (stride + 1)] = 0;
    for (let x = 0; x < stride; x++) raw[y * (stride + 1) + 1 + x] = img.data[y * img.width * 3 + x] ?? 0;
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(img.width, 0);
  ihdr.writeUInt32BE(img.height, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  return Buffer.concat([
    sig,
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', deflateSync(raw)),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

// A single crisp vertical stroke inside the head region.
function crispGlyph(): RgbImage {
  const img = makeImage(24, 20);
  fillRect(img, 4, 4, 19, 15, HEAD);
  fillRect(img, 9, 6, 10, 13, GLYPH);
  return img;
}

// The crisp stroke plus an offset duplicate: two bright runs per glyph row,
// separated by a small dark gap (the blend-zone ghosting signature).
function doubledGlyph(): RgbImage {
  const img = crispGlyph();
  fillRect(img, 15, 6, 16, 13, GLYPH);
  return img;
}

describe('blendZoneGhosting', () => {
  it('scores a crisp single stroke near zero', () => {
    const img = crispGlyph();
    const score = blendZoneGhosting(img, headMask(img), LUM_THRESHOLD);
    expect(score).toBeLessThan(0.1);
  });

  it('scores an artificially doubled glyph pattern well above the crisp case', () => {
    const crisp = crispGlyph();
    const doubled = doubledGlyph();
    const crispScore = blendZoneGhosting(crisp, headMask(crisp), LUM_THRESHOLD);
    const doubledScore = blendZoneGhosting(doubled, headMask(doubled), LUM_THRESHOLD);
    expect(crispScore).toBeLessThan(0.1);
    expect(doubledScore).toBeGreaterThan(0.5);
  });

  it('discriminates when run over a decoded synthetic PNG buffer', () => {
    const crisp = crispGlyph();
    const doubled = doubledGlyph();
    const crispDecoded = decodePng(encodeTruecolorPng(crisp));
    const doubledDecoded = decodePng(encodeTruecolorPng(doubled));
    expect(blendZoneGhosting(crispDecoded, headMask(crispDecoded), LUM_THRESHOLD)).toBeLessThan(0.1);
    expect(blendZoneGhosting(doubledDecoded, headMask(doubledDecoded), LUM_THRESHOLD)).toBeGreaterThan(0.5);
  });

  it('negative-control transform pushes a clean view into the ghosted range', () => {
    const crisp = crispGlyph();
    const ghosted = duplicateAndOffset(crisp, 4, LUM_THRESHOLD);
    const before = blendZoneGhosting(crisp, headMask(crisp), LUM_THRESHOLD);
    const after = blendZoneGhosting(ghosted, headMask(crisp), LUM_THRESHOLD);
    expect(after).toBeGreaterThan(0.5);
    expect(after).toBeGreaterThan(before);
  });

  it('returns zero on an empty (no-glyph) image without throwing', () => {
    const img = makeImage(8, 8);
    fillRect(img, 1, 1, 6, 6, HEAD);
    expect(blendZoneGhosting(img, headMask(img), LUM_THRESHOLD)).toBe(0);
  });
  it('scores a thick single stroke (width 5) near zero, not self-twinned', () => {
    const img = makeImage(24, 20);
    fillRect(img, 4, 4, 19, 15, HEAD);
    fillRect(img, 9, 6, 13, 13, GLYPH);
    const score = blendZoneGhosting(img, headMask(img), LUM_THRESHOLD);
    expect(score).toBeLessThan(0.1);
  });
});
