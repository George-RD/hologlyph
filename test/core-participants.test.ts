/**
 * Stage participants (dec.liquid-glass-participants): the page-to-world map,
 * the collision against the body, and the DOM stage that measures and pushes.
 *
 * happy-dom has no layout engine, so every rect a test cares about is stubbed
 * on the element. That is the right level anyway: the contract under test is
 * what this module DOES with a rect, and how many times it asks for one.
 */
import { describe, expect, it } from 'vitest';
import {
  BODY_ATTRIBUTE,
  OBSTACLE_ATTRIBUTE,
  STAGE_MAX_PARTICIPANTS,
  createStage,
  projectRect,
  stageCollider,
  stageProjection,
  type StageRect,
} from '../src/core/participants';
import { poolRadialProfile } from '../src/shaders/pool';

/** The shipped camera: 35 degree vertical field, 2.4 units back from Z 0. */
const FOV = 35;
const CAMERA_Z = 2.4;
const CANVAS: StageRect = { x: 100, y: 50, width: 400, height: 400 };

/** A cylinder of radius 0.25 spanning bind Y 0..1.8, close enough to the bust. */
function cylinder(radius = 0.25, minY = 0, maxY = 1.8) {
  const points: number[] = [];
  for (let i = 0; i <= 24; i++) {
    const y = minY + ((maxY - minY) * i) / 24;
    for (let k = 0; k < 8; k++) {
      const a = (k / 8) * Math.PI * 2;
      points.push(Math.cos(a) * radius, y, Math.sin(a) * radius);
    }
  }
  return poolRadialProfile(new Float32Array(points));
}

