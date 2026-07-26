/**
 * Live lens smoke shot (dec.liquid-glass-architecture, rung 3, item 5).
 *
 * The Chromium HTML-in-Canvas enhancement cannot be exercised in vitest: the
 * API exists only in Chromium behind `--enable-blink-features=CanvasDrawElement`
 * and paints real DOM on the compositor. So the three claims that matter are
 * measured here, in the installed Google Chrome, against
 * `demo/live-lens-lab.html`:
 *
 *   1. it ENGAGES only where detected, and refracts the named subtree
 *   2. it is LIVE: the refracted pixels move while the DOM moves, where the
 *      snapshot path holds the same frame
 *   3. its ABSENCE changes nothing: the same page with the flag off falls back
 *      to the snapshot path with no errors and a head that still renders
 *
 * Plus the hit-testing clause of the acceptance: a control under the head is
 * unreachable at its own layout box and the engine says so, while a control
 * outside the distorted region focuses normally.
 *
 * Dev-only. Needs `bun run dev` and a real Chrome; nothing in CI runs it.
 *
 * Usage: node tools/smoke/live-lens-shot.mjs [--url ...] [--out ...]
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { decodePng, luminance } from '../evals/score.mjs';

const args = process.argv.slice(2);
const readArg = (flag, fallback) => {
  const at = args.indexOf(flag);
  return at >= 0 && args[at + 1] ? args[at + 1] : fallback;
};

const URL_TARGET = readArg('--url', 'http://localhost:5173/hologlyph/live-lens-lab.html');
const OUT = readArg('--out', fileURLToPath(new URL('./out/', import.meta.url)));
const CHROME = readArg('--chrome', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome');

const VIEWPORT = { width: 1200, height: 900 };

/** The head sits at left 200, top 40, 420x720 in the lab layout. */
const HEAD_BOX = { x: 210, y: 60, width: 400, height: 680 };
/**
 * A static strip below the live canvas, which ends at y 760: everything inside
 * the source animates by design, so the control region has to be page that
 * does not.
 */
const PAGE_BOX = { x: 40, y: 790, width: 260, height: 80 };

mkdirSync(OUT, { recursive: true });

