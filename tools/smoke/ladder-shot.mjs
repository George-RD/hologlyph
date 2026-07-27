/**
 * Backdrop ladder exclusion smoke shot (`dec.liquid-glass-rung-exclusion`).
 *
 * Rung 2 (the compositor `backdrop-filter` layer) and rung 3 (the lens) both
 * answer "what is behind the glass", so a page with both gates open must show
 * exactly one of them, and it must be the one the host asked for by naming a
 * subtree. `demo/ladder-lab.html` points both rungs at the same `#hero`, so
 * the comparison is two routes to the same pixels rather than two pages.
 *
 * Six claims, each measured over the clip polygon rather than at a probe pixel,
 * for the reason `compositor-shot.mjs` records: the head sits over a smooth
 * part of the backdrop where one sample says almost nothing.
 *
 * 1. Rung 2 alone frosts inside the silhouette and leaves the page outside it.
 * 2. Naming a source removes the layer from the host tree within a bounded
 *    wait. Removed, not hidden: an invisible `backdrop-filter` element still
 *    costs the compositor a backdrop capture on every scroll.
 * 3. The head still shows the page. Rung 3 is on, so the inside of the
 *    silhouette must differ from the no-rung baseline, or the exclusion has
 *    simply turned the backdrop off.
 * 4. The two rungs are visibly different inside the silhouette. If they were
 *    not, the exclusion would be unobservable and this whole item moot.
 * 5. Dropping the source brings the layer back and restores the rung 2 frame
 *    to within the noise floor.
 * 6. `lens.amount: 0` with the source still bound brings the layer back too:
 *    contribution is the test, not intent.
 *
 * Usage (dev server must be running):
 *   bun tools/smoke/ladder-shot.mjs
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

const URL_TARGET = readArg('--url', 'http://localhost:5173/hologlyph/ladder-lab.html');
const OUT = readArg('--out', fileURLToPath(new URL('./out/', import.meta.url)));
const CHROME =
  process.env.HOLOGLYPH_CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

const VIEWPORT = { width: 1000, height: 800 };
/** Frost strength inside the silhouette, mean absolute channel delta. */
const FROST_FLOOR = 6;
/** Ceiling outside it. Not zero: PNG dithering and text antialiasing move a little. */
const LEAK_CEILING = 1;
/** How different the two rungs must look inside the head to be distinguishable. */
const RUNG_DELTA_FLOOR = 4;
/** How long a snapshot may take to resolve and stand the layer down. */
const EXCLUSION_TIMEOUT_MS = 8000;

mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({
  executablePath: CHROME,
  headless: false,
  args: ['--enable-gpu', '--force-device-scale-factor=1'],
});
// Reduced motion BEFORE the page loads, for the reason `compositor-shot.mjs`
// records: `setMotionFrozen` stops the skeleton but not the text skin, whose
// glyph rows scroll on their own clock and swamp the signal. It also pins the
// lab's ticker stripe, which is a liveness tell rather than a measurement.
const page = await browser.newPage({
  viewport: VIEWPORT,
  deviceScaleFactor: 1,
  reducedMotion: 'reduce',
});
page.on('console', (msg) => {
  if (msg.type() === 'error') console.log(`  [page error] ${msg.text()}`);
});
await page.goto(URL_TARGET, { waitUntil: 'load' });
await page.waitForFunction(() => Boolean(window.__ladderLab), null, { timeout: 30_000 });
await page.evaluate(() => window.__ladderLab.setMotionFrozen(true));
await page.waitForTimeout(2000);

const setCompositor = (n) => page.evaluate((v) => window.__ladderLab.setCompositor(v), n);
const setLens = (n) => page.evaluate((v) => window.__ladderLab.setLens(v), n);
const setSource = (on) => page.evaluate((v) => window.__ladderLab.setSource(v), on);
const layerState = () =>
  page.evaluate(() => {
    const el = window.__ladderLab.layer();
    if (!el) return null;
    return { clipPath: el.style.clipPath, visibility: el.style.visibility };
  });

/** Poll until the layer reaches the wanted presence, or give up. Returns the wait in ms. */
async function waitForLayer(present, timeout = EXCLUSION_TIMEOUT_MS) {
  const started = Date.now();
  for (;;) {
    const state = await layerState();
    if ((state !== null) === present) return Date.now() - started;
    if (Date.now() - started > timeout) return -1;
    await page.waitForTimeout(100);
  }
}

