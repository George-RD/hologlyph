import { chromium } from 'playwright';
const BASE = process.env.HOLOGLYPH_BASE ?? 'http://localhost:5174/hologlyph/';
const CHROME = process.env.HOLOGLYPH_CHROME;
const browser = await chromium.launch({ ...(CHROME ? { executablePath: CHROME } : {}), args: ['--no-sandbox', ...(process.platform === 'darwin' ? ['--use-angle=metal'] : [])] });
const page = await browser.newPage({ viewport: { width: 1280, height: 820 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => { if (m.type() === 'error') console.log('[console error]', m.text().slice(0, 200)); });

await page.goto(BASE, { waitUntil: 'load' });
await page.waitForFunction(() => document.getElementById('status')?.textContent?.startsWith('live'), null, { timeout: 60000 }).catch(() => console.log('never went live'));
await page.waitForTimeout(1500);

const checks = await page.evaluate(() => ({
  engineLink: !!document.querySelector('#topbar a[href*="engine"]'),
  intro: document.querySelector('#intro h1')?.textContent ?? null,
  introCopy: (document.querySelector('#intro p')?.textContent ?? '').slice(0, 40),
  sayInput: !!document.querySelector('#saybar input'),
  camZ: window.__lab.camera.position.z.toFixed(2),
}));
console.log(JSON.stringify(checks));
await page.screenshot({ path: '/tmp/holo-landing.png' });

// Drive speak with typed text and sample viseme influences over time.
await page.fill('#saybar input', 'hello world this is a smoke test of the mouth');
await page.click('#saybar button');
const samples = [];
for (let i = 0; i < 14; i++) {
  await page.waitForTimeout(180);
  samples.push(await page.evaluate(() => {
    let best = null;
    window.__lab.scene.traverse((o) => {
      if (!o.isMesh || !o.morphTargetDictionary || !o.morphTargetInfluences) return;
      for (const [name, idx] of Object.entries(o.morphTargetDictionary)) {
        if (!name.startsWith('viseme_') || name === 'viseme_sil') continue;
        const w = o.morphTargetInfluences[idx];
        if (!best || w > best.w) best = { name, w: +w.toFixed(2) };
      }
    });
    return best;
  }));
}
const active = samples.filter((s) => s && s.w > 0.2);
const distinct = new Set(active.map((s) => s.name));
console.log('speaking samples with open mouth:', active.length, 'distinct visemes:', [...distinct].join(','));
await page.waitForTimeout(400);
await page.screenshot({ path: '/tmp/holo-landing-speak.png' });
console.log('errors:', errors.length ? errors.join('; ') : 'none');
await browser.close();
