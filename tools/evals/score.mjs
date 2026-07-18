import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { inflateSync } from 'node:zlib';


// ---------------------------------------------------------------------------
// Dependency-free PNG decoder (truecolour / truecolour+alpha, 8-bit, filters
// 0-4). zlib inflation uses node:zlib; CRC32 is verified per chunk.
// ---------------------------------------------------------------------------
const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(buffer) {
  let c = 0xffffffff;
  for (let i = 0; i < buffer.length; i++) c = CRC_TABLE[(c ^ buffer[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

export function decodePng(input) {
  const data = typeof input === 'string' ? readFileSync(input) : input;
  const label = typeof input === 'string' ? input : '<buffer>';
  if (data.readUInt32BE(0) !== 0x89504e47) throw new Error(`not a PNG file: ${typeof input === 'string' ? input : '<buffer>'}`);
  let pos = 8;
  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colorType = 0;
  const idat = [];
  while (pos < data.length) {
    const len = data.readUInt32BE(pos);
    const type = data.toString('ascii', pos + 4, pos + 8);
    const start = pos + 8;
    const chunk = data.subarray(start, start + len);
    if (type === 'IHDR') {
      width = chunk.readUInt32BE(0);
      height = chunk.readUInt32BE(4);
      bitDepth = chunk[8];
      colorType = chunk[9];
    } else if (type === 'IDAT') {
      idat.push(chunk);
    } else if (type === 'IEND') {
      break;
    }
    const stored = data.readUInt32BE(start + len);
    if (crc32(data.subarray(pos + 4, start + len)) !== stored) {
      throw new Error(`CRC mismatch in ${type} chunk of ${label}`);
    }
    pos = start + len + 4;
  }
  if (colorType !== 2 && colorType !== 6) {
    throw new Error(`unsupported PNG colorType ${colorType} in ${label}`);
  }
  if (bitDepth !== 8) throw new Error(`unsupported PNG bitDepth ${bitDepth} in ${label}`);
  const channels = colorType === 6 ? 4 : 3;
  const raw = inflateSync(Buffer.concat(idat));
  const stride = width * channels;
  const out = Buffer.alloc(height * stride);
  let prev = Buffer.alloc(stride);
  let rp = 0;
  for (let y = 0; y < height; y++) {
    const filter = raw[rp++];
    const line = raw.subarray(rp, rp + stride);
    rp += stride;
    const cur = Buffer.alloc(stride);
    for (let i = 0; i < stride; i++) {
      const a = i >= channels ? cur[i - channels] : 0;
      const b = prev[i];
      const c = i >= channels ? prev[i - channels] : 0;
      const v = line[i];
      let recon;
      switch (filter) {
        case 0: recon = v; break;
        case 1: recon = v + a; break;
        case 2: recon = v + b; break;
        case 3: recon = v + ((a + b) >> 1); break;
        case 4: {
          const p = a + b - c;
          const pa = Math.abs(p - a);
          const pb = Math.abs(p - b);
          const pc = Math.abs(p - c);
          recon = v + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c);
          break;
        }
        default: throw new Error(`unsupported PNG filter type ${filter} in ${label}`);
      }
      cur[i] = recon & 0xff;
    }
    cur.copy(out, y * stride);
    prev = cur;
  }
  return { width, height, channels, data: out };
}

// ---------------------------------------------------------------------------
// Image helpers
// ---------------------------------------------------------------------------
const REC709 = [0.2126, 0.7152, 0.0722];
export function luminance(r, g, b) {
  return REC709[0] * r + REC709[1] * g + REC709[2] * b;
}

export function silhouetteMask(img, clear, tolerance, minAlpha) {
  const { width, height, channels, data } = img;
  const mask = new Uint8Array(width * height);
  let count = 0;
  for (let i = 0, p = 0; i < width * height; i++, p += channels) {
    const r = data[p];
    const g = data[p + 1];
    const b = data[p + 2];
    const a = channels === 4 ? data[p + 3] : 255;
    const diff = Math.abs(r - clear[0]) + Math.abs(g - clear[1]) + Math.abs(b - clear[2]);
    const on = diff > tolerance && a >= minAlpha ? 1 : 0;
    mask[i] = on;
    count += on;
  }
  return { mask, count };
}

// Mean absolute horizontal+vertical luminance gradient (high-frequency energy
// proxy). Sharper glyph edges yield a larger value.
function meanGradient(img) {
  const { width, height, channels, data } = img;
  let sum = 0;
  let n = 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * channels;
      const here = luminance(data[i], data[i + 1], data[i + 2]);
      if (x + 1 < width) {
        const r = (y * width + x + 1) * channels;
        const right = luminance(data[r], data[r + 1], data[r + 2]);
        sum += Math.abs(here - right);
        n++;
      }
      if (y + 1 < height) {
        const d = ((y + 1) * width + x) * channels;
        const down = luminance(data[d], data[d + 1], data[d + 2]);
        sum += Math.abs(here - down);
        n++;
      }
    }
  }
  return n > 0 ? sum / n : 0;
}

// Mean absolute luminance gradient restricted to silhouette pixels: measures
// glyph edge sharpness on the head itself, ignoring the background. Catches
// side-view smear that coverage alone cannot (stretched glyphs keep their
// bright-pixel fraction but lose high-frequency edges).
function silhouetteMeanGradient(img, mask) {
  const { width, height, channels, data } = img;
  let sum = 0;
  let n = 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const m = y * width + x;
      if (!mask[m]) continue;
      const i = m * channels;
      const here = luminance(data[i], data[i + 1], data[i + 2]);
      if (x + 1 < width && mask[m + 1]) {
        const r = (m + 1) * channels;
        sum += Math.abs(here - luminance(data[r], data[r + 1], data[r + 2]));
        n++;
      }
      if (y + 1 < height && mask[m + width]) {
        const d = (m + width) * channels;
        sum += Math.abs(here - luminance(data[d], data[d + 1], data[d + 2]));
        n++;
      }
    }
  }
  return n > 0 ? sum / n : 0;
}

