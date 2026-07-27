/**
 * Compositor glass smoke shot (dec.liquid-glass-compositor, item 6).
 *
 * Five claims, each measured over the clip polygon rather than at one probe
 * pixel. The single-pixel version of this script passed and failed for reasons
 * that had nothing to do with the feature: the head sits over a smooth part of
 * the backdrop, where a blur is very nearly a no-op, so one sample says almost
 * nothing while the mean over 90k pixels says a great deal.
 *
 * 1. Inertness. At `compositor.amount = 0` the page must author no layer at
 *    all, so a host that never touches the config keeps the shipped look.
 * 2. Frost. With the layer on, the mean change inside the silhouette must be
 *    far above the change outside it.
 * 3. Confinement. Outside the silhouette the page must be untouched, or the
 *    frost is a rectangle and the whole design is off. The control panel is
 *    excluded: its readout changes when the layer is built, and that is the
 *    capture moving, not the feature.
 * 4. Liveness, which is the ONLY thing separating rung 2 from rung 3. The
 *    backdrop field is pinned to an exact phase rather than raced against an
 *    animation. Stepping the phase must change what shows inside the head. A
 *    rasterised snapshot would hold the old phase and fail here while passing
 *    every other check.
 * 5. Tracking. Moving the head must rewrite the clip polygon.
 *
 * Usage (dev server must be running):
 *   bun tools/smoke/compositor-shot.mjs
 *
 * Runs against a real Chrome for real GPU compositing. Set HOLOGLYPH_CHROME to
 * override the binary.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { decodePng } from '../evals/score.mjs';

const args = process.argv.slice(2);
const readArg = (flag, fallback) => {
  const i = args.indexOf(flag);
  return i >= 0 && args[i + 1] !== undefined ? args[i + 1] : fallback;
};

const URL_TARGET = readArg('--url', 'http://localhost:5173/hologlyph/compositor-lab.html');
const OUT = readArg('--out', fileURLToPath(new URL('./out/', import.meta.url)));
const CHROME =
  process.env.HOLOGLYPH_CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

const VIEWPORT = { width: 1000, height: 800 };
/** Frost strength inside the silhouette, mean absolute channel delta. */
const FROST_FLOOR = 6;
/** Ceiling outside it. Not zero: PNG dithering and text antialiasing move a little. */
const LEAK_CEILING = 1;
/** Mean change inside the head when the backdrop phase steps. */
const LIVE_FLOOR = 4;

mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({
  executablePath: CHROME,
  headless: false,
  args: ['--enable-gpu', '--force-device-scale-factor=1'],
});
// Reduced motion BEFORE the page loads, so the engine mounts into it. This is
// not cosmetic: `setMotionFrozen` stops the skeleton but not the text skin,
// whose glyph rows scroll on their own clock and put a mean delta of about 25
// between two captures of an unchanged page. Against that floor a frost of 45
// is barely a signal. Reduced motion is the supported path that pauses the row
// flow, and it takes the floor to something a measurement can stand on.
const page = await browser.newPage({
  viewport: VIEWPORT,
  deviceScaleFactor: 1,
  reducedMotion: 'reduce',
});
page.on('console', (msg) => {
  if (msg.type() === 'error') console.log(`  [page error] ${msg.text()}`);
});
await page.goto(URL_TARGET, { waitUntil: 'load' });
await page.waitForFunction(() => Boolean(window.__compositorLab), null, { timeout: 30_000 });
// The head still emerges on a ramp. Freezing the pose is what makes every
// comparison below about the PAGE rather than about the head moving.
await page.evaluate(() => {
  window.__compositorLab.setMotionFrozen(true);
  window.__compositorLab.setFieldPhase(0);
});
await page.waitForTimeout(2000);

const set = (next) => page.evaluate((n) => window.__compositorLab.set(n), next);
const phase = (px) => page.evaluate((p) => window.__compositorLab.setFieldPhase(p), px);
const layerState = () =>
  page.evaluate(() => {
    const el = window.__compositorLab.layer();
    if (!el) return null;
    return {
      clipPath: el.style.clipPath,
      backdropFilter: el.style.backdropFilter,
      visibility: el.style.visibility,
      beforeCanvas: el.nextElementSibling?.tagName === 'CANVAS',
    };
  });

async function shot(name) {
  const buffer = await page.screenshot();
  writeFileSync(join(OUT, `${name}.png`), buffer);
  return decodePng(buffer);
}

/** Even-odd point-in-polygon over the clip vertices, in CSS pixels. */
function polygonMask(clipPath, width, height, exclude) {
  const pts = [...clipPath.matchAll(/(-?[\d.]+)px (-?[\d.]+)px/g)].map((m) => [Number(m[1]), Number(m[2])]);
  const mask = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (x >= exclude.x && x <= exclude.x + exclude.width && y >= exclude.y && y <= exclude.y + exclude.height) {
        mask[y * width + x] = 2;
        continue;
      }
      let hit = false;
      for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
        const [xi, yi] = pts[i];
        const [xj, yj] = pts[j];
        if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) hit = !hit;
      }
      mask[y * width + x] = hit ? 1 : 0;
    }
  }
  return { mask, points: pts.length };
}

/**
 * Mean and max absolute channel delta, split by mask region.
 *
 * `decodePng` returns three bytes per pixel for a colour-type-2 PNG and four
 * for colour-type-6, and reports which in `channels`. Hard-coding four reads a
 * neighbouring pixel's bytes for every sample, which still produces plausible
 * deltas while attributing them to the wrong coordinates: the inside/outside
 * split silently becomes meaningless.
 */
