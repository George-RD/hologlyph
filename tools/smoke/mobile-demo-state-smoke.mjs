import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { chromium } from 'playwright';

const origin = (process.argv[2] ?? 'http://localhost:5173').replace(/\/$/, '');
const browser = await chromium.launch({
  ...(process.env.HOLOGLYPH_CHROME ? { executablePath: process.env.HOLOGLYPH_CHROME } : {}),
  args: ['--no-sandbox'],
});
let page;
try {
  page = await browser.newPage({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 1,
    reducedMotion: 'reduce',
  });
  page.setDefaultTimeout(30_000);
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(`${origin}/hologlyph/`, { waitUntil: 'load' });
  await page.waitForFunction(() => document.body.dataset.ready === 'true' && globalThis.__hologlyphEngine.state === 'idle');

  // The interaction smoke covers real taps and TTS. Here drive the real state
  // machine directly so its expression overwrites cannot hide behind UI state.
  const snapshots = await page.evaluate(async () => {
    const engine = globalThis.__hologlyphEngine;
    const original = engine.motion.setExpression.bind(engine.motion);
    let target = null;
    engine.motion.setExpression = (expression) => {
      target = expression;
      original(expression);
    };
    const snapshots = [];
    try {
      for (const selected of ['neutral', 'friendly', 'thinking', 'agree', 'concern', 'happy', 'surprised']) {
        document.querySelector(`#expressionMenu [data-expression="${selected}"]`).click();
        for (const [type, expectedState] of [
          ['speech-start', 'speaking'],
          ['speech-stall', 'thinking'],
          ['speech-start', 'speaking'],
          ['speech-end', 'idle'],
          ['exit-viewport', 'departing'],
          ['submerge-complete', 'hidden'],
          ['enter-viewport', 'emerging'],
          ['emerge-complete', 'idle'],
        ]) {
          engine.behavior.dispatch({ type });
          // EngineImpl emits statechange before applying its default expression.
          await Promise.resolve();
          snapshots.push({ selected, type, expectedState, state: engine.state, target });
        }
      }
    } finally {
      engine.motion.setExpression = original;
    }
    return snapshots;
  });
  assert.equal(snapshots.length, 56);
  for (const snapshot of snapshots) {
    assert.equal(snapshot.state, snapshot.expectedState, JSON.stringify(snapshot));
    assert.equal(snapshot.target, snapshot.selected, JSON.stringify(snapshot));
  }

  await page.evaluate(() => {
    const engine = globalThis.__hologlyphEngine;
    const motion = engine.motion.setReducedMotion.bind(engine.motion);
    const vfx = engine.vfx.setReducedMotion.bind(engine.vfx);
    globalThis.__demoStateMotion = { motion: null, vfx: null };
    engine.motion.setReducedMotion = (enabled) => {
      globalThis.__demoStateMotion.motion = enabled;
      motion(enabled);
    };
    engine.vfx.setReducedMotion = (enabled) => {
      globalThis.__demoStateMotion.vfx = enabled;
      vfx(enabled);
    };
  });
  for (const enabled of [false, true]) {
    await page.emulateMedia({ reducedMotion: enabled ? 'reduce' : 'no-preference' });
    await page.waitForFunction((value) =>
      document.getElementById('reducedMotion').checked === value &&
      globalThis.__demoStateMotion.motion === value &&
      globalThis.__demoStateMotion.vfx === value, enabled);
  }

  const settingsLabels = await page.evaluate(() => {
    const trigger = document.getElementById('settingsTrigger');
    trigger.click();
    const open = trigger.getAttribute('aria-label');
    document.getElementById('closeSettings').click();
    return { open, closed: trigger.getAttribute('aria-label') };
  });
  assert.deepEqual(settingsLabels, { open: 'Close studio controls', closed: 'Open studio controls' });

  // A pending restoration must not write into an engine disposed in this task.
  await page.evaluate(() => {
    const engine = globalThis.__hologlyphEngine;
    const original = engine.setEmotion.bind(engine);
    globalThis.__demoStateLateWrites = 0;
    let terminal = false;
    engine.setEmotion = (expression) => {
      if (terminal) globalThis.__demoStateLateWrites++;
      original(expression);
    };
    engine.behavior.dispatch({ type: 'speech-start' });
    window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: false }));
    terminal = true;
  });
  assert.equal(await page.evaluate(() => globalThis.__demoStateLateWrites), 0);
  assert.deepEqual(errors, []);
  console.log('MOBILE DEMO STATE SMOKE PASSED: 56 mood transitions, live OS preferences, settings labels and terminal cleanup');
} catch (error) {
  console.error('MOBILE DEMO STATE SMOKE FAILED:', error);
  process.exitCode = 1;
  if (page) {
    await mkdir('tools/evals/out', { recursive: true });
    await page.screenshot({ path: 'tools/evals/out/mobile-demo-state-failure.png', timeout: 10_000 }).catch(() => {});
  }
} finally {
  await browser.close();
}
