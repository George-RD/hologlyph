import { LIQUID_BOUNDARY_LIMIT, LIQUID_BOUNDARY_RADIUS } from './liquid-boundary';
import { LIQUID_MAX_HEIGHT, LIQUID_THICKNESS, type LiquidBounds } from './liquid-dynamics';

/** Conservative model-space box containing every allowed full-liquid shape. */
export interface LiquidFootprint extends LiquidBounds {
  readonly minZ: number;
  readonly maxZ: number;
}

/**
 * Derive a footprint from the same extent and maximum excursions as the GPU
 * surface. This encloses the liquid endpoint, not the taller reforming head.
 * Invalid or overflowing avatar extents have no usable footprint.
 */
export function liquidFootprint(minY: number, maxY: number): LiquidFootprint | null {
  const span = maxY - minY;
  if (!Number.isFinite(minY) || !Number.isFinite(maxY)
    || !Number.isFinite(span) || span <= 0) return null;
  const radius = span * LIQUID_BOUNDARY_RADIUS * (1 + LIQUID_BOUNDARY_LIMIT);
  const bottom = minY - span * LIQUID_MAX_HEIGHT;
  const top = minY + span * (LIQUID_THICKNESS + LIQUID_MAX_HEIGHT);
  if (![radius, bottom, top].every(Number.isFinite)) return null;
  return Object.freeze({ minX: -radius, maxX: radius, minY: bottom, maxY: top,
    minZ: -radius, maxZ: radius });
}

/** Reject invalid rectangles before deriving carrier limits. */
function validBounds(bounds: LiquidBounds): boolean {
  return [bounds.minX, bounds.maxX, bounds.minY, bounds.maxY].every(Number.isFinite)
    && bounds.minX <= bounds.maxX && bounds.minY <= bounds.maxY
    && Number.isFinite(bounds.maxX - bounds.minX)
    && Number.isFinite(bounds.maxY - bounds.minY);
}

/**
 * Inset an axis-aligned model-space host by the visible XY footprint. A null
 * result explicitly means no placement can fit. Perspective hosts must also
 * project minZ/maxZ through their camera, as the lab's viewport adapter does.
 */
export function insetLiquidBounds(host: LiquidBounds, footprint: LiquidBounds): LiquidBounds | null {
  if (!validBounds(host) || !validBounds(footprint)) {
    throw new RangeError('Liquid host and footprint must have ordered finite bounds');
  }
  const result = {
    minX: host.minX - footprint.minX, maxX: host.maxX - footprint.maxX,
    minY: host.minY - footprint.minY, maxY: host.maxY - footprint.maxY,
  };
  return validBounds(result) ? Object.freeze(result) : null;
}
