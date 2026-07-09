/**
 * Thin Svelte wrapper for <hologlyph-head>.
 *
 * Svelte actions are ordinary functions, so this wrapper has NO Svelte
 * dependency. Use it with the `use:` directive on a `<hologlyph-head>` element:
 *
 * Usage:
 * ```svelte
 * <script lang="ts">
 *   import { hologlyphHead } from 'hologlyph/svelte';
 *   let avatar = '/avatar.glb';
 * </script>
 *
 * <hologlyph-head
 *   use:hologlyphHead={{ src: avatar, text: 'Welcome', onStateChange: (d) => console.log(d.to) }}
 * />
 * ```
 */

import { defineHologlyphHead, HologlyphHeadElement } from '../element';

export interface HologlyphHeadParams {
  src?: string;
  text?: string;
  mode?: 'auto' | 'manual';
  reducedMotion?: boolean;
  onReady?: () => void;
  onStateChange?: (detail: { from: string; to: string }) => void;
  onSpeechStart?: () => void;
  onSpeechEnd?: () => void;
  onError?: (error: Error) => void;
}

export interface SvelteActionReturn {
  update?: (params: HologlyphHeadParams) => void;
  destroy?: () => void;
}

/** Svelte action that wires a <hologlyph-head> node to the given params. */
export function hologlyphHead(
  node: HTMLElement,
  params: HologlyphHeadParams = {},
): SvelteActionReturn {
  defineHologlyphHead();
  const el = node as HologlyphHeadElement;
  const on: Array<[string, EventListener]> = [];

  const applyProps = (p: HologlyphHeadParams): void => {
    if (p.src !== undefined) el.src = p.src;
    if (p.text !== undefined) el.textSkin = p.text;
    if (p.mode !== undefined) el.mode = p.mode;
    if (p.reducedMotion !== undefined) el.reducedMotion = p.reducedMotion;
  };

  const wire = (p: HologlyphHeadParams): void => {
    const add = (name: string, fn: EventListener): void => {
      el.addEventListener(name, fn);
      on.push([name, fn]);
    };
    if (p.onReady) add('hologlyph-ready', () => p.onReady!());
    if (p.onStateChange) {
      add('hologlyph-statechange', (e) =>
        p.onStateChange!((e as CustomEvent).detail as { from: string; to: string }),
      );
    }
    if (p.onSpeechStart) add('hologlyph-speechstart', () => p.onSpeechStart!());
    if (p.onSpeechEnd) add('hologlyph-speechend', () => p.onSpeechEnd!());
    if (p.onError) {
      add('hologlyph-error', (e) => p.onError!((e as CustomEvent).detail.error as Error));
    }
  };

  applyProps(params);
  wire(params);

  return {
    update(next: HologlyphHeadParams) {
      applyProps(next);
      for (const [name, fn] of on) el.removeEventListener(name, fn);
      on.length = 0;
      wire(next);
    },
    destroy() {
      for (const [name, fn] of on) el.removeEventListener(name, fn);
      on.length = 0;
    },
  };
}
