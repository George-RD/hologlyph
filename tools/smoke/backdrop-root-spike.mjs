/**
 * Lab spike (dev-only): where is the backdrop root?
 *
 * `todo.liquid-glass-live-css-layer` wants a `backdrop-filter` layer behind the
 * head canvas, and `<hologlyph-head>` renders into a shadow root whose host
 * carries `contain: layout paint`. Filter Effects 2 says `backdrop-filter`
 * samples only as far back as its BACKDROP ROOT, and several properties promote
 * an ancestor into one. If the host is a backdrop root, the layer frosts an
 * empty backdrop and shows nothing, in every engine, and the feature is dead
 * before the Firefox question is even reached.
 *
 * This spike answers that, plus the two ancestor shapes Mozilla bug 1782876
 * still lists as broken (a transformed or overflow-clipped ancestor), and
 * re-confirms that `clip-path` on the filter element itself confines the frost
 * (bug 1579957, RESOLVED FIXED 2022-05-18).
 *
 * No dev server: the page is built inline so the spike is one command.
 *
 * Usage:
 *   node tools/smoke/backdrop-root-spike.mjs [chromium|webkit]
 */
import { chromium, webkit } from 'playwright';

const ENGINE = process.argv[2] ?? 'chromium';
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

const engines = { chromium, webkit };
const launcher = engines[ENGINE];
if (!launcher) throw new Error(`unknown engine ${ENGINE}`);

const launchOptions =
  ENGINE === 'chromium'
    ? { executablePath: CHROME, headless: false, args: ['--enable-gpu', '--force-device-scale-factor=1'] }
    : { headless: true };

/**
 * Each case mounts one host at a fixed spot with one ancestor shape, and the
 * filter layer always sits inside a shadow root exactly as the element builds
 * it. The page background is aperiodic on purpose: a periodic one cannot tell a
 * displaced sample from an undisplaced one.
 */
const CASES = [
  { id: 'plain', hostStyle: '' },
  { id: 'containLayoutPaint', hostStyle: 'contain:layout paint;' },
  { id: 'containLayout', hostStyle: 'contain:layout;' },
  { id: 'containStrict', hostStyle: 'contain:strict;' },
  { id: 'ancestorTransform', wrapStyle: 'transform:translateZ(0);' },
  { id: 'ancestorOverflowRadius', wrapStyle: 'overflow:hidden;border-radius:24px;position:relative;' },
  { id: 'ancestorOpacity', wrapStyle: 'opacity:0.99;' },
];

const HTML = `<!doctype html>
<html><head><meta charset="utf-8"><style>
  * { box-sizing: border-box; }
  html, body { margin: 0; height: 100%; }
  /* Aperiodic, high-contrast backdrop: a blur is only measurable against it. */
  body {
    background-color: #0b1020;
    background-image:
      radial-gradient(circle at 11% 23%, #ff2e63 0 38px, transparent 39px),
      radial-gradient(circle at 37% 71%, #08d9d6 0 52px, transparent 53px),
      radial-gradient(circle at 63% 17%, #f9ed69 0 44px, transparent 45px),
      radial-gradient(circle at 82% 59%, #b892ff 0 61px, transparent 62px),
      radial-gradient(circle at 26% 88%, #ffffff 0 33px, transparent 34px),
      radial-gradient(circle at 91% 91%, #ff9f1c 0 47px, transparent 48px);
  }
  .wrap { position: absolute; }
  .host { display: block; position: relative; width: 240px; height: 240px; }
</style></head><body><div id="stage"></div>
<script>
  // Each case gets its own 260px column so one screenshot covers them all.
  window.__cases = [];
  function build(cases) {
    const stage = document.getElementById('stage');
    cases.forEach((spec, i) => {
      const wrap = document.createElement('div');
      wrap.className = 'wrap';
      wrap.style.cssText += 'left:' + (20 + i * 260) + 'px;top:60px;width:240px;height:240px;' + (spec.wrapStyle ?? '');
      const host = document.createElement('div');
      host.className = 'host';
      host.style.cssText += spec.hostStyle ?? '';
      const root = host.attachShadow({ mode: 'open' });
      // Exactly the layer the module would build: absolute, inset 0, behind a
      // transparent canvas sibling, clipped to a blob by its OWN clip-path.
      const layer = document.createElement('div');
      layer.style.cssText =
        'position:absolute;inset:0;pointer-events:none;' +
        'clip-path:polygon(50% 4%, 88% 26%, 88% 74%, 50% 96%, 12% 74%, 12% 26%);';
      const canvas = document.createElement('canvas');
      canvas.width = 240; canvas.height = 240;
      canvas.style.cssText = 'position:relative;display:block;width:100%;height:100%';
      root.append(layer, canvas);
      wrap.appendChild(host);
      stage.appendChild(wrap);
      window.__cases.push({ id: spec.id, layer });
    });
  }
  window.__build = build;
  window.__setFilter = (on) => {
    for (const c of window.__cases) {
      const v = on ? 'blur(14px) saturate(180%)' : 'none';
      c.layer.style.backdropFilter = v;
      c.layer.style.webkitBackdropFilter = v;
    }
  };
</script></body></html>`;

