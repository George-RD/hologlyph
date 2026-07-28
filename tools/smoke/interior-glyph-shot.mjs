/**
 * Interior glyph field smoke shot (dec.liquid-glass-architecture, item 10).
 *
 * Four claims, all measured rather than eyeballed:
 *
 * 1. Inertness. At `interior.count = 0` the page must be pixel-identical to a
 *    page where the field was never switched on. A noise floor is established
 *    first by capturing the same state twice on the same code; the acceptance
 *    comparison only means anything against that floor.
 * 2. Engagement. At a working count the field must change a substantial number
 *    of pixels INSIDE the silhouette, and none outside it. A capture that
 *    changes nothing is not proving inertness, it is proving the feature never
 *    ran, which is the trap `demo/LAB-STATUS.md` records from the tier 1 pool.
 * 3. Lag. A step in head yaw must leave the field behind and then let it
 *    settle. Measured on the field's own centroid rather than on pixels: the
 *    claim is about where the glyphs are, and the settled reference has to be
 *    the pose AFTER the step, because the rest positions are carried by the
 *    head frame and move with it.
 * 4. Reduced motion removes the lag and damps the drift, without removing the
 *    field. Run in its own page, with the preference emulated before the first
 *    frame, because the engine reads it at mount.
 *
 * Determinism: this page does NOT emulate reduced motion for legs 1 to 3, so
 * the pose is pinned by hand instead. `__interiorLab.pinPose()` freezes
 * procedural motion, zeroes both text-skin scroll speeds (the row flow is a
 * GPU UV scroll that never stops, and two captures of an untouched page would
 * otherwise differ by the whole glyph grid), and clears every bone rotation
 * and morph influence.
 *
 * Usage (dev server must be running):
 *   bun tools/smoke/interior-glyph-shot.mjs
 *   bun tools/smoke/interior-glyph-shot.mjs --cost   # vsync-free cost leg
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

const URL_TARGET = readArg('--url', 'http://localhost:5173/hologlyph/interior-glyph-lab.html');
const OUT = readArg('--out', fileURLToPath(new URL('./out/', import.meta.url)));
const COST = hasFlag('--cost');
const CHROME =
  process.env.HOLOGLYPH_CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
/** The lab page background, so the silhouette is everything that differs. */
const CLEAR = [5, 7, 13];
/** Lower bound on the head's silhouette at this viewport with the field off. */
const SILHOUETTE_FLOOR = 150_000;
/** Working count for the legs that need the field visible. */
const LIVE_COUNT = 240;
/** Yaw step, radians, that the field has to chase. */
const YAW_STEP = 0.7;
/** Sampling interval for the settle poll, milliseconds. */
const SETTLE_WINDOW_MS = 500;
/**
 * Movement below which the field counts as settled, world units per window.
 * Tied to what is visible rather than to the step: it is one per cent of the
 * 0.02 sprite half-size these legs run at, so a glyph moving this slowly is
 * moving well under a pixel.
 */
const SETTLE_TOLERANCE = 2e-4;
/** Give up on the settle poll after this long. */
const SETTLE_TIMEOUT_MS = 60_000;

mkdirSync(OUT, { recursive: true });

const manifest = { url: URL_TARGET, capturedAt: new Date().toISOString(), legs: {} };

const browser = await chromium.launch();

/** Open the lab, wait for the avatar, pin everything that moves by itself. */
async function openLab(context) {
  const page = await context.newPage({
    viewport: { width: 1100, height: 800 },
    deviceScaleFactor: 1,
  });
  page.on('pageerror', (error) => {
    throw new Error(`page error: ${error.message}`);
  });
  page.on('console', (m) => {
    if (m.type() === 'error') console.error(`[console] ${m.text().slice(0, 240)}`);
  });
  // The deterministic RNG the visual eval installs, so idle gaze cannot wander
  // before the pose is pinned.
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
  await page.waitForTimeout(2500);
  const pinned = await page.evaluate(() => {
    document.getElementById('panel').style.display = 'none';
    return window.__interiorLab.pinPose();
  });
  if (!pinned) throw new Error('pinPose found no avatar');
  await page.waitForTimeout(600);
  return page;
}

