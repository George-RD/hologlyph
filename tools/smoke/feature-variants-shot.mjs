import { chromium } from 'playwright';

const CHROME = process.env.HOLOGLYPH_CHROME;
const browser = await chromium.launch({
  ...(CHROME ? { executablePath: CHROME } : {}),
  args: ['--no-sandbox', ...(process.platform === 'darwin' ? ['--use-angle=metal'] : [])],
});
const page = await browser.newPage({ viewport: { width: 1400, height: 1600 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => { if (m.type() === 'error') console.log('[console error]', m.text().slice(0, 200)); });

await page.goto('http://localhost:5199/hologlyph/feature-shading-variants.html', { waitUntil: 'load' });
await page.waitForFunction(() => document.getElementById('status')?.textContent === 'DONE', null, { timeout: 60000 })
  .catch(() => console.log('status did not reach DONE'));
await page.waitForTimeout(500);

await page.screenshot({ path: '/tmp/holo-feature-variants.png', fullPage: true });
console.log('errors:', errors.length ? errors.join('; ') : 'none');
await browser.close();
console.log('SHOT SAVED /tmp/holo-feature-variants.png');
