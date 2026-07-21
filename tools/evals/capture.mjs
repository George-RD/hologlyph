import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

// Optional real-browser override, e.g. HOLOGLYPH_CHROME=/Applications/Google Chrome.app/Contents/MacOS/Google Chrome
const CHROME = process.env.HOLOGLYPH_CHROME;
const DEFAULT_URL = 'http://localhost:5173/hologlyph/engine.html';
const OUTPUT_DIR = fileURLToPath(new URL('./out/', import.meta.url));
const VIEWPORT = { width: 1100, height: 800 };
const CANVAS_SELECTOR = '#holo';
const SETTLE_AFTER_LOAD_MS = 4000;
const SETTLE_AFTER_POSE_MS = 800;

mkdirSync(OUTPUT_DIR, { recursive: true });
const url = process.argv[2] ?? DEFAULT_URL;
const browser = await chromium.launch({
  ...(CHROME ? { executablePath: CHROME } : {}),
  // ANGLE Metal only exists on macOS; elsewhere let Chromium pick (SwiftShader in CI).
  args: ['--no-sandbox', ...(process.platform === 'darwin' ? ['--use-angle=metal'] : [])],
});
const page = await browser.newPage({ viewport: VIEWPORT, deviceScaleFactor: 1 });
const pageErrors = [];
page.on('pageerror', (error) => pageErrors.push(error.message));
page.on('console', (message) => {
  if (message.type() === 'error') console.error(`[console] ${message.text().slice(0, 240)}`);
});

// The production engine currently has no browser-facing seed hook. This keeps
// its default Math.random-driven gaze sequence repeatable without changing src/.
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

async function settlePage() {
  await page.goto(url, { waitUntil: 'load' });
  await page.waitForFunction(() => document.querySelector('#holo')?.getBoundingClientRect().width > 0, null, { timeout: 30000 });
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await page.waitForFunction(() => document.getElementById('state')?.textContent === 'state: idle', null, { timeout: 30000 });
  await page.waitForTimeout(SETTLE_AFTER_LOAD_MS);
}

async function canvasBox() {
  return await page.locator(CANVAS_SELECTOR).boundingBox();
}

async function captureCanvas(name) {
  const path = join(OUTPUT_DIR, `${name}.png`);
  await page.locator(CANVAS_SELECTOR).screenshot({ path });
  return path;
}

async function captureCloseUp(name) {
  const box = await canvasBox();
  if (!box) throw new Error('Could not locate the #holo canvas for close-up capture');
  const path = join(OUTPUT_DIR, `${name}.png`);
  await page.screenshot({
    path,
    clip: {
      x: box.x + box.width * 0.18,
      y: box.y + box.height * 0.08,
      width: box.width * 0.64,
      height: box.height * 0.82,
    },
  });
  return path;
}

async function setMotionFrozen(frozen) {
  await page.evaluate((value) => {
    const engine = window.__hologlyphEngine;
    if (!engine || typeof engine.setMotionFrozen !== 'function') {
      throw new Error('Demo engine missing setMotionFrozen; eval flow capture needs deterministic motion control.');
    }
    engine.setMotionFrozen(value);
  }, frozen);
}

async function captureFlowPair(captures) {
  await setMotionFrozen(true);
  await page.waitForTimeout(SETTLE_AFTER_POSE_MS);
  try {
    captures.push(await captureCanvas('flow-0'));
    await page.waitForTimeout(1000);
    captures.push(await captureCanvas('flow-1'));
  } finally {
    await setMotionFrozen(false);
  }
}

// Produce a true yaw view by orbiting the live renderer camera around the head
// origin. The motion API clamps head yaw to +/-0.5 rad (src/motion/index.ts
// DRAG_YAW_LIMIT), so the requested +/-0.6 rad view is achieved by orbiting the
// camera (initial position (0, 0.05, 2.4)) instead of rotating the head. This
// needs no src/ change: the engine exposes sysRenderer.camera at runtime via
// the demo-only window.__hologlyphEngine hook. The engine never resets the
// camera per frame, so the pose persists until the next page reload.
async function orbitCamera(yaw) {
  await page.evaluate((targetYaw) => {
    const engine = window.__hologlyphEngine;
    const renderer = engine?.sysRenderer;
    const camera = renderer?.camera;
    if (!camera) throw new Error('renderer camera not reachable via window.__hologlyphEngine');
    const radius = 2.4;
    camera.position.set(radius * Math.sin(targetYaw), 0.05, radius * Math.cos(targetYaw));
    camera.lookAt(0, 0, 0);
  }, yaw);
  await page.waitForTimeout(SETTLE_AFTER_POSE_MS);
}

const captures = [];
try {
  await settlePage();
  captures.push(await captureCanvas('front'));

  await settlePage();
  await orbitCamera(0.6);
  captures.push(await captureCanvas('yaw-plus-0.6'));

  await settlePage();
  await orbitCamera(-0.6);
  captures.push(await captureCanvas('yaw-minus-0.6'));

  await settlePage();
  captures.push(await captureCloseUp('close-up'));

  await settlePage();
  await captureFlowPair(captures);

  await settlePage();
  await orbitCamera(0.785);
  captures.push(await captureCanvas('yaw-0.785'));
} finally {
  await browser.close();
}

const result = { url, captures, pageErrors };
console.log(JSON.stringify(result, null, 2));
if (pageErrors.length > 0) {
  throw new Error(`Page errors during capture: ${pageErrors.join('; ')}`);
}
