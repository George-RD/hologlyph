import { chromium } from 'playwright';

const BASE = process.env.HOLOGLYPH_BASE ?? 'http://127.0.0.1:5199/hologlyph/';
const PROFILE = process.env.HOLOGLYPH_KOKORO_PROFILE ?? '/tmp/hologlyph-kokoro-real';
const DEVICE = process.env.HOLOGLYPH_KOKORO_DEVICE ?? 'wasm';
const CHROME = process.env.HOLOGLYPH_CHROME;
const context = await chromium.launchPersistentContext(PROFILE, {
  ...(CHROME ? { executablePath: CHROME } : {}),
  headless: true,
  viewport: { width: 1280, height: 820 },
  args: ['--no-sandbox', ...(process.platform === 'darwin' ? ['--use-angle=metal'] : [])],
});
try {
  const pages = context.pages();
  const page = pages[0] ?? (await context.newPage());
  const pageErrors = [];
  const modelRequests = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  page.on('request', (request) => {
    if (/huggingface\.co|hf\.co|onnx-community/i.test(request.url())) {
      modelRequests.push(request.url());
    }
  });
  await page.addInitScript((device) => {
    window.__kokoroDevice = device;
  }, DEVICE);

  await page.goto(BASE, { waitUntil: 'load' });
  await page.waitForFunction(
    () => document.getElementById('status')?.textContent?.startsWith('live'),
    null,
    { timeout: 60_000 },
  );
  const loadedBeforeClick = await page.evaluate(() => window.__lab?.speech?.hqLoaded === true);
  if (loadedBeforeClick) throw new Error('Kokoro model was already loaded before the click gesture');
  if (modelRequests.length !== 0) {
    throw new Error(`Kokoro model requested before click: ${modelRequests.join(', ')}`);
  }

  await page.click('#hqVoiceBtn');
  await page.waitForFunction(
    () => /hq voice ready|browser voice restored/i.test(
      document.getElementById('voiceStatus')?.textContent ?? '',
    ),
    null,
    { timeout: 600_000 },
  );
  const voiceStatus = await page.evaluate(
    () => document.getElementById('voiceStatus')?.textContent ?? '',
  );
  const hqLoaded = await page.evaluate(() => window.__lab?.speech?.hqLoaded === true);
  if (!hqLoaded) {
    throw new Error(`Kokoro adapter did not load after the click gesture: ${voiceStatus}`);
  }

  await page.fill('#saybar input', 'Hi.');
  await page.click('#speakBtn');
  const viseme = await page.waitForFunction(
    () => {
      const weights = window.__lab?.speech?.frameWeights ?? {};
      const peak = Math.max(0, ...Object.values(weights).map(Number));
      return peak > 0.05 ? { peak, weights } : false;
    },
    null,
    { timeout: 300_000 },
  );
  const result = await viseme.jsonValue();
  if (pageErrors.length > 0) {
    throw new Error(`Page errors: ${pageErrors.join('; ')}`);
  }
  console.log(JSON.stringify({ device: DEVICE, modelRequests: modelRequests.length, viseme: result }, null, 2));
  console.log('PASS: real Kokoro model loaded after gesture and drove visemes during audio playback');
} finally {
  await context.close();
}