function stubRect(element: HTMLElement, rect: StageRect): { calls: number } {
  const counter = { calls: 0 };
  element.getBoundingClientRect = (() => {
    counter.calls++;
    const applied = element.style.transform;
    // Emulate the browser: the reported box INCLUDES whatever transform is on
    // the element. Recovering the rest rect from it is the whole trap this
    // module has to survive.
    const match = /translate3d\((-?[\d.]+)px, (-?[\d.]+)px/.exec(applied);
    const dx = match ? Number(match[1]) : 0;
    const dy = match ? Number(match[2]) : 0;
    return {
      x: rect.x + dx,
      y: rect.y + dy,
      width: rect.width,
      height: rect.height,
      left: rect.x + dx,
      top: rect.y + dy,
      right: rect.x + dx + rect.width,
      bottom: rect.y + dy + rect.height,
      toJSON() {},
    } as DOMRect;
  }) as HTMLElement['getBoundingClientRect'];
  return counter;
}

describe('page to world projection', () => {
  it('maps the canvas centre to the camera axis and CSS down to world up', () => {
    const p = stageProjection(CANVAS, FOV, 0, 0, CAMERA_Z);
    // tan(17.5 deg) * 2.4
    expect(p.halfHeight).toBeCloseTo(Math.tan((FOV * Math.PI) / 360) * CAMERA_Z, 10);
    // Square canvas, so both half-extents agree.
    expect(p.halfWidth).toBeCloseTo(p.halfHeight, 10);

    const centre = projectRect(p, { x: 300, y: 250, width: 0, height: 0 });
    expect(centre.minX).toBeCloseTo(0, 10);
    expect(centre.maxY).toBeCloseTo(0, 10);

    // A rect in the TOP-LEFT of the canvas is at negative world X and
    // POSITIVE world Y: CSS Y grows downward and world Y grows upward.
    const topLeft = projectRect(p, { x: 100, y: 50, width: 40, height: 40 });
    expect(topLeft.minX).toBeCloseTo(-p.halfWidth, 10);
    expect(topLeft.maxY).toBeCloseTo(p.halfHeight, 10);
    expect(topLeft.minY).toBeLessThan(topLeft.maxY);
  });

  it('follows the camera off the axis rather than assuming the origin', () => {
    const p = stageProjection(CANVAS, FOV, 0.5, -0.25, CAMERA_Z);
    const centre = projectRect(p, { x: 300, y: 250, width: 0, height: 0 });
    expect(centre.minX).toBeCloseTo(0.5, 10);
    expect(centre.maxY).toBeCloseTo(-0.25, 10);
  });

  it('degrades to a null projection rather than dividing by a zero canvas', () => {
    const p = stageProjection({ x: 0, y: 0, width: 0, height: 0 }, FOV, 0, 0, CAMERA_Z);
    expect(p.pixelsPerWorldUnit).toBe(0);
    expect(p.halfWidth).toBe(0);
  });

  it('scales a world displacement back into CSS pixels', () => {
    const p = stageProjection(CANVAS, FOV, 0, 0, CAMERA_Z);
    expect(p.pixelsPerWorldUnit).toBeCloseTo(CANVAS.height / (2 * p.halfHeight), 10);
  });
});

describe('participant collision against the body', () => {
  const profile = cylinder();
  const body = { profile, rootOffsetY: 0 };

  it('squeezes the liquid away from an obstacle on the right', () => {
    // A rect straddling world X 0.15..0.6 at mid height overlaps a radius of
    // 0.25 by 0.1, and the flow piles LEFT, away from it.
    const collider = stageCollider(
      { minX: 0.15, maxX: 0.6, minY: 0.7, maxY: 0.9 },
      body,
    );
    expect(collider).not.toBeNull();
    expect(collider?.overlap).toBeCloseTo(0.1, 6);
    expect(collider?.direction[0]).toBeCloseTo(-1, 6);
    expect(collider?.bandY).toBeCloseTo(0.8, 6);
  });

  it('mirrors for an obstacle on the left, which is why one mode is not enough', () => {
    const collider = stageCollider(
      { minX: -0.6, maxX: -0.15, minY: 0.7, maxY: 0.9 },
      body,
    );
    expect(collider?.direction[0]).toBeCloseTo(1, 6);
    expect(collider?.overlap).toBeCloseTo(0.1, 6);
  });

  it('reports nothing when the element is clear of the silhouette', () => {
    expect(stageCollider({ minX: 0.4, maxX: 1, minY: 0.7, maxY: 0.9 }, body)).toBeNull();
  });

  it('measures the height in BIND space, not world space', () => {
    // Half submerged: the root is translated down, so a page element at world
    // Y 0.8 is pressing on a HIGHER part of the rig than it would at rest.
    const sunk = { profile, rootOffsetY: -0.6 };
    const collider = stageCollider({ minX: 0.15, maxX: 0.6, minY: 0.7, maxY: 0.9 }, sunk);
    expect(collider?.bandY).toBeCloseTo(1.4, 6);
  });

  it('reports how far a participant reaches below the waterline', () => {
    const collider = stageCollider({ minX: -0.1, maxX: 0.1, minY: -0.3, maxY: 0.2 }, body);
    expect(collider?.submerged).toBeCloseTo(0.3, 6);
    expect(collider?.poolX).toBeCloseTo(0, 6);
    expect(collider?.poolHalfWidth).toBeCloseTo(0.1, 6);
  });

  it('picks a way out rather than dividing by zero when the axis is engulfed', () => {
    // The rect swallows the body axis at this height: the nearest point IS
    // the axis, so the direction has to come from somewhere else.
    const collider = stageCollider({ minX: -0.4, maxX: 0.2, minY: 0.7, maxY: 0.9 }, body);
    expect(collider).not.toBeNull();
    const length = Math.hypot(...(collider?.direction ?? [0, 0, 0]));
    expect(length).toBeCloseTo(1, 6);
    // The rect's centre is left of the axis, so the liquid is pushed right.
    expect(collider?.direction[0]).toBeGreaterThan(0);
  });
});

describe('the DOM stage', () => {
  function mount(): { doc: Document; canvas: HTMLElement } {
    const doc = document.implementation.createHTMLDocument('stage');
    const canvas = doc.createElement('div');
    doc.body.append(canvas);
    stubRect(canvas, CANVAS);
    return { doc, canvas };
  }

  function mark(doc: Document, attribute: string, rect: StageRect): HTMLElement {
    const el = doc.createElement('div');
    el.setAttribute(attribute, '');
    doc.body.append(el);
    stubRect(el, rect);
    return el;
  }

  it('finds nothing, reads nothing and writes nothing on an unmarked page', () => {
    const { doc, canvas } = mount();
    const counter = stubRect(canvas, CANVAS);
    const stage = createStage({ root: doc, canvas });
    stage.refresh();
    expect(stage.participants).toHaveLength(0);
    stage.measure();
    // The canvas is only measured when there is something to measure it
    // against. Zero participants must cost exactly one selector match.
    expect(counter.calls).toBe(0);
    stage.dispose();
  });

  it('adopts both markers and records which is which', () => {
    const { doc, canvas } = mount();
    const obstacle = mark(doc, OBSTACLE_ATTRIBUTE, { x: 120, y: 100, width: 80, height: 60 });
    mark(doc, BODY_ATTRIBUTE, { x: 320, y: 100, width: 80, height: 60 });
    const stage = createStage({ root: doc, canvas });
    stage.refresh();

    expect(stage.participants).toHaveLength(2);
    expect(stage.participants[0]?.element).toBe(obstacle);
    expect(stage.participants[0]?.obstacle).toBe(true);
    expect(stage.participants[0]?.buoyant).toBe(false);
    expect(stage.participants[1]?.buoyant).toBe(true);
    stage.dispose();
  });

  it('measures once per invalidation, not once per frame', () => {
    const { doc, canvas } = mount();
    const el = mark(doc, OBSTACLE_ATTRIBUTE, { x: 120, y: 100, width: 80, height: 60 });
    const counter = stubRect(el, { x: 120, y: 100, width: 80, height: 60 });
    const stage = createStage({ root: doc, canvas });
    stage.refresh();

    stage.measure();
    expect(counter.calls).toBe(1);
    // A still page costs nothing: no observer fired, so the batch is skipped.
    stage.measure();
    stage.measure();
    expect(counter.calls).toBe(1);
    expect(stage.participants[0]?.rect.x).toBe(120);

    // A rescan is an invalidation.
    stage.refresh();
    stage.measure();
    expect(counter.calls).toBe(2);
    stage.dispose();
  });

  it('pushes only the buoyant participants and leaves obstacles where the host put them', () => {
    const { doc, canvas } = mount();
    const obstacle = mark(doc, OBSTACLE_ATTRIBUTE, { x: 120, y: 100, width: 80, height: 60 });
    const buoyant = mark(doc, BODY_ATTRIBUTE, { x: 320, y: 100, width: 80, height: 60 });
    const stage = createStage({ root: doc, canvas });
    stage.refresh();
    stage.measure();

    stage.write(Float64Array.from([9, -4, 6, 3]));
    expect(obstacle.style.transform).toBe('');
    expect(buoyant.style.transform).toBe('translate3d(6.00px, 3.00px, 0)');
    stage.dispose();
  });

  it('composes ahead of the host transform and restores it on release', () => {
    const { doc, canvas } = mount();
    const buoyant = mark(doc, BODY_ATTRIBUTE, { x: 320, y: 100, width: 80, height: 60 });
    buoyant.style.transform = 'rotate(4deg)';
    const stage = createStage({ root: doc, canvas });
    stage.refresh();
    stage.measure();

    stage.write(Float64Array.from([6, 3]));
    // OURS FIRST. Transforms apply right to left, so leading with the push
    // keeps the pixel offset in the untransformed parent's space.
    expect(buoyant.style.transform).toBe('translate3d(6.00px, 3.00px, 0) rotate(4deg)');
    stage.dispose();
    expect(buoyant.style.transform).toBe('rotate(4deg)');
  });

  it('subtracts its own push back out, so a held offset never drifts', () => {
    // The regression this exists for: `getBoundingClientRect` reports the
    // TRANSFORMED box, so measuring it straight would fold last frame's
    // reaction into this frame's collision and walk the element off the page.
    const { doc, canvas } = mount();
    mark(doc, BODY_ATTRIBUTE, { x: 320, y: 100, width: 80, height: 60 });
    const stage = createStage({ root: doc, canvas });
    stage.refresh();

    for (let i = 0; i < 10; i++) {
      stage.refresh();
      stage.measure();
      stage.write(Float64Array.from([6, 3]));
      expect(stage.participants[0]?.rect.x).toBe(320);
      expect(stage.participants[0]?.rect.y).toBe(100);
    }
    stage.dispose();
  });

  it('drops a participant whose markers were removed and restores its style', () => {
    const { doc, canvas } = mount();
    const buoyant = mark(doc, BODY_ATTRIBUTE, { x: 320, y: 100, width: 80, height: 60 });
    const stage = createStage({ root: doc, canvas });
    stage.refresh();
    stage.measure();
    stage.write(Float64Array.from([6, 3]));
    expect(buoyant.style.transform).not.toBe('');

    buoyant.removeAttribute(BODY_ATTRIBUTE);
    stage.refresh();
    expect(stage.participants).toHaveLength(0);
    expect(buoyant.style.transform).toBe('');
    stage.dispose();
  });

  it('releases a participant that leaves the viewport rather than freezing its push', () => {
    const { doc, canvas } = mount();
    const buoyant = mark(doc, BODY_ATTRIBUTE, { x: 320, y: 100, width: 80, height: 60 });
    let fire: IntersectionObserverCallback | null = null;
    const stage = createStage({
      root: doc,
      canvas,
      createIntersectionObserver: (cb) => {
        fire = cb;
        return {
          observe() {},
          unobserve() {},
          disconnect() {},
          takeRecords: () => [],
          root: null,
          rootMargin: '',
          thresholds: [],
        } as unknown as IntersectionObserver;
      },
    });
    stage.refresh();
    stage.measure();
    stage.write(Float64Array.from([6, 3]));
    expect(buoyant.style.transform).not.toBe('');

    const callback = fire as unknown as IntersectionObserverCallback | null;
    expect(callback).not.toBeNull();
    callback?.(
      [{ target: buoyant, isIntersecting: false } as unknown as IntersectionObserverEntry],
      {} as IntersectionObserver,
    );
    expect(stage.participants[0]?.visible).toBe(false);
    expect(buoyant.style.transform).toBe('');
    stage.dispose();
  });

  it('watches the document for late markers only once the page has used one', () => {
    const { doc, canvas } = mount();
    let observed = 0;
    const factory = () =>
      ({
        observe() {
          observed++;
        },
        disconnect() {},
        takeRecords: () => [],
      }) as unknown as MutationObserver;

    const bare = createStage({ root: doc, canvas, createMutationObserver: factory });
    bare.refresh();
    // Nothing marked: a subtree observer over an uninterested document is
    // exactly the standing cost the drop-in promise forbids.
    expect(observed).toBe(0);
    bare.dispose();

    mark(doc, OBSTACLE_ATTRIBUTE, { x: 120, y: 100, width: 80, height: 60 });
    const live = createStage({ root: doc, canvas, createMutationObserver: factory });
    live.refresh();
    expect(observed).toBe(1);
    live.dispose();
  });

  it('coalesces a burst of mutations into one rescan, drained by the batch', () => {
    const { doc, canvas } = mount();
    mark(doc, OBSTACLE_ATTRIBUTE, { x: 120, y: 100, width: 80, height: 60 });
    let fire: MutationCallback | null = null;
    const stage = createStage({
      root: doc,
      canvas,
      createMutationObserver: (cb) => {
        fire = cb;
        return {
          observe() {},
          disconnect() {},
          takeRecords: () => [],
        } as unknown as MutationObserver;
      },
    });
    stage.refresh();
    stage.measure();
    expect(stage.participants).toHaveLength(1);

    // A host application rendering a list fires one record per row. Rescanning
    // per record would run a `querySelectorAll` and a rewire per row.
    const callback = fire as unknown as MutationCallback | null;
    expect(callback).not.toBeNull();
    const late = mark(doc, BODY_ATTRIBUTE, { x: 320, y: 100, width: 80, height: 60 });
    for (let i = 0; i < 50; i++) callback?.([], {} as MutationObserver);
    // Nothing has been adopted yet: the flag is drained by the frame's batch.
    expect(stage.participants).toHaveLength(1);

    stage.measure();
    expect(stage.participants).toHaveLength(2);
    expect(stage.participants[1]?.element).toBe(late);

    // And the drain is a drain: a second batch with no new mutation rescans
    // nothing and leaves the list alone.
    stage.measure();
    expect(stage.participants).toHaveLength(2);
    stage.dispose();
  });

  it('adopts a bounded prefix and says so rather than tracking a whole list', () => {
    const { doc, canvas } = mount();
    for (let i = 0; i < STAGE_MAX_PARTICIPANTS + 12; i++) {
      mark(doc, OBSTACLE_ATTRIBUTE, { x: 120, y: 100 + i, width: 80, height: 60 });
    }
    const warnings: string[] = [];
    const original = console.warn;
    console.warn = (message: string) => warnings.push(message);
    try {
      const stage = createStage({ root: doc, canvas });
      stage.refresh();
      expect(stage.participants).toHaveLength(STAGE_MAX_PARTICIPANTS);
      // Every adopted element is observed and read on each invalidation, so
      // the bound is what keeps one careless marker on a row template from
      // costing a layout read per row per scroll.
      expect(warnings).toHaveLength(1);
      expect(warnings[0]).toContain(String(STAGE_MAX_PARTICIPANTS));
      // Said once, not once per rescan.
      stage.refresh();
      expect(warnings).toHaveLength(1);
      stage.dispose();
    } finally {
      console.warn = original;
    }
  });
});
