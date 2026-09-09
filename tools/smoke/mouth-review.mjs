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
const page = await browser.newPage({
  viewport: { width: 1100, height: 900 }, deviceScaleFactor: 1, reducedMotion: 'reduce',
});
const errors = [];
const captures = [];
page.on('pageerror', (error) => errors.push(error.message));
page.on('console', (message) => {
  if (message.type() === 'error') errors.push(message.text());
});
page.setDefaultTimeout(30000);
const poses = [
  ['closed', {}], ['aa', { viseme_aa: 1 }], ['ee', { viseme_ee: 1 }],
  ['oh', { viseme_oh: 1 }], ['th', { viseme_th: 1, tongue_out: 0.45 }],
  ['tongue-up', { viseme_dd: 1, tongue_up: 0.6 }],
];
const referencePoses = new Set(['closed', 'aa', 'ee', 'th']);

async function pose(yaw, weights) {
  await page.evaluate(({ yaw, weights }) => {
    const engine = window.__hologlyphEngine;
    for (const mesh of engine.avatar.morphMeshes) mesh.morphTargetInfluences?.fill(0);
    for (const [name, weight] of Object.entries(weights)) engine.avatar.setMorph(name, weight);
    const camera = engine.sysRenderer.camera;
    const radius = 1.9;
    camera.position.set(radius * Math.sin(yaw), 0.05, radius * Math.cos(yaw));
    camera.lookAt(0, 0, 0);
  }, { yaw, weights });
}

async function capture(name, reference = false) {
  // Swap only the material, in this very pose. The source asset's original
  // material is still owned by the engine until avatar disposal. This makes
  // the comparison independent of different frames, source text or cameras.
  await page.evaluate((reference) => {
    const engine = window.__hologlyphEngine;
    const original = [...engine.displacedMaterials].find((m) => m.name === 'mouth_interior');
    const current = engine.mouthMaterial;
    if (!original || !current) throw new Error('Missing original or replacement mouth material');
    const relayer = original.transparent !== current.transparent || original.blending !== current.blending;
    original.transparent = current.transparent;
    original.blending = current.blending;
    original.depthWrite = current.depthWrite;
    original.depthTest = current.depthTest;
    if (relayer) original.needsUpdate = true;
    engine.avatar.root.traverse((mesh) => {
      if (mesh.isMesh && (mesh.material === original || mesh.material === current)) {
        mesh.material = reference ? original : current;
      }
    });
  }, reference);
  await page.waitForTimeout(300);
  await page.locator('#holo').screenshot({ path: `${output}${name}.png` });
  captures.push(name);
  console.log(`captured ${name}`);
}

