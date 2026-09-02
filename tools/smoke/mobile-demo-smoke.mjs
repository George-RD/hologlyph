import { mkdir } from 'node:fs/promises';
import { chromium } from 'playwright';

const origin = (process.argv[2] ?? 'http://localhost:5173').replace(/\/$/, '');
const browser = await chromium.launch({ args: ['--no-sandbox'] });
const page = await browser.newPage({
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 2,
  hasTouch: true,
  isMobile: true,
});

const pageErrors = [];
page.on('pageerror', (error) => pageErrors.push(error.message));

// Give the demo a deterministic browser voice. The production page still uses
// the native SpeechSynthesis implementation; this only removes CI host audio
// variance while exercising the same adapter, boundary and viseme path.
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

  const speechSynthesis = {
    cancel() {},
    getVoices() { return []; },
    pause() {},
    resume() {},
    speak(utterance) {
      queueMicrotask(() => utterance.onstart?.());
      const words = utterance.text.match(/\S+/g) ?? [];
      let charIndex = 0;
      words.slice(0, 8).forEach((word, index) => {
        setTimeout(() => {
          utterance.onboundary?.({ charIndex, charLength: word.length });
          charIndex += word.length + 1;
        }, 90 + index * 85);
      });
      setTimeout(() => utterance.onend?.(), 950);
    },
  };

  Object.defineProperty(globalThis, 'SpeechSynthesisUtterance', {
    configurable: true,
    value: FakeSpeechSynthesisUtterance,
  });
  Object.defineProperty(globalThis, 'speechSynthesis', {
    configurable: true,
    value: speechSynthesis,
  });
});

await page.goto(`${origin}/hologlyph/`, { waitUntil: 'load' });
await page.waitForFunction(() => document.body.dataset.ready === 'true', null, { timeout: 30_000 });
await page.waitForTimeout(500);

const failures = [];
const viewport = page.viewportSize();
if (!viewport) failures.push('missing viewport');

const initial = await page.evaluate(() => {
  const canvas = document.getElementById('holo');
  const dock = document.querySelector('.command-dock');
  const panel = document.getElementById('settingsPanel');
  if (!(canvas instanceof HTMLElement) || !(dock instanceof HTMLElement) || !(panel instanceof HTMLElement)) {
    return null;
  }
  const canvasRect = canvas.getBoundingClientRect();
  const dockRect = dock.getBoundingClientRect();
  const panelRect = panel.getBoundingClientRect();
  return {
    canvas: { x: canvasRect.x, y: canvasRect.y, width: canvasRect.width, height: canvasRect.height },
    dock: { x: dockRect.x, y: dockRect.y, right: dockRect.right, bottom: dockRect.bottom },
    settingsHidden: panel.getAttribute('aria-hidden'),
    settingsPointerEvents: getComputedStyle(panel).pointerEvents,
    settingsX: panelRect.x,
  };
});

if (!initial) {
  failures.push('missing main demo elements');
} else if (viewport) {
  if (initial.canvas.width < viewport.width - 1 || initial.canvas.height < viewport.height - 1) {
    failures.push(`canvas does not fill mobile viewport: ${JSON.stringify(initial.canvas)}`);
  }
  if (initial.dock.x < 0 || initial.dock.right > viewport.width || initial.dock.bottom > viewport.height) {
    failures.push(`command dock leaves viewport: ${JSON.stringify(initial.dock)}`);
  }
  if (initial.settingsHidden !== 'true' || initial.settingsPointerEvents !== 'none') {
    failures.push('studio controls are not hidden by default');
  }
  if (initial.settingsX < viewport.width) failures.push('hidden studio panel still covers the stage');
}

await page.click('#expressionTrigger');
await page.waitForSelector('#expressionMenu.open');
const expressionLayout = await page.locator('.expression-option').evaluateAll((buttons) =>
  buttons.map((button) => {
    const rect = button.getBoundingClientRect();
    return { x: rect.x, y: rect.y, right: rect.right, bottom: rect.bottom };
  }),
);
if (expressionLayout.length !== 7) failures.push(`expected 7 expressions, found ${expressionLayout.length}`);
if (viewport) {
  expressionLayout.forEach((rect, index) => {
    if (rect.x < -1 || rect.y < -1 || rect.right > viewport.width + 1 || rect.bottom > viewport.height + 1) {
      failures.push(`expression ${index} leaves viewport: ${JSON.stringify(rect)}`);
    }
  });
}

await page.click('[data-expression="thinking"]');
const expressionState = await page.evaluate(() => ({
  selected: document.getElementById('expressionTrigger')?.getAttribute('data-expression'),
  expanded: document.getElementById('expressionTrigger')?.getAttribute('aria-expanded'),
  pressed: document.querySelector('[data-expression="thinking"]')?.getAttribute('aria-pressed'),
}));
if (expressionState.selected !== 'thinking' || expressionState.expanded !== 'false' || expressionState.pressed !== 'true') {
  failures.push(`expression selection did not settle: ${JSON.stringify(expressionState)}`);
}

await page.click('#captionTrigger');
await page.waitForSelector('#captionPanel.open');
await page.click('[data-caption-id="mobile"]');
await page.waitForFunction(() => document.body.dataset.speechCount === '1');
const speechStart = await page.evaluate(() => ({
  caption: document.getElementById('captionText')?.textContent,
  lastCaption: document.body.dataset.lastCaption,
  speaking: document.getElementById('speakTrigger')?.getAttribute('aria-pressed'),
  captionsExpanded: document.getElementById('captionTrigger')?.getAttribute('aria-expanded'),
}));
if (speechStart.lastCaption !== 'mobile' || !speechStart.caption?.includes('controls stay out of the way')) {
  failures.push(`sample caption was not selected: ${JSON.stringify(speechStart)}`);
}
if (speechStart.speaking !== 'true' || speechStart.captionsExpanded !== 'false') {
  failures.push(`speech did not start from caption choice: ${JSON.stringify(speechStart)}`);
}
await page.waitForFunction(
  () => document.getElementById('speakTrigger')?.getAttribute('aria-pressed') === 'false',
  null,
  { timeout: 3_000 },
);

await page.click('#settingsTrigger');
await page.waitForFunction(() => document.getElementById('settingsPanel')?.getAttribute('aria-hidden') === 'false');
const openPanel = await page.locator('#settingsPanel').boundingBox();
if (!openPanel) failures.push('studio panel did not open');
else if (viewport && (openPanel.x < -1 || openPanel.x + openPanel.width > viewport.width + 1)) {
  failures.push(`open studio panel leaves viewport: ${JSON.stringify(openPanel)}`);
}
await page.click('#closeSettings');
await page.waitForFunction(() => document.getElementById('settingsPanel')?.getAttribute('aria-hidden') === 'true');

await mkdir('tools/evals/out', { recursive: true });
await page.screenshot({ path: 'tools/evals/out/mobile-demo.png', fullPage: true });
await browser.close();

if (pageErrors.length > 0) failures.push(`page errors: ${pageErrors.join('; ')}`);
if (failures.length > 0) {
  console.error(`MOBILE DEMO SMOKE FAILED:\n- ${failures.join('\n- ')}`);
  process.exit(1);
}
console.log('MOBILE DEMO SMOKE PASSED');
