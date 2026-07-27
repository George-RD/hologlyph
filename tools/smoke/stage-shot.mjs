/**
 * Stage participants smoke shot (dec.liquid-glass-participants).
 *
 * Four claims, all of which have to be measured rather than eyeballed:
 *
 * 1. Inertness. A page that marks nothing must be pixel-identical to the page
 *    this feature landed on. A noise floor is established first by capturing
 *    the same state twice on the same code; every acceptance comparison below
 *    is only meaningful against that floor.
 * 2. Gating. Marking participants while `fluid.amount` is 0 must still change
 *    nothing, in either direction: no bulge on the head AND no transform on
 *    the marked elements. The reaction is Newton's third law on the same
 *    interaction, so a rigid head may not shove the page about.
 * 3. Two-sided squeeze. This is the whole reason `FLUID_MODES` grew. With one
 *    obstacle on each side of the head, the two must dent both sides rather
 *    than cancelling, so both-on has to differ from either-on-alone by more
 *    than the noise floor.
 * 4. The reaction lands, and is capped. A `data-hologlyph-body` element must
 *    pick up a transform, and its magnitude must respect `stage.maxPush`.
 *
 * Participants are injected by this script rather than read off the lab page,
 * so the measurement does not drift when the lab's copy is edited. Injecting
 * them after mount also exercises the documented late-arrival path through
 * `engine.refreshStage()`.
 *
 * Usage (dev server must be running):
 *   bun tools/smoke/stage-shot.mjs
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

const URL_TARGET = readArg('--url', 'http://localhost:5173/hologlyph/stage-lab.html');
const OUT = readArg('--out', fileURLToPath(new URL('./out/', import.meta.url)));
/** The lab page background, so the silhouette is everything that differs. */
const CLEAR = [5, 7, 13];
/**
 * Lower bound on the head's silhouette at this viewport. Same canary as the
 * pool shot: the comparisons below all measure one build against itself, so a
 * change that collapses the shell in every state would read as a perfect zero
 * pixel difference without this.
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
    // The row flow is a GPU UV scroll on its own clock, so two captures of an
    // untouched page otherwise differ by the whole glyph grid and the noise
    // floor swallows every comparison below it.
    engine.sysTextSkin?.setScrollSpeed(0);
    engine.eyeTextSkin?.setScrollSpeed(0);
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

async function setConfig(overrides) {
  await page.evaluate((next) => {
    window.__hologlyphEngine.vfx.setHeadConfig(next);
  }, overrides);
  await page.waitForTimeout(900);
}

/**
 * Replace the injected participants. Each entry is `{ id, markers, side }`;
 * the element is pinned over the canvas at a fixed fraction of its width, so
 * the geometry is the same on every run at this viewport.
 */
async function setParticipants(spec) {
  const written = await page.evaluate((entries) => {
    const HOST_ID = 'hologlyph-smoke-participants';
    document.getElementById(HOST_ID)?.remove();
    if (entries.length === 0) {
      window.__hologlyphEngine.refreshStage();
      return 0;
    }
    const canvas = document.querySelector('canvas');
    const box = canvas.getBoundingClientRect();
    const host = document.createElement('div');
    host.id = HOST_ID;
    for (const entry of entries) {
      const el = document.createElement('div');
      el.id = entry.id;
      for (const marker of entry.markers) el.setAttribute(marker, '');
      el.style.position = 'fixed';
      el.style.width = `${box.width * 0.22}px`;
      el.style.height = `${box.height * 0.16}px`;
      el.style.top = `${box.top + box.height * entry.top}px`;
      el.style.left =
        entry.side === 'left'
          ? `${box.left + box.width * 0.16}px`
          : `${box.left + box.width * 0.62}px`;
      el.style.background = 'rgba(0, 0, 0, 0)';
      el.style.pointerEvents = 'none';
      host.append(el);
    }
    document.body.append(host);
    // The documented late-arrival path: markers added after mount are not
    // watched until the host says so.
    window.__hologlyphEngine.refreshStage();
    return entries.length;
  }, spec);
  await page.waitForTimeout(900);
  return written;
}

