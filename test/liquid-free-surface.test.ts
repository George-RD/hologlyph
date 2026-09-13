import { describe, expect, it, vi } from 'vitest';
import { BoxGeometry, CanvasTexture, Group, Mesh, MeshBasicMaterial } from 'three';
import type { TextSkinEngine } from '../src/contracts';
import { LiquidBoundary, LIQUID_BOUNDARY_LIMIT } from '../src/shaders/liquid-boundary';
import { LiquidDynamics } from '../src/shaders/liquid-dynamics';
import { LiquidMaterialOwner } from '../src/shaders/liquid-material';
import { liquidFootprint, insetLiquidBounds } from '../src/shaders/liquid-footprint';
import { createLiquidScene } from '../src/shaders/liquid-scene';
import { buildSkinMaterial } from '../src/shaders/materials';

/** Advance the production fixed-step owner at a deterministic frame rate. */
function advance(body: LiquidDynamics, seconds: number): void {
  for (let i = 0; i < Math.round(seconds * 120); i++) body.update(1 / 120);
}

/** Borrow a real canvas atlas without introducing a GPU or independent clock. */
function skinSource(): TextSkinEngine {
  return {
    texture: new CanvasTexture(document.createElement('canvas')),
    scrollOffset: 0, scrollSpeed: 0,
    setSource() {}, setScrollSpeed() {}, setReducedMotion() {}, update() {}, dispose() {},
  };
}

describe('bounded independent liquid outline', () => {
  it('preserves radial area and positive radii under sustained forcing', () => {
    const boundary = new LiquidBoundary();
    for (let frame = 0; frame < 1200; frame++) {
      if (frame % 17 === 0) boundary.impulse(0.3, -0.7, 2);
      boundary.step(1 / 120, Math.sin(frame / 15) * 8, Math.cos(frame / 21) * 8);
      expect(boundary.modes.reduce((sum, mode) => sum + Math.abs(mode), 0))
        .toBeLessThanOrEqual(LIQUID_BOUNDARY_LIMIT + 1e-12);
      if (frame % 30 !== 0) continue;
      let area = 0;
      for (let i = 0; i < 128; i++) {
        const radius = boundary.radius(2 * Math.PI * i / 128);
        expect(radius).toBeGreaterThan(0.7);
        expect(radius).toBeLessThanOrEqual(1.22 + 1e-12);
        area += radius * radius * Math.PI / 128;
      }
      expect(area).toBeCloseTo(Math.PI, 11);
    }
  });

  it('impulses affect the edge only when the existing owner advances', () => {
    const body = new LiquidDynamics();
    body.setAmount(1, true);
    body.impulse(0.5, 0.1, 1.5);
    expect(body.boundary.modes).toEqual([0, 0, 0, 0]);
    advance(body, 0.1);
    expect(Math.max(...body.boundary.modes.map(Math.abs))).toBeGreaterThan(0.01);
    advance(body, 12);
    expect(Math.max(...body.boundary.modes.map(Math.abs))).toBeLessThan(1e-7);
  });

  it.each(['head', 'reduced', 'disposed'] as const)('clears the outline in %s mode', mode => {
    const body = new LiquidDynamics();
    body.setAmount(1, true);
    body.impulse(1, 0, 2);
    advance(body, 0.1);
    if (mode === 'head') body.setAmount(0, true);
    else if (mode === 'reduced') body.setReducedMotion(true);
    else body.dispose();
    expect(body.boundary.modes).toEqual([0, 0, 0, 0]);
    advance(body, 1);
    expect(body.boundary.modes).toEqual([0, 0, 0, 0]);
  });

  it('ignores invalid and oversized edge steps and rejects invalid angles', () => {
    const boundary = new LiquidBoundary();
    for (const dt of [-1, 0, NaN, Infinity, 1]) boundary.step(dt, 8, 8);
    boundary.step(1 / 120, Infinity, 0);
    boundary.impulse(NaN, 0, 1);
    expect(boundary.modes).toEqual([0, 0, 0, 0]);
    expect(() => boundary.radius(NaN)).toThrow(RangeError);
  });
});