async function setInterior(page, next) {
  await page.evaluate((cfg) => window.__interiorLab.setInterior(cfg), next);
  await page.waitForTimeout(700);
}

/** Mean of the field's front-left quad corners: where the glyphs actually are. */
async function centroid(page) {
  return await page.evaluate(() => {
    const field = window.__hologlyphEngine.interiorGlyphs;
    if (!field) return null;
    const geometry = field.object.geometry;
    const p = geometry.attributes.position.array;
    const n = geometry.drawRange.count / 6;
    if (n === 0) return null;
    let x = 0;
    let y = 0;
    let z = 0;
    for (let i = 0; i < n; i++) {
      x += p[i * 12];
      y += p[i * 12 + 1];
      z += p[i * 12 + 2];
    }
    return [x / n, y / n, z / n];
  });
}

const distance = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

/**
 * Wait until the field stops moving, and report how long that took.
 *
 * Two consecutive samples `SETTLE_WINDOW_MS` apart that differ by less than
 * `SETTLE_TOLERANCE` count as settled. That is a direct measurement of the
 * claim, and unlike a fixed sleep it does not silently become a measurement
 * of the host's frame rate.
 */
async function settleField(page) {
  const started = Date.now();
  let previous = await centroid(page);
  while (Date.now() - started < SETTLE_TIMEOUT_MS) {
    await page.waitForTimeout(SETTLE_WINDOW_MS);
    const current = await centroid(page);
    if (distance(previous, current) < SETTLE_TOLERANCE) {
      return { position: current, seconds: (Date.now() - started) / 1000 };
    }
    previous = current;
  }
  throw new Error(`the field never settled within ${SETTLE_TIMEOUT_MS / 1000} s`);
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
  return { image, mask, silhouette: count, meanLuma: count ? lum / count : 0 };
}

/**
 * Compare two captures of the same viewport, split by a silhouette mask.
 *
 * `exact` is the acceptance instrument: any channel differing at all counts,
 * so a chroma-only shift cannot hide. Splitting inside from outside is what
 * makes the engagement leg a claim about the HEAD rather than about the page.
 */
function compare(a, b, mask) {
  if (a.width !== b.width || a.height !== b.height || a.channels !== b.channels) {
    throw new Error('capture shape mismatch');
  }
  const px = a.width * a.height;
  let exact = 0;
  let inside = 0;
  let outside = 0;
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
    if (mask?.[i]) inside++;
    else outside++;
    const dl = Math.abs(
      luminance(a.data[ai], a.data[ai + 1], a.data[ai + 2]) -
        luminance(b.data[bi], b.data[bi + 1], b.data[bi + 2]),
    );
    if (dl > maxLuma) maxLuma = dl;
  }
  return { pixels: px, exact, inside, outside, maxLuma };
}

async function shoot(page, tag) {
  const path = join(OUT, `interior-${tag}.png`);
  await page.screenshot({ path });
  return { path, ...measure(path) };
}

// ---------------------------------------------------------------------------
// Legs 0 to 3: default motion preference.
// ---------------------------------------------------------------------------
const page = await openLab(browser);

// --- leg 0: the head is actually on screen ---------------------------------
// The inertness leg compares two states of the SAME build, so a change that
// breaks the shell in both states reads as a perfect 0 pixel difference. This
// floor is the cheap local canary against that.
await setInterior(page, { count: 0 });
const canary = await shoot(page, 'canary');
manifest.legs.silhouette = { pixels: canary.silhouette, floor: SILHOUETTE_FLOOR };
console.log(`silhouette at count 0: ${canary.silhouette} px (floor ${SILHOUETTE_FLOOR})`);
if (canary.silhouette < SILHOUETTE_FLOOR) {
  throw new Error(
    `the head is not on screen: ${canary.silhouette} px against a floor of ${SILHOUETTE_FLOOR}`,
  );
}