const browser = await launcher.launch(launchOptions);
const page = await browser.newPage({ viewport: { width: 260 * CASES.length + 40, height: 360 }, deviceScaleFactor: 1 });
await page.setContent(HTML, { waitUntil: 'load' });
await page.evaluate((cases) => window.__build(cases), CASES);
await page.waitForTimeout(400);

/** Decode a screenshot in-page and read the probe pixels for every case. */
async function probe() {
  const shot = await page.screenshot();
  const dataUrl = `data:image/png;base64,${shot.toString('base64')}`;
  return await page.evaluate(
    async ({ src, ids }) => {
      const img = new Image();
      await new Promise((res, rej) => {
        img.onload = res;
        img.onerror = rej;
        img.src = src;
      });
      const c = document.createElement('canvas');
      c.width = img.width;
      c.height = img.height;
      c.getContext('2d').drawImage(img, 0, 0);
      const ctx = c.getContext('2d');
      const at = (x, y) => {
        const d = ctx.getImageData(Math.round(x), Math.round(y), 1, 1).data;
        return [d[0], d[1], d[2]];
      };
      return ids.map((id, i) => {
        const left = 20 + i * 260;
        const top = 60;
        return {
          id,
          // Centre of the blob: inside the clip, so a live filter must change it.
          centre: at(left + 120, top + 120),
          // Top-left of the layer rect but outside the clip polygon: a confined
          // filter must leave it untouched.
          corner: at(left + 14, top + 12),
        };
      });
    },
    { src: dataUrl, ids: CASES.map((c) => c.id) },
  );
}

await page.evaluate(() => window.__setFilter(false));
await page.waitForTimeout(250);
const off = await probe();

await page.evaluate(() => window.__setFilter(true));
await page.waitForTimeout(250);
const on = await probe();

const delta = (a, b) => Math.max(...a.map((v, i) => Math.abs(v - b[i])));

console.log(`engine: ${ENGINE}`);
console.log('case                      centreDelta  cornerDelta  verdict');
for (let i = 0; i < CASES.length; i++) {
  const c = delta(on[i].centre, off[i].centre);
  const k = delta(on[i].corner, off[i].corner);
  const verdict =
    c <= 6
      ? 'DEAD: filter sampled nothing (empty backdrop root)'
      : k >= 8
        ? 'LEAK: frost paints outside the clip shape'
        : 'OK: live backdrop, confined to the clip shape';
  console.log(`${CASES[i].id.padEnd(24)}  ${String(c).padStart(11)}  ${String(k).padStart(11)}  ${verdict}`);
}

await browser.close();
