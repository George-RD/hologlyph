/**
 * Backdrop smoke (dec.glass-backdrop-adaptive): load the engine demo over a
 * dark, a mid-tone, and a light host page and check the head stays legible on
 * each. The page background is injected before the module runs, because the
 * engine samples the host backdrop once at mount.
 *
 * Usage: bun run dev, then
 *   node tools/smoke/backdrop-shot.mjs [url] [outDir]
 */
import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright';

const URL_BASE = process.argv[2] ?? 'http://localhost:5173/hologlyph/engine.html';
const OUT_DIR = process.argv[3] ?? '/tmp/holo-backdrop';
const CHROME = process.env.HOLOGLYPH_CHROME;

const THEMES = [
  { name: 'dark', color: '#05070d' },
  { name: 'mid', color: '#7f7f7f' },
  { name: 'light', color: '#ffffff' },
  { name: 'brand', color: '#1b3a6b' },
];

mkdirSync(OUT_DIR, { recursive: true });

const browser = await chromium.launch(
  CHROME ? { executablePath: CHROME, args: ['--enable-unsafe-webgpu'] } : {},
);

/** Mean channel delta of canvas pixels against the host page colour. */
async function measure(page, hex) {
  const buf = await page.locator('#holo').screenshot();
  const dataUrl = `data:image/png;base64,${buf.toString('base64')}`;
  return await page.evaluate(
    async ({ src, hex }) => {
      const img = new Image();
      await new Promise((res, rej) => {
        img.onload = res;
        img.onerror = rej;
        img.src = src;
      });
      const c = document.createElement('canvas');
      c.width = img.width;
      c.height = img.height;
      const ctx = c.getContext('2d');
      ctx.drawImage(img, 0, 0);
      const d = ctx.getImageData(0, 0, c.width, c.height).data;
      const br = Number.parseInt(hex.slice(1, 3), 16);
      const bg = Number.parseInt(hex.slice(3, 5), 16);
      const bb = Number.parseInt(hex.slice(5, 7), 16);
      let content = 0;
      let total = 0;
      let contrastSum = 0;
      let peak = 0;
      for (let i = 0; i < d.length; i += 4) {
        const delta =
          Math.abs(d[i] - br) + Math.abs(d[i + 1] - bg) + Math.abs(d[i + 2] - bb);
        if (delta > 30) {
          content += 1;
          contrastSum += delta;
          if (delta > peak) peak = delta;
        }
        total += 1;
      }
      return {
        contentFraction: content / total,
        meanContrast: content > 0 ? contrastSum / content : 0,
        peakContrast: peak,
      };
    },
    { src: dataUrl, hex },
  );
}

const results = [];
const failures = [];

for (const theme of THEMES) {
  const page = await browser.newPage({ viewport: { width: 1100, height: 800 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.addInitScript((color) => {
    const style = document.createElement('style');
    style.textContent = `:root, body { background: ${color} !important; }`;
    document.addEventListener('DOMContentLoaded', () => document.head.append(style));
  }, theme.color);

  await page.goto(URL_BASE, { waitUntil: 'load' });
  await page
    .waitForFunction(() => document.getElementById('state')?.textContent !== 'state: hidden', null, {
      timeout: 30000,
    })
    .catch(() => {});
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await page.waitForTimeout(3000);

  const stats = await measure(page, theme.color);
  const backdrop = await page.evaluate(
    () => window.__hologlyphEngine?.vfx?.headConfig?.skin?.backdrop ?? null,
  );
  await page.locator('#holo').screenshot({ path: `${OUT_DIR}/${theme.name}.png` });

  results.push({ theme: theme.name, page: theme.color, backdrop, ...stats, errors });
  if (errors.length > 0) failures.push(`${theme.name}: page errors ${errors.join('; ')}`);
  if (stats.contentFraction < 0.05) {
    failures.push(`${theme.name}: head covers only ${stats.contentFraction.toFixed(4)} of canvas`);
  }
  if (stats.meanContrast < 25) {
    failures.push(`${theme.name}: mean contrast ${stats.meanContrast.toFixed(1)} against the page`);
  }
  await page.close();
}

await browser.close();
console.log(JSON.stringify({ outDir: OUT_DIR, results }, null, 2));

if (failures.length > 0) {
  console.error(`BACKDROP SMOKE FAILED:\n- ${failures.join('\n- ')}`);
  process.exit(1);
}
console.log('BACKDROP SMOKE PASSED');
