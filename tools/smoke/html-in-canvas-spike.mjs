/**
 * Lab spike (dev-only): is the Chromium HTML-in-Canvas API a viable refraction
 * source for hologlyph? Runs `demo/html-in-canvas-spike.html` in the installed
 * Google Chrome with the feature flag on, measures the per-frame cost of
 * uploading a live DOM subtree into a WebGL texture, and probes the three
 * restrictions that decide whether it can ever be a drop-in path:
 *
 *   1. can it draw an ANCESTOR of the canvas (the "page behind the head" case)
 *   2. can it draw an element outside any canvas layoutsubtree
 *   3. does drawing taint a 2D canvas
 *
 * Usage: node tools/smoke/html-in-canvas-spike.mjs [url]
 */
import { chromium } from 'playwright';

const URL = process.argv[2] ?? 'http://localhost:5173/hologlyph/html-in-canvas-spike.html';
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

const browser = await chromium.launch({
  executablePath: CHROME,
  headless: false,
  args: [
    '--enable-blink-features=CanvasDrawElement',
    '--enable-gpu',
    '--force-device-scale-factor=2',
  ],
});
const page = await browser.newPage({ viewport: { width: 1400, height: 900 }, deviceScaleFactor: 2 });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
await page.goto(URL, { waitUntil: 'load' });
await page.waitForTimeout(1500);

const report = await page.evaluate(() => window.__spike(4000));

// Interaction leg: the drawn pixels are refracted, so they are nowhere near the
// element's layout box. Click where the input APPEARS, and where it actually
// lives, and see which one focuses it.
const before = await page.evaluate(() => window.__interactionProbe());
const canvasBox = await page.locator('#gl').boundingBox();
await page.mouse.click(canvasBox.x + canvasBox.width * 0.5, canvasBox.y + canvasBox.height * 0.36);
const afterCanvasClick = await page.evaluate(() => window.__interactionProbe());
await page.keyboard.type('XY');
const afterTypingIntoCanvas = await page.evaluate(() => window.__interactionProbe());

await page.evaluate(() => document.getElementById('typed').focus());
await page.keyboard.type('ZZ');
const afterProgrammaticFocus = await page.evaluate(() => window.__interactionProbe());

await page.screenshot({ path: '/tmp/holo-backdrop/html-in-canvas.png' });

console.log(
  JSON.stringify(
    {
      ...report,
      interaction: { before, afterCanvasClick, afterTypingIntoCanvas, afterProgrammaticFocus },
      pageErrors: errors,
    },
    null,
    2,
  ),
);
await browser.close();
