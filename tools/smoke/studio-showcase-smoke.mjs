import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from 'playwright';
import { decodePng } from '../evals/score.mjs';

const BASE = process.argv[2] ?? 'http://127.0.0.1:5199/hologlyph/';
const OUT = '/tmp/studio-shots';
mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch({
  ...(process.env.HOLOGLYPH_CHROME ? { executablePath: process.env.HOLOGLYPH_CHROME } : {}),
  args: ['--no-sandbox', ...(process.platform === 'darwin' ? ['--use-angle=metal'] : [])],
});
const page = await browser.newPage({ reducedMotion: 'reduce' });
const errors = [];
page.on('pageerror', (error) => errors.push(error.message));
page.on('console', (message) => {
  if (['error', 'warning'].includes(message.type())) errors.push(`${message.type()}: ${message.text()}`);
});
try {

async function gotoStudio() {
  const response = await page.goto(`${BASE}index.html`, { waitUntil: 'load' });
  if (response?.status() !== 200) throw new Error(`studio navigation returned ${response?.status() ?? 'no response'}`);
  if (new URL(response.url()).pathname !== '/hologlyph/index.html') {
    throw new Error(`studio navigation resolved to ${response.url()}, not /hologlyph/index.html`);
  }
  await page.locator('#rail').waitFor();
  await page.waitForFunction(() => window.__hologlyphEngine?.view);
  await page.evaluate(() => {
    window.__hologlyphEngine.vfx.setReducedMotion(true);
    window.__hologlyphEngine.setView({ yaw: 0, height: 0.05, distance: 2.4, lookAt: 0, fov: 35 });
    window.__hologlyphEngine.motion.clearGazeFollow();
  });
}

function largestComponentBounds(mask, width, height) {
  const visited = new Uint8Array(mask.length);
  const queue = new Int32Array(mask.length);
  let largest = null;
  for (let start = 0; start < mask.length; start++) {
    if (!mask[start] || visited[start]) continue;
    let read = 0; let write = 1; let count = 0;
    let minX = width; let maxX = -1; let minY = height; let maxY = -1;
    queue[0] = start;
    visited[start] = 1;
    while (read < write) {
      const index = queue[read++];
      const x = index % width;
      const y = Math.floor(index / width);
      count++;
      minX = Math.min(minX, x); maxX = Math.max(maxX, x);
      minY = Math.min(minY, y); maxY = Math.max(maxY, y);
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        if (dx === 0 && dy === 0) continue;
        const nx = x + dx; const ny = y + dy;
        if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue;
        const next = ny * width + nx;
        if (!mask[next] || visited[next]) continue;
        visited[next] = 1;
        queue[write++] = next;
      }
    }
    if (!largest || count > largest.count) largest = { minX, maxX, minY, maxY, count };
  }
  return largest;
}

// Regression: one bright edge pixel must not expand the centred subject bounds.
{
  const mask = new Uint8Array(9 * 5);
  for (let y = 1; y <= 3; y++) for (let x = 3; x <= 5; x++) mask[y * 9 + x] = 1;
  mask[8] = 1;
  const bounds = largestComponentBounds(mask, 9, 5);
  if (!bounds || bounds.minX !== 3 || bounds.maxX !== 5 || bounds.count !== 9) {
    throw new Error('largest-component bounds include an isolated foreground outlier');
  }
}

function centroid(path, threshold = 55) {
  const { data, width, height, channels } = decodePng(path);
  let count = 0; let sumX = 0;
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const i = (y * width + x) * channels;
    if (Math.abs(data[i] - 5) + Math.abs(data[i + 1] - 7) + Math.abs(data[i + 2] - 13) < threshold) continue;
    count++; sumX += x;
  }
  return { x: sumX / count, count };
}

function largestForegroundBounds(path, threshold = 55) {
  const { data, width, height, channels } = decodePng(path);
  const mask = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const index = y * width + x;
    const i = index * channels;
    if (Math.abs(data[i] - 5) + Math.abs(data[i + 1] - 7) + Math.abs(data[i + 2] - 13) >= threshold) mask[index] = 1;
  }
  const bounds = largestComponentBounds(mask, width, height);
  return { width, bounds };
}

function residualOffset(path) {
  const sample = centroid(path);
  const { width, bounds } = largestForegroundBounds(path);
  const thresholds = Object.fromEntries([30, 55, 80, 110].map((threshold) => {
    const value = centroid(path, threshold);
    return [threshold, value.x - width / 2];
  }));
  return {
    width,
    centroidOffset: sample.x - width / 2,
    bboxOffset: bounds ? (bounds.minX + bounds.maxX) / 2 - width / 2 : Number.NaN,
    thresholds,
    count: sample.count,
  };
}

