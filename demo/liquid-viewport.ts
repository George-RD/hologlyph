import { Matrix4, Vector4, type Object3D, type PerspectiveCamera } from 'three';
import type { LiquidBounds, LiquidFootprint } from '../src/index';

/**
 * Return a conservative centred travel rectangle whose complete liquid box
 * fits the perspective viewport. Every corner of the box at every corner of
 * the travel rectangle must satisfy the homogeneous clip inequalities.
 * This includes depth and root transforms, not just the carrier's centre.
 * Null explicitly reports that even the resting origin cannot fit.
 */
export function viewportLiquidBounds(
  camera: PerspectiveCamera,
  root: Object3D,
  footprint: LiquidFootprint,
  desired: LiquidBounds,
  padding = 0.06,
): LiquidBounds | null {
  const values = [footprint.minX, footprint.maxX, footprint.minY, footprint.maxY,
    footprint.minZ, footprint.maxZ, desired.minX, desired.maxX, desired.minY, desired.maxY, padding];
  const spans = [footprint.maxX - footprint.minX, footprint.maxY - footprint.minY,
    footprint.maxZ - footprint.minZ, desired.maxX - desired.minX, desired.maxY - desired.minY];
  if (!values.every(Number.isFinite) || !spans.every(span => Number.isFinite(span) && span >= 0)
    || padding < 0 || padding >= 0.5
    || desired.minX > 0 || desired.maxX < 0 || desired.minY > 0 || desired.maxY < 0) {
    throw new RangeError('Liquid viewport bounds require finite extents and a travel area containing the origin');
  }
  root.updateWorldMatrix(true, false);
  camera.updateMatrixWorld();
  const clip = new Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse)
    .multiply(root.matrixWorld);
  if (!clip.elements.every(Number.isFinite)) return null;
  const point = new Vector4();
  const margin = 1 - 2 * padding;

  /** All corners suffice because each homogeneous clip inequality is linear. */
  function fits(scale: number): boolean {
    for (const x of [desired.minX * scale, desired.maxX * scale]) {
      for (const y of [desired.minY * scale, desired.maxY * scale]) {
        for (const px of [footprint.minX, footprint.maxX]) {
          for (const py of [footprint.minY, footprint.maxY]) {
            for (const pz of [footprint.minZ, footprint.maxZ]) {
              point.set(px + x, py + y, pz, 1).applyMatrix4(clip);
              if (![point.x, point.y, point.z, point.w].every(Number.isFinite)
                || !(point.w > 0) || Math.abs(point.x) > margin * point.w
                || Math.abs(point.y) > margin * point.w || Math.abs(point.z) > point.w) return false;
            }
          }
        }
      }
    }
    return true;
  }

  if (!fits(0)) return null;
  let low = 0;
  let high = 1;
  if (fits(1)) low = 1;
  else {
    for (let i = 0; i < 24; i++) {
      const middle = (low + high) / 2;
      if (fits(middle)) low = middle;
      else high = middle;
    }
  }
  return Object.freeze({ minX: desired.minX * low, maxX: desired.maxX * low,
    minY: desired.minY * low, maxY: desired.maxY * low });
}
