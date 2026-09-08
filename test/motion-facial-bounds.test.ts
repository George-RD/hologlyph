import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { createMotionEngine } from '../src/motion';
import { clamp01 } from '../src/contracts';
import type { LoadedAvatar } from '../src/contracts';

function makeAvatar(): LoadedAvatar {
  const root = new THREE.Group();
  const morphStore: Record<string, number> = {};
  return {
    root,
    morphMeshes: [],
    animations: [],
    bones: {},
    setMorph(name: string, weight: number) {
      morphStore[name] = clamp01(weight);
    },
    getMorph(name: string) {
      return morphStore[name] ?? 0;
    },
    dispose() {},
  };
}

describe('facial deformation bounds', () => {
  it('applies a held blink through the bilateral blink morph only', () => {
    const motion = createMotionEngine({ idle: false });
    const avatar = makeAvatar();
    motion.attach(avatar);

    motion.setBlinkHold(1);
    motion.update(1 / 60, 1 / 60);

    expect(avatar.getMorph('exp_blink')).toBe(1);
    expect(avatar.getMorph('exp_blink_l')).toBe(0);
    expect(avatar.getMorph('exp_blink_r')).toBe(0);
  });

  it('does not overshoot a full viseme pose while transitioning between one-hot visemes', () => {
    const motion = createMotionEngine({ idle: false });
    const avatar = makeAvatar();
    motion.attach(avatar);

    motion.applyVisemeFrame({ time: 0, weights: { viseme_ih: 1, jaw_open: 0 } });
    for (let i = 0; i < 20; i++) motion.update(0.05, (i + 1) * 0.05);

    motion.applyVisemeFrame({ time: 1, weights: { viseme_ee: 1, jaw_open: 0 } });
    for (let i = 0; i < 8; i++) {
      motion.update(0.05, 1.05 + i * 0.05);
      const total = avatar.getMorph('viseme_ih') + avatar.getMorph('viseme_ee');
      expect(total).toBeLessThanOrEqual(1.001);
    }
  });
});