// --- leg 1: noise floor -----------------------------------------------------
const floorA = await shoot(page, 'off-a');
const floorB = await shoot(page, 'off-b');
const floor = compare(floorA.image, floorB.image, floorA.mask);
console.log(`noise floor: ${floor.exact} px differ, max luma ${floor.maxLuma.toFixed(2)}`);

// --- leg 2: engagement and inertness ---------------------------------------
await setInterior(page, { count: LIVE_COUNT, size: 0.02, drift: 0, inertia: 0 });
const on = await shoot(page, 'on');
await setInterior(page, { count: 0 });
const backOff = await shoot(page, 'off-c');
const active = compare(floorA.image, on.image, floorA.mask);
const inert = compare(floorA.image, backOff.image, floorA.mask);
manifest.legs.engagement = { floor, active, inert };
console.log(
  `field on changes ${active.exact} px (${active.inside} inside the silhouette, ` +
    `${active.outside} outside); back at 0 it changes ${inert.exact} px`,
);
if (active.inside <= floor.exact * 4) {
  throw new Error('the field changed almost nothing: the capture is not exercising it');
}
if (active.outside > floor.outside + 200) {
  throw new Error(
    `the field painted ${active.outside} px outside the silhouette: it is escaping the head`,
  );
}
if (inert.exact > floor.exact) {
  throw new Error(
    `count 0 is not inert: ${inert.exact} px differ against a noise floor of ${floor.exact}`,
  );
}

// --- leg 3: lag and settle --------------------------------------------------
// Drift off, so the only thing moving the glyphs is the head. The settled
// reference is taken AFTER the step: the rest positions are carried by the
// head frame, so a settled field is not back where it started.
await setInterior(page, { count: LIVE_COUNT, size: 0.02, drift: 0, inertia: 0.9 });
await page.waitForTimeout(2500);
const preStep = await centroid(page);

await page.evaluate((yaw) => window.__interiorLab.setYaw(yaw), YAW_STEP);
await page.waitForTimeout(60);
const immediate = await centroid(page);

// Polled, not a fixed wait. `interiorIntegrate` clamps `dt` to
// `INTERIOR_MAX_STEP`, so below 20 fps the simulation advances slower than the
// wall clock, and a headless page rendering this scene through software GL
// runs well below that. A fixed sleep therefore measures the host's frame
// rate as much as the spring, and it made this leg fail on a slow run and
// pass on a fast one.
const settled = await settleField(page);
const settledA = settled.position;
await page.waitForTimeout(SETTLE_WINDOW_MS * 2);
const settledB = await centroid(page);

const travel = distance(preStep, settledA);
const lag = distance(immediate, settledA);
const residual = distance(settledA, settledB);
manifest.legs.lag = {
  travel,
  lag,
  residual,
  settleSeconds: settled.seconds,
  preStep,
  immediate,
  settledA,
  settledB,
};
console.log(
  `yaw step moves the field ${travel.toFixed(5)} units; 60 ms in it is still ` +
    `${lag.toFixed(5)} behind, and it settles after ${settled.seconds.toFixed(1)} s ` +
    `and then holds to ${residual.toFixed(5)}`,
);
// Comfortably above the settle tolerance, or "settled" and "moved" would be
// the same measurement and the whole leg would be vacuous.
if (travel < SETTLE_TOLERANCE * 20) {
  throw new Error(
    `the head yaw moved the field only ${travel.toFixed(5)}: the lag leg is not exercising it`,
  );
}
if (lag < travel * 0.5) throw new Error('the field kept up with the head: there is no lag to see');
// Settling once could be a stall; it has to STAY settled. Sampled over two
// windows, so the budget is two windows' worth of the per-window tolerance.
if (residual > SETTLE_TOLERANCE * 2) {
  throw new Error(`the field did not stay settled: it moved ${residual.toFixed(5)} again`);
}

