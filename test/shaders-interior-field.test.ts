/**
 * Field-level containment (`todo.interior-glyph-containment`).
 *
 * The pure halves are covered in `shaders-interior.test.ts`. What this file
 * defends is the composition, which is where the acceptance criterion actually
 * lives: no drawn glyph crosses the silhouette at any point in a full drift
 * cycle, with the head at rest AND while it moves, on a frame that is not unit
 * scaled. A bounded drift target is not a bounded glyph, because the spring is
 * under-damped and chases its target through a moving frame.
 *
 * Containment is checked two ways at once, because the probe's distance is
 * UNSIGNED and so cannot by itself tell a contained glyph from an escaped one:
 * the glyph's billboard must clear the skin by its own extent, AND the glyph
 * must be on the inside of it. The body is a sphere, so the second is its
 * radius about the frame's own origin.
 */
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import type { HeadInteriorConfig } from '../src/contracts';
import { createInteriorGlyphField } from '../src/shaders/interior-glyph-field';
import { createSurfaceProbe } from '../src/shaders/interior-glyphs';

/** Deterministic, and never 0 or 1 exactly, so no branch is reached by luck. */
function seededRng(seed = 1): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return (state >>> 8) / 0x1000000;
  };
}

const RINGS = 20;
const SEGMENTS = 20;
const RADIUS = 0.5;

/**
 * The integrator's longest legal step, so a cycle costs as few updates as it
 * can, and the number of them a full drift cycle takes: the slowest drift
 * component turns at 0.23 rad/s.
 */
const STEP = 1 / 20;
const CYCLE_STEPS = Math.ceil((2 * Math.PI) / 0.23 / STEP);
/** An indexed sphere, so the field has a body with readable topology. */
function sphereMesh(): { positions: Float32Array; indices: Uint32Array } {
  const positions: number[] = [];
  for (let ring = 0; ring <= RINGS; ring++) {
    const phi = (ring / RINGS) * Math.PI;
    for (let s = 0; s <= SEGMENTS; s++) {
      const a = (s / SEGMENTS) * Math.PI * 2;
      positions.push(
        Math.sin(phi) * Math.cos(a) * RADIUS,
        Math.cos(phi) * RADIUS,
        Math.sin(phi) * Math.sin(a) * RADIUS,
      );
    }
  }
  const indices: number[] = [];
  const stride = SEGMENTS + 1;
  for (let ring = 0; ring < RINGS; ring++) {
    for (let s = 0; s < SEGMENTS; s++) {
      const a = ring * stride + s;
      indices.push(a, a + 1, a + stride, a + 1, a + stride + 1, a + stride);
    }
  }
  return { positions: new Float32Array(positions), indices: new Uint32Array(indices) };
}

const CONFIG: HeadInteriorConfig = {
  count: 300,
  size: 0.02,
  // The lab's maximum, which is what the owner was moving when the glyphs
  // popped out of the head.
  drift: 0.05,
  inertia: 0.6,
  depthFade: 0.65,
  brightness: 0.55,
  tint: '#9fe7ff',
};

function buildField(rng = seededRng(7)) {
  const { positions, indices } = sphereMesh();
  return createInteriorGlyphField({
    positions,
    indices,
    thickness: null,
    bindToFrame: new THREE.Matrix4(),
    texture: new THREE.Texture(),
    grid: { cols: 96, rows: 64 },
    config: CONFIG,
    rng,
  });
}

function stillCamera(): THREE.PerspectiveCamera {
  const camera = new THREE.PerspectiveCamera(35, 1, 0.1, 100);
  camera.position.set(0, 0.05, 2.4);
  camera.lookAt(0, 0, 0);
  camera.updateMatrixWorld(true);
  return camera;
}

/** Which glyph slots the index buffer actually draws this frame. */
function drawnGlyphs(geometry: THREE.BufferGeometry): number[] {
  const index = geometry.getIndex();
  if (!index) return [];
  const drawn = geometry.drawRange.count;
  const slots: number[] = [];
  for (let i = 0; i < drawn; i += 6) slots.push(Math.floor((index.getX(i) ?? 0) / 4));
  return slots;
}

/** Centre of a glyph's billboard, which is the mean of its four corners. */
function glyphCentre(position: THREE.BufferAttribute, g: number, out: THREE.Vector3): THREE.Vector3 {
  out.set(0, 0, 0);
  for (let c = 0; c < 4; c++) {
    out.x += position.getX(g * 4 + c);
    out.y += position.getY(g * 4 + c);
    out.z += position.getZ(g * 4 + c);
  }
  return out.multiplyScalar(0.25);
}

