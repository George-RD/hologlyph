import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

/** Real renderer evidence, not reference art or a separate proxy animation. */
export async function reviewLiquidBody(base = 'http://localhost:5173/hologlyph/engine.html') {
  const out = fileURLToPath(new URL('../evals/out/mouth-anatomy/liquid/', import.meta.url));
  mkdirSync(out, { recursive: true });
  const browser = await chromium.launch({ args: ['--no-sandbox'] });
  const context = await browser.newContext({
    viewport: { width: 1000, height: 900 }, deviceScaleFactor: 1,
    reducedMotion: 'no-preference', recordVideo: { dir: out, size: { width: 1000, height: 900 } },
  });
  const page = await context.newPage();
  const video = page.video();
  const errors = [];
  const captures = [];
  const report = { commit: process.env.GITHUB_SHA ?? null, errors, captures };
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  const capture = async name => {
    await page.waitForTimeout(180);
    await page.screenshot({ path: `${out}${name}.png` });
    captures.push(name);
    writeFileSync(`${out}result.json`, JSON.stringify(report, null, 2));
    console.log(`LIQUID REVIEW ${name}`);
  };
  try {
    const url = new URL('liquid-body-lab.html', base);
    await page.goto(url.href, { waitUntil: 'load' });
    await page.waitForFunction(() => window.__liquidLab?.ready, undefined, { timeout: 60000 });
    await page.waitForFunction(() => window.__liquidLab.engine.vfx.emergence > 0.99);
    await page.evaluate(async () => {
      const { surfaceProbe } = await import('./liquid-surface-probe.ts');
      window.__surfaceProbe = surfaceProbe(window.__liquidLab.engine);
      window.__liquidLab.pose('ee');
    });
    for (const mode of ['actual', 'no-depth', 'reference-normal', 'reference-colour', 'reference-position', 'reference-all']) {
      await page.evaluate(mode => window.__surfaceProbe.apply(mode), mode);
      await capture(`probe-${mode}`);
    }
    await page.evaluate(() => {
      window.__surfaceProbe.dispose();
      delete window.__surfaceProbe;
    });
    for (const background of ['dark', 'light']) {
      await page.evaluate(background => {
        const lab = window.__liquidLab;
        lab.background(background);
        lab.pose('ee');
        lab.view({ close: true, side: false });
      }, background);
      await capture(`${background}-teeth-ee`);
      await page.evaluate(() => window.__liquidLab.pose('aa'));
      await capture(`${background}-tongue-aa`);
    }
    await page.evaluate(() => {
      window.__liquidLab.background('dark');
      window.__liquidLab.view({ close: false, side: false });
    });
    for (const value of [0, 0.25, 0.5, 0.75, 1]) {
      await page.evaluate(value => window.__liquidLab.amount(value, true), value);
      await capture(`collapse-${Math.round(value * 100)}`);
    }
    await page.evaluate(() => window.__liquidLab.amount(0, true));
    await page.waitForTimeout(200);
    await page.evaluate(() => window.__liquidLab.amount(1));
    await page.waitForFunction(() => window.__liquidLab.liquid.canSteer);
    const before = await page.evaluate(() => [...window.__liquidLab.liquid.position]);
    await page.evaluate(() => {
      const body = window.__liquidLab.liquid;
      body.impulse(0.5, 0.2, 1.5);
      body.steerTo(0.4, 0.35);
    });
    await page.waitForTimeout(220);
    await capture('sloshing');
    const moving = await page.evaluate(() => ({
      position: [...window.__liquidLab.liquid.position],
      velocity: [...window.__liquidLab.liquid.velocity],
      waveEnergy: window.__liquidLab.liquid.waveEnergy,
    }));
    assert(moving.position[0] > before[0]);
    assert(moving.waveEnergy > 0);
    await page.evaluate(() => window.__liquidLab.liquid.release());
    await page.waitForTimeout(350);
    await capture('released');
    await page.evaluate(() => window.__liquidLab.amount(0));
    await page.waitForFunction(() => window.__liquidLab.liquid.amount === 0);
    const reformed = await page.evaluate(() => [...window.__liquidLab.liquid.position]);
    assert(reformed[0] > 0.1, 'Re-forming must retain travelled placement');
    await capture('reformed');
    await page.evaluate(() => window.__liquidLab.background('light'));
    await capture('reformed-light');
    await page.evaluate(() => window.__liquidLab.amount(1));
    await page.waitForFunction(() => window.__liquidLab.liquid.canSteer);
    await capture('liquid-light');
    report.moving = moving;
    report.reformed = reformed;
    assert.deepEqual(errors, []);
  } finally {
    writeFileSync(`${out}result.json`, JSON.stringify(report, null, 2));
    await context.close();
    if (video) await video.saveAs(`${out}walkthrough.webm`);
    await browser.close();
  }
}