// Negative-control transform: horizontally smear an image in place by
// averaging each pixel over a window to its right. Simulates the planar
// side-projection stretch defect; the yaw legibility metric must fail on it.
function smearHorizontally(img, window) {
  const { width, height, channels, data } = img;
  const src = data.slice();
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      for (let c = 0; c < Math.min(channels, 3); c++) {
        let sum = 0;
        let n = 0;
        for (let k = 0; k < window && x + k < width; k++) {
          sum += src[(y * width + x + k) * channels + c];
          n++;
        }
        data[(y * width + x) * channels + c] = sum / n;
      }
    }
  }
}

function glyphCoverage(img, clear, tolerance, minAlpha, lumThreshold) {
  const { width, height, channels, data } = img;
  let glyph = 0;
  let sil = 0;
  for (let i = 0, p = 0; i < width * height; i++, p += channels) {
    const r = data[p];
    const g = data[p + 1];
    const b = data[p + 2];
    const a = channels === 4 ? data[p + 3] : 255;
    const diff = Math.abs(r - clear[0]) + Math.abs(g - clear[1]) + Math.abs(b - clear[2]);
    if (diff > tolerance && a >= minAlpha) {
      sil++;
      if (luminance(r, g, b) > lumThreshold) glyph++;
    }
  }
  return { glyph, silhouette: sil, coverage: sil > 0 ? glyph / sil : 0 };
}

function silhouetteMeanAbsDelta(imgA, imgB, mask) {
  const { width, height, channels } = imgA;
  let sum = 0;
  let n = 0;
  for (let i = 0, p = 0; i < width * height; i++, p += channels) {
    if (!mask[i]) continue;
    let d = 0;
    for (let c = 0; c < 3; c++) d += Math.abs(imgA.data[p + c] - imgB.data[p + c]);
    sum += d / 3;
    n++;
  }
  return n > 0 ? sum / n : 0;
}

