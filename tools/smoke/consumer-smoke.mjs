import { chromium } from 'playwright';

const CHROME = process.env.HOLOGLYPH_CHROME;
const browser = await chromium.launch({
  ...(CHROME ? { executablePath: CHROME } : {}),
  args: ['--no-sandbox', ...(process.platform === 'darwin' ? ['--use-angle=metal'] : [])],
});
const page = await browser.newPage({ viewport: { width: 900, height: 700 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
const requests = [];
page.on('request', (r) => { if (r.url().includes('default-avatar') || r.url().includes('.glb')) requests.push(r.url()); });

async function canvasStats(targetPage) {
  const buffer = await targetPage.locator('#c').screenshot();
  const dataUrl = `data:image/png;base64,${buffer.toString('base64')}`;
  return targetPage.evaluate(async (src) => {
    const img = new Image();
    await new Promise((resolve, reject) => { img.onload = resolve; img.onerror = reject; img.src = src; });
    const canvas = document.createElement('canvas');
    canvas.width = img.width; canvas.height = img.height;
    const context = canvas.getContext('2d');
    context.drawImage(img, 0, 0);
    const data = context.getImageData(0, 0, canvas.width, canvas.height).data;
    let content = 0;
    for (let index = 0; index < data.length; index += 4) {
      if (Math.abs(data[index] - 5) + Math.abs(data[index + 1] - 7) + Math.abs(data[index + 2] - 13) > 30) content++;
    }
    return { contentFraction: content / (data.length / 4) };
  }, dataUrl);
}
await page.goto('http://localhost:8932/tools/smoke/consumer.html', { waitUntil: 'load' });
await page.waitForFunction(() => document.getElementById('state')?.dataset.ready === '1', null, { timeout: 30000 });
await page.waitForTimeout(2500);
const state = await page.evaluate(() => document.getElementById('state')?.textContent);
const stats = await canvasStats(page);
await page.screenshot({ path: '/tmp/holo-consumer.png' });

const placeholderPage = await browser.newPage({ viewport: { width: 900, height: 700 } });
const placeholderErrors = [];
const placeholderRequests = [];
placeholderPage.on('pageerror', (error) => placeholderErrors.push(error.message));
placeholderPage.on('request', (request) => {
  if (request.url().includes('default-avatar') || request.url().includes('.glb')) placeholderRequests.push(request.url());
});
await placeholderPage.goto('http://localhost:8932/tools/smoke/consumer.html?placeholder', { waitUntil: 'load' });
await placeholderPage.waitForFunction(() => document.getElementById('state')?.dataset.ready === '1', null, { timeout: 30000 });
await placeholderPage.waitForTimeout(2500);
const placeholderState = await placeholderPage.evaluate(() => document.getElementById('state')?.textContent);
const placeholderStats = await canvasStats(placeholderPage);
await placeholderPage.screenshot({ path: '/tmp/holo-consumer-placeholder.png' });
console.log(JSON.stringify({
  defaultAvatar: { state, stats, lazyChunkRequests: requests, pageErrors: errors },
  placeholder: {
    state: placeholderState,
    stats: placeholderStats,
    lazyChunkRequests: placeholderRequests,
    pageErrors: placeholderErrors,
  },
}, null, 2));
await browser.close();

// Hard oracles: the BUILT dist must load the packaged default head.
const failures = [];
if (state !== 'state: idle') failures.push(`expected idle, got ${state}`);
if (stats.contentFraction < 0.08) failures.push(`bust content fraction too low: ${stats.contentFraction}`);
if (!requests.some((u) => u.includes('default-avatar'))) failures.push('lazy default-avatar chunk was never requested');
if (errors.length > 0) failures.push(`page errors: ${errors.join('; ')}`);
if (placeholderState !== 'state: idle') failures.push(`expected placeholder idle, got ${placeholderState}`);
if (placeholderStats.contentFraction < 0.08) {
  failures.push(`placeholder content fraction too low: ${placeholderStats.contentFraction}`);
}
if (placeholderRequests.length > 0) {
  failures.push(`placeholder unexpectedly requested an avatar: ${placeholderRequests.join(', ')}`);
}
if (placeholderErrors.length > 0) failures.push(`placeholder page errors: ${placeholderErrors.join('; ')}`);
if (failures.length > 0) {
  console.error(`SMOKE FAILED:\n- ${failures.join('\n- ')}`);
  process.exit(1);
}
console.log('SMOKE PASSED');
