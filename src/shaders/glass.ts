/**
 * Pure backdrop-adaptation maths for the glass skin (dec.glass-backdrop-adaptive).
 *
 * The canvas is transparent, so the head composites over whatever the host page
 * paints behind it. Emissive glyphs read as glow only against a dark backdrop:
 * on a light page the same values wash out, and on a mid tone neither glow nor
 * ink carries the letterforms. This module maps a backdrop colour to the five
 * shader inputs that keep the skin legible, with no GPU or DOM involvement so
 * it is testable in isolation.
 */

/** Adaptation applied to the skin material for a given host page colour. */
export interface BackdropAdaptation {
  /** Relative luminance of the backdrop in linear light, 0 (black) to 1 (white). */
  readonly luminance: number;
  /** How far the glyph colour shifts from glow towards dark ink, 0 to 1. */
  readonly inkMix: number;
  /**
   * Dark ink colour derived from the backdrop, in three's linear working
   * space so it can be handed straight to a `Color` uniform.
   */
  readonly inkColor: readonly [number, number, number];
  /** Multiplier on the emissive glow; falls off as the backdrop brightens. */
  readonly glowScale: number;
  /** Extra base opacity, peaking on mid tones where contrast is worst. */
  readonly opacityFloor: number;
  /** Fresnel rim colour: a cool glow on dark pages, a dark outline on light. */
  readonly rimColor: readonly [number, number, number];
}

/** Rim colour on a dark backdrop: the approved cool holo rim. */
const RIM_DARK: readonly [number, number, number] = [0.5, 0.7, 1.0];

/** Rim colour on a light backdrop: a deep outline that still reads as glass. */
const RIM_LIGHT: readonly [number, number, number] = [0.08, 0.12, 0.22];

/** Peak opacity added on a mid-tone backdrop. */
const MAX_OPACITY_FLOOR = 0.2;

/** Fraction of the emissive glow a fully white backdrop removes. */
const MAX_GLOW_CUT = 0.85;

/** Backdrop luminance where glyphs start turning into ink. */
const INK_START = 0.25;

/** Backdrop luminance where the ink shift is complete. */
const INK_END = 0.7;

/** How dark the ink is relative to the backdrop it is drawn on. */
const INK_DARKEN = 0.18;

/** Parse `#rrggbb` (or `#rgb`) into sRGB channels in 0 to 1; null when malformed. */
export function parseHexColor(hex: string): [number, number, number] | null {
  if (typeof hex !== 'string') return null;
  const clean = hex.trim().toLowerCase();
  const long = /^#([0-9a-f]{6})$/.exec(clean);
  if (long?.[1]) {
    const value = Number.parseInt(long[1], 16);
    return [((value >> 16) & 255) / 255, ((value >> 8) & 255) / 255, (value & 255) / 255];
  }
  const short = /^#([0-9a-f]{3})$/.exec(clean);
  if (short?.[1]) {
    const [r, g, b] = short[1];
    return [
      Number.parseInt(`${r}${r}`, 16) / 255,
      Number.parseInt(`${g}${g}`, 16) / 255,
      Number.parseInt(`${b}${b}`, 16) / 255,
    ];
  }
  return null;
}

/** sRGB transfer function inverse for one channel. */
export function srgbToLinear(channel: number): number {
  const c = channel <= 0 ? 0 : channel >= 1 ? 1 : channel;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

/** Relative luminance of a hex colour; malformed input reads as black. */
export function backdropLuminance(hex: string): number {
  const rgb = parseHexColor(hex);
  if (!rgb) return 0;
  return (
    0.2126 * srgbToLinear(rgb[0]) +
    0.7152 * srgbToLinear(rgb[1]) +
    0.0722 * srgbToLinear(rgb[2])
  );
}

/** Hermite smoothstep, clamped to the edge values. */
function smoothstep(edge0: number, edge1: number, x: number): number {
  if (edge1 <= edge0) return x < edge0 ? 0 : 1;
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

/**
 * Map a host page colour to the skin's adaptation inputs.
 *
 * `adapt` scales every response, so `adapt = 0` returns the identity: the
 * owner-approved dark-page look regardless of what the page is painted. A dark
 * backdrop also returns the identity by construction, because every term is
 * driven by luminance.
 */
export function adaptToBackdrop(color: string, adapt: number): BackdropAdaptation {
  const strength = Math.min(1, Math.max(0, adapt));
  const luminance = backdropLuminance(color);
  const rgb = parseHexColor(color) ?? [0, 0, 0];

  const inkMix = strength * smoothstep(INK_START, INK_END, luminance);
  const glowScale = 1 - strength * MAX_GLOW_CUT * luminance;
  // Peaks at mid grey, where neither glow nor ink has much contrast to spend.
  const opacityFloor = strength * MAX_OPACITY_FLOOR * (1 - Math.abs(2 * luminance - 1));
  // Authored as a darkened version of the page in sRGB, then linearised: a
  // linear 0.18 would display as a mid grey rather than as ink.
  const inkColor: [number, number, number] = [
    srgbToLinear(rgb[0] * INK_DARKEN),
    srgbToLinear(rgb[1] * INK_DARKEN),
    srgbToLinear(rgb[2] * (INK_DARKEN + 0.02)),
  ];

  return {
    luminance,
    inkMix,
    inkColor,
    glowScale,
    opacityFloor,
    rimColor: [
      RIM_DARK[0] + (RIM_LIGHT[0] - RIM_DARK[0]) * inkMix,
      RIM_DARK[1] + (RIM_LIGHT[1] - RIM_DARK[1]) * inkMix,
      RIM_DARK[2] + (RIM_LIGHT[2] - RIM_DARK[2]) * inkMix,
    ],
  };
}