// Blend-zone ghosting estimator. Triplanar sampling cross-fades two glyph
// sets near a 45-degree surface, which can read as faint doubled glyphs. This
// measures self-similarity of the bright glyph signal at small horizontal
// offsets (2-6 px): a clean stroke has few pixels whose twin (another bright
// pixel) sits a few columns away, whereas a ghosted copy repeats the whole
// pattern at a fixed offset so nearly every bright pixel gains a twin. The
// score is the mean per-row twin fraction, so clean views trend toward zero
// and ghosted views toward one. `lumThreshold` selects glyph pixels; `mask`
// is the head-silhouette mask.

// Status for metrics where a larger value is worse (e.g. ghosting). Pass when
// at or below the baseline times passRatio, warn up to warnRatio, else fail.
function highIsBadStatus(value, baseline, passRatio, warnRatio) {
  if (baseline == null || baseline <= 0) return { status: 'baseline-missing' };
  if (value <= baseline * passRatio) return { status: 'pass' };
  if (value <= baseline * warnRatio) return { status: 'warn' };
  return { status: 'fail' };
}
export function blendZoneGhosting(img, mask, lumThreshold) {
  const { width, height, channels, data } = img;
  const offsets = [2, 3, 4, 5, 6];
  let twinSum = 0;
  let rowsWithGlyph = 0;
  for (let y = 0; y < height; y++) {
    const bright = [];
    for (let x = 0; x < width; x++) {
      const m = y * width + x;
      if (!mask[m]) continue;
      const i = m * channels;
      if (luminance(data[i], data[i + 1], data[i + 2]) > lumThreshold) bright.push(x);
    }
    if (bright.length === 0) continue;
    rowsWithGlyph++;
    // Partition bright pixels into contiguous runs. A twin must lie in a
    // different run, so the width of a single stroke never registers as a
    // ghost copy.
    const isBright = new Uint8Array(width);
    const runId = new Int16Array(width).fill(-1);
    let run = 0;
    let start = bright[0];
    let prev = bright[0];
    for (let k = 1; k < bright.length; k++) {
      if (bright[k] === prev + 1) { prev = bright[k]; continue; }
      for (let x = start; x <= prev; x++) { isBright[x] = 1; runId[x] = run; }
      run++;
      start = bright[k];
      prev = bright[k];
    }
    for (let x = start; x <= prev; x++) { isBright[x] = 1; runId[x] = run; }
    let twins = 0;
    for (const x of bright) {
      const r = runId[x];
      let hasTwin = false;
      for (const off of offsets) {
        const right = x + off;
        const left = x - off;
        if (right < width && isBright[right] && runId[right] !== r) { hasTwin = true; break; }
        if (left >= 0 && isBright[left] && runId[left] !== r) { hasTwin = true; break; }
      }
      if (hasTwin) twins++;
    }
    twinSum += twins / bright.length;
  }
  return rowsWithGlyph > 0 ? twinSum / rowsWithGlyph : 0;
}
// Negative-control transform: duplicate every bright glyph pixel and shift the
// copy right by `offset` pixels, in place on a copy. This reproduces the
// doubled-edge signature of blend-zone ghosting from an otherwise clean view,
// so the ghosting metric must classify the result as fail.
export function duplicateAndOffset(img, offset, lumThreshold) {
  const { width, height, channels, data } = img;
  const out = Buffer.from(data);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width - offset; x++) {
      const i = (y * width + x) * channels;
      if (luminance(data[i], data[i + 1], data[i + 2]) > lumThreshold) {
        const j = (y * width + (x + offset)) * channels;
        for (let c = 0; c < Math.min(channels, 3); c++) out[j + c] = data[i + c];
      }
    }
  }
  return { width, height, channels, data: out };
}

// ---------------------------------------------------------------------------
// Status helpers
// ---------------------------------------------------------------------------
const REQUIRED_BASELINE_KEYS = [
  'glyphLegibility',
  'coverageFront',
  'coverageYawPlus',
  'coverageYawMinus',
  'flow',
  'yawLegibilityPlus',
  'yawLegibilityMinus',
  'blendZoneGhosting',
];

