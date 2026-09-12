import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { reviewLiquidBody } from './mouth-liquid-preview.mjs';

const out = fileURLToPath(new URL('../evals/out/mouth-anatomy/', import.meta.url));
mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ args: ['--no-sandbox'] });
const page = await browser.newPage({ viewport: { width: 1000, height: 1000 }, reducedMotion: 'reduce', deviceScaleFactor: 1 });
const errors = [];
const captures = [];
page.on('pageerror', error => errors.push(error.message));
page.on('console', message => {
  if (message.type() === 'error') errors.push(message.text());
});
try {
  await page.goto(process.argv[2] ?? 'http://localhost:5173/hologlyph/engine.html', { waitUntil: 'load' });
  await page.evaluate(() => scrollTo(0, document.body.scrollHeight));
  await page.waitForFunction(() => document.getElementById('state')?.textContent === 'state: idle');
  await page.addStyleTag({ content: '.intro,.outro,.controls{visibility:hidden} #holo{width:700px;height:820px}' });
  const labels = await page.evaluate(() => {
    const e = window.__hologlyphEngine;
    e.setMotionFrozen(true);
    e.resize(700, 820);
    return e.avatar.morphMeshes.filter(mesh => mesh.material.name === 'mouth_interior').map(mesh => {
      const attr = mesh.geometry.getAttribute('_oral_region');
      if (!attr) throw new Error('Preview loaded an unlabelled mouth');
      let teeth = 0, tongue = 0, gums = 0;
      for (let i = 0; i < attr.count; i++) {
        if (attr.getX(i) > 0.99) teeth++;
        else if (attr.getY(i) > 0.99) tongue++;
        else gums++;
      }
      return { name: mesh.name, teeth, tongue, gums };
    });
  });
  assert(labels.length > 0 && labels.every(label => label.teeth > 100 && label.tongue > 100 && label.gums > 100));
  const poses = [
    ['closed', {}], ['aa', { viseme_aa: 1 }], ['ee', { viseme_ee: 1 }],
    ['ss', { viseme_ss: 1 }], ['oh', { viseme_oh: 1 }], ['th', { viseme_th: 1, tongue_out: 0.7 }],
    ['tongue-up', { viseme_dd: 1, tongue_up: 0.75 }],
  ];
  for (const glass of [0, 0.7]) {
    await page.evaluate(amount => window.__hologlyphEngine.vfx.setHeadConfig({ skin: { glass: { amount } } }), glass);
    for (const yaw of [0, 0.5]) {
      for (const [name, weights] of poses) {
        if (yaw && !['ee', 'th'].includes(name)) continue;
        await page.evaluate(({ yaw, weights }) => {
          const e = window.__hologlyphEngine;
          for (const mesh of e.avatar.morphMeshes) mesh.morphTargetInfluences?.fill(0);
          for (const [name, value] of Object.entries(weights)) e.avatar.setMorph(name, value);
          const camera = e.sysRenderer.camera;
          camera.position.set(1.72 * Math.sin(yaw), 0.05, 1.72 * Math.cos(yaw));
          camera.lookAt(0, 0, 0);
        }, { yaw, weights });
        await page.waitForTimeout(250);
        const file = `${glass ? 'glass' : 'text'}-${yaw ? 'side' : 'front'}-${name}`;
        await page.locator('#holo').screenshot({ path: `${out}${file}.png` });
        captures.push(file);
        console.log(file);
      }
    }
  }
  writeFileSync(`${out}result.json`, JSON.stringify({ labels, captures, errors }, null, 2));
  assert.deepEqual(errors, []);
} finally {
  await browser.close();
}

await reviewLiquidBody(process.argv[2]);
