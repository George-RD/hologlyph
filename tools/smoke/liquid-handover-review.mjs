import assert from 'node:assert/strict';

/** Inspect the real renderer backend, not navigator.gpu feature detection. */
async function rendererObservation(page) {
  return page.evaluate(() => {
    const host = window.__liquidLab.engine.sysRenderer;
    const renderer = host.gpuRenderer;
    const backend = renderer.backend;
    const gl = backend.gl;
    const debug = gl?.getExtension('WEBGL_debug_renderer_info');
    return {
      reportedBackend: host.backend,
      actualBackend: backend.constructor.name,
      device: debug ? gl.getParameter(debug.UNMASKED_RENDERER_WEBGL) : null,
      userAgent: navigator.userAgent,
      drawCalls: renderer.info.render.drawCalls,
      triangles: renderer.info.render.triangles,
      note: 'Headless desktop browser and mobile viewport, not physical-device performance.',
    };
  });
}

/** Read-only frame sampling; the existing VFX loop remains the only clock. */
async function observeFrames(page, count = 24) {
  return page.evaluate(count => new Promise(resolve => {
    const frames = [];
    let previous = performance.now();
    const sample = now => {
      const lab = window.__liquidLab;
      frames.push({ dt: now - previous, position: [...lab.liquid.position],
        bounds: { ...lab.liquid.bounds }, amount: lab.liquid.amount,
        camera: lab.engine.sysRenderer.camera.matrixWorld.toArray() });
      previous = now;
      if (frames.length < count) requestAnimationFrame(sample);
      else resolve(frames);
    };
    requestAnimationFrame(sample);
  }), count);
}

/** Reverse the requested transition without snapping its current amount. */
async function interrupt(page, target) {
  const state = await page.evaluate(target => {
    const lab = window.__liquidLab;
    const before = lab.liquid.amount;
    lab.amount(target);
    return { before, after: lab.liquid.amount, target: lab.liquid.targetAmount };
  }, target);
  assert.equal(state.before, state.after, 'Interrupting must not snap the current shape');
  assert.equal(state.target, target);
  return state;
}

/** Fixed-camera handover, interruption and release evidence on six host cases. */
export async function reviewLiquidHandover(page, capture, report) {
  report.handover = [];
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  for (const viewport of [{ width: 1000, height: 900 }, { width: 390, height: 844 }]) {
    await page.setViewportSize(viewport);
    for (const background of ['dark', 'light', 'checker']) {
      const prefix = `handover-${viewport.width}-${background}`;
      // Use the supported reduced-motion placement path to reset between
      // cases. Do not mutate the solver's position or run another update loop.
      await page.emulateMedia({ reducedMotion: 'reduce' });
      await page.waitForTimeout(100);
      await page.evaluate(background => {
        const lab = window.__liquidLab;
        lab.view({ close: false, side: false });
        lab.amount(1, true);
        lab.liquid.steerTo(0, 0);
        lab.amount(0, true);
        lab.pose('ee');
        lab.background(background);
      }, background);
      await page.emulateMedia({ reducedMotion: 'no-preference' });
      await page.waitForTimeout(100);
      const camera = await page.evaluate(() => window.__liquidLab.engine.sysRenderer.camera.matrixWorld.toArray());
      const entry = { viewport, background, phases: [], interrupts: [] };
      for (const [direction, amounts] of [['out', [0, 0.5, 0.8, 0.94, 0.96, 1]], ['in', [0.96, 0.94, 0.8, 0.5, 0]]]) {
        for (const amount of amounts) {
          await page.evaluate(amount => window.__liquidLab.amount(amount, true), amount);
          await capture(`${prefix}-${direction}-${Math.round(amount * 100)}`);
          const actual = await page.evaluate(() => {
            const lab = window.__liquidLab;
            const originals = [];
            lab.engine.avatar.root.traverse(object => {
              if (object.isMesh && object.name !== 'hologlyph_liquid_surface') originals.push(object.visible);
            });
            return { amount: lab.liquid.amount, camera: lab.engine.sysRenderer.camera.matrixWorld.toArray(),
              surface: lab.engine.avatar.root.getObjectByName('hologlyph_liquid_surface')?.visible, originals };
          });
          assert.deepEqual(actual.camera, camera, 'The camera must not conceal the handover');
          if (amount === 1) {
            assert(actual.surface, 'The independent surface must own the full-liquid endpoint');
            assert(actual.originals.length > 0 && actual.originals.every(visible => !visible), 'No authored internals may remain in full liquid');
          }
          entry.phases.push({ direction, amount: actual.amount });
        }
      }
      await page.evaluate(() => window.__liquidLab.amount(1));
      await page.waitForFunction(() => window.__liquidLab.liquid.amount >= 0.75);
      entry.interrupts.push(await interrupt(page, 0));
      await capture(`${prefix}-interrupt-reform`);
      await page.waitForFunction(() => window.__liquidLab.liquid.amount <= 0.4);
      entry.interrupts.push(await interrupt(page, 1));
      await capture(`${prefix}-interrupt-liquid`);
      await page.waitForFunction(() => window.__liquidLab.liquid.canSteer);
      await page.evaluate(() => {
        const body = window.__liquidLab.liquid;
        body.steerTo(body.bounds.maxX, body.bounds.maxY);
        body.impulse(0.4, 0.2, 1.5);
      });
      await observeFrames(page, 8);
      await page.evaluate(() => window.__liquidLab.liquid.release());
      const frames = await observeFrames(page);
      for (const frame of frames) {
        const [x, y] = frame.position;
        assert(x >= frame.bounds.minX && x <= frame.bounds.maxX);
        assert(y >= frame.bounds.minY && y <= frame.bounds.maxY);
        assert.deepEqual(frame.camera, camera);
      }
      const timings = frames.slice(1).map(frame => frame.dt).sort((a, b) => a - b);
      entry.frameMs = { median: timings[Math.floor(timings.length / 2)], p95: timings[Math.floor(timings.length * 0.95)] };
      entry.renderer = await rendererObservation(page);
      await capture(`${prefix}-released`);
      await page.evaluate(() => window.__liquidLab.amount(0));
      await page.waitForFunction(() => window.__liquidLab.liquid.amount === 0);
      await capture(`${prefix}-reformed`);
      const position = await page.evaluate(() => {
        const lab = window.__liquidLab;
        return { body: [...lab.liquid.position], carrier: lab.engine.avatar.root.getObjectByName('hologlyph_liquid_carrier').position.toArray() };
      });
      assert.deepEqual(position.carrier, [...position.body, 0]);
      entry.reformed = position;
      report.handover.push(entry);
    }
  }
  // A close inspection must follow the travelled head, not its old origin.
  await page.setViewportSize({ width: 1000, height: 900 });
  await page.evaluate(() => {
    const lab = window.__liquidLab;
    lab.view({ close: true });
    lab.background('dark');
    lab.pose('aa');
  });
  await capture('travelled-tongue-close');
  const close = await page.evaluate(() => {
    const lab = window.__liquidLab;
    return { position: [...lab.liquid.position], camera: lab.engine.sysRenderer.camera.position.toArray() };
  });
  assert.equal(close.camera[0], close.position[0]);
  assert(Math.abs(close.camera[1] - close.position[1] + 0.08) < 1e-10);
}
