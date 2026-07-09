/**
 * Public entry point for the <hologlyph-head> web component.
 *
 * This module re-exports the element class and the registration helper. It is
 * the primary, declarative public surface of hologlyph (dec.api-emphasis);
 * the imperative engine it wraps is exposed underneath via the element's
 * `engine` getter.
 */

export { HologlyphHeadElement, defineHologlyphHead } from './hologlyph-head';
export type { EngineFactory } from './hologlyph-head';