// Rigid control: at inertia 0 the same step must be tracked immediately, which
// is what proves the lag above is the spring and not a stale buffer.
await page.evaluate(() => window.__interiorLab.setYaw(0));
await setInterior(page, { count: LIVE_COUNT, size: 0.02, drift: 0, inertia: 0 });
await page.waitForTimeout(1200);
await page.evaluate((yaw) => window.__interiorLab.setYaw(yaw), YAW_STEP);
await page.waitForTimeout(60);
const rigid = await centroid(page);
const rigidLag = distance(rigid, settledA);
manifest.legs.lag.rigidLag = rigidLag;
console.log(`at inertia 0 the same step lands within ${rigidLag.toFixed(5)} immediately`);
if (rigidLag > travel * 0.2) throw new Error('inertia 0 did not track the head');

await setInterior(page, { count: 0 });
await page.close();

// ---------------------------------------------------------------------------
// Leg 4: reduced motion, in its own context. The engine reads the preference
// at mount, so it has to be set before the first frame.
// ---------------------------------------------------------------------------
const reducedContext = await browser.newContext({ reducedMotion: 'reduce' });
const reducedPage = await openLab(reducedContext);
await setInterior(reducedPage, { count: LIVE_COUNT, size: 0.02, drift: 0.008, inertia: 0.9 });
await reducedPage.waitForTimeout(1500);
const reducedShot = await shoot(reducedPage, 'reduced-on');
const reducedPre = await centroid(reducedPage);
await reducedPage.evaluate((yaw) => window.__interiorLab.setYaw(yaw), YAW_STEP);
await reducedPage.waitForTimeout(60);
const reducedImmediate = await centroid(reducedPage);
await reducedPage.waitForTimeout(2000);
const reducedSettled = await centroid(reducedPage);
const reducedTravel = distance(reducedPre, reducedSettled);
const reducedLag = distance(reducedImmediate, reducedSettled);
manifest.legs.reduced = {
  silhouette: reducedShot.silhouette,
  travel: reducedTravel,
  lag: reducedLag,
};
console.log(
  `reduced motion: the same step moves ${reducedTravel.toFixed(5)} units and lags ` +
    `${reducedLag.toFixed(5)}`,
);
if (reducedShot.silhouette < SILHOUETTE_FLOOR) {
  throw new Error('reduced motion lost the head entirely');
}
if (reducedTravel <= 0) throw new Error('the reduced-motion leg never moved the head');
if (reducedLag > reducedTravel * 0.2) {
  throw new Error('reduced motion kept the lag: the shake response was not removed');
}
await reducedPage.close();
await reducedContext.close();
await browser.close();

// --- leg 5: cost ------------------------------------------------------------
// rAF deltas are vsync-clamped at about 16.7 ms and would read the same with
// the field on or off, so this runs against a real Chrome with vsync off.
if (COST) {
  const real = await chromium.launch({
    executablePath: CHROME,
    headless: false,
    args: ['--enable-gpu', '--disable-gpu-vsync', '--disable-frame-rate-limit'],
  });
  const costPage = await real.newPage({ viewport: { width: 1100, height: 800 } });
  await costPage.goto(URL_TARGET, { waitUntil: 'load' });
  await costPage.waitForFunction(() => !!window.__hologlyphEngine?.avatar, null, {
    timeout: 30_000,
  });
  await costPage.waitForTimeout(2500);

  const sample = async (count, frames = 600) => {
    await costPage.evaluate((c) => window.__interiorLab.setInterior({ count: c }), count);
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
  const onCost = await sample(LIVE_COUNT);
  const maxCost = await sample(512);
  manifest.legs.cost = { off, on: onCost, max: maxCost, addedMeanMs: onCost.mean - off.mean };
  console.log(
    `uncapped frame cost: off ${off.median.toFixed(3)} ms median, ${LIVE_COUNT} glyphs ` +
      `${onCost.median.toFixed(3)} ms, 512 glyphs ${maxCost.median.toFixed(3)} ms`,
  );
  await real.close();
}

const manifestPath = join(OUT, 'interior-glyph-shot.json');
writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`manifest ${manifestPath}`);
console.log(`captures in ${OUT}`);
