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
await page.goto('http://localhost:8932/tools/smoke/consumer.html', { waitUntil: 'load' });
await page.waitForFunction(() => document.getElementById('state')?.dataset.ready === '1', null, { timeout: 30000 });
await page.waitForTimeout(2500);
const state = await page.evaluate(() => document.getElementById('state')?.textContent);
const buf = await page.locator('#c').screenshot();
const dataUrl = `data:image/png;base64,${buf.toString('base64')}`;
const stats = await page.evaluate(async (src) => {
  const img = new Image();
  await new Promise((res, rej) => { img.onload = res; img.onerror = rej; img.src = src; });
  const c = document.createElement('canvas');
  c.width = img.width; c.height = img.height;
  const ctx = c.getContext('2d');
  ctx.drawImage(img, 0, 0);
  const d = ctx.getImageData(0, 0, c.width, c.height).data;
  let content = 0, total = 0;
  for (let i = 0; i < d.length; i += 4) {
    if (Math.abs(d[i] - 5) + Math.abs(d[i + 1] - 7) + Math.abs(d[i + 2] - 13) > 30) content++;
    total++;
  }
  return { contentFraction: content / total };
}, dataUrl);
await page.screenshot({ path: '/tmp/holo-consumer.png' });
console.log(JSON.stringify({ state, stats, lazyChunkRequests: requests, pageErrors: errors }, null, 2));
await browser.close();

// Hard oracles: the BUILT dist must load the packaged default head.
const failures = [];
if (state !== 'state: idle') failures.push(`expected idle, got ${state}`);
if (stats.contentFraction < 0.08) failures.push(`bust content fraction too low: ${stats.contentFraction}`);
if (!requests.some((u) => u.includes('default-avatar'))) failures.push('lazy default-avatar chunk was never requested');
if (errors.length > 0) failures.push(`page errors: ${errors.join('; ')}`);
if (failures.length > 0) {
  console.error(`SMOKE FAILED:\n- ${failures.join('\n- ')}`);
  process.exit(1);
}
console.log('SMOKE PASSED');
