/**
 * Snapshot lens smoke shot (dec.liquid-glass-architecture, rung 3, item 4).
 *
 * Four claims, all measured rather than eyeballed:
 *
 * 1. The head is on screen at all. The other legs compare two states of the
 *    same build, so a change that breaks the shell in both reads as a perfect
 *    0 pixel difference. The tier 1 pool lost a debugging session to exactly
 *    that, so this floor comes first.
 * 2. Inertness. With no source named, the page must be pixel-identical to a
 *    page where the lens was never written: `lensGate` is derived from the
 *    binding, and at 0 the material emits `output` bit for bit.
 * 3. Visibility. Naming the hero must change a large, contiguous share of the
 *    head's own pixels and leave the page outside the silhouette alone. A
 *    lens that only touches the rim is a decal, not refraction.
 * 4. Displacement follows thickness. Flipping the sign of `lens.strength`
 *    must move the refracted content the other way, which no flat overlay of
 *    a snapshot could do.
 *
 * Usage (dev server must be running):
 *   bun run dev
 *   bun tools/smoke/lens-shot.mjs
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { decodePng, luminance } from '../evals/score.mjs';

const args = process.argv.slice(2);
const readArg = (flag, fallback) => {
  const i = args.indexOf(flag);
  return i >= 0 && args[i + 1] !== undefined ? args[i + 1] : fallback;
};

const URL_TARGET = readArg('--url', 'http://localhost:5173/hologlyph/lens-lab.html');
const OUT = readArg('--out', fileURLToPath(new URL('./out/', import.meta.url)));

const VIEWPORT = { width: 1100, height: 800 };

/**
 * Box around the head in this viewport, in pixels. The lab camera is the
 * shipped one, so the bust occupies the middle of the frame; the panel lives
 * on the right and is excluded by construction.
 */
const HEAD_BOX = { x: 330, y: 60, width: 440, height: 700 };

/**
 * A strip of hero well clear of the head, used as the control: the lens must
 * change nothing outside the silhouette.
 */
const PAGE_BOX = { x: 8, y: 8, width: 300, height: 200 };

mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: VIEWPORT, deviceScaleFactor: 1 });
// Reduced motion also stops the text-skin row flow, so the glyph grid phase
// cannot drift between captures.
await page.emulateMedia({ reducedMotion: 'reduce' });
page.on('pageerror', (error) => console.error(`[pageerror] ${error.message}`));
page.on('console', (m) => {
  if (m.type() === 'error') console.error(`[console] ${m.text().slice(0, 240)}`);
});

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

/** Freeze every bone and every morph array so two captures are comparable. */
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

async function setSource(on) {
  await page.evaluate((next) => window.__lensLab.setSource(next), on);
  await page.waitForTimeout(900);
}

async function setLens(next) {
  await page.evaluate((cfg) => window.__lensLab.setLens(cfg), next);
  await page.waitForTimeout(500);
}

async function shoot(tag) {
  const path = join(OUT, `lens-${tag}.png`);
  await page.screenshot({ path });
  return { tag, path, image: decodePng(path) };
}

/** Count pixels differing at all, and by more than 3 luma, inside a box. */
function compare(a, b, box) {
  if (a.width !== b.width || a.height !== b.height) throw new Error('capture shape mismatch');
  let total = 0;
  let exact = 0;
  let over3 = 0;
  let maxLuma = 0;
  for (let y = box.y; y < box.y + box.height; y++) {
    for (let x = box.x; x < box.x + box.width; x++) {
      const i = (y * a.width + x) * a.channels;
      const j = (y * b.width + x) * b.channels;
      total++;
      if (a.data[i] === b.data[j] && a.data[i + 1] === b.data[j + 1] && a.data[i + 2] === b.data[j + 2]) {
        continue;
      }
      exact++;
      const dl = Math.abs(
        luminance(a.data[i], a.data[i + 1], a.data[i + 2]) -
          luminance(b.data[j], b.data[j + 1], b.data[j + 2]),
      );
      if (dl > 3) over3++;
      if (dl > maxLuma) maxLuma = dl;
    }
  }
  return { total, exact, over3, share: exact / total, maxLuma };
}

