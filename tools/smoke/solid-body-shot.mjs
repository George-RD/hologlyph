/**
 * Solid-body glass smoke shot (dec.liquid-glass-architecture, item 1).
 *
 * Captures the engine demo head at one or more `skin.glass.amount` settings
 * with the pose pinned, and optionally diffs each capture against the same
 * capture taken on another branch. Two acceptance claims lean on this:
 *
 *   - at amount 1 the interior wall and Beer-Lambert absorption visibly give
 *     the head body, so coverage and luminance move;
 *   - at amount 0 the render is identical to the same capture taken before
 *     this change, so the approved dark-page look is untouched.
 *
 * Pinning matters. `setMotionFrozen` holds whatever pose idle motion had
 * reached, idle phases off wall-clock time, and any change to load-time work
 * (the thickness raycast costs about 70 ms) leaves the head a couple of
 * milliradians away. Glyphs are welded to the bind pose, so that slides every
 * one of them a pixel or two and reads as a 5% pixel difference that is not
 * there. So the bones and every morph influence array are zeroed first.
 *
 * Usage: `bun run dev`, then on each branch
 *   bun tools/smoke/solid-body-shot.mjs --out DIR [--amounts 1,0]
 * and to compare
 *   bun tools/smoke/solid-body-shot.mjs --out DIR --baseline OTHER_DIR
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { decodePng, luminance, silhouetteMask } from '../evals/score.mjs';

const args = process.argv.slice(2);
const readArg = (flag, fallback) => {
  const at = args.indexOf(flag);
  return at >= 0 && args[at + 1] !== undefined ? args[at + 1] : fallback;
};

const URL_TARGET = readArg('--url', 'http://localhost:5173/hologlyph/engine.html');
const OUT = readArg('--out', fileURLToPath(new URL('./out/', import.meta.url)));
const BASELINE = readArg('--baseline', null);
const AMOUNTS = readArg('--amounts', '1,0').split(',').map(Number);
/**
 * Morphs to drive after pinning, as `name=value,name=value`. Use it to prove
 * the internals still resolve through an open aperture: the mouth cavity only
 * becomes visible at `jaw_open=1`, and the eyes disappear at `exp_blink=1`.
 *
 * Parsed strictly, because `LoadedAvatar.setMorph` degrades an unknown name to
 * a no-op: a typo would otherwise capture a neutral head while the caller
 * believed it had captured an open mouth.
 */
const MORPHS = readArg('--morph', '')
  .split(',')
  .filter(Boolean)
  .map((pair) => {
    const [name, raw] = pair.split('=');
    const value = Number(raw ?? 1);
    if (!name || !Number.isFinite(value) || value < 0 || value > 1) {
      throw new Error(`--morph expects name=value with value in [0,1], got "${pair}"`);
    }
    return [name, value];
  })
  .sort(([a], [b]) => a.localeCompare(b));
/** The pose is part of the capture identity, never just a caller-chosen tag. */
const POSE = MORPHS.map(([name, value]) => `${name}-${value}`).join('_') || 'neutral';
const ORBIT = Number(readArg('--orbit', '0'));
if (!Number.isFinite(ORBIT)) throw new Error('--orbit expects a number of radians');
// The view is part of the identity too, or an orbited run silently overwrites
// the head-on one and a baseline comparison lines up mismatched cameras.
const TAG = readArg('--tag', ORBIT === 0 ? POSE : `${POSE}-orbit-${ORBIT}`);
const CHROME = process.env.HOLOGLYPH_CHROME;
/** The demo page background, so the silhouette is everything that differs. */
const CLEAR = [5, 7, 13];

mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({
  ...(CHROME ? { executablePath: CHROME } : {}),
  args: ['--no-sandbox', ...(process.platform === 'darwin' ? ['--use-angle=metal'] : [])],
});
const page = await browser.newPage({ viewport: { width: 1100, height: 800 }, deviceScaleFactor: 1 });
// Reduced motion also stops the text-skin row flow, so the glyph grid phase
// cannot drift between captures.
await page.emulateMedia({ reducedMotion: 'reduce' });
page.on('pageerror', (error) => console.error(`[pageerror] ${error.message}`));
page.on('console', (m) => {
  if (m.type() === 'error') console.error(`[console] ${m.text().slice(0, 240)}`);
});

