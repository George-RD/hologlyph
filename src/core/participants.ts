/**
 * Stage participants: the opt-in contract that lets the fluid touch the page
 * (dec.liquid-glass-participants, `dec.liquid-glass-architecture` rung 4).
 *
 * The head has never known anything about the host layout, so it has never
 * been able to collide with anything. This module is the whole of that
 * knowledge, and it is deliberately narrow:
 *
 * - The host marks elements it ALREADY OWNS with `data-hologlyph-obstacle`
 *   (squeezes the fluid) or `data-hologlyph-body` (is pushed by the fluid).
 *   An element may carry both. Nothing else is claimed and no layout is
 *   authored, so level 0 of the product is still one tag.
 * - Rects are read in one batch and never interleaved with a write, so a
 *   frame costs at most one style recalculation and usually none: the batch
 *   is skipped entirely unless an observer or a scroll invalidated it.
 * - Results go back as CSS transforms and nothing else. A participant must
 *   tolerate being transformed; if it cannot, do not mark it.
 * - Zero participants is the normal case. With none marked there is no
 *   observer, no rect read, no transform and no collider, so the drop-in head
 *   is reproduced exactly.
 *
 * The maths here is deliberately separable from the DOM: `stageProjection`,
 * `projectRect` and `stageCollider` are pure and are what the tests drive.
 */

import type { Disposable, StageCollider } from '../contracts.js';
import { FLUID_PARTICIPANT_MODES } from '../shaders/fluid.js';
import { poolProfileRadiusAt, type PoolProfile } from '../shaders/pool.js';

/** Marks an element the fluid is squeezed by. */
export const OBSTACLE_ATTRIBUTE = 'data-hologlyph-obstacle';

/** Marks an element the fluid pushes around. */
export const BODY_ATTRIBUTE = 'data-hologlyph-body';

/** One `querySelectorAll` covers both markers. */
const PARTICIPANT_SELECTOR = `[${OBSTACLE_ATTRIBUTE}],[${BODY_ATTRIBUTE}]`;

/**
 * Sub-pixel tolerance on the written transform. Below this the write is
 * skipped, so a settled page stops touching the style attribute rather than
 * rewriting the same string sixty times a second.
 */
const WRITE_EPSILON = 0.05;

/**
 * Most elements the stage will adopt, however many the page marks.
 *
 * Only `FLUID_PARTICIPANT_MODES` of them can ever couple, but every adopted
 * element is observed and its rect read on each invalidation, so an
 * unbounded scan turns one careless `data-hologlyph-obstacle` on a list item
 * template into a layout read per row per scroll. Adopting a bounded prefix
 * and saying so is the library's usual posture: degrade and warn, never
 * surprise.
 */
export const STAGE_MAX_PARTICIPANTS = 32;

/** A rectangle in CSS pixels, VIEWPORT space, exactly as the browser reports it. */
export interface StageRect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

const EMPTY_RECT: StageRect = Object.freeze({ x: 0, y: 0, width: 0, height: 0 });

/**
 * The canvas viewport mapped onto the head's own plane (world Z 0).
 *
 * Every participant lives in the page, which is flat, and the head lives at
 * the origin, so one plane is the whole of the correspondence. Anything more
 * (a per-participant depth, a ray cast against the mesh) would buy accuracy
 * the coupling cannot spend: the flow field is a handful of damped modes.
 */
export interface StageProjection {
  /** Canvas rect the projection was built from, viewport CSS pixels. */
  readonly canvas: StageRect;
  /** Half-extent of the visible world at Z 0, world units. */
  readonly halfWidth: number;
  readonly halfHeight: number;
  /** World point the canvas centre looks at, on that plane. */
  readonly centreX: number;
  readonly centreY: number;
  /** Scale factor for turning a world displacement back into CSS pixels. */
  readonly pixelsPerWorldUnit: number;
}

/** Degenerate projection: what an unmounted or zero-sized canvas yields. */
const NULL_PROJECTION: StageProjection = Object.freeze({
  canvas: EMPTY_RECT,
  halfWidth: 0,
  halfHeight: 0,
  centreX: 0,
  centreY: 0,
  pixelsPerWorldUnit: 0,
});

