import { chromium } from 'playwright';
const CHROME = process.env.HOLOGLYPH_CHROME;
const BASE = process.env.HOLOGLYPH_BASE ?? 'http://127.0.0.1:5199/hologlyph/';
const browser = await chromium.launch({ ...(CHROME ? { executablePath: CHROME } : {}), args: ['--no-sandbox', ...(process.platform === 'darwin' ? ['--use-angle=metal'] : [])] });
let failure = null;
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 820 } });
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text().slice(0, 200));
  });

  await page.goto(`${BASE}?tune`, { waitUntil: 'load' });
  await page.waitForFunction(
    () => document.getElementById('status')?.textContent?.startsWith('live'),
    null,
    { timeout: 60000 },
  );
  await page.waitForTimeout(1500);

  const counts = await page.evaluate(() => {
    const buttons = [...document.querySelectorAll('#panel button')];
    const requiredButton = (label) => {
      const button = buttons.find((candidate) => candidate.textContent?.includes(label));
      if (!button) throw new Error(`Missing lab button: ${label}`);
      return button;
    };
    requiredButton('Owner 07-21').click();
    requiredButton('dark').click();
    requiredButton('mid').click();
    requiredButton('light').click();

    const colour = document.getElementById('customBgColor');
    if (!colour) throw new Error('Missing custom background colour control');
    colour.value = '#121824';
    colour.dispatchEvent(new Event('input', { bubbles: true }));

    const core = [...document.querySelectorAll('#panel input[type=checkbox]')]
      .find((input) => input.nextElementSibling?.textContent?.includes('inner core'));
    if (!core) throw new Error('Missing inner core control');
    core.checked = true;
    core.dispatchEvent(new Event('change', { bubbles: true }));

    requiredButton('night preset').click();
    requiredButton('day preset').click();

    const trim = [...document.querySelectorAll('input[type=range]')]
      .find((input) => input.previousElementSibling?.textContent?.includes('trim size'));
    if (!trim) throw new Error('Missing trim size control');
    trim.value = 0.5;
    trim.dispatchEvent(new Event('input', { bubbles: true }));

    return {
      sliders: document.querySelectorAll('input[type=range]').length,
      buttons: buttons.length,
    };
  });
  await page.waitForTimeout(1200);
  await page.screenshot({ path: '/tmp/holo-lab.png' });
  console.log('sliders:', counts.sliders, 'buttons:', counts.buttons, 'errors:', errors.length ? errors.join('; ') : 'none');
  if (errors.length) throw new Error(`Lab shot encountered page errors: ${errors.join('; ')}`);
} catch (error) {
  failure = error;
}
await browser.close();
if (failure) throw failure;