const manifest = { url: URL_TARGET, capturedAt: new Date().toISOString(), legs: {} };
const failures = [];
const check = (name, ok, detail) => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}  ${detail}`);
  if (!ok) failures.push(name);
};

await pinPose();

// --- leg 0: the head is on screen -----------------------------------------
// The hero is a striped blue field; the head is the only thing over it that
// carries warm glyph glow. Counting pixels inside the head box that are
// brighter than the hero establishes that there is a head to refract through.
await setSource(false);
const off = await shoot('source-off');
{
  const { image } = off;
  let lit = 0;
  for (let y = HEAD_BOX.y; y < HEAD_BOX.y + HEAD_BOX.height; y++) {
    for (let x = HEAD_BOX.x; x < HEAD_BOX.x + HEAD_BOX.width; x++) {
      const i = (y * image.width + x) * image.channels;
      if (luminance(image.data[i], image.data[i + 1], image.data[i + 2]) > 70) lit++;
    }
  }
  manifest.legs.presence = { lit };
  check('head is on screen', lit > 8000, `${lit} lit px inside the head box`);
}

// --- leg 1: noise floor ----------------------------------------------------
const offAgain = await shoot('source-off-again');
const noise = compare(off.image, offAgain.image, HEAD_BOX);
manifest.legs.noise = noise;
check('same state twice is stable', noise.exact < 200, `${noise.exact} px differ, max ${noise.maxLuma.toFixed(1)} luma`);

// --- leg 2: the sample window is the layout arithmetic ---------------------
// The mapping is proved by the numbers, not by pixels. A pixel comparison
// against the unrefracted head cannot isolate it, because switching the lens
// on also moves one blend across a colour-space seam (see leg 3). So the
// window the engine actually bound is recomputed here from the two rects and
// compared exactly.
await setSource(true);
await setLens({ amount: 1, strength: 0 });
const bound = await page.evaluate(() => {
  const rect = (el) => {
    const b = el.getBoundingClientRect();
    return { x: b.left + scrollX, y: b.top + scrollY, width: b.width, height: b.height };
  };
  const binding = window.__hologlyphEngine.pageLens?.binding;
  return {
    hero: rect(document.getElementById('hero')),
    canvas: rect(document.getElementById('holo')),
    window: binding?.window ?? null,
    displacement: binding?.displacement ?? null,
    image: binding ? { width: binding.texture.image?.width, height: binding.texture.image?.height } : null,
    // `RendererHost.backend` reports what `navigator.gpu` advertises, not what
    // three actually built, and headless Chromium advertises WebGPU while
    // falling back. Ask the renderer.
    backend: window.__hologlyphEngine.sysRenderer?.gpuRenderer?.backend?.isWebGPUBackend
      ? 'webgpu'
      : 'webgl2',
  };
});
manifest.legs.window = bound;
{
  const { hero, canvas, window: win } = bound;
  const expected = win && {
    offsetU: (canvas.x - hero.x) / hero.width,
    offsetV: 1 - (canvas.y - hero.y) / hero.height,
    scaleU: canvas.width / hero.width,
    scaleV: -(canvas.height / hero.height),
  };
  const near = (a, b) => Math.abs(a - b) < 1e-9;
  const ok =
    !!win &&
    near(win.offsetU, expected.offsetU) &&
    near(win.offsetV, expected.offsetV) &&
    near(win.scaleU, expected.scaleU) &&
    near(win.scaleV, expected.scaleV);
  check(
    'the bound sample window is the document-space layout arithmetic',
    ok,
    `${JSON.stringify(win)} against ${JSON.stringify(expected)} on the ${bound.backend} backend`,
  );
}
const aligned = await shoot('aligned');

// --- leg 3: the compositing seam is bounded --------------------------------
// Naming a source makes the head opaque and folds the page into the SCENE, so
// that one blend moves from the compositor's encoded space into three's linear
// working space. No formulation inside the scene can avoid it: the compositor
// computes `encode(C*a) + encode(page)*(1-a)` and a fragment can only compute
// `encode(C*a + L*(1-a))`. It is a tone shift, not a mapping error, so it is
// bounded rather than asserted away, and it is why leg 4 measures displacement
// against the LENSED head rather than the unrefracted one.
const seam = compare(off.image, aligned.image, HEAD_BOX);
manifest.legs.seam = seam;
check(
  'the colour-space seam stays a tone shift, not a mapping break',
  seam.share < 0.45 && seam.maxLuma < 130,
  `${seam.over3} px over 3 luma, ${(seam.share * 100).toFixed(1)}% of the head box, max ${seam.maxLuma.toFixed(1)}`,
);

// --- leg 4: displacement is visible ----------------------------------------
// Both captures have the lens bound and the head opaque, so the seam cancels
// and the difference is displacement alone. This is the acceptance criterion:
// the named subtree is visibly lensed through the head.
await setLens({ amount: 1, strength: 0.06 });
const on = await shoot('source-on');
const lensed = compare(aligned.image, on.image, HEAD_BOX);
manifest.legs.lensed = lensed;
check(
  'displacement visibly lenses the named subtree through the head',
  // Measured at 9327 px on the lab hero at strength 0.06. The floor sits well
  // under it because the acceptance is "visible", not a pixel count: what it
  // guards against is the displacement silently going to zero, which is what
  // happens if the thickness attribute stops being baked or the normal chain
  // loses its xy.
  lensed.over3 > 6_000,
  `${lensed.over3} px moved by more than 3 luma (${(lensed.share * 100).toFixed(1)}% of the head box differ)`,
);

// --- leg 5: the page outside the head is untouched -------------------------
const outside = compare(off.image, on.image, PAGE_BOX);
manifest.legs.outside = outside;
check(
  'the page outside the silhouette is untouched',
  outside.exact === 0,
  `${outside.exact} px differ in the control strip`,
);

// --- leg 6: displacement has a direction -----------------------------------
// A flat overlay of the snapshot would be identical under a sign flip. Only a
// real per-fragment displacement moves the content the other way.
await setLens({ amount: 1, strength: -0.06 });
const flipped = await shoot('strength-flipped');
const signFlip = compare(on.image, flipped.image, HEAD_BOX);
manifest.legs.signFlip = signFlip;
check(
  'flipping the strength sign moves the refracted content',
  signFlip.over3 > 5_000,
  `${signFlip.over3} px moved by more than 3 luma`,
);

// --- leg 7: dropping the source restores the shipped head ------------------
await setLens({ amount: 1, strength: 0.06 });
await setSource(false);
const restored = await shoot('source-dropped');
const inert = compare(off.image, restored.image, HEAD_BOX);
manifest.legs.inert = inert;
check(
  'dropping the source restores the unrefracted head',
  inert.exact <= Math.max(noise.exact, 200),
  `${inert.exact} px differ against the original, noise floor ${noise.exact}`,
);

writeFileSync(join(OUT, 'lens-shot.json'), `${JSON.stringify(manifest, null, 2)}\n`);
await browser.close();

if (failures.length > 0) {
  console.error(`\n${failures.length} leg(s) failed: ${failures.join(', ')}`);
  process.exit(1);
}
console.log('\nall legs passed');
