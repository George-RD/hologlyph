/**
 * Thin Vue 3 wrapper for <hologlyph-head>.
 *
 * Vue supports custom elements natively, so this is simply a plain options
 * object component that any Vue 3 app can register.
 *
 * Tell Vue to treat the tag as a custom element so the compiler does not warn:
 *
 *   // main.ts
 *   app.config.compilerOptions.isCustomElement = (tag) =>
 *     tag === 'hologlyph-head';
 *
 * or, with @vitejs/plugin-vue:
 *
 *   // vite.config.ts
 *   vue({ template: { compilerOptions: { isCustomElement: (tag) => tag === 'hologlyph-head' } } })
 *
 * Usage:
 * ```ts
 * import { hologlyphHeadVue } from 'hologlyph/vue';
 * const HologlyphHead = hologlyphHeadVue();
 * app.component('HologlyphHead', HologlyphHead);
 * ```
 * ```vue
 * <HologlyphHead src="/avatar.glb" text="Welcome" @statechange="onState" />
 * ```
 */

import { defineHologlyphHead, type HologlyphHeadElement } from '../element';

interface VueComponentInstance {
  $refs: Record<string, HologlyphHeadElement>;
  $emit(event: string, ...args: unknown[]): void;
  src?: string;
  text?: string;
  reducedMotion?: boolean;
  _wire: () => void;
  _unwire: () => void;
  _on?: Array<[string, EventListener]>;
}

export interface HologlyphVueComponent {
  name: string;
  props: Record<string, unknown>;
  emits: string[];
  template: string;
  mounted(this: VueComponentInstance): void;
  beforeUnmount(this: VueComponentInstance): void;
  methods: {
    _wire(this: VueComponentInstance): void;
    _unwire(this: VueComponentInstance): void;
  };
  [key: string]: unknown;
}

/** Build a Vue 3 options-object component for the custom element. */
export function hologlyphHeadVue(): HologlyphVueComponent {
  defineHologlyphHead();

  return {
    name: 'HologlyphHead',
    props: {
      src: { type: String, default: '' },
      text: { type: String, default: '' },
      reducedMotion: { type: Boolean, default: false },
    },
    emits: ['ready', 'statechange', 'speechstart', 'speechend', 'error'],
    template:
      '<hologlyph-head ref="el" :src="src || null" :text-skin="text || null" ' +
      ':reduced-motion="reducedMotion ? \'\' : null"></hologlyph-head>',
    mounted(this: VueComponentInstance) {
      this._wire();
    },
    beforeUnmount(this: VueComponentInstance) {
      this._unwire();
    },
    methods: {
      _wire(this: VueComponentInstance) {
        const el = this.$refs.el;
        if (!el) return;
        this._on = [];
        const add = (name: string, fn: EventListener): void => {
          el.addEventListener(name, fn);
          this._on!.push([name, fn]);
        };

        if (this.src) el.src = this.src;
        if (this.text) el.textSkin = this.text;
        if (this.reducedMotion !== undefined) el.reducedMotion = this.reducedMotion;

        add('hologlyph-ready', () => this.$emit('ready'));
        add('hologlyph-statechange', (e) =>
          this.$emit('statechange', (e as CustomEvent).detail),
        );
        add('hologlyph-speechstart', () => this.$emit('speechstart'));
        add('hologlyph-speechend', () => this.$emit('speechend'));
        add('hologlyph-error', (e) => this.$emit('error', (e as CustomEvent).detail.error));
      },
      _unwire(this: VueComponentInstance) {
        const el = this.$refs.el;
        if (el && this._on) {
          for (const [name, fn] of this._on) el.removeEventListener(name, fn);
        }
        this._on = undefined;
      },
    },
  };
}
