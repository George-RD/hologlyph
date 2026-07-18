import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { HologlyphHeadProps, ReactLike } from '../src/adapters/react';
import { createHologlyphHead } from '../src/adapters/react';
import { hologlyphHead } from '../src/adapters/svelte';
import { defineHologlyphHead, type HologlyphHeadElement } from '../src/element';

type EffectCleanup = () => void;
type FakeEffect = () => unknown;
type FakeReact = {
  react: ReactLike;
  render: (component: (props: HologlyphHeadProps) => unknown, props: HologlyphHeadProps) => void;
  flush: () => void;
  unmount: () => void;
  host: HologlyphHeadElement;
};

const depsEqual = (a: unknown[] | undefined, b: unknown[] | undefined): boolean => {
  if (!a || !b) return false;
  if (a.length !== b.length) return false;
  return a.every((value, i) => Object.is(value, b[i]));
};

function createFakeReact(): FakeReact {
  const refs: Array<{ current: unknown }> = [];
  const effectSlots: Array<{ deps: unknown[] | undefined; cleanup: EffectCleanup | undefined }> = [];
  const effectQueue: Array<{
    index: number;
    effect: FakeEffect;
    deps: unknown[] | undefined;
    previousCleanup: EffectCleanup | undefined;
  }> = [];

  let host: HologlyphHeadElement | null = null;
  let effectCursor = 0;
  let refCursor = 0;

  const react: ReactLike = {
    createElement: (type, props) => {
      if (!host) {
        host = document.createElement(type) as HologlyphHeadElement;
      }

      const ref = props ? (props as { ref?: unknown }).ref : undefined;
      if (typeof ref === 'function') {
        ref(host);
      } else if (ref && typeof ref === 'object' && 'current' in ref) {
        (ref as { current: HologlyphHeadElement | null }).current = host;
      }

      return host;
    },
    useRef: <T>(initial: T) => {
      const current = refs[refCursor] as { current: T } | undefined;
      if (current) {
        current.current = initial;
        refCursor += 1;
        return current;
      }

      const next = { current: initial } as { current: T };
      refs[refCursor] = next;
      refCursor += 1;
      return next;
    },
    useEffect: (effect, deps) => {
      const currentIndex = effectCursor;
      const previous = effectSlots[currentIndex];
      const hasDeps = deps !== undefined;
      const changed = !previous || !hasDeps || !depsEqual(previous.deps, deps);

      if (changed) {
        effectQueue.push({
          index: currentIndex,
          effect,
          deps,
          previousCleanup: previous?.cleanup,
        });
      }

      if (!previous) {
        effectSlots[currentIndex] = { deps: hasDeps ? deps : undefined, cleanup: undefined };
      }

      effectCursor += 1;
    },
  };

  return {
    react,
    render: (component, props) => {
      effectCursor = 0;
      refCursor = 0;
      effectQueue.length = 0;
      component(props);
    },
    flush: () => {
      const pending = effectQueue.splice(0, effectQueue.length);
      for (const item of pending) {
        item.previousCleanup?.();
        const maybeCleanup = item.effect();
        effectSlots[item.index] = {
          deps: item.deps,
          cleanup:
            typeof maybeCleanup === 'function' ? (maybeCleanup as EffectCleanup) : undefined,
        };
      }
    },
    unmount: () => {
      for (const slot of effectSlots) slot.cleanup?.();
      effectSlots.length = 0;
      effectQueue.length = 0;
    },
    get host() {
      return host as HologlyphHeadElement;
    },
  };
}

describe('react adapter', () => {
  let fakeReact: ReturnType<typeof createFakeReact>;
  let Component: ReturnType<typeof createHologlyphHead>;
  let element: HologlyphHeadElement;

  beforeEach(() => {
    defineHologlyphHead();
    fakeReact = createFakeReact();
    Component = createHologlyphHead(fakeReact.react);
    fakeReact.render(Component, {});
    element = fakeReact.host;
    fakeReact.unmount();
  });

  afterEach(() => {
    fakeReact.unmount();
  });

  it('applies initial props during creation so they are present before effects run', () => {
    fakeReact.render(Component, {
      src: 'avatar.glb',
      text: 'Hello',
      reducedMotion: true,
    });

    expect(element.src).toBe('avatar.glb');
    expect(element.textSkin).toBe('Hello');
    expect(element.hasAttribute('reduced-motion')).toBe(true);
  });

  it('clears previously-set props when values become undefined', () => {
    fakeReact.render(Component, {
      src: 'avatar.glb',
      text: 'Hello',
      reducedMotion: true,
    });

    fakeReact.render(Component, {});

    expect(element.getAttribute('src')).toBeNull();
    expect(element.getAttribute('text-skin')).toBeNull();
    expect(element.hasAttribute('reduced-motion')).toBe(false);
  });

  it('refreshes listeners when callback props change', () => {
    const first = vi.fn();
    const second = vi.fn();

    fakeReact.render(Component, { onReady: first });
    fakeReact.flush();

    element.dispatchEvent(new Event('hologlyph-ready'));
    expect(first).toHaveBeenCalledTimes(1);

    fakeReact.render(Component, { onReady: second });
    fakeReact.flush();

    element.dispatchEvent(new Event('hologlyph-ready'));
    expect(first).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenCalledTimes(1);
  });
});

describe('svelte adapter', () => {
  let element: HologlyphHeadElement;
  let action: ReturnType<typeof hologlyphHead> | undefined;

  beforeEach(() => {
    defineHologlyphHead();
    element = document.createElement('hologlyph-head') as HologlyphHeadElement;
  });

  afterEach(() => {
    action?.destroy?.();
    if (element.isConnected) {
      element.remove();
    }
    action = undefined;
  });

  it('clears attributes when params are removed', () => {
    action = hologlyphHead(element, {
      src: 'avatar.glb',
      text: 'Hello',
      reducedMotion: true,
    });

    expect(element.getAttribute('src')).toBe('avatar.glb');
    expect(element.getAttribute('text-skin')).toBe('Hello');
    expect(element.hasAttribute('reduced-motion')).toBe(true);

    action.update?.({
      src: undefined,
      text: undefined,
      reducedMotion: undefined,
    });

    expect(element.getAttribute('src')).toBeNull();
    expect(element.getAttribute('text-skin')).toBeNull();
    expect(element.hasAttribute('reduced-motion')).toBe(false);
  });

  it('updates event listeners when callback params change', () => {
    const first = vi.fn();
    const second = vi.fn();

    action = hologlyphHead(element, { onReady: first });

    element.dispatchEvent(new Event('hologlyph-ready'));
    expect(first).toHaveBeenCalledTimes(1);

    action.update?.({ onReady: second });

    element.dispatchEvent(new Event('hologlyph-ready'));
    expect(first).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenCalledTimes(1);
  });
});
