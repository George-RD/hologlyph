/**
 * Public entry point for hologlyph.
 *
 * Re-exports the imperative engine (advanced surface) and every contract type.
 * The declarative custom element is registered separately by the element
 * module; its export line is kept here so integration resolves once that
 * module lands (it is owned by a sibling agent and may not exist yet).
 */
export { createEngine } from './core/index.js';
export type * from './contracts.js';

export { defineHologlyphHead, HologlyphHeadElement } from './element/index.js';
