import { chromium } from 'playwright';

const CHROME = process.env.HOLOGLYPH_CHROME;
const browser = await chromium.launch({
  ...(CHROME ? { executablePath: CHROME } : {}),
  args: ['--no-sandbox', ...(process.platform === 'darwin' ? ['--use-angle=metal'] : [])],
});
const page = await browser.newPage({ viewport: { width: 1100, height: 800 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') console.log('[console]', m.type(), m.text().slice(0, 160)); });

await page.goto('http://localhost:5199/', { waitUntil: 'load' });

// Wait until the engine leaves 'hidden' (ready + observer fired) or timeout.
await page.waitForFunction(
  () => document.getElementById('state')?.textContent !== 'state: hidden',
  null,
  { timeout: 30000 },
).catch(() => {});
const stateEarly = await page.evaluate(() => document.getElementById('state')?.textContent);

// Force full emergence via scroll.
await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
await page.waitForTimeout(2500);
const state = await page.evaluate(() => document.getElementById('state')?.textContent);

// Screenshot canvas region and analyze against the clear colour in-page.
async function canvasStats() {
  const buf = await page.locator('#holo').screenshot();
  const dataUrl = `data:image/png;base64,${buf.toString('base64')}`;
  return await page.evaluate(async (src) => {
    const img = new Image();
    await new Promise((res, rej) => { img.onload = res; img.onerror = rej; img.src = src; });
    const c = document.createElement('canvas');
    c.width = img.width; c.height = img.height;
    const ctx = c.getContext('2d');
    ctx.drawImage(img, 0, 0);
    const d = ctx.getImageData(0, 0, c.width, c.height).data;
    // Renderer clear colour is near #05070d; classify pixels that differ by
    // more than a tolerance as "content".
    let content = 0, total = 0, sum = 0;
    for (let i = 0; i < d.length; i += 4) {
      const dr = Math.abs(d[i] - 5), dg = Math.abs(d[i + 1] - 7), db = Math.abs(d[i + 2] - 13);
      if (dr + dg + db > 30) content++;
      sum += d[i] + d[i + 1] + d[i + 2];
      total++;
    }
    return { contentFraction: content / total, meanRGB: sum / (total * 3), w: c.width, h: c.height };
  }, dataUrl);
}

const emerged = await canvasStats();

// Speak roundtrip: click speak, sample mid-speech frames, assert mouth-region motion.
async function centerCrop() {
  const buf = await page.locator('#holo').screenshot();
  const dataUrl = `data:image/png;base64,${buf.toString('base64')}`;
  return await page.evaluate(async (src) => {
    const img = new Image();
    await new Promise((res, rej) => { img.onload = res; img.onerror = rej; img.src = src; });
    const c = document.createElement('canvas');
    c.width = img.width; c.height = img.height;
    const ctx = c.getContext('2d');
    ctx.drawImage(img, 0, 0);
    // Central band where the face/mouth sits.
    const x = Math.floor(img.width * 0.3), w = Math.floor(img.width * 0.4);
    const y = Math.floor(img.height * 0.35), h = Math.floor(img.height * 0.45);
    return Array.from(ctx.getImageData(x, y, w, h).data.filter((_, i) => i % 16 === 0));
  }, dataUrl);
}

const beforeSpeak = await centerCrop();
await page.click('#speak');
await page.waitForTimeout(900);
const midSpeak1 = await centerCrop();
await page.waitForTimeout(700);
const midSpeak2 = await centerCrop();
const speakState = await page.evaluate(() => document.getElementById('state')?.textContent);

function diff(a, b) {
  let d = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) d += Math.abs(a[i] - b[i]) > 12 ? 1 : 0;
  return d / n;
}

const results = {
  stateEarly,
  stateAfterScroll: state,
  speakState,
  emerged,
  mouthMotion_beforeVsMid1: diff(beforeSpeak, midSpeak1),
  mouthMotion_mid1VsMid2: diff(midSpeak1, midSpeak2),
  pageErrors: errors,
};
console.log(JSON.stringify(results, null, 2));

await page.screenshot({ path: '/tmp/holo-demo.png' });
await browser.close();

// Hard oracles: fail non-zero when the bust or viseme motion regresses.
const failures = [];
if (state !== 'state: idle') failures.push(`expected idle after scroll, got ${state}`);
if (speakState !== 'state: speaking') failures.push(`expected speaking after click, got ${speakState}`);
if (emerged.contentFraction < 0.08) failures.push(`bust content fraction too low: ${emerged.contentFraction}`);
if (results.mouthMotion_beforeVsMid1 < 0.05 && results.mouthMotion_mid1VsMid2 < 0.05) {
  failures.push('no visible viseme motion during speech');
}
if (errors.length > 0) failures.push(`page errors: ${errors.join('; ')}`);
if (failures.length > 0) {
  console.error(`SMOKE FAILED:\n- ${failures.join('\n- ')}`);
  process.exit(1);
}
console.log('SMOKE PASSED');