const manifest = { url: URL_TARGET, capturedAt: new Date().toISOString(), legs: {} };
const failures = [];
const check = (name, ok, detail) => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}  ${detail}`);
  if (!ok) failures.push(name);
};

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
      if (
        a.data[i] === b.data[j] &&
        a.data[i + 1] === b.data[j + 1] &&
        a.data[i + 2] === b.data[j + 2]
      ) {
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

/**
 * Open the lab. `flag` off is the negative control: the same page, the same
 * code path, with the capability missing.
 */
async function openLab({ flag }) {
  const browser = await chromium.launch({
    executablePath: CHROME,
    headless: false,
    args: [
      ...(flag ? ['--enable-blink-features=CanvasDrawElement'] : []),
      '--enable-gpu',
      '--force-device-scale-factor=1',
    ],
  });
  const page = await browser.newPage({ viewport: VIEWPORT, deviceScaleFactor: 1 });
  // Reduced motion stops the text-skin row flow, so the head's own animation
  // cannot be mistaken for refracted content. The lab's CSS animation and its
  // per-frame counter are not media-query guarded, so the SOURCE keeps moving.
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const errors = [];
  const warnings = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (m) => {
    const where = m.location()?.url ?? '';
    // Vite serves no favicon, so every page here logs one 404 that has nothing
    // to do with the lens.
    if (where.endsWith('/favicon.ico')) return;
    if (m.type() === 'error') errors.push(`${m.text().slice(0, 200)} @ ${where}`);
    if (m.type() === 'warning') warnings.push(m.text().slice(0, 240));
  });
  await page.goto(URL_TARGET, { waitUntil: 'load' });
  await page.waitForFunction(() => !!window.__hologlyphEngine?.avatar, null, { timeout: 30_000 });
  await page.waitForTimeout(2500);
  // Freeze the rig, not the page: the head must hold still so any pixel change
  // inside its silhouette comes from the refracted subtree and nothing else.
  await page.evaluate(() => {
    const engine = window.__hologlyphEngine;
    engine.setMotionFrozen(true);
    for (const bone of Object.values(engine.avatar.bones)) bone?.quaternion.set(0, 0, 0, 1);
    for (const mesh of engine.avatar.morphMeshes) mesh.morphTargetInfluences?.fill(0);
  });
  return { browser, page, errors, warnings };
}

const shoot = (page, tag) => {
  const path = join(OUT, `live-lens-${tag}.png`);
  return page.screenshot({ path }).then(() => ({ tag, path, image: decodePng(path) }));
};

const setSource = async (page, next) => {
  await page.evaluate((m) => window.__liveLensLab.setSource(m), next);
  await page.waitForTimeout(1200);
};

// === flagged run ===========================================================
{
  const { browser, page, errors, warnings } = await openLab({ flag: true });

  // --- leg 0: the capability is actually present ---------------------------
  const capability = await page.evaluate(() => window.__liveLensLab.capability);
  manifest.legs.capability = capability;
  check(
    'HTML-in-Canvas is detected with the flag on',
    capability.supported === true,
    JSON.stringify(capability),
  );
  if (!capability.supported) {
    console.error('\nno capability: relaunch with a Chrome that still honours CanvasDrawElement');
    await browser.close();
    process.exit(1);
  }

  // --- leg 1: the head's own residual motion, the floor every later leg is
  // measured against. Reduced motion pins the text-skin flow and the rig is
  // frozen, but a frame is never bit-identical to the one a second later, and
  // pretending otherwise would make the liveness legs brittle.
  await setSource(page, 'none');
  const off = await shoot(page, 'source-off');
  await page.waitForTimeout(1000);
  const offAgain = await shoot(page, 'source-off-again');
  const floor = compare(off.image, offAgain.image, HEAD_BOX);
  manifest.legs.floor = floor;
  console.log(`floor: ${floor.over3} px over 3 luma with no source, one second apart`);

  // --- leg 2: the enhancement refracts the named subtree -------------------
  await setSource(page, 'live');
  const live = await shoot(page, 'live');
  const engaged = compare(off.image, live.image, HEAD_BOX);
  manifest.legs.engaged = engaged;
  check(
    'the live subtree is refracted through the head',
    engaged.over3 > 6_000,
    `${engaged.over3} px over 3 luma inside the head box`,
  );

  // --- leg 3: it is LIVE, and the snapshot path is not ---------------------
  // Two captures a second apart with the DOM animating. This is the whole
  // feature: the same comparison on the snapshot path must fall back to the
  // floor, because a frozen texture cannot contribute anything.
  const liveA = await shoot(page, 'live-t0');
  await page.waitForTimeout(1000);
  const liveB = await shoot(page, 'live-t1');
  const moved = compare(liveA.image, liveB.image, HEAD_BOX);
  manifest.legs.moved = moved;
  check(
    'the refracted content keeps moving while the DOM moves',
    moved.over3 > Math.max(1_000, floor.over3 * 4),
    `${moved.over3} px over 3 luma a second apart, floor ${floor.over3}`,
  );

  await setSource(page, 'snapshot');
  const snapA = await shoot(page, 'snapshot-t0');
  await page.waitForTimeout(1000);
  const snapB = await shoot(page, 'snapshot-t1');
  const frozen = compare(snapA.image, snapB.image, HEAD_BOX);
  manifest.legs.frozen = frozen;
  check(
    'the snapshot path contributes no motion of its own',
    frozen.over3 < moved.over3 / 4,
    `${frozen.over3} px over 3 luma against ${moved.over3} live, floor ${floor.over3}`,
  );

  // --- leg 4: the page outside the silhouette is untouched -----------------
  await setSource(page, 'live');
  const liveAgain = await shoot(page, 'live-again');
  const outside = compare(off.image, liveAgain.image, PAGE_BOX);
  manifest.legs.outside = outside;
  check(
    'the page outside the silhouette is untouched',
    outside.over3 === 0,
    `${outside.over3} px over 3 luma in the control strip`,
  );

  // --- leg 5: hit-testing, the acceptance clause ---------------------------
  const reachable = await page.evaluate(() => window.__liveLensLab.probeHit('reachable'));
  manifest.legs.reachable = reachable;
  check(
    'a control outside the distorted region is reachable and focusable',
    reachable.elementAtLayoutBox === 'reachable' && reachable.focused === 'reachable',
    JSON.stringify(reachable),
  );

  warnings.length = 0;
  await page.evaluate(() => window.__liveLensLab.showTrap(true));
  await page.waitForTimeout(600);
  const trapped = await page.evaluate(() => window.__liveLensLab.probeHit('trapped'));
  manifest.legs.trapped = trapped;
  manifest.legs.trapWarning = warnings.filter((w) => w.includes('interactive control'));
  check(
    'a control under the head is unreachable at its own layout box',
    trapped.elementAtLayoutBox !== 'trapped',
    `layout box hit ${trapped.elementAtLayoutBox}`,
  );
  check(
    'the engine warns rather than letting a control go quietly dead',
    manifest.legs.trapWarning.length > 0,
    manifest.legs.trapWarning[0] ?? 'no warning seen',
  );

  manifest.legs.flaggedErrors = errors;
  check('no page errors with the flag on', errors.length === 0, errors.join(' | ') || 'clean');
  await browser.close();
}

// === unflagged run: absence changes nothing ================================
{
  const { browser, page, errors } = await openLab({ flag: false });
  const capability = await page.evaluate(() => window.__liveLensLab.capability);
  manifest.legs.capabilityUnflagged = capability;
  check(
    'the capability is absent without the flag, which is the normal case',
    capability.supported === false,
    JSON.stringify(capability),
  );

  // The lab asks for the live source on load. With no capability the engine
  // must build the snapshot lens instead, silently, and keep rendering.
  await setSource(page, 'live');
  const fallback = await shoot(page, 'unflagged-live-request');
  await setSource(page, 'none');
  const bare = await shoot(page, 'unflagged-none');
  const still = compare(fallback.image, bare.image, HEAD_BOX);
  manifest.legs.unflagged = still;
  check(
    'the head still renders and still refracts through the snapshot fallback',
    still.over3 > 3_000,
    `${still.over3} px over 3 luma between source on and off`,
  );
  manifest.legs.unflaggedErrors = errors;
  check('no page errors with the flag off', errors.length === 0, errors.join(' | ') || 'clean');
  await browser.close();
}

writeFileSync(join(OUT, 'live-lens-shot.json'), `${JSON.stringify(manifest, null, 2)}\n`);

if (failures.length > 0) {
  console.error(`\n${failures.length} leg(s) failed: ${failures.join(', ')}`);
  process.exit(1);
}
console.log('\nall legs passed');
