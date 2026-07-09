/**
 * Thin React wrapper for <hologlyph-head>.
 *
 * This module has ZERO React dependency. Instead of importing `react`, the
 * caller passes their own React namespace. This keeps the published package
 * free of a React peer dependency and lets any React version drive the
 * component.
 *
 * Usage:
 * ```ts
 * import * as React from 'react';
 * import { createHologlyphHead } from 'hologlyph/react';
 *
 * const HologlyphHead = createHologlyphHead(React);
 *
 * function Avatar() {
 *   return (
 *     <HologlyphHead
 *       src="/avatar.glb"
 *       text="Welcome"
 *       onStateChange={(d) => console.log(d.to)}
 *       onSpeechStart={() => console.log('speaking')}
 *     />
 *   );
 * }
 * ```
 */

import { defineHologlyphHead, HologlyphHeadElement } from '../element';

/** Minimal structural view of the React surface we actually use. */
export interface ReactLike {
  createElement(
    type: string,
    props: Record<string, unknown> | null,
    ...children: unknown[]
  ): unknown;
  useRef<T>(initial: T): { current: T };
  useEffect(effect: () => void | (() => void), deps?: unknown[]): void;
}

export interface HologlyphHeadProps {
  src?: string;
  text?: string;
  mode?: 'auto' | 'manual';
  reducedMotion?: boolean;
  onReady?: () => void;
  onStateChange?: (detail: { from: string; to: string }) => void;
  onSpeechStart?: () => void;
  onSpeechEnd?: () => void;
  onError?: (error: Error) => void;
  [key: string]: unknown;
}

/**
 * Build a React component function bound to the supplied React namespace.
 * Idempotently registers the custom element on first call.
 */
export function createHologlyphHead(react: ReactLike): (props: HologlyphHeadProps) => unknown {
  defineHologlyphHead();
  const { createElement, useRef, useEffect } = react;

  return function HologlyphHead(props: HologlyphHeadProps): unknown {
    const ref = useRef<HologlyphHeadElement | null>(null);

    useEffect(() => {
      const el = ref.current;
      if (!el) return;

      if (props.src !== undefined) el.src = props.src;
      if (props.text !== undefined) el.textSkin = props.text;
      if (props.mode !== undefined) el.mode = props.mode;
      if (props.reducedMotion !== undefined) el.reducedMotion = props.reducedMotion;

      const listeners: Array<[string, EventListener]> = [];
      const add = (name: string, fn: EventListener): void => {
        el.addEventListener(name, fn);
        listeners.push([name, fn]);
      };

      if (props.onReady) add('hologlyph-ready', () => props.onReady!());
      if (props.onStateChange) {
        add('hologlyph-statechange', (e) =>
          props.onStateChange!((e as CustomEvent).detail as { from: string; to: string }),
        );
      }
      if (props.onSpeechStart) add('hologlyph-speechstart', () => props.onSpeechStart!());
      if (props.onSpeechEnd) add('hologlyph-speechend', () => props.onSpeechEnd!());
      if (props.onError) {
        add('hologlyph-error', (e) =>
          props.onError!((e as CustomEvent).detail.error as Error),
        );
      }

      return () => {
        for (const [name, fn] of listeners) el.removeEventListener(name, fn);
      };
    }, [props.src, props.text, props.mode, props.reducedMotion]);

    return createElement('hologlyph-head', { ref });
  };
}