async function shot(name) {
  const buffer = await page.screenshot();
  writeFileSync(join(OUT, `${name}.png`), buffer);
  return decodePng(buffer);
}

/** Parse a `polygon(...)` value into vertices, in CSS pixels. */
function clipPoints(clipPath) {
  return [...clipPath.matchAll(/(-?[\d.]+)px (-?[\d.]+)px/g)].map((m) => [
    Number(m[1]),
    Number(m[2]),
  ]);
}

/** Even-odd point-in-polygon over the clip vertices, in CSS pixels. */
function polygonMask(clipPath, width, height, exclude) {
  const pts = clipPoints(clipPath);
  const mask = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (
        x >= exclude.x &&
        x <= exclude.x + exclude.width &&
        y >= exclude.y &&
        y <= exclude.y + exclude.height
      ) {
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
 * "Away from the head", which is NOT the same region as "outside the clip
 * polygon" and is the reason this script carries two masks.
 *
 * The compositor outline is cut at the emergence waterline, because the layer
 * must not frost a submerged head that is not drawn. The BUST is drawn below
 * that line, so the polygon bottoms out well above the shoulders: measured at
 * 1000x800 the clip polygon ends at y 406 while the head still occupies
 * pixels down to y 567. Rung 3 shades the whole head, so judging its leak
 * against the polygon counts the shoulders as page and fails a correct engine.
 *
 * The box is derived from the polygon's own x-range plus a margin, taken down
 * to the bottom of the viewport, and never from the comparison it gates: a
 * region fitted to the measured difference could not fail.
 */
function pageMask(clipPath, width, height, exclude, margin = 24) {
  const pts = clipPoints(clipPath);
  const x0 = Math.min(...pts.map((p) => p[0])) - margin;
  const x1 = Math.max(...pts.map((p) => p[0])) + margin;
  const y0 = Math.min(...pts.map((p) => p[1])) - margin;
  const mask = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const inPanel =
        x >= exclude.x &&
        x <= exclude.x + exclude.width &&
        y >= exclude.y &&
        y <= exclude.y + exclude.height;
      mask[y * width + x] = inPanel ? 2 : x >= x0 && x <= x1 && y >= y0 ? 1 : 0;
    }
  }
  return { mask, box: { x0: +x0.toFixed(2), x1: +x1.toFixed(2), y0: +y0.toFixed(2) } };
}

