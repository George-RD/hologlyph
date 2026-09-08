import { mkdir } from 'node:fs/promises';
import { chromium } from 'playwright';

const origin = (process.argv[2] ?? 'http://localhost:5173').replace(/\/$/, '');
const out = 'tools/evals/out/facial-speech-gain-ab';
await mkdir(out, { recursive: true });

const browser = await chromium.launch({ args: ['--no-sandbox'] });
const page = await browser.newPage({ viewport: { width: 900, height: 900 }, deviceScaleFactor: 1 });
try {
  await page.goto(`${origin}/hologlyph/`, { waitUntil: 'load' });
  await page.waitForFunction(() => document.body.dataset.ready === 'true');

  const capture = async (name, viseme, gain) => {
    await page.evaluate(({ viseme, gain }) => {
      const engine = globalThis.__hologlyphEngine;
      if (!engine) throw new Error('missing demo engine');
      engine.motion.setExpression('neutral', 0);
      engine.motion.clearVisemes();
      engine.motion.applyVisemeFrame({ time: 0, weights: { [viseme]: gain, jaw_open: 0 } });
    }, { viseme, gain });
    await page.waitForTimeout(320);
    await page.locator('#holo').screenshot({ path: `${out}/${name}.png` });
  };

  await capture('01-ih-full-1.00', 'viseme_ih', 1);
  await capture('02-ih-calibrated-0.55', 'viseme_ih', 0.55);
  await capture('03-aa-full-1.00', 'viseme_aa', 1);
  await capture('04-aa-calibrated-0.55', 'viseme_aa', 0.55);

  const state = await page.evaluate(() => ({
    glassAmount: globalThis.__hologlyphEngine.vfx.headConfig.skin.glass.amount,
    fluidAmount: globalThis.__hologlyphEngine.vfx.headConfig.fluid.amount,
    meltAmount: globalThis.__hologlyphEngine.vfx.headConfig.melt.amount,
  }));
  console.log('FACIAL SPEECH GAIN A/B', JSON.stringify(state));
} finally {
  await browser.close();
}