/**
 * Build the page-to-world map for a perspective camera looking down -Z.
 *
 * `cameraZ` is the distance to the head's plane, so the visible half-height
 * there is `tan(fov/2) * cameraZ`. A camera that has been moved off the axis
 * shifts the plane's centre by exactly its own X and Y, which is why those are
 * read rather than assumed zero.
 */
export function stageProjection(
  canvas: StageRect,
  fovDegrees: number,
  cameraX: number,
  cameraY: number,
  cameraZ: number,
): StageProjection {
  if (!(canvas.width > 0) || !(canvas.height > 0)) return NULL_PROJECTION;
  const halfHeight = Math.tan((Math.max(1e-3, fovDegrees) * Math.PI) / 360) * Math.abs(cameraZ);
  if (!(halfHeight > 0)) return NULL_PROJECTION;
  return {
    canvas,
    halfHeight,
    halfWidth: (halfHeight * canvas.width) / canvas.height,
    centreX: cameraX,
    centreY: cameraY,
    pixelsPerWorldUnit: canvas.height / (2 * halfHeight),
  };
}

/** A participant rect resolved onto the head's plane, world units. */
export interface StageBox {
  readonly minX: number;
  readonly maxX: number;
  readonly minY: number;
  readonly maxY: number;
}

/**
 * Project a viewport rect onto the head's plane. CSS Y grows downward and
 * world Y grows upward, so the rect's top edge becomes the box's `maxY`.
 */
export function projectRect(projection: StageProjection, rect: StageRect): StageBox {
  const { canvas, halfWidth, halfHeight, centreX, centreY } = projection;
  const toX = (px: number): number =>
    centreX + (((px - canvas.x) / canvas.width) * 2 - 1) * halfWidth;
  const toY = (py: number): number =>
    centreY - (((py - canvas.y) / canvas.height) * 2 - 1) * halfHeight;
  return {
    minX: toX(rect.x),
    maxX: toX(rect.x + rect.width),
    maxY: toY(rect.y),
    minY: toY(rect.y + rect.height),
  };
}

/** The body a participant collides with: a radial profile and where it sits. */
export interface StageBody {
  readonly profile: PoolProfile;
  /** World Y translation the emergence ramp is applying (<= 0). */
  readonly rootOffsetY: number;
}

