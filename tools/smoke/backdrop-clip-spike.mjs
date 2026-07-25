/**
 * Lab spike (dev-only): can a CSS `backdrop-filter` be confined to the head
 * silhouette with `clip-path`, and what does rewriting that polygon every frame
 * cost? This is the correctness+cost gate for the "live glass body, WebGL detail
 * on top" architecture, where the page behind the canvas cannot be sampled by
 * WebGL at all (see meta/research on DOM capture).
 *
 * Usage (dev server must be running):
 *   node tools/smoke/backdrop-clip-spike.mjs [url] [chromium|firefox|webkit]
 *
 * Chromium runs against the installed Google Chrome for real GPU compositing.
 * Notes on reading the numbers: with vsync disabled, a frame loop that mutates
 * nothing produces no damage and stays throttled to the display, so only the
 * `animatedClip` rows measure real cost.
 */
import { chromium, firefox, webkit } from 'playwright';

const URL = process.argv[2] ?? 'http://localhost:5173/hologlyph/backdrop-clip-spike.html';
const ENGINE = process.argv[3] ?? 'chromium';
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

const engines = { chromium, firefox, webkit };
const launcher = engines[ENGINE];
if (!launcher) throw new Error(`unknown engine ${ENGINE}`);

const launchOptions =
  ENGINE === 'chromium'
    ? {
        executablePath: CHROME,
        headless: false,
        args: [
          '--enable-gpu',
          '--disable-gpu-vsync',
          '--disable-frame-rate-limit',
          '--force-device-scale-factor=2',
        ],
      }
    : // Headed Firefox/WebKit crash on this host's GPU helper; the correctness
      // leg only needs compositing, which headless still performs. Frame costs
      // from these engines are therefore indicative only.
      { headless: true };

const browser = await launcher.launch(launchOptions);
const page = await browser.newPage({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: 2 });
await page.goto(URL, { waitUntil: 'load' });
await page.waitForTimeout(1200);

/**
 * Correctness leg: sample a pixel inside the glass rect but outside the blob,
 * and one at the centre, with the filter on and off. A clipped filter changes
 * the centre only; a leaking filter changes the corner too.
 */
async function pixelProbe() {
  const shot = await page.screenshot();
  const dataUrl = `data:image/png;base64,${shot.toString('base64')}`;
  return await page.evaluate(async (src) => {
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
    const at = (x, y) => {
      const d = ctx.getImageData(Math.round(x), Math.round(y), 1, 1).data;
      return [d[0], d[1], d[2]];
    };
    const r = document.getElementById('glass').getBoundingClientRect();
    const s = img.width / window.innerWidth;
    return {
      corner: at((r.left + 6) * s, (r.top + 6) * s),
      centre: at((r.left + r.width / 2) * s, (r.top + r.height / 2) * s),
    };
  }, dataUrl);
}

const setFilter = (value) =>
  page.evaluate((v) => {
    const g = document.getElementById('glass');
    g.style.backdropFilter = v;
    g.style.webkitBackdropFilter = v;
  }, value);

await setFilter('blur(12px) saturate(1.25)');
await page.waitForTimeout(300);
const withFilter = await pixelProbe();
await setFilter('none');
await page.waitForTimeout(300);
const withoutFilter = await pixelProbe();
await setFilter('blur(12px) saturate(1.25)');

const delta = (a, b) => Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) + Math.abs(a[2] - b[2]);
const cornerDelta = delta(withFilter.corner, withoutFilter.corner);
const centreDelta = delta(withFilter.centre, withoutFilter.centre);

/** Cost leg: blur radius sweep, static vs per-frame polygon rewrite. */
const timings = await page.evaluate(async () => {
  const glass = document.getElementById('glass');
  const POINTS = 60;
  const polygon = (t, wobble) => {
    const pts = [];
    for (let i = 0; i < POINTS; i += 1) {
      const a = (i / POINTS) * Math.PI * 2;
      const egg = 1 - 0.18 * Math.cos(a) - 0.12 * Math.cos(2 * a);
      const ripple = wobble ? 0.035 * Math.sin(6 * a + t * 3) : 0;
      const r = 0.42 * (egg + ripple);
      pts.push(
        `${(50 + Math.cos(a) * r * 100).toFixed(2)}% ${(50 + Math.sin(a) * r * 100).toFixed(2)}%`,
      );
    }
    return `polygon(${pts.join(',')})`;
  };

  const measure = (frames, onFrame) =>
    new Promise((resolve) => {
      const s = [];
      let last = performance.now();
      let n = 0;
      const tick = (now) => {
        s.push(now - last);
        last = now;
        onFrame(now / 1000);
        n += 1;
        if (n < frames) requestAnimationFrame(tick);
        else {
          const mean = s.reduce((x, v) => x + v, 0) / s.length;
          resolve({ mean: +mean.toFixed(3), fps: +(1000 / mean).toFixed(0) });
        }
      };
      requestAnimationFrame(tick);
    });

  const out = {};
  for (const blur of [0, 16, 64]) {
    const filter = blur === 0 ? 'none' : `blur(${blur}px) saturate(1.25)`;
    glass.style.backdropFilter = filter;
    glass.style.webkitBackdropFilter = filter;
    glass.style.clipPath = polygon(0, false);
    await new Promise((r) => setTimeout(r, 250));
    out[`blur${blur}`] = await measure(240, (t) => {
      glass.style.clipPath = polygon(t, true);
    });
  }

  glass.style.width = '100vw';
  glass.style.height = '100vh';
  glass.style.backdropFilter = 'blur(16px) saturate(1.25)';
  glass.style.webkitBackdropFilter = 'blur(16px) saturate(1.25)';
  out.fullViewportBlur16 = await measure(240, (t) => {
    glass.style.clipPath = polygon(t, true);
  });
  return out;
});

console.log(
  JSON.stringify(
    {
      engine: ENGINE,
      clipping: {
        cornerDelta,
        centreDelta,
        verdict:
          centreDelta > 12 && cornerDelta < 8
            ? 'clip-path DOES clip the backdrop-filter'
            : cornerDelta >= 8
              ? 'LEAK: the filter paints outside the clip shape'
              : 'INCONCLUSIVE: the filter had no measurable effect',
      },
      framesAnimatedClip: timings,
    },
    null,
    2,
  ),
);

await browser.close();