function compare(a, b, mask, width, height) {
  if (a.data.length !== b.data.length) throw new Error('captures differ in size');
  if (a.channels !== b.channels) throw new Error('captures differ in channel count');
  const ch = a.channels;
  const acc = { inside: { n: 0, sum: 0, max: 0 }, outside: { n: 0, sum: 0, max: 0 } };
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const m = mask[y * width + x];
      if (m === 2) continue;
      const i = (y * width + x) * ch;
      const d = Math.max(
        Math.abs(a.data[i] - b.data[i]),
        Math.abs(a.data[i + 1] - b.data[i + 1]),
        Math.abs(a.data[i + 2] - b.data[i + 2]),
      );
      const bucket = m === 1 ? acc.inside : acc.outside;
      bucket.n++;
      bucket.sum += d;
      if (d > bucket.max) bucket.max = d;
    }
  }
  const done = (r) => ({ n: r.n, mean: +(r.sum / r.n).toFixed(2), max: r.max });
  return { inside: done(acc.inside), outside: done(acc.outside) };
}

// --- 1. inertness, and the noise floor ---------------------------------------
// Two captures of the SAME state on the SAME code. Without this every number
// below is unanchored: the head's glyph rows scroll on their own clock and the
// emergence ramp never fully settles, so "the page changed" is the null
// hypothesis, not the finding.
await set({ amount: 0 });
await page.waitForTimeout(400);
const layerAtZero = await layerState();
const off = await shot('compositor-off');
await page.waitForTimeout(600);
const offAgain = await shot('compositor-off-again');

// --- the layer on, same backdrop phase ---------------------------------------
await set({ amount: 1, blur: 18, saturate: 1.6 });
await page.waitForTimeout(600);
const layerAtOne = await layerState();
const onPhase0 = await shot('compositor-on');

const panel = await page.evaluate(() => window.__compositorLab.panelRect());
const { mask, points } = polygonMask(layerAtOne?.clipPath ?? '', VIEWPORT.width, VIEWPORT.height, panel);

// --- the master mix, at a value nobody else exercises ------------------------
// `amount` is carried by the LAYER's own opacity. That is safe by spec, since
// only an ANCESTOR's opacity promotes a backdrop root, but "safe by spec" is
// how the whole Firefox blocker started, so it is measured: half the amount
// must frost visibly and must frost less than the full amount.
await set({ amount: 0.5 });
await page.waitForTimeout(500);
const onHalf = await shot('compositor-on-half');
await set({ amount: 1 });
await page.waitForTimeout(500);

// --- liveness: step the backdrop, hold the pose and the layer ----------------
await phase(-260);
await page.waitForTimeout(500);
const onPhase1 = await shot('compositor-on-stepped');

// --- tracking -----------------------------------------------------------------
await phase(0);
await page.evaluate(() => window.__compositorLab.setMotionFrozen(false));
await page.waitForTimeout(700);
const clipAfterPose = (await layerState())?.clipPath;

await browser.close();

const noise = compare(off, offAgain, mask, VIEWPORT.width, VIEWPORT.height);
const frost = compare(off, onPhase0, mask, VIEWPORT.width, VIEWPORT.height);
const live = compare(onPhase0, onPhase1, mask, VIEWPORT.width, VIEWPORT.height);
const half = compare(off, onHalf, mask, VIEWPORT.width, VIEWPORT.height);

// Everything is judged against the floor, never against zero.
const leakCeiling = Math.max(LEAK_CEILING, noise.outside.mean * 2);
const report = {
  clipPoints: points,
  layerAtZero,
  layerAtOne,
  noise,
  frost,
  live,
  half,
  leakCeiling: +leakCeiling.toFixed(2),
  clipChangedWithPose: layerAtOne?.clipPath !== clipAfterPose,
};
writeFileSync(join(OUT, 'compositor-shot.json'), `${JSON.stringify(report, null, 2)}\n`);

const checks = [
  ['authors no layer at amount 0', layerAtZero === null],
  ['inserts the layer immediately before the canvas', layerAtOne?.beforeCanvas === true],
  ['clips to a polygon', /^polygon\(/.test(layerAtOne?.clipPath ?? '')],
  [`frosts inside the silhouette (mean >= ${FROST_FLOOR})`, frost.inside.mean >= FROST_FLOOR],
  ['the frost is far above the noise floor', frost.inside.mean >= noise.inside.mean * 3],
  [`leaves the page outside it alone (mean <= ${leakCeiling.toFixed(2)})`, frost.outside.mean <= leakCeiling],
  [`the frosted content is LIVE (mean >= ${LIVE_FLOOR})`, live.inside.mean >= LIVE_FLOOR],
  // The control for the leg above: if the page did not change, "live" proves
  // nothing. Outside the head it must have changed a great deal.
  ['the stepped backdrop really did move', live.outside.mean >= LIVE_FLOOR * 2],
  ['half the amount still frosts', half.inside.mean >= FROST_FLOOR / 2],
  ['half the amount frosts less than full', half.inside.mean < frost.inside.mean],
  ['the outline tracks the pose', report.clipChangedWithPose],
];

console.log(`compositor glass smoke, ${URL_TARGET}`);
console.log(JSON.stringify(report, null, 2));
let failed = 0;
for (const [name, ok] of checks) {
  if (!ok) failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`);
}
console.log(`frames in ${OUT}`);
process.exit(failed === 0 ? 0 : 1);
