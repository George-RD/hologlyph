import { chromium } from 'playwright';
import { blendZoneGhosting, decodePng } from '../evals/score.mjs';

const BASE = process.env.HOLOGLYPH_BASE ?? 'http://127.0.0.1:5199/hologlyph/';
const CHROME = process.env.HOLOGLYPH_CHROME;
const browser = await chromium.launch({
  ...(CHROME ? { executablePath: CHROME } : {}),
  args: ['--no-sandbox', ...(process.platform === 'darwin' ? ['--use-angle=metal'] : [])],
});
let failure = null;
try {
const page = await browser.newPage({ viewport: { width: 1280, height: 820 } });
const errors = [];
page.on('pageerror', (error) => errors.push(error.message));

await page.goto(`${BASE}?tune`, { waitUntil: 'load' });
await page.waitForFunction(
  () => document.getElementById('status')?.textContent?.startsWith('live'),
  null,
  { timeout: 60_000 },
);
await page.evaluate(() => {
  const lab = window.__lab;
  lab.state.idle = false;
  lab.state.scrollSpeed = 0;
  lab.U.scroll.value = 0;
  const sparseMarker = `I${'\u200b'.repeat(15)}`;
  lab.skin.setSource({
    getText: () => sparseMarker,
    onChange: () => () => {},
  });
  lab.scene.background.set('#04060b');
  lab.controls.enabled = false;
  const radius = 2.4;
  const yaw = 0.785;
  lab.camera.position.set(radius * Math.sin(yaw), 0.05, radius * Math.cos(yaw));
  lab.camera.lookAt(0, 0, 0);
  lab.uLegacyProjection.value = 0;
});
await page.waitForTimeout(1_000);
await page.locator('#view').screenshot({ path: '/tmp/hologlyph-seam-current.png' });
await page.evaluate(() => {
  window.__lab.uLegacyProjection.value = 1;
});
await page.waitForTimeout(1_000);
await page.locator('#view').screenshot({ path: '/tmp/hologlyph-seam-legacy.png' });
await page.evaluate(() => {
  const lab = window.__lab;
  lab.uLegacyProjection.value = 0;
  lab.scene.traverse((object) => {
    if (!object.isMesh) return;
    if (object.material === lab.headMat) {
      object.material = lab.blendMaskMat;
    } else {
      object.visible = false;
    }
  });
});
await page.waitForTimeout(1_000);
await page.locator('#view').screenshot({ path: '/tmp/hologlyph-seam-mask.png' });

const currentImage = decodePng('/tmp/hologlyph-seam-current.png');
const legacyImage = decodePng('/tmp/hologlyph-seam-legacy.png');
const maskImage = decodePng('/tmp/hologlyph-seam-mask.png');
const mask = new Uint8Array(maskImage.width * maskImage.height);
let maskPixels = 0;
for (let index = 0; index < mask.length; index++) {
  const offset = index * maskImage.channels;
  const luminance =
    maskImage.data[offset] * 0.2126 +
    maskImage.data[offset + 1] * 0.7152 +
    maskImage.data[offset + 2] * 0.0722;
  if (luminance > 80) {
    mask[index] = 1;
    maskPixels++;
  }
}
const glyphThreshold = 20;
const coverage = (image) => {
  let bright = 0;
  for (let index = 0; index < mask.length; index++) {
    if (!mask[index]) continue;
    const offset = index * image.channels;
    const luminance =
      image.data[offset] * 0.2126 +
      image.data[offset + 1] * 0.7152 +
      image.data[offset + 2] * 0.0722;
    if (luminance > glyphThreshold) bright++;
  }
  return maskPixels > 0 ? bright / maskPixels : 0;
};
const interpolated = blendZoneGhosting(currentImage, mask, glyphThreshold);
const legacy = blendZoneGhosting(legacyImage, mask, glyphThreshold);
const interpolatedCoverage = coverage(currentImage);
const legacyCoverage = coverage(legacyImage);
if (errors.length > 0) throw new Error(`Page errors: ${errors.join('; ')}`);
if (maskPixels < 100) throw new Error(`Blend mask was too small: ${maskPixels} pixels`);
if (!(interpolated < legacy)) {
  throw new Error(`Single-sample projection did not improve localized ghosting: interpolated=${interpolated}, legacy=${legacy}`);
}
if (interpolatedCoverage < legacyCoverage * 0.8) {
  throw new Error(`Single-sample projection lost localized coverage: interpolated=${interpolatedCoverage}, legacy=${legacyCoverage}`);
}
console.log(JSON.stringify({
  maskPixels,
  interpolated,
  legacy,
  interpolatedCoverage,
  legacyCoverage,
}, null, 2));
console.log('PASS: single-sample projection reduces localized blend-zone ghosting');
} catch (error) {
  failure = error;
}
await browser.close();
if (failure) throw failure;