export function validateBaseline(payload) {
  const base = payload?.baseline;
  if (!base || typeof base !== 'object') {
    throw new Error(`baseline-missing: baseline block is absent in baseline data`);
  }
  const missing = [];
  for (const key of REQUIRED_BASELINE_KEYS) {
    const value = base[key];
    if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
      missing.push(key);
    }
  }
  if (missing.length > 0) {
    throw new Error(`baseline-missing: missing or invalid keys: ${missing.join(', ')}`);
  }
}

function isNumber(value) {
  return typeof value === 'number' && Number.isFinite(value);
}

function ratioStatus(value, baseline, passRatio, warnRatio) {
  if (!isNumber(value) || baseline == null || baseline <= 0) return { status: 'baseline-missing' };
  if (value >= baseline * passRatio) return { status: 'pass' };
  if (value >= baseline * warnRatio) return { status: 'warn' };
  return { status: 'fail' };
}

function flowStatus(value, baseline, min, warnRatio, failRatio) {
  if (!isNumber(value) || baseline == null || baseline <= 0) return { status: 'baseline-missing' };
  if (value <= min) return { status: 'fail', reason: 'no visible flow (static frame)' };
  if (value >= baseline * failRatio) return { status: 'fail', reason: 'flow exceeds strobing ceiling' };
  if (value < baseline * warnRatio) return { status: 'warn', reason: 'weak flow' };
  return { status: 'pass' };
}

function worst(...statuses) {
  if (statuses.includes('fail')) return 'fail';
  if (statuses.includes('warn')) return 'warn';
  if (statuses.includes('baseline-missing')) return 'baseline-missing';
  return 'pass';
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
function loadBaseline(path) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch (error) {
    throw new Error(`Could not read baseline.json: ${error.message}`);
  }
}

