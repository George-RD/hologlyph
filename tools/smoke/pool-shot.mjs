/**
 * Tier 1 pool smoke shot (dec.liquid-glass-architecture, item 3).
 *
 * Three claims, all of which have to be measured rather than eyeballed:
 *
 * 1. Inertness. At `pool.amount = 0` the page must be pixel-identical to a
 *    page where the pool was never switched on, so the owner-approved look is
 *    reproduced exactly. A noise floor is established first by capturing the
 *    same state twice on the same code; the acceptance comparison is only
 *    meaningful against that floor.
 * 2. Morphs survive the breathe. `NodeMaterial.setupPosition` assigns
 *    `positionNode` over `positionLocal` after morph targets and skinning, so
 *    a displacement written from the raw attributes would silently discard
 *    every viseme. With the breathe at its maximum, driving `jaw_open` must
 *    still move pixels.
 * 3. Cost. The tier 1 budget is about 1 ms of added GPU time. rAF deltas are
 *    vsync-clamped at about 16.7 ms and would read the same with the pool on
 *    or off, so this leg runs against a real Chrome with `--disable-gpu-vsync`
 *    and `--disable-frame-rate-limit`, the same way the backdrop-clip spike
 *    had to.
 *
 * Usage (dev server must be running):
 *   bun tools/smoke/pool-shot.mjs
 *   bun tools/smoke/pool-shot.mjs --cost      # adds the vsync-free cost leg
 *
 * `--cost` needs a real Chrome and opens a window; set HOLOGLYPH_CHROME to
 * override the path.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { decodePng, luminance, silhouetteMask } from '../evals/score.mjs';

const args = process.argv.slice(2);
const readArg = (flag, fallback) => {
  const i = args.indexOf(flag);
  return i >= 0 && args[i + 1] !== undefined ? args[i + 1] : fallback;
};
const hasFlag = (flag) => args.includes(flag);

const URL_TARGET = readArg('--url', 'http://localhost:5173/hologlyph/pool-lab.html');
const OUT = readArg('--out', fileURLToPath(new URL('./out/', import.meta.url)));
const COST = hasFlag('--cost');
const CHROME =
  process.env.HOLOGLYPH_CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
/** The lab page background, so the silhouette is everything that differs. */
const CLEAR = [5, 7, 13];
/**
 * Lower bound on the head's silhouette at this viewport with the pool off.
 * The shipped bust measures 103180 px here; a shading-normal NaN took the
 * equivalent eval capture to about a fifteenth of its healthy count. The floor
 * sits at roughly 40 per cent of the measured value, because it is a canary
 * for total collapse and not a pixel-accuracy metric.
 */
const SILHOUETTE_FLOOR = 40_000;

mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch();
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
  let seed = 0x2f6e2b1;
  Math.random = () => {
    seed ^= seed << 13;
    seed ^= seed >>> 17;
    seed ^= seed << 5;
    return ((seed >>> 0) % 1_000_000) / 1_000_000;
  };
});

await page.goto(URL_TARGET, { waitUntil: 'load' });
await page.waitForFunction(() => !!window.__hologlyphEngine?.avatar, null, { timeout: 30_000 });
await page.waitForTimeout(3000);

/**
 * Pin the pose. Every bone quaternion and every morph influence array, not
 * just the first: the shipped bust puts jaw and blink deltas on the mouth
 * interior and the eye trim too, and a stale influence there moves exactly the
 * region under review.
 */
async function pinPose() {
  const pinned = await page.evaluate(() => {
    const engine = window.__hologlyphEngine;
    engine.setMotionFrozen(true);
    for (const bone of Object.values(engine.avatar.bones)) bone?.quaternion.set(0, 0, 0, 1);
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
}

async function setPool(overrides) {
  await page.evaluate((next) => {
    window.__hologlyphEngine.vfx.setHeadConfig({ pool: next });
  }, overrides);
  await page.waitForTimeout(700);
}

async function setMorph(name, value) {
  const applied = await page.evaluate(
    ([n, v]) => {
      const engine = window.__hologlyphEngine;
      engine.avatar.setMorph(n, v);
      return {
        value: engine.avatar.getMorph(n),
        // `setMorph` degrades an unknown name to a no-op and `getMorph` then
        // reads back 0, which looks correct for a requested 0. So ask the rig
        // whether it knows the name at all.
        known: engine.avatar.morphMeshes.some(
          (mesh) => mesh.morphTargetDictionary && n in mesh.morphTargetDictionary,
        ),
      };
    },
    [name, value],
  );
  if (!applied.known) throw new Error(`morph "${name}" is not in this rig`);
  if (Math.abs(applied.value - value) > 1e-6) {
    throw new Error(`morph "${name}" did not take: asked ${value}, rig reports ${applied.value}`);
  }
  await page.waitForTimeout(600);
}

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
    throw new Error('capture shape mismatch');
  }
  const px = a.width * a.height;
  let exact = 0;
  let over3 = 0;
  let maxLuma = 0;
  for (let i = 0; i < px; i++) {
    const ai = i * a.channels;
    const bi = i * b.channels;
    let differs = false;
    for (let c = 0; c < 3; c++) {
      if (a.data[ai + c] !== b.data[bi + c]) differs = true;
    }
    if (!differs) continue;
    exact++;
    const dl = Math.abs(
      luminance(a.data[ai], a.data[ai + 1], a.data[ai + 2]) -
        luminance(b.data[bi], b.data[bi + 1], b.data[bi + 2]),
    );
    if (dl > 3) over3++;
    if (dl > maxLuma) maxLuma = dl;
  }
  return { pixels: px, exact, over3, maxLuma };
}