try {
  // Headless Chromium has no system voice. Drive the host's word-boundary
  // events deterministically, keeping the real demo adapter, speech engine
  // and motion blend intact. This verifies animation, not audible synthesis.
  await page.addInitScript(() => {
    class TestUtterance {
      constructor(text) { this.text = text; }
    }
    let startTimer;
    let boundaryTimer;
    const cancel = () => {
      clearTimeout(startTimer);
      clearInterval(boundaryTimer);
    };
    const synthesis = {
      cancel,
      getVoices() { return []; },
      speak(utterance) {
        cancel();
        const words = [...utterance.text.matchAll(/\S+/g)];
        let cursor = 0;
        const boundary = () => {
          const word = words[cursor++ % words.length];
          if (word) utterance.onboundary?.({ charIndex: word.index, charLength: word[0].length });
        };
        startTimer = setTimeout(() => {
          utterance.onstart?.();
          boundary();
          boundaryTimer = setInterval(boundary, 600);
        }, 0);
      },
    };
    Object.defineProperty(globalThis, 'SpeechSynthesisUtterance', { configurable: true, value: TestUtterance });
    Object.defineProperty(globalThis, 'speechSynthesis', { configurable: true, value: synthesis });
  });
  await page.goto(process.argv[2] ?? 'http://localhost:5173/hologlyph/engine.html', { waitUntil: 'load' });
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await page.waitForFunction(() => document.getElementById('state')?.textContent === 'state: idle');
  // The sticky canvas overlaps the outro at the bottom of this demo. Hide
  // prose without changing its layout, scroll position or the real renderer.
  await page.addStyleTag({ content: '.intro, .outro { visibility: hidden; }' });
  const meshes = await page.evaluate(() => {
    const engine = window.__hologlyphEngine;
    if (!engine?.avatar || !engine?.sysRenderer?.camera) throw new Error('Real engine review hook missing');
    engine.setMotionFrozen(true);
    const rows = [];
    engine.avatar.root.traverse((object) => {
      if (!object.isMesh) return;
      const materials = Array.isArray(object.material) ? object.material : [object.material];
      rows.push({
        name: object.name, vertices: object.geometry.attributes.position?.count ?? 0,
        materials: materials.map((material) => ({ name: material.name, type: material.type })),
        morphs: Object.keys(object.morphTargetDictionary ?? {}),
      });
    });
    return rows;
  });
  writeFileSync(`${output}meshes.json`, JSON.stringify(meshes, null, 2));
  assert(meshes.some((mesh) => mesh.materials.some((material) => material.name === 'mouth_interior' && material.type === 'NodeMaterial') && mesh.morphs.includes('tongue_out')), 'Review requires the real mouth primitive, replacement shader and tongue morphs');
  for (const glass of [0, 0.7]) {
    await page.evaluate((amount) => {
      window.__hologlyphEngine.vfx.setHeadConfig({ skin: { glass: { amount } } });
    }, glass);
    for (const yaw of [0, 0.6]) {
      for (const [name, weights] of poses) {
        await pose(yaw, weights);
        const label = `${glass ? 'glass' : 'text'}-${yaw ? 'side' : 'front'}-${name}`;
        await capture(label);
        if (yaw === 0 && referencePoses.has(name)) await capture(`before-${label}`, true);
      }
    }
  }
  // The same shader must also compile with displacement and on a light host.
  await pose(0, { viseme_aa: 1 });
  await page.evaluate(() => window.__hologlyphEngine.vfx.setHeadConfig({ melt: { amount: 0.35 } }));
  await capture('melt-aa');
  await page.evaluate(() => {
    window.__hologlyphEngine.vfx.setHeadConfig({ melt: { amount: 0 }, skin: { backdrop: { auto: false, color: '#f4f2ed' } } });
    document.body.style.background = '#f4f2ed';
  });
  await capture('light-aa');
  await page.evaluate(() => {
    window.__hologlyphEngine.vfx.setHeadConfig({ skin: { backdrop: { auto: false, color: '#05070d' } } });
    document.body.style.background = '#05070d';
  });
  await page.setViewportSize({ width: 390, height: 844 });
  for (const [name, weights] of [poses[0], poses[2], poses[4]]) {
    await pose(0, weights);
    await capture(`mobile-${name}`);
  }
  // Exercise the actual speech-to-motion path as well as static extremes.
  await page.evaluate(() => window.__hologlyphEngine.setMotionFrozen(false));
  await page.locator('#speak').click();
  await page.waitForFunction(() => {
    const engine = window.__hologlyphEngine;
    return engine.speech.speaking && engine.avatar.morphMeshes.some((mesh) =>
      Object.entries(mesh.morphTargetDictionary ?? {}).some(([name, index]) =>
        name.startsWith('viseme_') && name !== 'viseme_sil' && mesh.morphTargetInfluences[index] > 0.05));
  });
  await capture('mobile-speech-animation');
  await page.evaluate(() => window.__hologlyphEngine.speech.cancel());
  assert.deepEqual(errors, [], 'Browser errors during mouth review');
} finally {
  writeFileSync(`${output}result.json`, JSON.stringify({ captures, count: captures.length, voice: 'synthetic host word-boundary events; no audio', errors }, null, 2));
  await browser.close();
}
