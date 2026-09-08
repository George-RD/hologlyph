import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const output = fileURLToPath(new URL('../evals/out/mouth/', import.meta.url));
mkdirSync(output, { recursive: true });
const browser = await chromium.launch({
  ...(process.env.HOLOGLYPH_CHROME ? { executablePath: process.env.HOLOGLYPH_CHROME } : {}),
  args: ['--no-sandbox'],
});
const errors = [];
const page = await browser.newPage({
  viewport: { width: 1100, height: 900 },
  deviceScaleFactor: 1,
  reducedMotion: 'reduce',
});
page.on('pageerror', (error) => errors.push(error.message));
page.on('console', (message) => {
  if (message.type() === 'error') errors.push(message.text());
});
page.setDefaultTimeout(30000);
const poses = [
  ['closed', {}],
  ['aa', { viseme_aa: 1 }],
  ['ee', { viseme_ee: 1 }],
  ['oh', { viseme_oh: 1 }],
  ['th', { viseme_th: 1, tongue_out: 0.45 }],
  ['tongue-up', { viseme_dd: 1, tongue_up: 0.6 }],
];
try {
  await page.goto(process.argv[2] ?? 'http://localhost:5173/hologlyph/engine.html', { waitUntil: 'load' });
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await page.waitForFunction(() => document.getElementById('state')?.textContent === 'state: idle');
  const meshes = await page.evaluate(() => {
    const engine = window.__hologlyphEngine;
    if (!engine?.avatar || !engine?.sysRenderer?.camera) throw new Error('Real engine review hook missing');
    engine.setMotionFrozen(true);
    const rows = [];
    engine.avatar.root.traverse((object) => {
      if (!object.isMesh) return;
      const materials = Array.isArray(object.material) ? object.material : [object.material];
      rows.push({
        name: object.name,
        vertices: object.geometry.attributes.position?.count ?? 0,
        materials: materials.map((material) => ({ name: material.name, type: material.type, transparent: material.transparent })),
        morphs: Object.keys(object.morphTargetDictionary ?? {}),
      });
    });
    return rows;
  });
  assert(meshes.some((mesh) => mesh.vertices > 10000), 'Placeholder cannot pass a mouth review');
  writeFileSync(`${output}meshes.json`, JSON.stringify(meshes, null, 2));
  for (const glass of [0, 0.7]) {
    await page.evaluate((amount) => {
      window.__hologlyphEngine.sysVfx.setHeadConfig({ skin: { glass: { amount } } });
    }, glass);
    for (const yaw of [0, 0.6]) {
      for (const [name, weights] of poses) {
        await page.evaluate(({ yaw, weights }) => {
          const engine = window.__hologlyphEngine;
          for (const mesh of engine.avatar.morphMeshes) {
            mesh.morphTargetInfluences?.fill(0);
            for (const [name, weight] of Object.entries(weights)) {
              const index = mesh.morphTargetDictionary?.[name];
              if (index !== undefined && mesh.morphTargetInfluences) mesh.morphTargetInfluences[index] = weight;
            }
          }
          const camera = engine.sysRenderer.camera;
          camera.position.set(2.4 * Math.sin(yaw), 0.05, 2.4 * Math.cos(yaw));
          camera.lookAt(0, 0, 0);
        }, { yaw, weights });
        await page.waitForTimeout(180);
        await page.locator('#holo').screenshot({ path: `${output}${glass ? 'glass' : 'text'}-${yaw ? 'side' : 'front'}-${name}.png` });
      }
    }
  }
  writeFileSync(`${output}result.json`, JSON.stringify({ poses: poses.length, captures: poses.length * 4, errors }, null, 2));
  assert.deepEqual(errors, [], 'Browser errors during mouth review');
} finally {
  await browser.close();
}
