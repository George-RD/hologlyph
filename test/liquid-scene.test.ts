import { describe, expect, it } from 'vitest';
import { Group, Mesh, MeshBasicMaterial, Vector3 } from 'three';
import { createLiquidScene } from '../src/shaders/liquid-scene';

function rig() {
  const root = new Group();
  root.position.set(4, 5, 6);
  const body = new Mesh();
  body.position.set(0.1, 0.2, 0.3);
  const trimMaterial = new MeshBasicMaterial();
  trimMaterial.name = 'eye_trim';
  const trim = new Mesh(undefined, trimMaterial);
  root.add(body, trim);
  return { root, body, trim };
}

function position(mesh: Mesh): Vector3 { return mesh.getWorldPosition(new Vector3()); }

describe('liquid scene placement', () => {
  it('carries the entire rig without fighting emergence on root Y', () => {
    const { root, body, trim } = rig();
    const before = position(body);
    const binding = createLiquidScene(root);
    expect(position(body)).toEqual(before);
    binding.update({ amount: 1, targetAmount: 1, position: [0.3, 0.4] });
    expect(position(body).sub(before).distanceTo(new Vector3(0.3, 0.4, 0))).toBeLessThan(1e-12);
    expect(root.position).toEqual(new Vector3(4, 5, 6));
    binding.update({ amount: 0, targetAmount: 0, position: [0.3, 0.4] });
    expect(position(trim).distanceTo(new Vector3(4.3, 5.4, 6))).toBeLessThan(1e-12);
    binding.dispose();
  });

  it('hides only unsupported trim while the liquid shape is changing', () => {
    const { root, body, trim } = rig();
    body.frustumCulled = false;
    const binding = createLiquidScene(root);
    binding.update({ amount: 0, targetAmount: 1, position: [0, 0] });
    expect(trim.visible).toBe(false);
    expect(body.visible).toBe(true);
    expect(trim.frustumCulled).toBe(false);
    binding.update({ amount: 0, targetAmount: 0, position: [0, 0] });
    expect(trim.visible).toBe(true);
    expect(trim.frustumCulled).toBe(true);
    expect(body.frustumCulled).toBe(false);
    binding.dispose();
  });

  it('does not reveal trim which was already hidden', () => {
    const { root, trim } = rig();
    trim.visible = false;
    const binding = createLiquidScene(root);
    binding.update({ amount: 1, targetAmount: 1, position: [0, 0] });
    binding.update({ amount: 0, targetAmount: 0, position: [0, 0] });
    expect(trim.visible).toBe(false);
    binding.dispose();
  });

  it('restores the original hierarchy and culling on repeated disposal', () => {
    const { root, body, trim } = rig();
    const binding = createLiquidScene(root);
    binding.update({ amount: 1, targetAmount: 1, position: [1, 1] });
    binding.dispose(); binding.dispose();
    expect(root.children).toEqual([body, trim]);
    expect(trim.visible).toBe(true);
    expect(body.frustumCulled).toBe(true);
    binding.update({ amount: 1, targetAmount: 1, position: [2, 2] });
    expect(root.children).toEqual([body, trim]);
  });
});