async function shoot(tag) {
  const path = join(OUT, `pool-${tag}.png`);
  await page.screenshot({ path });
  return { path, ...measure(path) };
}

const manifest = { url: URL_TARGET, capturedAt: new Date().toISOString(), legs: {} };

// --- leg 0: the head is actually on screen ---------------------------------
// This guard exists because its absence cost a debugging session. The
// inertness leg below compares two states of the SAME build, so a change that
// breaks the shell in both states reads as a perfect 0 pixel difference. A
// NaN in the shading normal did exactly that: it collapsed the silhouette by
// 93 per cent and the inertness leg still reported inert. Cross-build
// regressions are `bun run eval`'s job; this floor is the cheap local canary.
await pinPose();
await setPool({ amount: 0 });
const canary = await shoot('canary');
manifest.legs.silhouette = { pixels: canary.silhouette, floor: SILHOUETTE_FLOOR };
console.log(`silhouette at amount 0: ${canary.silhouette} px (floor ${SILHOUETTE_FLOOR})`);
if (canary.silhouette < SILHOUETTE_FLOOR) {
  throw new Error(
    `the head is barely rendering: ${canary.silhouette} px against a floor of ${SILHOUETTE_FLOOR}. ` +
      'Something in the skin material graph is producing NaN, not something in the pool.',
  );
}

// --- leg 1: inertness ------------------------------------------------------
// The lab boots with the pool on, so the "never enabled" baseline is taken
// after a reload with the amount forced to 0 before the first frame renders.
const floorA = await shoot('off-a');
const floorB = await shoot('off-b');
const floor = compare(floorA.image, floorB.image);
console.log(`noise floor: ${floor.exact} px differ, max luma ${floor.maxLuma.toFixed(2)}`);

await setPool({ amount: 1 });
const on = await shoot('on');
await setPool({ amount: 0 });
const backOff = await shoot('off-c');
const inert = compare(floorA.image, backOff.image);
const active = compare(floorA.image, on.image);

manifest.legs.inertness = { floor, inert, active };
console.log(
  `pool on changes ${((active.exact / active.pixels) * 100).toFixed(2)}% of pixels; ` +
    `back at 0 it changes ${inert.exact} px (floor ${floor.exact})`,
);
if (active.exact <= floor.exact) {
  throw new Error('pool at amount 1 changed nothing: the capture is not exercising the feature');
}
if (inert.exact > floor.exact) {
  throw new Error(
    `pool is not inert at amount 0: ${inert.exact} px differ against a floor of ${floor.exact}`,
  );
}

// --- leg 2: morphs survive the breathe -------------------------------------
await setPool({ amount: 1, breathe: 0.03 });
const jawShut = await shoot('breathe-jaw-shut');
await setMorph('jaw_open', 1);
const jawOpen = await shoot('breathe-jaw-open');
await setMorph('jaw_open', 0);
const jaw = compare(jawShut.image, jawOpen.image);
manifest.legs.morphs = jaw;
console.log(`jaw_open under maximum breathe moves ${jaw.exact} px, max luma ${jaw.maxLuma.toFixed(2)}`);
if (jaw.exact === 0) {
  throw new Error(
    'jaw_open changed nothing with the breathe on: the position node discarded the morph stack',
  );
}

await setPool({ amount: 0, breathe: 0.006 });
await browser.close();

// --- leg 3: cost -----------------------------------------------------------
if (COST) {
  const real = await chromium.launch({
    executablePath: CHROME,
    headless: false,
    args: ['--enable-gpu', '--disable-gpu-vsync', '--disable-frame-rate-limit'],
  });
  const costPage = await real.newPage({ viewport: { width: 1100, height: 800 } });
  await costPage.goto(URL_TARGET, { waitUntil: 'load' });
  await costPage.waitForFunction(() => !!window.__hologlyphEngine?.avatar, null, { timeout: 30_000 });
  await costPage.waitForTimeout(2500);

  /** Mean frame interval over `frames` uncapped frames. */
  const sample = async (amount, frames = 600) => {
    await costPage.evaluate((a) => {
      window.__hologlyphEngine.vfx.setHeadConfig({ pool: { amount: a } });
    }, amount);
    await costPage.waitForTimeout(800);
    return await costPage.evaluate(
      (n) =>
        new Promise((resolve) => {
          const deltas = [];
          let last = 0;
          const tick = (now) => {
            if (last) deltas.push(now - last);
            last = now;
            if (deltas.length >= n) {
              deltas.sort((x, y) => x - y);
              resolve({
                mean: deltas.reduce((a, b) => a + b, 0) / deltas.length,
                median: deltas[Math.floor(deltas.length / 2)],
                p95: deltas[Math.floor(deltas.length * 0.95)],
                n: deltas.length,
              });
            } else {
              requestAnimationFrame(tick);
            }
          };
          requestAnimationFrame(tick);
        }),
      frames,
    );
  };

  const off = await sample(0);
  const onCost = await sample(1);
  manifest.legs.cost = { off, on: onCost, addedMeanMs: onCost.mean - off.mean };
  console.log(
    `uncapped frame cost: off ${off.median.toFixed(3)} ms median, on ${onCost.median.toFixed(3)} ms, ` +
      `added mean ${(onCost.mean - off.mean).toFixed(3)} ms`,
  );
  await real.close();
}

const manifestPath = join(OUT, 'pool-shot.json');
writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`manifest ${manifestPath}`);
console.log(`captures in ${OUT}`);
