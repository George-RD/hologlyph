/**
 * Host page backdrop detection (dec.glass-backdrop-adaptive).
 *
 * The canvas clears to transparent, so what sits behind the head is whatever
 * the host page paints. This walks up from the mount host looking for the first
 * element that actually paints an opaque background, and reports it as a hex
 * colour the skin config understands. Anything it cannot resolve degrades to
 * the caller's fallback rather than guessing black.
 */

/**
 * Convert a computed `background-color` to `#rrggbb`.
 *
 * Returns null for anything that does not paint: `transparent`, any colour with
 * alpha below `MIN_ALPHA`, and syntaxes we cannot read (`color(display-p3 ...)`,
 * gradients, keywords a browser did not resolve).
 */
export function computedColorToHex(value: string | null | undefined): string | null {
  if (!value) return null;
  const match = /^rgba?\(([^)]+)\)$/.exec(value.trim().toLowerCase());
  if (!match?.[1]) return null;
  const parts = match[1].split(/[\s,/]+/).filter((part) => part.length > 0);
  if (parts.length < 3) return null;

  const channels: number[] = [];
  for (let i = 0; i < 3; i += 1) {
    const raw = parts[i];
    if (raw === undefined) return null;
    const numeric = raw.endsWith('%')
      ? (Number.parseFloat(raw) / 100) * 255
      : Number.parseFloat(raw);
    if (!Number.isFinite(numeric)) return null;
    channels.push(Math.min(255, Math.max(0, Math.round(numeric))));
  }

  const alphaRaw = parts[3];
  if (alphaRaw !== undefined) {
    const alpha = alphaRaw.endsWith('%')
      ? Number.parseFloat(alphaRaw) / 100
      : Number.parseFloat(alphaRaw);
    // A mostly transparent element does not decide what is behind the head:
    // keep walking so the ancestor that actually paints wins.
    if (!Number.isFinite(alpha) || alpha < MIN_ALPHA) return null;
  }

  return `#${channels.map((c) => c.toString(16).padStart(2, '0')).join('')}`;
}

/** Below this alpha an element is treated as not painting a background at all. */
const MIN_ALPHA = 0.5;
/** Browser canvas colour when no element paints a background. */
const CANVAS_LIGHT = '#ffffff';

/** Canvas colour a `color-scheme: dark` page gets instead. */
const CANVAS_DARK = '#121212';

/**
 * First opaque background colour at or above `element`.
 *
 * The walk continues past the mount host through its ancestors. When nothing
 * paints, the page is showing the browser canvas: that is white, or the dark
 * canvas colour when the document opted into a dark `color-scheme`. Both html
 * and body default to `rgba(0, 0, 0, 0)`, so an unstyled page always lands
 * here, and resolving it to the caller's dark fallback would make the head
 * glow-on-dark against white. `fallback` is used only when there is no
 * `getComputedStyle` to ask, which means no DOM to render into either.
 */
export function resolveBackdropColor(element: Element | null, fallback: string): string {
  if (!element || typeof globalThis.getComputedStyle !== 'function') return fallback;

  let node: Element | null = element;
  while (node) {
    const hex = computedColorToHex(globalThis.getComputedStyle(node).backgroundColor);
    if (hex) return hex;
    if (node.parentElement) {
      node = node.parentElement;
      continue;
    }
    // A head nested in another component's shadow tree has no parent element
    // at the boundary; hop to the host so the app's own background still wins.
    const root = node.getRootNode();
    node = root instanceof ShadowRoot ? root.host : null;
  }

  const root = element.ownerDocument?.documentElement;
  const scheme = root ? globalThis.getComputedStyle(root).colorScheme : '';
  return scheme?.includes('dark') && !scheme.includes('light') ? CANVAS_DARK : CANVAS_LIGHT;
}