function main() {
  const OUTPUT_DIR = fileURLToPath(new URL('./out/', import.meta.url));
  const BASELINE_PATH = fileURLToPath(new URL('./baseline.json', import.meta.url));
  const REPORT_PATH = join(OUTPUT_DIR, 'report.json');
  const baseline = loadBaseline(BASELINE_PATH);
  validateBaseline(baseline);

  const cfg = baseline.silhouette ?? {};
  const clear = cfg.clearColor ?? [5, 7, 13];
  const tolerance = cfg.clearTolerance ?? 30;
  const minAlpha = cfg.minAlpha ?? 128;
  const lumThreshold = baseline.glyph?.lumThreshold ?? 120;
  const b = baseline.baseline ?? {};
  const t = baseline.thresholds ?? {};

  const files = readdirSync(OUTPUT_DIR).filter((f) => f.endsWith('.png'));
  const need = ['front.png', 'yaw-plus-0.6.png', 'yaw-minus-0.6.png', 'yaw-0.785.png', 'close-up.png', 'flow-0.png', 'flow-1.png'];
  const missing = need.filter((f) => !files.includes(f));
  if (missing.length > 0) {
    throw new Error(`Missing capture PNGs in ${OUTPUT_DIR}: ${missing.join(', ')}`);
  }

  const front = decodePng(join(OUTPUT_DIR, 'front.png'));
  const yawPlus = decodePng(join(OUTPUT_DIR, 'yaw-plus-0.6.png'));
  const yawMinus = decodePng(join(OUTPUT_DIR, 'yaw-minus-0.6.png'));
  const closeUp = decodePng(join(OUTPUT_DIR, 'close-up.png'));
  const flow0 = decodePng(join(OUTPUT_DIR, 'flow-0.png'));
  const flow1 = decodePng(join(OUTPUT_DIR, 'flow-1.png'));
  const yaw0785 = decodePng(join(OUTPUT_DIR, 'yaw-0.785.png'));
  const ghostMask = silhouetteMask(yaw0785, clear, tolerance, minAlpha).mask;

  const negativeControl = process.argv.includes('--negative-control');
  let ghostImg = yaw0785;
  if (negativeControl) {
    smearHorizontally(yawPlus, 6);
    smearHorizontally(yawMinus, 6);
    ghostImg = duplicateAndOffset(yaw0785, 4, lumThreshold);
  }

  const closeUpGrad = meanGradient(closeUp);
  const legibility = {
    value: round(closeUpGrad),
    baseline: b.glyphLegibility,
    passCutoff: b.glyphLegibility != null ? round(b.glyphLegibility * (t.glyphLegibility?.passRatio ?? 0.8)) : null,
    warnCutoff: b.glyphLegibility != null ? round(b.glyphLegibility * (t.glyphLegibility?.warnRatio ?? 0.5)) : null,
    ...ratioStatus(closeUpGrad, b.glyphLegibility, t.glyphLegibility?.passRatio ?? 0.8, t.glyphLegibility?.warnRatio ?? 0.5),
  };

  const yawLegibility = {};
  for (const [key, img, base] of [
    ['yawPlus', yawPlus, b.yawLegibilityPlus],
    ['yawMinus', yawMinus, b.yawLegibilityMinus],
  ]) {
    const mask = silhouetteMask(img, clear, tolerance, minAlpha).mask;
    const value = silhouetteMeanGradient(img, mask);
    yawLegibility[key] = {
      value: round(value),
      baseline: base,
      passCutoff: base != null ? round(base * (t.yawLegibility?.passRatio ?? 0.8)) : null,
      warnCutoff: base != null ? round(base * (t.yawLegibility?.warnRatio ?? 0.5)) : null,
      status: ratioStatus(value, base, t.yawLegibility?.passRatio ?? 0.8, t.yawLegibility?.warnRatio ?? 0.5).status,
    };
  }
  const yawLegibilityStatus = worst(yawLegibility.yawPlus.status, yawLegibility.yawMinus.status);

  const covFront = glyphCoverage(front, clear, tolerance, minAlpha, lumThreshold);
  const covYawPlus = glyphCoverage(yawPlus, clear, tolerance, minAlpha, lumThreshold);
  const covYawMinus = glyphCoverage(yawMinus, clear, tolerance, minAlpha, lumThreshold);
  const coverage = {
    front: {
      path: join(OUTPUT_DIR, 'front.png'),
      silhouettePixels: covFront.silhouette,
      glyphPixels: covFront.glyph,
      coverage: round(covFront.coverage),
      baseline: b.coverageFront,
      passCutoff: b.coverageFront != null ? round(b.coverageFront * (t.coverage?.passRatio ?? 0.8)) : null,
      warnCutoff: b.coverageFront != null ? round(b.coverageFront * (t.coverage?.warnRatio ?? 0.5)) : null,
      status: ratioStatus(covFront.coverage, b.coverageFront, t.coverage?.passRatio ?? 0.8, t.coverage?.warnRatio ?? 0.5).status,
    },
    yawPlus: {
      path: join(OUTPUT_DIR, 'yaw-plus-0.6.png'),
      silhouettePixels: covYawPlus.silhouette,
      glyphPixels: covYawPlus.glyph,
      coverage: round(covYawPlus.coverage),
      baseline: b.coverageYawPlus,
      passCutoff: b.coverageYawPlus != null ? round(b.coverageYawPlus * (t.coverage?.passRatio ?? 0.8)) : null,
      warnCutoff: b.coverageYawPlus != null ? round(b.coverageYawPlus * (t.coverage?.warnRatio ?? 0.5)) : null,
      status: ratioStatus(covYawPlus.coverage, b.coverageYawPlus, t.coverage?.passRatio ?? 0.8, t.coverage?.warnRatio ?? 0.5).status,
    },
    yawMinus: {
      path: join(OUTPUT_DIR, 'yaw-minus-0.6.png'),
      silhouettePixels: covYawMinus.silhouette,
      glyphPixels: covYawMinus.glyph,
      coverage: round(covYawMinus.coverage),
      baseline: b.coverageYawMinus,
      passCutoff: b.coverageYawMinus != null ? round(b.coverageYawMinus * (t.coverage?.passRatio ?? 0.8)) : null,
      warnCutoff: b.coverageYawMinus != null ? round(b.coverageYawMinus * (t.coverage?.warnRatio ?? 0.5)) : null,
      status: ratioStatus(covYawMinus.coverage, b.coverageYawMinus, t.coverage?.passRatio ?? 0.8, t.coverage?.warnRatio ?? 0.5).status,
    },
  };
  const coverageStatus = worst(coverage.front.status, coverage.yawPlus.status, coverage.yawMinus.status);

  const flowMask = silhouetteMask(flow0, clear, tolerance, minAlpha).mask;
  const flowValue = silhouetteMeanAbsDelta(flow0, flow1, flowMask);
  const flow = {
    value: round(flowValue),
    baseline: b.flow,
    min: t.flow?.min ?? 0.0001,
    ceiling: b.flow != null ? round(b.flow * (t.flow?.failRatio ?? 3.0)) : null,
    ...flowStatus(flowValue, b.flow, t.flow?.min ?? 0.0001, t.flow?.warnRatio ?? 0.3, t.flow?.failRatio ?? 3.0),
  };
  const gt = t.blendZoneGhosting ?? {};
  const ghostValue = blendZoneGhosting(ghostImg, ghostMask, lumThreshold);
  const ghosting = {
    value: round(ghostValue),
    path: join(OUTPUT_DIR, 'yaw-0.785.png'),
    baseline: b.blendZoneGhosting,
    passCutoff: b.blendZoneGhosting != null ? round(b.blendZoneGhosting * (gt.passRatio ?? 1.5)) : null,
    warnCutoff: b.blendZoneGhosting != null ? round(b.blendZoneGhosting * (gt.warnRatio ?? 2.0)) : null,
    ...highIsBadStatus(ghostValue, b.blendZoneGhosting, gt.passRatio ?? 1.5, gt.warnRatio ?? 2.0),
  };

  const notes = [];
  notes.push('Eye-occlusion metric skipped: measuring bright sphere clusters outside the face region proved too fragile (see README).');
  notes.push(`Side views use a true camera orbit of +/-${baseline.viewYawRad} rad around the head origin (renderer camera initial position (0, 0.05, 2.4)), not head rotation, so the requested yaw angle is honoured without changing src/.`);
  notes.push('A 45-degree (yaw 0.785 rad) camera-orbit view isolates the triplanar blend zone; the blend-zone ghosting metric scores doubled-edge energy there (higher is worse).');

  const overall = worst(legibility.status, yawLegibilityStatus, coverageStatus, flow.status, ghosting.status);
  const report = {
    generatedAt: new Date().toISOString(),
    baselinePath: BASELINE_PATH,
    notes,
    metrics: {
      glyphLegibility: legibility,
      yawLegibility,
      coverage,
      flow,
      blendZoneGhosting: ghosting,
      eyeOcclusion: { status: 'skipped', reason: 'fragile; documented in README' },
    },
    overall,
  };

  const reportPath = negativeControl ? join(OUTPUT_DIR, 'report-negative-control.json') : REPORT_PATH;
  writeFileSync(reportPath, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));

  if (negativeControl) {
    const controlStatuses = [yawLegibility.yawPlus.status, yawLegibility.yawMinus.status, ghosting.status];
    if (!controlStatuses.every((s) => s === 'fail')) {
      throw new Error(
        `Negative control FAILED to fail: views scored [${controlStatuses.join(', ')}]; yaw smear and 45-degree duplicate must all be fail. Harness is not protective.`,
      );
    }
    console.log('Negative control OK: smeared yaw views and duplicated 45-degree view all score fail.');
    return;
  }

  if (overall === 'fail' || overall === 'baseline-missing') {
    throw new Error('Eval report contains at least one failing metric.');
  }
}

function round(value) {
  return Math.round(value * 1000) / 1000;
}

if (import.meta.main) main();