// The deterministic RNG the visual eval installs, so idle gaze cannot wander.
await page.addInitScript(() => {
  let state = 0x6d2b79f5;
  Math.random = () => {
    state |= 0;
    state = (state + 0x6d2b79f5) | 0;
    let value = Math.imul(state ^ (state >>> 15), 1 | state);
    value ^= value + Math.imul(value ^ (value >>> 7), 61 | value);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
});

await page.goto(URL_TARGET, { waitUntil: 'load' });
await page.waitForFunction(() => document.querySelector('#holo')?.getBoundingClientRect().width > 0, null, {
  timeout: 30_000,
});
await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
await page.waitForFunction(() => document.getElementById('state')?.textContent === 'state: idle', null, {
  timeout: 30_000,
});
await page.waitForTimeout(4000);

const pinned = await page.evaluate(() => {
  const engine = window.__hologlyphEngine;
  engine.setMotionFrozen(true);
  for (const bone of Object.values(engine.avatar.bones)) bone?.quaternion.set(0, 0, 0, 1);
  // Every morph-bearing primitive, not just the first: the shipped bust puts
  // jaw and blink deltas on the mouth interior and the eye trim too, and a
  // stale influence there moves exactly the internals under review.
  let arrays = 0;
  let residual = 0;
  for (const mesh of engine.avatar.morphMeshes) {
    const influences = mesh.morphTargetInfluences;
    if (!influences) continue;
    influences.fill(0);
    arrays++;
    for (const value of influences) residual += Math.abs(value);
  }
  return { arrays, residual };
});
if (pinned.residual !== 0) throw new Error(`morph influences not pinned: ${pinned.residual}`);
console.log(`pinned bones and ${pinned.arrays} morph influence array(s)`);

if (MORPHS.length > 0) {
  const applied = await page.evaluate((pairs) => {
    const engine = window.__hologlyphEngine;
    const seen = {};
    for (const [name, value] of pairs) {
      engine.avatar.setMorph(name, value);
      seen[name] = {
        value: engine.avatar.getMorph(name),
        // `setMorph` degrades an unknown name to a no-op and `getMorph` then
        // reads back 0, which looks correct for a requested 0. So ask the rig
        // whether it knows the name at all.
        known: engine.avatar.morphMeshes.some(
          (mesh) => mesh.morphTargetDictionary && name in mesh.morphTargetDictionary,
        ),
      };
    }
    return seen;
  }, MORPHS);
  for (const [name, value] of MORPHS) {
    const seen = applied[name];
    if (!seen?.known) {
      throw new Error(`morph "${name}" is not in this rig, so the capture would be neutral`);
    }
    if (Math.abs(seen.value - value) > 1e-6) {
      throw new Error(`morph "${name}" did not take: asked ${value}, rig reports ${seen.value}`);
    }
  }
  console.log(`driving ${MORPHS.map(([n, v]) => `${n}=${v}`).join(' ')}`);
  await page.waitForTimeout(600);
}

if (ORBIT !== 0) {
  // Same camera orbit the visual eval uses: the motion API clamps head yaw, so
  // a true rotated view comes from moving the camera, not the head.
  await page.evaluate((yaw) => {
    const camera = window.__hologlyphEngine.sysRenderer.camera;
    const radius = 2.4;
    camera.position.set(radius * Math.sin(yaw), 0.05, radius * Math.cos(yaw));
    camera.lookAt(0, 0, 0);
  }, ORBIT);
  console.log(`orbited camera to ${ORBIT} rad`);
  await page.waitForTimeout(600);
}
await page.waitForTimeout(800);

function measure(path) {
  const image = decodePng(path);
  const { mask, count } = silhouetteMask(image, CLEAR, 24, 8);
  const { channels, data } = image;
  let lum = 0;
  for (let i = 0; i < mask.length; i++) {
    if (!mask[i]) continue;
    lum += luminance(data[i * channels], data[i * channels + 1], data[i * channels + 2]);
  }
  return { image, silhouette: count, meanLuma: count ? lum / count : 0 };
}

/**
 * Compare two captures of the same viewport.
 *
 * `exact` is the acceptance instrument: any channel differing at all counts,
 * so a chroma-only shift cannot hide. The luminance figures beside it describe
 * how big a real difference is, and ignore deltas of 3 or less because the GPU
 * dithers the gradient backdrop between runs.
 */
function compare(a, b) {
  if (a.width !== b.width || a.height !== b.height || a.channels !== b.channels) {
    throw new Error(
      `capture shape mismatch: ${a.width}x${a.height}x${a.channels} vs ${b.width}x${b.height}x${b.channels}`,
    );
  }
  const ch = a.channels;
  let exact = 0;
  let changed = 0;
  let signed = 0;
  let absolute = 0;
  let peak = 0;
  for (let i = 0; i < a.width * a.height; i++) {
    let differs = false;
    for (let k = 0; k < ch; k++) {
      if (a.data[i * ch + k] !== b.data[i * ch + k]) differs = true;
    }
    if (differs) exact++;
    const la = luminance(a.data[i * ch], a.data[i * ch + 1], a.data[i * ch + 2]);
    const lb = luminance(b.data[i * ch], b.data[i * ch + 1], b.data[i * ch + 2]);
    const d = la - lb;
    if (Math.abs(d) <= 3) continue;
    changed++;
    signed += d;
    absolute += Math.abs(d);
    if (Math.abs(d) > peak) peak = Math.abs(d);
  }
  return {
    exact,
    changed,
    pct: (changed / (a.width * a.height)) * 100,
    meanSigned: signed / (changed || 1),
    meanAbs: absolute / (changed || 1),
    peak,
  };
}

const manifest = {
  url: URL_TARGET,
  pose: POSE,
  orbit: ORBIT,
  baseline: BASELINE,
  capturedAt: new Date().toISOString(),
  captures: [],
};

for (const amount of AMOUNTS) {
  await page.evaluate((value) => {
    window.__hologlyphEngine.vfx.setHeadConfig({ skin: { glass: { amount: value } } });
  }, amount);
  await page.waitForTimeout(900);

  const name = `solid-body-${TAG}-amount-${amount}.png`;
  const path = join(OUT, name);
  await page.locator('#holo').screenshot({ path });

  const { image, silhouette, meanLuma } = measure(path);
  const hash = createHash('sha256').update(image.data).digest('hex');
  console.log(
    `amount=${amount}`,
    `pose=${POSE}`,
    `px=${image.width}x${image.height}`,
    `silhouette=${silhouette}`,
    `meanLuma=${meanLuma.toFixed(3)}`,
    `sha256=${hash.slice(0, 16)}`,
  );
  const record = { name, amount, silhouette, meanLuma, sha256: hash };
  manifest.captures.push(record);

  if (!BASELINE) continue;
  const reference = join(BASELINE, name);
  if (!existsSync(reference)) {
    // Fatal, not a warning: a silently skipped comparison is exactly how an
    // unproven acceptance claim gets written down as proven.
    throw new Error(`baseline requested but missing: ${reference}`);
  }
  const delta = compare(decodePng(reference), image);
  record.delta = delta;
  console.log(
    `  vs baseline: exactPixelsDiffering=${delta.exact}`,
    `luminanceChanged=${delta.changed} (${delta.pct.toFixed(3)}%)`,
    `meanSigned=${delta.meanSigned.toFixed(2)}`,
    `meanAbs=${delta.meanAbs.toFixed(2)}`,
    `peak=${delta.peak.toFixed(1)}`,
  );
}

const manifestPath = join(OUT, `solid-body-${TAG}.json`);
writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`manifest ${manifestPath}`);

console.log(`captures in ${OUT}`);
await browser.close();