function mouthMotion(before, after) {
  const first = decodePng(before); const second = decodePng(after);
  const left = Math.floor(first.width * 0.32); const right = Math.ceil(first.width * 0.68);
  const top = Math.floor(first.height * 0.48); const bottom = Math.ceil(first.height * 0.68);
  let changed = 0;
  for (let y = top; y < bottom; y++) for (let x = left; x < right; x++) {
    const i = (y * first.width + x) * first.channels;
    const delta = Math.abs(first.data[i] - second.data[i]) + Math.abs(first.data[i + 1] - second.data[i + 1]) + Math.abs(first.data[i + 2] - second.data[i + 2]);
    if (delta > 20) changed++;
  }
  return changed;
}

const cases = [['1440x900', 1440, 900, false], ['1280x800', 1280, 800, false], ['1920x1080', 1920, 1080, false], ['900x700', 900, 700, false], ['1440x900-focus', 1440, 900, true]];
const results = [];
for (const [name, width, height, focus] of cases) {
  await page.setViewportSize({ width, height });
  await gotoStudio();
  if (focus) await page.click('#focus');
  await page.waitForTimeout(500);
  const stage = await page.locator('#stage').boundingBox();
  await page.screenshot({ path: join(OUT, `presentation-${name}.png`) });
  await page.evaluate(() => document.body.classList.add('measuring'));
  const path = join(OUT, `${name}.png`);
  await page.locator('#holo').screenshot({ path });
  await page.evaluate(() => document.body.classList.remove('measuring'));
  const head = centroid(path);
  const shell = centroid(path, 30);
  const { bounds } = largestForegroundBounds(path);
  const bboxCentre = bounds ? (bounds.minX + bounds.maxX) / 2 : Number.NaN;
  results.push({
    name,
    centroid: head.x + stage.x,
    shellCentroid: shell.x + stage.x,
    bboxCentre: bboxCentre + stage.x,
    stageCentre: stage.x + stage.width / 2,
    offset: head.x - stage.width / 2,
    shellOffset: shell.x - stage.width / 2,
    bboxOffset: bboxCentre - stage.width / 2,
    pixels: head.count,
  });
}

await page.setViewportSize({ width: 1440, height: 900 });
await gotoStudio();
await page.waitForTimeout(500);
await page.evaluate(() => document.body.classList.add('measuring'));
await page.locator('#holo').screenshot({ path: join(OUT, 'residual-reduced.png') });
const residualReduced = residualOffset(join(OUT, 'residual-reduced.png'));
await page.evaluate(() => document.body.classList.remove('measuring'));

await gotoStudio();
await page.evaluate(() => window.__hologlyphEngine.setMotionFrozen(true));
await page.waitForTimeout(500);
await page.evaluate(() => document.body.classList.add('measuring'));
await page.locator('#holo').screenshot({ path: join(OUT, 'residual-frozen.png') });
const residualFrozen = residualOffset(join(OUT, 'residual-frozen.png'));
await page.evaluate(() => document.body.classList.remove('measuring'));

await page.setViewportSize({ width: 1440, height: 900 });
await gotoStudio();
const poseBefore = await page.evaluate(() => window.__hologlyphEngine.view);
await page.mouse.move(700, 400); await page.mouse.down(); await page.mouse.move(820, 350); await page.mouse.up();
const poseAfterDrag = await page.evaluate(() => window.__hologlyphEngine.view);
const yawSlider = Number(await page.evaluate(() => [...document.querySelectorAll('#rail label')]
  .find((label) => label.textContent === 'orbit')?.nextElementSibling?.value));
await page.locator('#holo').hover({ position: { x: 332, y: 400 } });
await page.mouse.wheel(0, 120);
const poseAfterWheel = await page.evaluate(() => window.__hologlyphEngine.view);
const distanceSlider = Number(await page.evaluate(() => [...document.querySelectorAll('#rail label')]
  .find((label) => label.textContent === 'distance')?.nextElementSibling?.value));
await page.locator('#holo').dispatchEvent('dblclick');
await page.waitForTimeout(50);
const poseAfterReset = await page.evaluate(() => window.__hologlyphEngine.view);