describe('interior glyph field containment', () => {
  const { positions, indices } = sphereMesh();

  /**
   * Drive the field over a FULL drift cycle on a frame that optionally rotates
   * and translates, and is scaled by `scale`. Reports the worst clearance any
   * DRAWN glyph's furthest billboard corner had to the skin, the furthest any
   * drawn glyph strayed outward as a fraction of the body's own radius, and how
   * many glyphs were drawn.
   *
   * The field's clock advances by `dt` per update, not by anything the caller
   * names, and the slowest drift component turns at 0.23 rad/s, so a cycle is
   * about 27.3 s of field time. At the integrator's longest legal step that is
   * `CYCLE_STEPS` updates.
   *
   * The skin is probed ONCE, in the body's own space, and glyph centres are
   * carried back into it by the inverse frame. The frame is a rotation, a
   * translation and a uniform scale, so that map is a similarity and a distance
   * measured in body space is the world distance divided by the scale. Building
   * a probe over a re-transformed mesh every frame measures the same number for
   * a few hundred times the cost.
   */
  function driveField(scale: number, moving: boolean): {
    gap: number;
    outward: number;
    drawn: number;
  } {
    const field = buildField();
    const camera = stillCamera();
    const frame = new THREE.Matrix4();
    const inverse = new THREE.Matrix4();
    const centre = new THREE.Vector3();
    const extent = CONFIG.size * Math.SQRT2;
    const mesh = field.object as THREE.Mesh;
    const skin = createSurfaceProbe(positions, indices);
    let gap = Number.POSITIVE_INFINITY;
    let outward = 0;
    let drawn = 0;

    for (let step = 0; step < CYCLE_STEPS; step++) {
      const t = step * STEP;
      // A head that turns, nods and crosses the stage, or one that holds still.
      // Both have to hold, and the still one is the "at rest" half of the
      // acceptance criterion.
      if (moving) {
        frame
          .makeRotationFromEuler(new THREE.Euler(Math.sin(t * 3) * 0.4, t * 2.5, Math.sin(t) * 0.2))
          .setPosition(Math.sin(t * 2) * 0.3, Math.cos(t * 1.5) * 0.1, 0)
          .scale(new THREE.Vector3(scale, scale, scale));
      } else {
        frame.makeScale(scale, scale, scale);
      }

      field.update(STEP, { frameMatrix: frame, camera, reduced: false });

      inverse.copy(frame).invert();
      const attr = mesh.geometry.getAttribute('position') as THREE.BufferAttribute;
      const slots = drawnGlyphs(mesh.geometry);
      drawn = slots.length;
      // The radial bound is cheap, so every glyph is tested on every frame and a
      // transient spring escape between two of them cannot hide. The exact
      // surface distance costs a pass over the triangles, so it samples a fifth
      // of the frames, which is dense against a spring that moves smoothly.
      const measure = step % 5 === 0;
      for (const g of slots) {
        glyphCentre(attr, g, centre).applyMatrix4(inverse);
        outward = Math.max(outward, centre.length() / RADIUS);
        if (!measure) continue;
        gap = Math.min(gap, skin.distance(centre.x, centre.y, centre.z) * scale - extent);
      }
    }

    field.dispose();
    return { gap, outward, drawn };
  }

  it('holds every drawn glyph inside a still head at full drift', () => {
    const { gap, outward, drawn } = driveField(1, false);
    expect(drawn).toBeGreaterThan(150);
    expect(gap).toBeGreaterThan(0);
    expect(outward).toBeLessThan(1);
  });

  it('holds every drawn glyph inside a head that is turning and translating', () => {
    // The case a target-only bound cannot pass: the spring lags the frame by
    // design and overshoots on the way back, so the glyph is not where its
    // bounded target is.
    const { gap, outward, drawn } = driveField(1, true);
    expect(drawn).toBeGreaterThan(150);
    expect(gap).toBeGreaterThan(0);
    expect(outward).toBeLessThan(1);
  });

  it('holds every drawn glyph inside a scaled head that is moving', () => {
    // Clearances are measured in bind space and the sprite is world-space, so a
    // frame scale away from 1 is where a mis-converted budget shows up.
    for (const scale of [0.4, 2.5]) {
      const { gap, outward, drawn } = driveField(scale, true);
      expect(drawn, `scale ${scale} drew nothing`).toBeGreaterThan(100);
      expect(gap, `scale ${scale} leaked`).toBeGreaterThan(0);
      expect(outward, `scale ${scale} escaped`).toBeLessThan(1);
    }
  });

  it('culls the glyphs a raised sprite size no longer fits, without reseeding', () => {
    const field = buildField();
    const camera = stillCamera();
    const frame = new THREE.Matrix4();
    const mesh = field.object as THREE.Mesh;

    field.update(1 / 60, { frameMatrix: frame, camera, reduced: false });
    const before = mesh.geometry.drawRange.count;

    // A sprite wide enough that most sites can no longer hold one. The budgets
    // are keyed on the extent, so this takes effect on the next frame without
    // the field being rebuilt.
    field.setConfig({ ...CONFIG, size: 0.2 });
    field.update(1 / 60, { frameMatrix: frame, camera, reduced: false });
    const after = mesh.geometry.drawRange.count;

    expect(before).toBeGreaterThan(0);
    expect(after).toBeLessThan(before);
    field.dispose();
  });
});
