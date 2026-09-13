import { describe, expect, it } from 'vitest';
import { Group, PerspectiveCamera, Vector3, WebGLCoordinateSystem, WebGPUCoordinateSystem } from 'three';
import { viewportLiquidBounds } from '../demo/liquid-viewport';
import { liquidFootprint } from '../src/shaders/liquid-footprint';
import type { LiquidBounds, LiquidFootprint } from '../src/index';

const desired = { minX: -0.6, maxX: 0.6, minY: -0.2, maxY: 0.85 };

/** Build a real perspective camera without allocating a renderer. */
function cameraAt(distance: number, aspect = 1): PerspectiveCamera {
  const camera = new PerspectiveCamera(45, aspect, 0.1, 100);
  camera.position.set(0, 0, distance);
  camera.lookAt(0, 0, 0);
  camera.updateMatrixWorld();
  return camera;
}

/** Check every extreme position independently in normalised device coordinates. */
function expectContained(camera: PerspectiveCamera, root: Group, footprint: LiquidFootprint, bounds: LiquidBounds): void {
  root.updateWorldMatrix(true, false);
  for (const x of [bounds.minX, bounds.maxX]) for (const y of [bounds.minY, bounds.maxY]) {
    for (const px of [footprint.minX, footprint.maxX]) for (const py of [footprint.minY, footprint.maxY]) {
      for (const pz of [footprint.minZ, footprint.maxZ]) {
        const projected = new Vector3(px + x, py + y, pz).applyMatrix4(root.matrixWorld).project(camera);
        expect(Math.abs(projected.x)).toBeLessThanOrEqual(0.88 + 1e-9);
        expect(Math.abs(projected.y)).toBeLessThanOrEqual(0.88 + 1e-9);
        expect(projected.z).toBeGreaterThanOrEqual(camera.coordinateSystem === WebGPUCoordinateSystem ? -1e-9 : -1 - 1e-9);
        expect(projected.z).toBeLessThanOrEqual(1 + 1e-9);
      }
    }
  }
}

describe('perspective liquid containment', () => {
  it.each([WebGLCoordinateSystem, WebGPUCoordinateSystem])('honours near and far planes in coordinate system %s', coordinateSystem => {
    const camera = new PerspectiveCamera(45, 1, 1, 10);
    camera.coordinateSystem = coordinateSystem;
    camera.updateProjectionMatrix();
    camera.position.z = 2;
    camera.updateMatrixWorld();
    const root = new Group();
    const origin = { minX: 0, maxX: 0, minY: 0, maxY: 0 };
    const footprint = { minX: -0.05, maxX: 0.05, minY: -0.05, maxY: 0.05, minZ: 0.7, maxZ: 0.9 };
    expect(viewportLiquidBounds(camera, root, footprint, origin)).not.toBeNull();
    // The front corner is only 0.8 units from a near plane at 1. WebGPU
    // projects it into negative Z within (-w, 0), which WebGL's test admits.
    expect(viewportLiquidBounds(camera, root, { ...footprint, maxZ: 1.2 }, origin)).toBeNull();
    expect(viewportLiquidBounds(camera, root, { ...footprint, minZ: -8.2 }, origin)).toBeNull();
  });

  it('insets the visible body rather than only clamping its origin', () => {
    const root = new Group();
    const camera = cameraAt(6);
    const footprint = liquidFootprint(-0.8, 0.8);
    if (!footprint) throw new Error('Test extent must be usable');
    const bounds = viewportLiquidBounds(camera, root, footprint, desired);
    expect(bounds).not.toBeNull();
    if (!bounds) throw new Error('The body should fit at rest');
    expect(bounds.maxX).toBeGreaterThan(0);
    expect(bounds.maxX).toBeLessThan(desired.maxX);
    expectContained(camera, root, footprint, bounds);
    // Negative control: the requested carrier limits themselves fit but do
    // not reserve the front-most corner of the liquid's depth envelope.
    expect(() => expectContained(camera, root, footprint, desired)).toThrow();
  });

  it.each([1, 390 / 844])('contains rotated and translated roots at aspect %s', aspect => {
    const root = new Group();
    root.position.set(0.1, 0.1, 0.1);
    root.rotation.set(0.1, 0.15, 0.03);
    const camera = cameraAt(7 * Math.max(1, 0.85 / aspect), aspect);
    const footprint = liquidFootprint(-0.8, 0.8);
    if (!footprint) throw new Error('Test extent must be usable');
    const bounds = viewportLiquidBounds(camera, root, footprint, desired);
    if (!bounds) throw new Error('The body should fit this framed viewport');
    expectContained(camera, root, footprint, bounds);
  });

  it('reports a viewport that cannot hold even the resting body', () => {
    const footprint = liquidFootprint(-0.8, 0.8);
    if (!footprint) throw new Error('Test extent must be usable');
    expect(viewportLiquidBounds(cameraAt(2), new Group(), footprint, desired)).toBeNull();
  });

  it('rejects reversed or overflowing envelopes rather than claiming containment', () => {
    const footprint = liquidFootprint(-0.8, 0.8);
    if (!footprint) throw new Error('Test extent must be usable');
    const camera = cameraAt(10);
    const root = new Group();
    expect(() => viewportLiquidBounds(camera, root, { ...footprint, minX: 2, maxX: -2 }, desired)).toThrow(RangeError);
    expect(() => viewportLiquidBounds(camera, root, { ...footprint, minZ: -Number.MAX_VALUE, maxZ: Number.MAX_VALUE }, desired)).toThrow(RangeError);
    expect(() => viewportLiquidBounds(camera, root, footprint, { ...desired, minX: 1 })).toThrow(RangeError);
  });

  it('does not accept non-finite camera transforms', () => {
    const camera = cameraAt(10);
    camera.projectionMatrix.elements[0] = NaN;
    const footprint = liquidFootprint(-0.8, 0.8);
    if (!footprint) throw new Error('Test extent must be usable');
    expect(viewportLiquidBounds(camera, new Group(), footprint, desired)).toBeNull();
  });
});