await page.click('#focus');
await page.setViewportSize({ width: 700, height: 800 });
await page.waitForTimeout(300);
await page.click('#focus');
await page.waitForTimeout(300);
const breakpointRail = await page.locator('#rail').boundingBox();
const railWidth = await page.evaluate(() => Number.parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--rail')) * Number.parseFloat(getComputedStyle(document.documentElement).fontSize));
await page.setViewportSize({ width: 1440, height: 900 });
await gotoStudio();
await page.evaluate(() => {
  const motion = window.__hologlyphEngine.motion;
  const target = motion.setGazeTarget.bind(motion);
  window.__studioGazeCalls = 0;
  motion.setGazeTarget = (...args) => { window.__studioGazeCalls++; return target(...args); };
});
await page.locator('#holo').hover({ position: { x: 450, y: 350 } });
await page.waitForTimeout(20);
const gazeCallsBeforeDrag = await page.evaluate(() => window.__studioGazeCalls);
await page.mouse.move(700, 400);
const gazeCallsAtDragStart = await page.evaluate(() => window.__studioGazeCalls);
await page.mouse.down(); await page.mouse.move(820, 350); await page.mouse.up();
const gazeCallsAfterDrag = await page.evaluate(() => window.__studioGazeCalls);

await page.evaluate(() => {
  window.__studioSpeechEvents = [];
  window.__hologlyphEngine.on('speechstart', () => window.__studioSpeechEvents.push('start'));
  window.__hologlyphEngine.on('speechend', () => window.__studioSpeechEvents.push('end'));
});
await page.locator('#say').fill('Hologlyph speaks clearly with a moving mouth, shaping every syllable into a visible expression while this deliberately long sentence keeps the browser utterance active for the cancellation check.');
const before = await page.locator('#holo').screenshot();
await page.locator('#speak').click(); await page.waitForTimeout(800);
const during = await page.locator('#holo').screenshot();
const speakingBeforeCancel = await page.evaluate(() => window.__hologlyphEngine.speech.speaking);
await page.locator('#speak').click(); await page.waitForTimeout(150);
const speakingAfterCancel = await page.evaluate(() => window.__hologlyphEngine.speech.speaking);
const afterCancel = await page.locator('#speak').textContent();
const speechEvents = await page.evaluate(() => window.__studioSpeechEvents);
const mouthPixelsChanged = mouthMotion(before, during);
console.log(JSON.stringify({ results, residualReduced, residualFrozen, breakpointRail, poseBefore, poseAfterDrag, yawSlider, poseAfterWheel, distanceSlider, poseAfterReset, gazeCallsBeforeDrag, gazeCallsAtDragStart, gazeCallsAfterDrag, speechEvents, mouthPixelsChanged, speakingBeforeCancel, speakingAfterCancel, afterCancel, errors }, null, 2));
const failures = [];
// The threshold-55 centroid is a brightness diagnostic: glyph and lighting
// mass bias it camera-right by resolution-dependent amounts. Shell centroid
// and silhouette bounds are the position assertions.
for (const result of results) {
  if (!Number.isFinite(result.shellOffset) || Math.abs(result.shellOffset) > 2) failures.push(`${result.name}: shell-centroid offset ${result.shellOffset}`);
  if (!Number.isFinite(result.bboxOffset) || Math.abs(result.bboxOffset) > 2) failures.push(`${result.name}: silhouette bounds offset ${result.bboxOffset}`);
}
if (poseAfterDrag.yaw === poseBefore.yaw || Math.abs(yawSlider - poseAfterDrag.yaw) > 0.011) failures.push('drag did not update public pose and matching orbit slider');
if (poseAfterWheel.distance === poseAfterDrag.distance || Math.abs(distanceSlider - poseAfterWheel.distance) > 0.011) failures.push('wheel did not update public pose and matching distance slider');
if (poseAfterReset.yaw !== 0 || poseAfterReset.height !== 0.05 || poseAfterReset.distance !== 2.4) failures.push('double-click did not restore the default view');
if (!breakpointRail || breakpointRail.x < -1 || Math.abs(breakpointRail.width - railWidth) > 0.5) failures.push('rail did not reopen after crossing the breakpoint');
if (!gazeCallsBeforeDrag || gazeCallsAfterDrag !== gazeCallsAtDragStart) failures.push('gaze did not follow normally or was not suppressed during drag');
if (!speechEvents.includes('start') || !speechEvents.includes('end') || mouthPixelsChanged < 50 || !speakingBeforeCancel || speakingAfterCancel || afterCancel !== 'Speak') failures.push('speech did not emit lifecycle events, move the mouth, and cancel');
if (errors.length) failures.push(`console/page errors: ${errors.join('; ')}`);
if (failures.length) throw new Error(`STUDIO SHOWCASE SMOKE FAILED\n${failures.join('\n')}`);
console.log('STUDIO SHOWCASE SMOKE PASSED');
} finally {
  await browser.close();
}
