import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { decodePng } from '../evals/score.mjs';

function imageDifference(a, b) {
  assert.equal(a.width, b.width);
  assert.equal(a.height, b.height);
  let sum = 0;
  for (let i = 0; i < a.width * a.height; i++) {
    for (let c = 0; c < 3; c++) sum += Math.abs(a.data[i * a.channels + c] - b.data[i * b.channels + c]);
  }
  return sum / (a.width * a.height * 3);
}

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
  page.setDefaultTimeout(60000);
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  // Save the actual compiled shader sources on failure. This is test-only
  // instrumentation; the runtime never patches browser APIs.
  await page.addInitScript(() => {
    window.__liquidShaders = [];
    if (typeof WebGL2RenderingContext === 'undefined') return;
    const original = WebGL2RenderingContext.prototype.shaderSource;
    WebGL2RenderingContext.prototype.shaderSource = function(shader, source) {
      if (window.__liquidShaders.length < 48) {
        window.__liquidShaders.push({ type: this.getShaderParameter(shader, this.SHADER_TYPE), source });
      }
      return original.call(this, shader, source);
    };
  });
  const capture = async name => {
    await page.waitForTimeout(180);
    const bytes = await page.screenshot({ path: `${out}${name}.png` });
    captures.push(name);
    writeFileSync(`${out}result.json`, JSON.stringify(report, null, 2));
    console.log(`LIQUID REVIEW ${name}`);
    return decodePng(bytes);
  };
  try {
    await page.goto(new URL('liquid-body-lab.html', base).href, { waitUntil: 'load' });
    await page.waitForFunction(() => window.__liquidLab?.ready);
    await page.waitForFunction(() => window.__liquidLab.engine.vfx.emergence > 0.999);
    await page.evaluate(async () => {
      const { surfaceProbe } = await import('./liquid-surface-probe.ts');
      const lab = window.__liquidLab;
      lab.engine.sysTextSkin.setReducedMotion(true);
      lab.engine.eyeTextSkin.setReducedMotion(true);
      lab.pose('ee');
      window.__surfaceProbe = surfaceProbe(lab.engine);
    });
    const actual = await capture('head-actual');
    await page.evaluate(() => window.__surfaceProbe.apply('reference-all'));
    const reference = await capture('head-reference');
    await page.evaluate(() => {
      window.__surfaceProbe.dispose();
      delete window.__surfaceProbe;
    });
    report.zeroModeDifference = imageDifference(actual, reference);
    // The old black head scored 10.87 and its grey control 5.24. A one-level
    // average allowance admits rounding, not a missing or flat-shaded face.
    assert(report.zeroModeDifference < 1, `Liquid-off changed the head: mean pixel difference ${report.zeroModeDifference}`);
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
    const trim = await page.evaluate(() => {
      const result = [];
      window.__liquidLab.engine.avatar.root.traverse(object => {
        if (object.isMesh && object.material?.name === 'eye_trim') result.push(object.visible);
      });
      return result;
    });
    assert(trim.length > 0, 'The shipped rig must exercise authored eye trim');
    assert(trim.every(visible => !visible), 'Eye trim must not float above the liquid');
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
    const reformed = await page.evaluate(() => {
      const lab = window.__liquidLab;
      const carrier = lab.engine.avatar.root.getObjectByName('hologlyph_liquid_carrier');
      const trim = [];
      lab.engine.avatar.root.traverse(object => {
        if (object.isMesh && object.material?.name === 'eye_trim') trim.push(object.visible);
      });
      return { position: [...lab.liquid.position], carrier: carrier?.position.toArray(), trim };
    });
    assert(reformed.position[0] > 0.1, 'Re-forming must retain travelled placement');
    assert.deepEqual(reformed.carrier, [...reformed.position, 0], 'The complete rig must follow placement');
    assert(reformed.trim.every(Boolean), 'Authored trim must return with the head');
    await capture('reformed');
    await page.evaluate(() => window.__liquidLab.background('light'));
    await capture('reformed-light');
    await page.evaluate(() => window.__liquidLab.amount(1));
    await page.waitForFunction(() => window.__liquidLab.liquid.canSteer);
    await capture('liquid-light');
    report.moving = moving;
    report.reformed = reformed;
    // Drive the actual pointer listeners, not just the solver's API.
    await page.mouse.move(400, 450);
    await page.mouse.down();
    await page.mouse.move(455, 425, { steps: 8 });
    await page.mouse.up();
    await page.waitForTimeout(200);
    await capture('pointer-drag');
    await page.setViewportSize({ width: 390, height: 844 });
    await capture('mobile-liquid');
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.waitForTimeout(100);
    await page.evaluate(() => {
      window.__liquidLab.liquid.steerTo(0, 0);
      window.__liquidLab.amount(0);
      window.__liquidLab.pose('ee');
    });
    await capture('mobile-head-reduced');
    const reduced = await page.evaluate(() => ({ amount: window.__liquidLab.liquid.amount, energy: window.__liquidLab.liquid.waveEnergy }));
    assert.deepEqual(reduced, { amount: 0, energy: 0 });
    assert.deepEqual(errors, []);
  } finally {
    const shaders = await page.evaluate(() => window.__liquidShaders ?? []).catch(() => []);
    for (let i = 0; i < shaders.length; i++) {
      const shader = shaders[i];
      writeFileSync(`${out}shader-${i}-${shader.type === 35633 ? 'vertex' : 'fragment'}.glsl`, shader.source);
    }
    writeFileSync(`${out}result.json`, JSON.stringify(report, null, 2));
    await context.close();
    if (video) await video.saveAs(`${out}walkthrough.webm`);
    await browser.close();
  }
}