/**
 * Mean and max absolute channel delta, split by mask region. `decodePng`
 * reports its own channel count; hard-coding four silently reads neighbouring
 * pixels on a colour-type-2 PNG and makes the inside/outside split meaningless.
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

// --- baseline: neither rung, and the noise floor ------------------------------
// Two captures of the same state, so every number below is judged against what
// an unchanged page already moves by.
await setSource(false);
await setCompositor({ amount: 0 });
await page.waitForTimeout(600);
const bare = await shot('ladder-bare');
await page.waitForTimeout(600);
const bareAgain = await shot('ladder-bare-again');

// --- rung 2 alone --------------------------------------------------------------
await setCompositor({ amount: 1 });
await waitForLayer(true, 2000);
await page.waitForTimeout(600);
const rung2State = await layerState();
const rung2 = await shot('ladder-rung2');

const panel = await page.evaluate(() => window.__ladderLab.panelRect());
const { mask, points } = polygonMask(
  rung2State?.clipPath ?? '',
  VIEWPORT.width,
  VIEWPORT.height,
  panel,
);
const { mask: awayMask, box: headBox } = pageMask(
  rung2State?.clipPath ?? '',
  VIEWPORT.width,
  VIEWPORT.height,
  panel,
);

// --- rung 3 stands rung 2 down --------------------------------------------------
await setLens({ amount: 1, strength: 0.06 });
await setSource(true);
const exclusionMs = await waitForLayer(false);
await page.waitForTimeout(800);
const rung3 = await shot('ladder-rung3');

// --- contribution, not intent: mixing the lens out gives the frost back ---------
// Each restore leg records the state it started from. Without that they pass
// trivially on a build that never stood the layer down in the first place,
// which is exactly the regression this script exists to catch.
const goneBeforeAmount = (await layerState()) === null;
await setLens({ amount: 0 });
const restoredByAmountMs = await waitForLayer(true, 2000);
await page.waitForTimeout(500);
await setLens({ amount: 1 });
await waitForLayer(false);

// --- dropping the source gives it back too, and restores the frame --------------
const goneBeforeDrop = (await layerState()) === null;
await setSource(false);
const restoredByDropMs = await waitForLayer(true, 2000);
await page.waitForTimeout(800);
const restored = await shot('ladder-restored');

await browser.close();

const noise = compare(bare, bareAgain, mask, VIEWPORT.width, VIEWPORT.height);
const frost = compare(bare, rung2, mask, VIEWPORT.width, VIEWPORT.height);
const lens = compare(bare, rung3, mask, VIEWPORT.width, VIEWPORT.height);
const between = compare(rung2, rung3, mask, VIEWPORT.width, VIEWPORT.height);
const restoration = compare(rung2, restored, mask, VIEWPORT.width, VIEWPORT.height);
// The leak legs, measured away from the head rather than outside the polygon.
const noiseAway = compare(bare, bareAgain, awayMask, VIEWPORT.width, VIEWPORT.height);
const lensAway = compare(bare, rung3, awayMask, VIEWPORT.width, VIEWPORT.height);

const leakCeiling = Math.max(LEAK_CEILING, noise.outside.mean * 2);
// Ceiling and measurement from the same region: the away mask has its own
// noise floor, and judging it against the polygon's would compare two
// different populations.
const awayCeiling = Math.max(LEAK_CEILING, noiseAway.outside.mean * 2);
const report = {
  clipPoints: points,
  clipPath: rung2State?.clipPath ?? '',
  panel,
  headBox,
  exclusionMs,
  goneBeforeAmount,
  restoredByAmountMs,
  goneBeforeDrop,
  restoredByDropMs,
  noise,
  noiseAway,
  frost,
  lens,
  lensAway,
  between,
  restoration,
  leakCeiling: +leakCeiling.toFixed(2),
  awayCeiling: +awayCeiling.toFixed(2),
  pageFraction: +(lensAway.outside.n / (VIEWPORT.width * VIEWPORT.height)).toFixed(3),
};
writeFileSync(join(OUT, 'ladder-shot.json'), `${JSON.stringify(report, null, 2)}\n`);

const checks = [
  ['rung 2 clips to a polygon', /^polygon\(/.test(rung2State?.clipPath ?? '')],
  [`rung 2 frosts inside the silhouette (mean >= ${FROST_FLOOR})`, frost.inside.mean >= FROST_FLOOR],
  [
    `rung 2 leaves the page outside it (mean <= ${leakCeiling.toFixed(2)})`,
    frost.outside.mean <= leakCeiling,
  ],
  ['naming a source removes the layer from the tree', exclusionMs >= 0],
  ['rung 3 still shows the page inside the head', lens.inside.mean >= noise.inside.mean * 3],
  [
    `the two rungs look different inside the head (mean >= ${RUNG_DELTA_FLOOR})`,
    between.inside.mean >= RUNG_DELTA_FLOOR,
  ],
  [
    `rung 3 leaves the page away from the head alone (mean <= ${awayCeiling.toFixed(2)})`,
    lensAway.outside.mean <= awayCeiling,
  ],
  // The control for the leg above. A head box wide enough to swallow the whole
  // viewport would pass it trivially, so the page it protects must be a real
  // part of the frame. A third, not a half: this lab's control panel is itself
  // a quarter of the viewport and is excluded from every mask.
  [
    `and that page is a third of the frame (${(report.pageFraction * 100).toFixed(0)}%)`,
    report.pageFraction >= 0.33,
  ],
  ['lens.amount 0 gives the frost back', goneBeforeAmount && restoredByAmountMs >= 0],
  ['dropping the source gives the frost back', goneBeforeDrop && restoredByDropMs >= 0],
  [
    'and restores the rung 2 frame to within the noise floor',
    restoration.inside.mean <= Math.max(noise.inside.mean * 2, 2),
  ],
];

console.log(`backdrop ladder exclusion smoke, ${URL_TARGET}`);
console.log(JSON.stringify(report, null, 2));
let failed = 0;
for (const [name, ok] of checks) {
  if (!ok) failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`);
}
console.log(`frames in ${OUT}`);
process.exit(failed === 0 ? 0 : 1);