function clampTo(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

/**
 * Resolve one projected participant against the body, or `null` if it is
 * nowhere near it.
 *
 * The body is a solid of revolution about world X 0, so the collision is the
 * distance from the participant's nearest point to that axis, compared with
 * the body's radius at the height they meet. Both the height and the radius
 * are read off the same radial profile the pool waterline uses, so a
 * replacement bust is never given the shipped bust's silhouette.
 *
 * The returned `direction` points from the obstacle TOWARD the axis. That is
 * the way the liquid is squeezed out, and the shader's one-sided ramp then
 * bulges the far side rather than the near one.
 */
export function stageCollider(box: StageBox, body: StageBody): StageCollider | null {
  const { profile, rootOffsetY } = body;
  // The profile is in bind space; the ramp translates the body without
  // deforming it, so world Y and bind Y differ by exactly the root offset.
  const bodyMinY = profile.minY + rootOffsetY;
  const bodyMaxY = profile.maxY + rootOffsetY;
  if (!(bodyMaxY > bodyMinY)) return null;

  // Height at which the two overlap. Outside the body's span the participant
  // is clamped to the nearest end rather than dropped, so an element level
  // with the crown still presses on the crown.
  const bandY = clampTo((box.minY + box.maxY) / 2, bodyMinY, bodyMaxY);
  const radius = poolProfileRadiusAt(profile, bandY - rootOffsetY);
  if (!(radius > 0)) return null;

  // Nearest point of the rect to the axis point at that height, and the gap
  // between them. That gap is what the radius is tested against.
  const nearX = clampTo(0, box.minX, box.maxX);
  const nearY = clampTo(bandY, box.minY, box.maxY);
  const gap = Math.hypot(nearX, bandY - nearY);
  const overlap = radius - gap;
  if (!(overlap > 0)) return null;

  let dx = -nearX;
  let dy = bandY - nearY;
  let distance = gap;
  if (distance <= 1e-6) {
    // The axis runs through the rect: the body is engulfed at this height, so
    // the way out is away from the rect's own centre rather than away from a
    // nearest point that is the axis itself.
    dx = -(box.minX + box.maxX) / 2;
    dy = bandY - (box.minY + box.maxY) / 2;
    distance = Math.hypot(dx, dy);
    if (distance <= 1e-6) {
      dx = -1;
      dy = 0;
      distance = 1;
    }
  }

  const submerged = Math.max(0, Math.min(-box.minY, box.maxY - box.minY));
  return {
    bandY: bandY - rootOffsetY,
    direction: [dx / distance, dy / distance, 0],
    overlap,
    poolX: (box.minX + box.maxX) / 2,
    poolHalfWidth: Math.abs(box.maxX - box.minX) / 2,
    submerged,
  };
}

/** One marked element and everything the stage tracks about it. */
export interface StageParticipant {
  readonly element: HTMLElement;
  /** Carries `data-hologlyph-obstacle`: the fluid is squeezed by it. */
  readonly obstacle: boolean;
  /** Carries `data-hologlyph-body`: the fluid pushes it around. */
  readonly buoyant: boolean;
  /** In the viewport at all. Offscreen participants are read and written never. */
  readonly visible: boolean;
  /**
   * Rest rect in viewport CSS pixels, with this module's own transform
   * subtracted back out. Measuring the live rect and feeding it straight back
   * in would fold last frame's push into this frame's collision and drift.
   */
  readonly rect: StageRect;
}

export interface StageOptions {
  /** Where to look for markers. The mounted canvas's document by default. */
  readonly root: ParentNode;
  /** The mounted canvas, measured in the same batch as the participants. */
  readonly canvas: HTMLElement;
  /** Injectable for tests, which have no real layout to observe. */
  readonly createResizeObserver?: (cb: ResizeObserverCallback) => ResizeObserver;
  readonly createIntersectionObserver?: (
    cb: IntersectionObserverCallback,
    init?: IntersectionObserverInit,
  ) => IntersectionObserver;
  readonly createMutationObserver?: (cb: MutationCallback) => MutationObserver;
}

export interface Stage extends Disposable {
  /** Rescan the root for markers, keeping the state of elements that survive. */
  refresh(): void;
  /**
   * Read the canvas rect and every visible participant's rect, in one batch.
   * A no-op unless an observer or a scroll invalidated the last batch, which
   * is what keeps a still page at zero layout reads per frame.
   */
  measure(): void;
  readonly participants: readonly StageParticipant[];
  /** Canvas rect from the last batch. */
  readonly canvasRect: StageRect;
  /**
   * Write the reaction offsets back, in CSS pixels, one XY pair per
   * participant. Called after every read in the frame, never between two.
   */
  write(offsets: Float64Array): void;
  /** Drop every written transform and restore the host's own. */
  release(): void;
}

interface ParticipantEntry {
  element: HTMLElement;
  obstacle: boolean;
  buoyant: boolean;
  visible: boolean;
  rect: StageRect;
  /** The inline transform the host had, restored verbatim on teardown. */
  baseTransform: string;
  /** What this module last wrote, in CSS pixels. */
  appliedX: number;
  appliedY: number;
}

function readAttributes(element: Element): { obstacle: boolean; buoyant: boolean } {
  return {
    obstacle: element.hasAttribute(OBSTACLE_ATTRIBUTE),
    buoyant: element.hasAttribute(BODY_ATTRIBUTE),
  };
}

/**
 * Build the stage over a root. Cheap to construct and cheaper still to run:
 * the initial scan is one `querySelectorAll`, and a root with no markers
 * installs no observer at all.
 */
export function createStage(options: StageOptions): Stage {
  const { root, canvas } = options;
  const createRO =
    options.createResizeObserver ??
    (typeof ResizeObserver === 'undefined'
      ? null
      : (cb: ResizeObserverCallback) => new ResizeObserver(cb));
  const createIO =
    options.createIntersectionObserver ??
    (typeof IntersectionObserver === 'undefined'
      ? null
      : (cb: IntersectionObserverCallback, init?: IntersectionObserverInit) =>
          new IntersectionObserver(cb, init));
  const createMO =
    options.createMutationObserver ??
    (typeof MutationObserver === 'undefined'
      ? null
      : (cb: MutationCallback) => new MutationObserver(cb));

  const entries: ParticipantEntry[] = [];
  const byElement = new Map<HTMLElement, ParticipantEntry>();
  let canvasRect: StageRect = EMPTY_RECT;
  let dirty = true;
  let disposed = false;

  let resize: ResizeObserver | null = null;
  let intersect: IntersectionObserver | null = null;
  let mutations: MutationObserver | null = null;
  /** Wired once, on the first scan that finds anything. */
  let observersReady = false;
  /** Set by the `MutationObserver`, drained once at the top of `measure`. */
  let rescanPending = false;
  /** The overflow warning is said once, not once per rescan. */
  let warnedOverflow = false;

  const invalidate = (): void => {
    dirty = true;
  };

  const view = canvas.ownerDocument?.defaultView ?? null;
  let listening = false;

  function listen(): void {
    if (listening || !view) return;
    listening = true;
    // Scroll is not a layout change, so no observer reports it, and polling is
    // what this contract forbids. A passive capturing listener catches the
    // window and every scrolling container in one go, and all it does is set
    // a flag: the read still happens once, inside the frame's batch.
    view.addEventListener('scroll', invalidate, { passive: true, capture: true });
    view.addEventListener('resize', invalidate, { passive: true });
  }

  function unlisten(): void {
    if (!listening || !view) return;
    listening = false;
    view.removeEventListener('scroll', invalidate, { capture: true });
    view.removeEventListener('resize', invalidate);
  }

  /**
   * Wire the invalidation sources. Each is independent: a runtime with no
   * `ResizeObserver` must still get scroll invalidation, or the rects go
   * stale after frame one and every collision is measured against where the
   * page used to be.
   */
  function ensureObservers(): void {
    if (observersReady) return;
    observersReady = true;
    if (createRO) resize = createRO(invalidate);
    if (createIO) {
      intersect = createIO((records) => {
        for (const record of records) {
          const entry = byElement.get(record.target as HTMLElement);
          if (!entry) continue;
          entry.visible = record.isIntersecting;
          // An element that has just left the viewport keeps whatever push it
          // was holding until something releases it, and nothing will: it is
          // no longer measured. Zero it here, once.
          if (!entry.visible) applyTransform(entry, 0, 0);
        }
        dirty = true;
      });
    }
    listen();
  }

  function adopt(element: HTMLElement): ParticipantEntry {
    const existing = byElement.get(element);
    const marks = readAttributes(element);
    if (existing) {
      existing.obstacle = marks.obstacle;
      existing.buoyant = marks.buoyant;
      return existing;
    }
    const entry: ParticipantEntry = {
      element,
      obstacle: marks.obstacle,
      buoyant: marks.buoyant,
      // Assumed visible until an IntersectionObserver says otherwise, so a
      // page whose observer has not fired yet still collides on frame one.
      visible: true,
      rect: EMPTY_RECT,
      baseTransform: element.style.transform,
      appliedX: 0,
      appliedY: 0,
    };
    byElement.set(element, entry);
    resize?.observe(element);
    intersect?.observe(element);
    return entry;
  }

  function drop(entry: ParticipantEntry): void {
    applyTransform(entry, 0, 0);
    entry.element.style.transform = entry.baseTransform;
    resize?.unobserve(entry.element);
    intersect?.unobserve(entry.element);
    byElement.delete(entry.element);
  }

  function applyTransform(entry: ParticipantEntry, x: number, y: number): void {
    if (
      Math.abs(x - entry.appliedX) < WRITE_EPSILON &&
      Math.abs(y - entry.appliedY) < WRITE_EPSILON
    ) {
      return;
    }
    entry.appliedX = x;
    entry.appliedY = y;
    if (x === 0 && y === 0) {
      entry.element.style.transform = entry.baseTransform;
      return;
    }
    // OURS FIRST. Transforms apply right to left, so leading with the push
    // keeps it in the untransformed parent's space: a host base transform
    // that scales or rotates then leaves the pixel offset alone, which is
    // what makes the subtraction in `measureRect` exact rather than close.
    const push = `translate3d(${x.toFixed(2)}px, ${y.toFixed(2)}px, 0)`;
    entry.element.style.transform = entry.baseTransform
      ? `${push} ${entry.baseTransform}`
      : push;
  }

  function watchRoot(): void {
    if (mutations || !createMO) return;
    // Installed only once the page has proved it uses this feature. A subtree
    // observer over a document that marks nothing is exactly the standing cost
    // the drop-in promise forbids, and `Engine.refreshStage` is the escape
    // hatch for a host that marks its first participant later.
    const target = root instanceof Document ? root.documentElement : (root as Element);
    if (!target) return;
    // Coalesced, never immediate. `childList: true` over a subtree fires on
    // every insertion anywhere in the host application, and a rescan is a
    // `querySelectorAll` plus a rewire; running one per mutation would make a
    // list rendering a hundred rows do a hundred of them. The flag is drained
    // once, at the top of the frame's batch.
    mutations = createMO(() => {
      rescanPending = true;
    });
    mutations.observe(target, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: [OBSTACLE_ATTRIBUTE, BODY_ATTRIBUTE],
    });
  }

  function refresh(): void {
    if (disposed) return;
    rescanPending = false;
    const found = root.querySelectorAll(PARTICIPANT_SELECTOR);
    if (found.length > 0) {
      ensureObservers();
      watchRoot();
    }
    const seen = new Set<HTMLElement>();
    entries.length = 0;
    for (const node of found) {
      // HTML only. An `SVGElement` matches the selector and has a `style`, but
      // its box is governed by its own viewBox and a CSS transform on it means
      // something else; silently pushing one around is worse than ignoring it.
      if (!(node instanceof HTMLElement)) continue;
      if (entries.length >= STAGE_MAX_PARTICIPANTS) {
        if (!warnedOverflow) {
          warnedOverflow = true;
          console.warn(
            `[hologlyph] ${found.length} elements carry a hologlyph participant marker; only the ` +
              `first ${STAGE_MAX_PARTICIPANTS} are tracked, and only ${FLUID_PARTICIPANT_MODES} ` +
              'can couple to the fluid at once.',
          );
        }
        break;
      }
      seen.add(node);
      entries.push(adopt(node));
    }
    for (const entry of [...byElement.values()]) {
      if (!seen.has(entry.element)) drop(entry);
    }
    dirty = true;
  }

  function measureRect(element: HTMLElement, offsetX: number, offsetY: number): StageRect {
    const r = element.getBoundingClientRect();
    // Subtract our own push back out. `getBoundingClientRect` reports the
    // TRANSFORMED box, so feeding it straight back in would fold last frame's
    // reaction into this frame's collision and walk the element off the page.
    return { x: r.x - offsetX, y: r.y - offsetY, width: r.width, height: r.height };
  }

  const stage: Stage = {
    refresh,

    measure(): void {
      if (disposed) return;
      // Drain the coalesced mutations first: a marker that arrived since the
      // last frame has to be adopted before the batch that would read it.
      if (rescanPending) refresh();
      if (!dirty) return;
      dirty = false;
      if (entries.length === 0) {
        canvasRect = EMPTY_RECT;
        return;
      }
      // One batch, reads only. Nothing below writes to the DOM, so the browser
      // recalculates style at most once for the whole frame.
      const c = canvas.getBoundingClientRect();
      canvasRect = { x: c.x, y: c.y, width: c.width, height: c.height };
      for (const entry of entries) {
        entry.rect = entry.visible
          ? measureRect(entry.element, entry.appliedX, entry.appliedY)
          : EMPTY_RECT;
      }
    },

    get participants(): readonly StageParticipant[] {
      return entries;
    },

    get canvasRect(): StageRect {
      return canvasRect;
    },

    write(offsets: Float64Array): void {
      if (disposed) return;
      for (let i = 0; i < entries.length; i++) {
        const entry = entries[i];
        if (!entry) continue;
        if (!entry.visible || !entry.buoyant) {
          applyTransform(entry, 0, 0);
          continue;
        }
        applyTransform(entry, offsets[i * 2] ?? 0, offsets[i * 2 + 1] ?? 0);
      }
    },

    release(): void {
      for (const entry of byElement.values()) {
        applyTransform(entry, 0, 0);
        entry.element.style.transform = entry.baseTransform;
      }
    },

    dispose(): void {
      if (disposed) return;
      disposed = true;
      stage.release();
      resize?.disconnect();
      intersect?.disconnect();
      mutations?.disconnect();
      resize = null;
      intersect = null;
      mutations = null;
      unlisten();
      entries.length = 0;
      byElement.clear();
      canvasRect = EMPTY_RECT;
    },
  };

  return stage;
}
