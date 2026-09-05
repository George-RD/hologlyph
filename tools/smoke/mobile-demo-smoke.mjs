import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { chromium } from 'playwright';

const origin = (process.argv[2] ?? 'http://localhost:5173').replace(/\/$/, '');
const browser = await chromium.launch({ args: ['--no-sandbox'] });
let page;
let captured = false;
// Library-mode Playwright waits otherwise have no default deadline.
const watchdog = setTimeout(() => {
  console.error('MOBILE DEMO SMOKE FAILED: exceeded the three-minute deadline');
  process.exitCode = 1;
  void browser.close();
}, 180_000);

try {
  page = await browser.newPage({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    hasTouch: true,
    isMobile: true,
  });
  page.setDefaultTimeout(30_000);
  const pageErrors = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));

  // Keep the real demo adapter and viseme path; replace only the host voice.
  // Cancelling clears pending callbacks, as a real interrupted voice would.
  await page.addInitScript(() => {
    class FakeSpeechSynthesisUtterance {
      constructor(text) {
        this.text = text;
        this.onstart = null;
        this.onboundary = null;
        this.onend = null;
        this.onerror = null;
      }
    }
    const voice = { spoken: [], cancellations: 0 };
    globalThis.__mobileDemoVoice = voice;
    let timers = [];
    const speechSynthesis = {
      cancel() {
        voice.cancellations++;
        timers.forEach(clearTimeout);
        timers = [];
      },
      getVoices() { return []; },
      pause() {},
      resume() {},
      speak(utterance) {
        voice.spoken.push(utterance.text);
        timers.push(setTimeout(() => utterance.onstart?.(), 0));
        [...utterance.text.matchAll(/\S+/g)].slice(0, 8).forEach((word, index) => {
          timers.push(setTimeout(() => {
            utterance.onboundary?.({ charIndex: word.index, charLength: word[0].length });
          }, 90 + index * 85));
        });
        timers.push(setTimeout(() => utterance.onend?.(), 950));
      },
    };
    Object.defineProperty(globalThis, 'SpeechSynthesisUtterance', {
      configurable: true, value: FakeSpeechSynthesisUtterance,
    });
    Object.defineProperty(globalThis, 'speechSynthesis', {
      configurable: true, value: speechSynthesis,
    });
  });

  await page.goto(`${origin}/hologlyph/`, { waitUntil: 'load' });
  await page.waitForFunction(() => document.body.dataset.ready === 'true', null, { timeout: 30_000 });
  assert.equal(await page.locator('#settingsPanel').isVisible(), false, 'settings visible on first load');
  assert.equal(await page.locator('#settingsPanel').evaluate((el) => el.inert), true);
  assert.equal(await page.locator('#captionPanel').evaluate((el) => el.inert), true);

  /** Wait for finite control transitions, not a timing guess or the engine's animation loop. */
  async function settle(selector) {
    await page.locator(selector).evaluate(async (element) => {
      await Promise.all(element.getAnimations({ subtree: true }).map((animation) => animation.finished.catch(() => {})));
    });
  }

  await page.locator('#expressionTrigger').tap();
  for (const viewport of [
    { width: 320, height: 568 },
    { width: 375, height: 667 },
    { width: 390, height: 844 },
    { width: 430, height: 932 },
    { width: 844, height: 390 },
    { width: 1280, height: 800 },
  ]) {
    // Resize an OPEN fan to exercise the observer/orientation path as well.
    await page.setViewportSize(viewport);
    await page.waitForSelector('#expressionMenu.open');
    await settle('#expressionMenu');
    const layout = await page.evaluate(() => {
      const canvas = document.getElementById('holo').getBoundingClientRect();
      const menu = document.getElementById('expressionMenu').getBoundingClientRect();
      const dock = document.querySelector('.command-dock').getBoundingClientRect();
      const buttons = [...document.querySelectorAll('.expression-option')];
      const rects = buttons.map((button) => button.getBoundingClientRect());
      return {
        canvasFills: canvas.width >= innerWidth - 1 && canvas.height >= innerHeight - 1,
        dockFits: dock.left >= 0 && dock.right <= innerWidth && dock.bottom <= innerHeight,
        menuVisible: menu.width > 0 && menu.height > 0,
        count: buttons.length,
        inBounds: rects.every((r) => r.left >= 0 && r.top >= 0 && r.right <= innerWidth && r.bottom <= innerHeight),
        touchSized: rects.every((r) => r.width >= 44 && r.height >= 44),
        separated: rects.every((a, i) => rects.every((b, j) => i === j ||
          Math.hypot(a.x + a.width / 2 - b.x - b.width / 2, a.y + a.height / 2 - b.y - b.height / 2) >=
          (a.width + b.width) / 2 + 4)),
        // Check actual hit-testing across each circular target, not just centres
        // or bounding rectangles that can pass even when neighbours cover it.
        hittable: buttons.every((button, i) => [-15, 0, 15].every((dx) => [-15, 0, 15].every((dy) =>
          document.elementFromPoint(rects[i].x + rects[i].width / 2 + dx, rects[i].y + rects[i].height / 2 + dy) === button))),
      };
    });
    assert.equal(layout.count, 7);
    for (const [name, passed] of Object.entries(layout)) {
      if (name !== 'count') assert.equal(passed, true, `${viewport.width}x${viewport.height}: ${name}`);
    }
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await settle('#expressionMenu');
  await page.keyboard.press('Escape');
  assert.equal(await page.locator('#expressionTrigger').evaluate((el) => el === document.activeElement), true);

  // Every option must be independently tappable, not merely present in the DOM.
  for (const expression of ['neutral', 'friendly', 'thinking', 'agree', 'concern', 'happy', 'surprised']) {
    await page.locator('#expressionTrigger').tap();
    await page.waitForSelector('#expressionMenu.open');
    await settle('#expressionMenu');
    await page.locator(`#expressionMenu [data-expression="${expression}"]`).tap();
    assert.equal(await page.locator('#expressionTrigger').getAttribute('data-expression'), expression);
    assert.equal(await page.locator(`#expressionMenu [data-expression="${expression}"]`).getAttribute('aria-pressed'), 'true');
    assert.equal(await page.locator('#expressionMenu').evaluate((el) => el.inert), true);
  }
  await page.locator('#expressionTrigger').focus();
  await page.keyboard.press('Enter');
  await settle('#expressionMenu');
  assert.equal(await page.evaluate(() => document.activeElement?.matches('.expression-option[aria-pressed="true"]')), true);
  await page.keyboard.press('Enter');
  assert.equal(await page.evaluate(() => document.activeElement?.id), 'expressionTrigger');

  await page.locator('#captionTrigger').tap();
  await settle('#captionPanel');
  assert.equal(await page.evaluate(() => document.activeElement?.matches('.caption-choice[aria-current="true"]')), true);
  await page.locator('[data-caption-id="mobile"]').tap();
  await page.waitForFunction(() => globalThis.__mobileDemoVoice.spoken.length === 1);
  assert.equal(await page.evaluate(() => document.body.dataset.lastCaption), 'mobile');
  assert.equal(await page.locator('#captionTrigger').getAttribute('aria-expanded'), 'false');
  assert.equal(await page.locator('#speakTrigger').getAttribute('aria-pressed'), 'true');
  assert.equal(await page.evaluate(() => document.activeElement?.id), 'captionTrigger');
  await page.waitForFunction(() => document.getElementById('speakTrigger').getAttribute('aria-pressed') === 'false');

  // Real taps during the pulse animation exercise replacement speech rather
  // than letting Playwright wait until speech ends to click a stable button.
  const say = await page.locator('#speakTrigger').boundingBox();
  assert.ok(say);
  for (let i = 0; i < 3; i++) {
    await page.touchscreen.tap(say.x + say.width / 2, say.y + say.height / 2);
    await page.waitForFunction((count) => globalThis.__mobileDemoVoice.spoken.length === count, i + 2);
  }
  assert.equal(await page.evaluate(() => globalThis.__mobileDemoVoice.spoken.every((text) => text === document.getElementById('captionText').textContent)), true);
  await page.waitForFunction(() => document.getElementById('speakTrigger').getAttribute('aria-pressed') === 'false');

  await page.locator('#settingsTrigger').tap();
  await settle('#settingsPanel');
  assert.equal(await page.locator('#settingsPanel').evaluate((el) => el.open && el.matches(':modal')), true);
  const panelBox = await page.locator('#settingsPanel').boundingBox();
  assert.ok(panelBox && panelBox.x >= 0 && panelBox.x + panelBox.width <= 390);
  assert.equal(await page.evaluate(() => {
    document.getElementById('speakTrigger').focus();
    return document.getElementById('settingsPanel').contains(document.activeElement);
  }), true, 'background can steal modal focus');
  await page.keyboard.press('Shift+Tab');
  assert.equal(await page.evaluate(() => document.activeElement === document.body || document.getElementById('settingsPanel').contains(document.activeElement)), true);
  await page.keyboard.press('Escape');
  assert.equal(await page.locator('#settingsPanel').isVisible(), false);
  assert.equal(await page.evaluate(() => document.activeElement?.id), 'settingsTrigger');
  await page.locator('#settingsTrigger').tap();
  await settle('#settingsPanel');
  await page.touchscreen.tap(2, 400);
  assert.equal(await page.locator('#settingsPanel').isVisible(), false, 'backdrop tap did not close settings');

  // Verify the host catches a rejected engine promise and leaves Say usable.
  await page.evaluate(() => {
    const engine = globalThis.__hologlyphEngine;
    const original = engine.speak.bind(engine);
    engine.speak = async () => {
      engine.speak = original;
      throw new Error('Expected smoke-test speech rejection');
    };
  });
  await page.locator('#speakTrigger').tap();
  await page.waitForFunction(() => document.getElementById('statusToast').textContent === 'Speech is unavailable in this browser');
  assert.equal(await page.locator('#speakTrigger').getAttribute('aria-pressed'), 'false');

  // Deterministically cover the persisted page lifecycle; actual BFCache
  // eligibility depends on the browser/GPU and is not assumed by this smoke.
  await page.evaluate(() => {
    const engine = globalThis.__hologlyphEngine;
    const original = engine.dispose.bind(engine);
    globalThis.__mobileDemoDisposals = 0;
    engine.dispose = () => {
      globalThis.__mobileDemoDisposals++;
      original();
    };
    window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: true }));
    window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true }));
  });
  assert.equal(await page.evaluate(() => globalThis.__mobileDemoDisposals), 0, 'cached page disposed its engine');
  await page.locator('#captionTrigger').tap();
  await settle('#captionPanel');
  await page.locator('[data-caption-id="hello"]').tap();
  await page.waitForFunction(() => globalThis.__mobileDemoVoice.spoken.length === 5);
  await page.waitForFunction(() => document.getElementById('speakTrigger').getAttribute('aria-pressed') === 'false');

  await page.evaluate(() => {
    const motion = globalThis.__hologlyphEngine.motion;
    const original = motion.setHeadTarget.bind(motion);
    globalThis.__mobileDemoTargets = [];
    motion.setHeadTarget = (yaw, pitch) => {
      globalThis.__mobileDemoTargets.push({ yaw, pitch });
      original(yaw, pitch);
    };
  });
  const session = await page.context().newCDPSession(page);
  try {
    await session.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: 100, y: 230, id: 1 }] });
    await session.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: 165, y: 260, id: 1 }] });
    await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  } finally {
    await session.detach();
  }
  assert.equal(await page.evaluate(() => globalThis.__mobileDemoTargets.some((p) => p.yaw > 0 && p.pitch > 0)), true);
  assert.equal(await page.locator('#holo').evaluate((el) => el.classList.contains('dragging')), false);

  await page.evaluate(() => document.getElementById('statusToast').classList.remove('visible'));
  await mkdir('tools/evals/out', { recursive: true });
  await page.screenshot({ path: 'tools/evals/out/mobile-demo.png', fullPage: true });
  captured = true;
  await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: false })));
  assert.equal(await page.evaluate(() => globalThis.__mobileDemoDisposals), 1);
  assert.deepEqual(pageErrors, [], `page errors: ${pageErrors.join('; ')}`);
  console.log('MOBILE DEMO SMOKE PASSED: six viewports, seven moods, speech/replay, modal focus, touch drag and page lifecycle');
} catch (error) {
  console.error('MOBILE DEMO SMOKE FAILED:', error);
  process.exitCode = 1;
} finally {
  clearTimeout(watchdog);
  if (page && !captured) {
    await mkdir('tools/evals/out', { recursive: true });
    await page.screenshot({ path: 'tools/evals/out/mobile-demo-failure.png', fullPage: true }).catch(() => {});
  }
  await browser.close();
}
