import { mkdir } from 'node:fs/promises';
import { chromium } from 'playwright';

const origin = (process.argv[2] ?? 'http://localhost:5173').replace(/\/$/, '');
const out = 'tools/evals/out/facial-interior-ab';
await mkdir(out, { recursive: true });

const browser = await chromium.launch({ args: ['--no-sandbox'] });
const page = await browser.newPage({ viewport: { width: 900, height: 900 }, deviceScaleFactor: 1 });
try {
  await page.goto(`${origin}/hologlyph/`, { waitUntil: 'load' });
  await page.waitForFunction(() => document.body.dataset.ready === 'true');

  await page.evaluate(() => {
    const engine = globalThis.__hologlyphEngine;
    if (!engine) throw new Error('missing demo engine');
    engine.motion.setExpression('neutral', 0);
    engine.motion.applyVisemeFrame({ time: 0, weights: { viseme_ih: 1, jaw_open: 0 } });
  });
  await page.waitForTimeout(300);

  const canvas = page.locator('#holo');
  await canvas.screenshot({ path: `${out}/01-current-interior-on.png` });

  const state = await page.evaluate(() => {
    const engine = globalThis.__hologlyphEngine;
    const interior = engine.interiorMesh;
    if (!interior) throw new Error('interior mesh is not present');
    const snapshot = {
      visible: interior.visible,
      renderOrder: interior.renderOrder,
      materialName: interior.material?.name ?? '',
      glassAmount: engine.vfx.headConfig.skin.glass.amount,
      fluidAmount: engine.vfx.headConfig.fluid.amount,
      meltAmount: engine.vfx.headConfig.melt.amount,
    };
    interior.visible = false;
    return snapshot;
  });
  console.log('FACIAL INTERIOR A/B', JSON.stringify(state));
  await page.waitForTimeout(120);
  await canvas.screenshot({ path: `${out}/02-same-pose-interior-off.png` });

  await page.evaluate(() => {
    const engine = globalThis.__hologlyphEngine;
    engine.motion.applyVisemeFrame({ time: 0, weights: { viseme_aa: 1, jaw_open: 0 } });
    engine.interiorMesh.visible = true;
  });
  await page.waitForTimeout(220);
  await canvas.screenshot({ path: `${out}/03-aa-interior-on.png` });
  await page.evaluate(() => { globalThis.__hologlyphEngine.interiorMesh.visible = false; });
  await page.waitForTimeout(120);
  await canvas.screenshot({ path: `${out}/04-aa-interior-off.png` });
} finally {
  await browser.close();
}
