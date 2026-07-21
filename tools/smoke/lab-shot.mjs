import { chromium } from 'playwright';
const CHROME = process.env.HOLOGLYPH_CHROME;
const browser = await chromium.launch({ ...(CHROME ? { executablePath: CHROME } : {}), args: ['--no-sandbox', '--use-angle=metal'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 820 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => { if (m.type() === 'error') console.log('[console error]', m.text().slice(0, 200)); });

await page.goto('http://localhost:5199/hologlyph/feature-shading-lab.html', { waitUntil: 'load' });
await page.waitForFunction(() => document.getElementById('status')?.textContent?.startsWith('live'), null, { timeout: 60000 }).catch(() => console.log('never went live'));
await page.waitForTimeout(1500);

const sliderCount = await page.evaluate(() => document.querySelectorAll('input[type=range]').length);
const btnCount = await page.evaluate(() => document.querySelectorAll('#panel button').length);
// exercise the V4 preset + move head yaw, then screenshot
await page.evaluate(() => { const b = [...document.querySelectorAll('#panel button')].find(x => x.textContent.includes('V4')); b && b.click(); });
await page.waitForTimeout(1200);
await page.screenshot({ path: '/tmp/holo-lab.png' });
console.log('sliders:', sliderCount, 'buttons:', btnCount, 'errors:', errors.length ? errors.join('; ') : 'none');
await browser.close();