/** The transform this feature wrote on an injected participant, in pixels. */
async function readPush(id) {
  return page.evaluate((target) => {
    const el = document.getElementById(target);
    if (!el) return null;
    const match = /translate3d\((-?[\d.]+)px, (-?[\d.]+)px/.exec(el.style.transform ?? '');
    return match ? { x: Number(match[1]), y: Number(match[2]) } : { x: 0, y: 0 };
  }, id);
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
  const path = join(OUT, `stage-${tag}.png`);
  await page.screenshot({ path });
  return { path, ...measure(path) };
}

const LEFT = { id: 'smoke-left', markers: ['data-hologlyph-obstacle'], side: 'left', top: 0.46 };
const RIGHT = { id: 'smoke-right', markers: ['data-hologlyph-obstacle'], side: 'right', top: 0.46 };
// The buoyant element sits opposite the right-hand obstacle and at the same
// height, because the two legs that use it pair them: only a participant that
// actually presses on the body claims a mode, and only a mode has a flow to
// react to.
const FLOAT = { id: 'smoke-float', markers: ['data-hologlyph-body'], side: 'left', top: 0.46 };

const manifest = { url: URL_TARGET, capturedAt: new Date().toISOString(), legs: {} };

// --- leg 0: the head is actually on screen ---------------------------------
await pinPose();
await setParticipants([]);
await setConfig({ fluid: { amount: 0 }, pool: { amount: 0 } });
const canary = await shoot('canary');
manifest.legs.silhouette = { pixels: canary.silhouette, floor: SILHOUETTE_FLOOR };
console.log(`silhouette with no participants: ${canary.silhouette} px (floor ${SILHOUETTE_FLOOR})`);
if (canary.silhouette < SILHOUETTE_FLOOR) {
  throw new Error(
    `head silhouette collapsed to ${canary.silhouette} px, below the ${SILHOUETTE_FLOOR} px floor: ` +
      'every comparison below would be meaningless',
  );
}

// --- leg 1: noise floor and inertness --------------------------------------
const floorA = await shoot('rest-a');
const floorB = await shoot('rest-b');
const floor = compare(floorA.image, floorB.image);
console.log(`noise floor: ${floor.exact} px differ, max luma ${floor.maxLuma.toFixed(2)}`);

// Participants marked, but the head is rigid. Both halves must stay shut.
await setParticipants([LEFT, RIGHT, FLOAT]);
const gated = await shoot('gated');
const gatedDiff = compare(floorA.image, gated.image);
const gatedPush = await readPush(FLOAT.id);
manifest.legs.gating = { diff: gatedDiff, push: gatedPush };
console.log(
  `three participants at fluid.amount 0 change ${gatedDiff.exact} px (floor ${floor.exact}), ` +
    `float push (${gatedPush.x}, ${gatedPush.y})`,
);
if (gatedDiff.exact > floor.exact) {
  throw new Error(
    `marking participants moved ${gatedDiff.exact} px with the fluid gate shut: the shipped look is not inert`,
  );
}
if (gatedPush.x !== 0 || gatedPush.y !== 0) {
  throw new Error('a rigid head pushed the page: the two halves of the coupling are not gated together');
}

// --- leg 2: one side, then the other, then both ----------------------------
await setConfig({ fluid: { amount: 1, sag: 0.05, wobble: 0, tension: 0.55 }, stage: { squeeze: 1.4 } });

await setParticipants([LEFT]);
const leftOnly = await shoot('left');
await setParticipants([RIGHT]);
const rightOnly = await shoot('right');
await setParticipants([LEFT, RIGHT]);
const both = await shoot('both');

const leftMoves = compare(floorA.image, leftOnly.image);
const rightMoves = compare(floorA.image, rightOnly.image);
const bothVsLeft = compare(leftOnly.image, both.image);
const bothVsRight = compare(rightOnly.image, both.image);
manifest.legs.twoSided = { leftMoves, rightMoves, bothVsLeft, bothVsRight };
console.log(
  `left alone ${leftMoves.exact} px, right alone ${rightMoves.exact} px, ` +
    `both vs left ${bothVsLeft.exact} px, both vs right ${bothVsRight.exact} px`,
);
if (leftMoves.exact <= floor.exact || rightMoves.exact <= floor.exact) {
  throw new Error('a single obstacle changed nothing: the capture is not exercising the squeeze');
}
if (bothVsLeft.exact <= floor.exact || bothVsRight.exact <= floor.exact) {
  throw new Error(
    'two opposed obstacles collapsed onto one of them: the modal basis is averaging rather than summing',
  );
}

// --- leg 3: the reaction lands and respects its cap ------------------------
await setConfig({ stage: { push: 1, maxPush: 24 } });
await setParticipants([RIGHT, FLOAT]);
await page.waitForTimeout(900);
const pushed = await readPush(FLOAT.id);
const obstaclePush = await readPush(RIGHT.id);
const magnitude = Math.hypot(pushed.x, pushed.y);
manifest.legs.reaction = { pushed, obstaclePush, magnitude };
console.log(
  `body element pushed (${pushed.x}, ${pushed.y}) = ${magnitude.toFixed(2)} px; ` +
    `obstacle element pushed (${obstaclePush.x}, ${obstaclePush.y})`,
);
if (magnitude === 0) {
  throw new Error('a data-hologlyph-body element picked up no transform: the reaction never landed');
}
if (magnitude > 24 + 0.05) {
  throw new Error(`the reaction reached ${magnitude.toFixed(2)} px, past the 24 px cap`);
}
if (obstaclePush.x !== 0 || obstaclePush.y !== 0) {
  throw new Error('a data-hologlyph-obstacle element moved: only data-hologlyph-body may be pushed');
}

// --- leg 4: the pool dents under a submerged participant -------------------
// `fluid.amount` back to 0, so this leg measures WATER and nothing else. The
// two halves are gated independently on purpose: the colliders are resolved
// whatever the body is doing, and the pool consumes them behind its own gate.
await setConfig({ fluid: { amount: 0 }, pool: { amount: 1 }, stage: { displace: 1 } });
await setParticipants([]);
const poolRest = await shoot('pool-rest');
await setParticipants([{ ...RIGHT, top: 0.88 }]);
const poolDent = await shoot('pool-dent');
const dent = compare(poolRest.image, poolDent.image);
manifest.legs.poolDent = dent;
console.log(`a participant crossing the waterline moves ${dent.exact} px of water`);
if (dent.exact <= floor.exact) {
  throw new Error('a submerged participant left the pool flat: the dent is not reaching the field');
}

// Leave the page on the shipped configuration, so a human who opens the lab
// after a run is not looking at the smoke's settings.
await setParticipants([]);
await setConfig({ fluid: { amount: 0 }, pool: { amount: 0 } });
await browser.close();

const manifestPath = join(OUT, 'stage-shot.json');
writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`manifest ${manifestPath}`);
console.log(`captures in ${OUT}`);