describe('free-surface lifecycle', () => {
  it('hides every original mesh at full liquid and restores authored visibility', () => {
    const root = new Group();
    const geometry = new BoxGeometry();
    const material = new MeshBasicMaterial();
    const visible = new Mesh(geometry, material);
    const hidden = new Mesh(geometry, material);
    hidden.visible = false;
    visible.frustumCulled = false;
    root.add(visible, hidden);
    const scene = createLiquidScene(root);
    const free = new Group();
    scene.carrier.add(free);
    scene.update({ amount: 1, targetAmount: 1, position: [0.3, 0.4] });
    expect(visible.visible).toBe(false);
    expect(hidden.visible).toBe(false);
    expect(free.visible).toBe(true);
    expect(scene.carrier.position.toArray()).toEqual([0.3, 0.4, 0]);
    scene.update({ amount: 0.7, targetAmount: 0, position: [0.3, 0.4] });
    expect(visible.visible).toBe(true);
    expect(hidden.visible).toBe(false);
    scene.update({ amount: 1, targetAmount: 1, position: [0.3, 0.4] });
    free.removeFromParent();
    scene.dispose(); scene.dispose();
    expect(visible.parent).toBe(root);
    expect(visible.visible).toBe(true);
    expect(visible.frustumCulled).toBe(false);
    expect(hidden.visible).toBe(false);
    expect(hidden.frustumCulled).toBe(true);
    geometry.dispose(); material.dispose();
  });

  it('owns one anatomical-independent mesh, restores replacement and never disposes the atlas', () => {
    const skin = skinSource();
    const built = buildSkinMaterial(skin);
    const owner = new LiquidMaterialOwner();
    owner.attachSurface({ front: built.material, interior: built.interior, mask: built.mask }, skin);
    owner.setExtent(-0.8, 0.8);
    const root = new Group();
    const replacement = new Group();
    owner.bindScene(root);
    owner.dynamics.setAmount(1, true);
    owner.update(0);
    const surface = root.getObjectByName('hologlyph_liquid_surface') as Mesh;
    expect(surface?.isMesh).toBe(true);
    expect(surface.geometry.type).toBe('SphereGeometry');
    expect(surface.geometry.morphAttributes).toEqual({});
    expect(surface.geometry.getAttribute('skinIndex')).toBeUndefined();
    expect(surface.geometry.getAttribute('_ORAL_REGION')).toBeUndefined();
    expect(surface.geometry.index?.count).toBeLessThanOrEqual(64 * 24 * 6);
    expect(surface.visible).toBe(true);
    const geometryDispose = vi.spyOn(surface.geometry, 'dispose');
    const atlasDispose = vi.fn();
    skin.texture.addEventListener('dispose', atlasDispose);
    owner.bindScene(replacement);
    expect(root.getObjectByName(surface.name)).toBeUndefined();
    expect(replacement.getObjectByName(surface.name)).toBe(surface);
    owner.dynamics.setAmount(0, true);
    owner.update(0);
    expect(surface.visible).toBe(false);
    owner.dispose(); owner.dispose();
    expect(geometryDispose).toHaveBeenCalledTimes(1);
    expect(atlasDispose).not.toHaveBeenCalled();
    expect(replacement.getObjectByName(surface.name)).toBeUndefined();
    built.material.dispose(); built.interior.dispose(); built.mask.dispose(); skin.texture.dispose();
  });
});

describe('liquid footprint containment', () => {
  it('reserves the worst allowed radial and wave excursion', () => {
    const footprint = liquidFootprint(-0.8, 0.8);
    expect(footprint).not.toBeNull();
    expect(Object.isFrozen(footprint)).toBe(true);
    expect(footprint?.maxX).toBeCloseTo(1.6 * 0.7 * 1.22, 12);
    expect(footprint?.maxZ).toBe(footprint?.maxX);
    expect(footprint?.minY).toBeCloseTo(-0.8 - 1.6 * 0.022, 12);
    expect(footprint?.maxY).toBeCloseTo(-0.8 + 1.6 * 0.142, 12);
  });

  it.each([[0, 0], [1, -1], [NaN, 1], [0, Infinity], [-Number.MAX_VALUE, Number.MAX_VALUE]])(
    'does not invent a footprint for unusable extent %s to %s', (low, high) => {
      expect(liquidFootprint(low, high)).toBeNull();
    },
  );

  it('insets placement and explicitly reports when the body cannot fit', () => {
    const host = { minX: -2, maxX: 2, minY: -2, maxY: 2 };
    const footprint = { minX: -1, maxX: 1, minY: -0.8, maxY: -0.6 };
    expect(insetLiquidBounds(host, footprint)).toEqual({ minX: -1, maxX: 1, minY: -1.2, maxY: 2.6 });
    expect(insetLiquidBounds({ ...host, maxX: -1 }, footprint)).toBeNull();
    expect(insetLiquidBounds({ ...host, maxX: 0 }, footprint)?.minX).toBe(-1);
    expect(() => insetLiquidBounds({ ...host, minX: Infinity }, footprint)).toThrow(RangeError);
    expect(() => insetLiquidBounds(host, { ...footprint, maxY: -2 })).toThrow(RangeError);
  });
});
