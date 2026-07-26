/**
 * Single-source TSL text-skin and eye materials (dec.renderer-posture).
 *
 * bind-space triplanar glyph sampling (so side surfaces keep readable
 * character density) and derives a translucent holo look from sampled colour.
 *
 * No GPU resources are constructed at module load: the material and its node
 * graph are built lazily inside `buildSkinMaterial` / `buildEyeballMaterial`,
 * so importing this module under happy-dom is safe.
 *
 * This module also carries the two tier 1 pool terms that live on the body
 * rather than on the water (dec.liquid-glass-architecture, item 3): the
 * outward-only breathe on the shell, and the waterline fade that stops the
 * clipped cross-section reading as a hollow shell. Both are gated by
 * `pool.amount`, and both collapse to an exact identity at 0.
 *
 * Tier 1 boundary, stated so the next reader does not think it was missed:
 * only the materials the library builds fade. The authored `mouth_interior`
 * and `eye_trim` materials in the engine's `KEEP_MATERIALS`, and the eyeball
 * material, still terminate at the hard clip plane. Softening them means
 * replacing authored glTF materials with node-material clones, which silently
 * drops whatever maps and emissive the asset carried, and buys very little:
 * they are small, dark and only cross the waterline during emergence. It is
 * deferred rather than done badly.
 */

import {
  BackSide,
  Color,
  DataTexture,
  FrontSide,
  LinearFilter,
  RepeatWrapping,
  Vector2,
  Vector4,
} from 'three';
import { MeshBasicNodeMaterial, MeshStandardNodeMaterial } from 'three/webgpu';
import {
  acos,
  atan,
  attribute,
  cameraPosition,
  cos,
  dot,
  exp,
  float,
  floor,
  fract,
  luminance,
  mix,
  normalGeometry,
  normalLocal,
  normalView,
  normalWorld,
  output,
  positionGeometry,
  positionLocal,
  positionViewDirection,
  positionWorld,
  pow,
  saturate,
  screenUV,
  sin,
  smoothstep,
  texture,
  transformNormalToView,
  uniform,
  vec2,
  vec3,
  vec4,
} from 'three/tsl';
import type * as THREE from 'three';
import {
  clamp01,
  DEFAULT_HEAD_CONFIG,
  type HeadConfig,
  type HeadConfigOverrides,
  type TextSkinEngine,
} from '../contracts';
import { adaptToBackdrop } from './glass';
import { INTERIOR_GLYPH_MAX } from './interior-glyphs';

/** Default glyph grid shape (mirrors DEFAULT_GRID in text-skin). */
const GRID_COLS = 96;
const GRID_ROWS = 64;

/** Glyph cells per world unit for the planar projection. */
export const PLANAR_DENSITY = 40;

/** Horizontal projection scale: u advances this much per world unit of x. */
export const U_SCALE = PLANAR_DENSITY / GRID_COLS;

/** Vertical projection scale: v advances this much per world unit of y. */
export const V_SCALE = PLANAR_DENSITY / GRID_ROWS;


/** Key directional-light weight for the matte skin-shading term (scene key intensity 2.2, white). */
export const SHADE_KEY_WEIGHT = 2.2;

/** Fill directional-light weight for the matte skin-shading term (scene fill intensity 0.8, cool). */
export const SHADE_FILL_WEIGHT = 0.8;

/** Small additive ambient floor so shadowed skin keeps a faint base luminance. */
export const SHADE_AMBIENT = 0.08;

/** Lower clamp on the skin-shading term so facial glyphs never read fully black. */
export const SHADE_FLOOR = 0.12;

/**
 * Beer-Lambert extinction over the baked `aThickness` attribute, which is
 * normalised so 1 is the thickest part of the body. On the shipped bust that
 * puts the forehead at 0.835 and the nose tip at 0.149, so at 2.4 the cranium
 * transmits 13% of the page behind it and the nose tip 70%. That spread is
 * what makes the head read as a block rather than a shell.
 */
export const GLASS_ABSORPTION = 2.4;

/**
 * Peak alpha of the interior (backface) pass. Deliberately low: the far wall
 * is a hint of depth, not a second face competing with the front glyphs.
 */
export const INTERIOR_OPACITY = 0.55;

/** Brightness scale of the interior pass relative to the front surface. */
export const INTERIOR_DIM = 0.42;

/**
 * Height above the waterline, in world units, over which the pool's breathe
 * dies away. The bust is about 1.8 tall and the head about 1.0, so 0.45 keeps
 * the swell in the shoulders and base where the water is, and leaves the face
 * still: a wobbling mouth would be a viseme bug wearing a costume.
 */
export const BREATHE_FALLOFF = 0.45;

/** Breathe wavenumbers. Deliberately incommensurate so the pattern does not
 * visibly repeat, and low enough that a full wavelength (about 1.1 and 1.5
 * world units) is larger than any facial feature. */
export const BREATHE_KX = 5.5;
export const BREATHE_KZ = 4.1;

/** Breathe angular frequency, rad/s: about 3.9 s per cycle, a swell not a chop. */
export const BREATHE_OMEGA = 1.6;

/**
 * Absorption is achromatic on the front surface and tinted on the interior
 * wall, and that split is measured rather than assumed.
 *
 * Mixing the glass tint into the front glyph colour in proportion to what the
 * body hides is the obvious reading of "Beer-Lambert tinted by the tint", but
 * it flattens the glyph field exactly where the body is thickest. The visual
 * eval's yaw legibility fell from a 32.5 and 32.3 baseline to 23.8 and 22.1
 * against pass cutoffs of 26.0 and 25.8, a straight fail; a 0.22 ceiling on
 * the mix still cost 29.7 and 27.4. Dropping it entirely holds 32.0 and 29.4.
 *
 * What the measurement rejects is mixing the tint into the front glyph field,
 * which is what the yaw metric reads. It says nothing about tinting light that
 * has actually passed through the body, which is what the interior wall does.
 *
 * A text-skinned head cannot spend that much legibility for a pastel wash, so
 * the front keeps a colourless thickness term (thick body hides more page)
 * and the tinted Beer-Lambert lives on the interior wall, which is the light
 * that has genuinely travelled through the body.
 */

/** The float uniform we advance each frame from `skin.scrollOffset`. */
export interface ScrollUniform {
  value: number;
}

export interface HeadUniforms {
  scroll: ScrollUniform;
  baseOpacity: { value: number };
  lipsOp: { value: number };
  noseOp: { value: number };
  jawOp: { value: number };
  orbitOp: { value: number };
  browOp: { value: number };
  socketShadow: { value: number };
  socketMask: { value: number };
  socketSize: { value: number };
  cavity: { value: number };
  lipDark: { value: number };
  lipHue: { value: number };
  lipGate: { value: number };
  eyelid: { value: number };
  brow: { value: number };
  browGate: { value: number };
  glyphScale: { value: number };
  hDensity: { value: number };
  vDensity: { value: number };
  sharp: { value: number };
  tone: { value: number };
  toneAmt: { value: number };
  skinWarm: { value: number };
  rim: { value: number };
  glowGain: { value: number };
  glassAmount: { value: number };
  fresnel: { value: number };
  fresnelPow: { value: number };
  specular: { value: number };
  sheen: { value: number };
  refraction: { value: number };
  glassTint: { value: THREE.Color };
  inkMix: { value: number };
  inkColor: { value: THREE.Color };
  glowScale: { value: number };
  opacityFloor: { value: number };
  rimColor: { value: THREE.Color };
  /** Tier 1 pool master gate; 0 makes every pool term below an exact no-op. */
  poolAmount: { value: number };
  /** Outward-only breathe amplitude, world units. */
  poolBreathe: { value: number };
  /**
   * Crossfade to the breathe-deformed shading normal, 0 or 1. Derived rather
   * than configured: at 0 the shipped normal chain is reproduced exactly, so
   * it must be 0 whenever the breathe amplitude is.
   */
  poolNormalGate: { value: number };
  /** Height of the fade band above the waterline, world units. */
  poolFade: { value: number };
  /** Bind-space height of the waterline, written every frame as -rootOffsetY. */
  poolWaterY: { value: number };
  /** Monotonic seconds, written every frame; phases the breathe. */
  poolTime: { value: number };
  /**
   * Crossfade to the lensed composite on the interior pass, 0 or 1. Derived,
   * not configured: at 0 the material emits `output` unchanged, so a head
   * with no page snapshot bound is bit-identical to the shipped look. It may
   * only open once a real texture is in `lensTexture`.
   */
  lensGate: { value: number };
  /** Mix of the lensed snapshot over the live page behind the head. */
  lensAmount: { value: number };
  /** `screenUV` to snapshot UV: (offsetU, offsetV, scaleU, scaleV). */
  lensWindow: { value: THREE.Vector4 };
  /** Per-axis sample displacement in `screenUV` units, at unit thickness. */
  lensDisplacement: { value: THREE.Vector2 };
  /** The page snapshot itself; a 1x1 placeholder until one is captured. */
  lensTexture: { value: THREE.Texture };
}

export interface BuiltSkinMaterial {
  /** Front-facing surface: the face you read glyphs off. */
  material: THREE.Material;
  /**
   * Back-facing interior wall, drawn before the occlusion mask so the far side
   * of the body shows through the near one. Every uniform node it consumes is
   * the node `material` consumes, so one `applyConfigToBindings` write drives
   * both halves and they can never drift. Front-only terms (rim, specular,
   * silhouette fresnel) have no meaning on an inside face and are absent.
   */
  interior: THREE.Material;
  scroll: ScrollUniform;
  uniforms: HeadUniforms;
}

export interface EyeUniforms {
  scroll: ScrollUniform;
  eyeDensity: { value: number };
  scleraGlow: { value: number };
  irisGlow: { value: number };
  eyePresence: { value: number };
  pupil: { value: number };
  flowDir: { value: number };
  irisSize: { value: number };
  irisColor: { value: THREE.Color };
  scleraColor: { value: THREE.Color };
}

export interface BuiltEyeballMaterial {
  material: THREE.Material;
  uniforms: EyeUniforms;
}

/** Pure frontal planar UV projection from object-space coordinates. */
export function planarUV(x: number, y: number): { u: number; v: number } {
  return { u: x * U_SCALE + 0.5, v: y * V_SCALE };
}

/** Pure row-staggered flow UVs, mirroring the shader's bind-pose mapping. */
export function rowFlowUV(
  x: number,
  y: number,
  scroll: number,
): { u: number; v: number; rowRate: number } {
  const row = Math.floor(y * PLANAR_DENSITY);
  const phase = ((row * 0.618) % 1 + 1) % 1;
  const rowRate = 0.75 + phase * 0.5;
  return {
    u: x * U_SCALE + 0.5 + scroll * rowRate,
    v: y * V_SCALE,
    rowRate,
  };
}

/** Pure squared normal weights used by bind-space triplanar sampling. */
export function triplanarWeights(
  nx: number,
  ny: number,
  nz: number,
): { x: number; y: number; z: number } {
  const x = nx * nx;
  const y = ny * ny;
  const z = nz * nz;
  const sum = x + y + z || 1;
  return { x: x / sum, y: y / sum, z: z / sum };
}

/**
 * Pure projection coordinate blending for triplanar text sampling.
 * Eliminates double letterform cross-fading by interpolating sample coordinates
 * through normal weights rather than alpha-blending separate samples.
 */
export function blendedProjectionUV(
  x: number,
  y: number,
  z: number,
  nx: number,
  ny: number,
  nz: number,
  scroll: number,
  sharp = 5.5,
): { u: number; v: number; samples: number } {
  const ax = Math.abs(nx) ** sharp;
  const ay = Math.abs(ny) ** sharp;
  const az = Math.abs(nz) ** sharp;
  const sum = ax + ay + az || 1;
  const wx = ax / sum;
  const wy = ay / sum;
  const wz = az / sum;

  const px = x * wz + z * wx + x * wy;
  const py = y * (wz + wx) + z * wy;
  const rowY = Math.floor(py * PLANAR_DENSITY);
  const phase = ((rowY * 0.618) % 1 + 1) % 1;
  const rateY = 0.75 + phase * 0.5;

  return {
    u: px * U_SCALE + 0.5 + scroll * rateY,
    v: py * V_SCALE,
    samples: 1,
  };
}

export function normaliseHeadConfig(
  overrides?: HeadConfigOverrides,
  base: HeadConfig = DEFAULT_HEAD_CONFIG,
): HeadConfig {
  if (!overrides) return base;
  const parseColor = (val: string | undefined, fallback: string): string => {
    if (!val || typeof val !== 'string') return fallback;
    const clean = val.trim();
    if (/^#[0-9a-fA-F]{6}$/.test(clean)) return clean.toLowerCase();
    return fallback;
  };
  // Signed values still have to be finite: a NaN strength would reach the
  // sample coordinates and blank the head, silently, on one host's maths bug.
  const finiteOr = (val: number | undefined, fallback: number): number =>
    typeof val === 'number' && Number.isFinite(val) ? val : fallback;

  const config: HeadConfig = {
    skin: {
      opacity: {
        base: clamp01(overrides.skin?.opacity?.base ?? base.skin.opacity.base),
        lips: clamp01(overrides.skin?.opacity?.lips ?? base.skin.opacity.lips),
        nose: clamp01(overrides.skin?.opacity?.nose ?? base.skin.opacity.nose),
        jaw: clamp01(overrides.skin?.opacity?.jaw ?? base.skin.opacity.jaw),
        orbit: clamp01(overrides.skin?.opacity?.orbit ?? base.skin.opacity.orbit),
        brow: clamp01(overrides.skin?.opacity?.brow ?? base.skin.opacity.brow),
        socketMask: clamp01(overrides.skin?.opacity?.socketMask ?? base.skin.opacity.socketMask),
      },
      shading: {
        socketShadow: clamp01(overrides.skin?.shading?.socketShadow ?? base.skin.shading.socketShadow),
        socketSize: Math.max(0.1, overrides.skin?.shading?.socketSize ?? base.skin.shading.socketSize),
        cavity: clamp01(overrides.skin?.shading?.cavity ?? base.skin.shading.cavity),
        lipDark: clamp01(overrides.skin?.shading?.lipDark ?? base.skin.shading.lipDark),
        lipHue: clamp01(overrides.skin?.shading?.lipHue ?? base.skin.shading.lipHue),
        lipGate: Math.max(1, overrides.skin?.shading?.lipGate ?? base.skin.shading.lipGate),
        eyelid: clamp01(overrides.skin?.shading?.eyelid ?? base.skin.shading.eyelid),
        brow: clamp01(overrides.skin?.shading?.brow ?? base.skin.shading.brow),
        browGate: Math.max(1, overrides.skin?.shading?.browGate ?? base.skin.shading.browGate),
      },
      glyph: {
        scale: Math.max(0.1, overrides.skin?.glyph?.scale ?? base.skin.glyph.scale),
        horizontalDensity: Math.max(0.1, overrides.skin?.glyph?.horizontalDensity ?? base.skin.glyph.horizontalDensity),
        verticalDensity: Math.max(0.1, overrides.skin?.glyph?.verticalDensity ?? base.skin.glyph.verticalDensity),
        sharpness: Math.max(1, overrides.skin?.glyph?.sharpness ?? base.skin.glyph.sharpness),
      },
      tone: {
        balance: clamp01(overrides.skin?.tone?.balance ?? base.skin.tone.balance),
        amount: clamp01(overrides.skin?.tone?.amount ?? base.skin.tone.amount),
        skinWarmth: clamp01(overrides.skin?.tone?.skinWarmth ?? base.skin.tone.skinWarmth),
        rim: clamp01(overrides.skin?.tone?.rim ?? base.skin.tone.rim),
        glowGain: Math.max(0, overrides.skin?.tone?.glowGain ?? base.skin.tone.glowGain),
      },
      glass: {
        amount: clamp01(overrides.skin?.glass?.amount ?? base.skin.glass.amount),
        fresnel: clamp01(overrides.skin?.glass?.fresnel ?? base.skin.glass.fresnel),
        fresnelPower: Math.max(1, overrides.skin?.glass?.fresnelPower ?? base.skin.glass.fresnelPower),
        specular: Math.max(0, overrides.skin?.glass?.specular ?? base.skin.glass.specular),
        sheen: Math.max(1, overrides.skin?.glass?.sheen ?? base.skin.glass.sheen),
        refraction: Math.max(0, overrides.skin?.glass?.refraction ?? base.skin.glass.refraction),
        tint: parseColor(overrides.skin?.glass?.tint, base.skin.glass.tint),
      },
      backdrop: {
        color: parseColor(overrides.skin?.backdrop?.color, base.skin.backdrop.color),
        adapt: clamp01(overrides.skin?.backdrop?.adapt ?? base.skin.backdrop.adapt),
        auto: overrides.skin?.backdrop?.auto ?? base.skin.backdrop.auto,
      },
    },
    eyes: {
      density: Math.max(10, overrides.eyes?.density ?? base.eyes.density),
      scleraGlow: Math.max(0, overrides.eyes?.scleraGlow ?? base.eyes.scleraGlow),
      irisGlow: Math.max(0, overrides.eyes?.irisGlow ?? base.eyes.irisGlow),
      presence: clamp01(overrides.eyes?.presence ?? base.eyes.presence),
      pupil: clamp01(overrides.eyes?.pupil ?? base.eyes.pupil),
      flowDirection: overrides.eyes?.flowDirection ?? base.eyes.flowDirection,
      irisSize: Math.max(0.1, overrides.eyes?.irisSize ?? base.eyes.irisSize),
      irisColor: parseColor(overrides.eyes?.irisColor, base.eyes.irisColor),
      scleraColor: parseColor(overrides.eyes?.scleraColor, base.eyes.scleraColor),
    },
    pool: {
      amount: clamp01(overrides.pool?.amount ?? base.pool.amount),
      bias: Math.max(0, overrides.pool?.bias ?? base.pool.bias),
      ripple: Math.max(0, overrides.pool?.ripple ?? base.pool.ripple),
      meniscus: clamp01(overrides.pool?.meniscus ?? base.pool.meniscus),
      contact: clamp01(overrides.pool?.contact ?? base.pool.contact),
      breathe: Math.max(0, overrides.pool?.breathe ?? base.pool.breathe),
      fade: Math.max(0, overrides.pool?.fade ?? base.pool.fade),
      tint: parseColor(overrides.pool?.tint, base.pool.tint),
    },
    interior: {
      // Integral, and capped: the sort and the buffer writes are linear in
      // this, and the field stops reading as text in glass long before the
      // cap is anywhere near.
      count: Math.min(
        INTERIOR_GLYPH_MAX,
        Math.max(0, Math.floor(finiteOr(overrides.interior?.count, base.interior.count))),
      ),
      // `finiteOr` throughout, not a bare `??`. `Math.max(0, NaN)` is NaN and
      // `clamp01(NaN)` is NaN, and a NaN inertia poisons the integrator's
      // world positions permanently: the field never recovers, not even from
      // a later good config, because the spring reads its own last position.
      size: Math.max(0, finiteOr(overrides.interior?.size, base.interior.size)),
      drift: Math.max(0, finiteOr(overrides.interior?.drift, base.interior.drift)),
      inertia: clamp01(finiteOr(overrides.interior?.inertia, base.interior.inertia)),
      depthFade: clamp01(finiteOr(overrides.interior?.depthFade, base.interior.depthFade)),
      // Clamped rather than merely defaulted: the contract says an interior
      // glyph never outshines the surface text, and a host writing 4 here
      // would otherwise break it silently.
      brightness: clamp01(finiteOr(overrides.interior?.brightness, base.interior.brightness)),
      tint: parseColor(overrides.interior?.tint, base.interior.tint),
    },
    lens: {
      amount: clamp01(overrides.lens?.amount ?? base.lens.amount),
      // Signed on purpose: the sign decides whether the head reads as a
      // converging or a diverging lens, and both are legitimate looks.
      strength: finiteOr(overrides.lens?.strength, base.lens.strength),
      recaptureMs: Math.max(0, overrides.lens?.recaptureMs ?? base.lens.recaptureMs),
    },
  };
  Object.freeze(config.skin.opacity);
  Object.freeze(config.skin.shading);
  Object.freeze(config.skin.glyph);
  Object.freeze(config.skin.tone);
  Object.freeze(config.skin.glass);
  Object.freeze(config.skin.backdrop);
  Object.freeze(config.skin);
  Object.freeze(config.eyes);
  Object.freeze(config.pool);
  Object.freeze(config.interior);
  Object.freeze(config.lens);
  return Object.freeze(config);
}

function prepTexture(tex: THREE.CanvasTexture): void {
  tex.wrapS = RepeatWrapping;
  tex.wrapT = RepeatWrapping;
  tex.generateMipmaps = false;
  tex.minFilter = LinearFilter;
  tex.magFilter = LinearFilter;
  tex.anisotropy = Math.max(tex.anisotropy, 4);
}

/**
 * Shared 1x1 opaque black stand-in for a page snapshot nobody has captured.
 *
 * The lens node is built into every skin material so there is one graph
 * rather than two, and `lensGate` is what keeps it inert; a sampler still
 * needs something bound, and one texel is the cheapest thing that is never
 * read while the gate is shut. It is also what a cleared lens rebinds to:
 * leaving a disposed snapshot in the sampler would retain the whole rasterised
 * canvas and make three re-upload it from `image` on the next frame.
 *
 * Deliberately never disposed: it is four bytes, immutable, and shared by
 * every engine in the page, so an owner would have to be refcounted to buy
 * nothing.
 */
let lensPlaceholder: THREE.DataTexture | null = null;
export function lensPlaceholderTexture(): THREE.DataTexture {
  if (!lensPlaceholder) {
    lensPlaceholder = new DataTexture(new Uint8Array([0, 0, 0, 255]), 1, 1);
    lensPlaceholder.needsUpdate = true;
  }
  return lensPlaceholder;
}

export function buildSkinMaterial(
  skin: TextSkinEngine,
  config: HeadConfig = DEFAULT_HEAD_CONFIG,
): BuiltSkinMaterial {
  const material = new MeshStandardNodeMaterial();
  material.metalness = 0;
  material.roughness = 0.4;
  material.transparent = true;
  material.depthTest = true;
  material.depthWrite = true;
  material.side = FrontSide;

  // Interior wall. Never writes depth: it sits behind everything the occlusion
  // mask then hides, and must not stop the eyeballs or the mouth cavity from
  // resolving against the front surface.
  const interior = new MeshStandardNodeMaterial();
  interior.metalness = 0;
  interior.roughness = 0.4;
  interior.transparent = true;
  interior.depthTest = true;
  interior.depthWrite = false;
  interior.side = BackSide;

  prepTexture(skin.texture);

  const uScroll = uniform(0);
  const uBaseOpacity = uniform(config.skin.opacity.base);
  const uLipsOp = uniform(config.skin.opacity.lips);
  const uNoseOp = uniform(config.skin.opacity.nose);
  const uJawOp = uniform(config.skin.opacity.jaw);
  const uOrbitOp = uniform(config.skin.opacity.orbit);
  const uBrowOp = uniform(config.skin.opacity.brow);
  const uSocketMask = uniform(config.skin.opacity.socketMask);

  const uSocketShadow = uniform(config.skin.shading.socketShadow);
  const uSocketSize = uniform(config.skin.shading.socketSize);
  const uCavity = uniform(config.skin.shading.cavity);
  const uLipDark = uniform(config.skin.shading.lipDark);
  const uLipHue = uniform(config.skin.shading.lipHue);
  const uLipGate = uniform(config.skin.shading.lipGate);
  const uEyelid = uniform(config.skin.shading.eyelid);
  const uBrow = uniform(config.skin.shading.brow);
  const uBrowGate = uniform(config.skin.shading.browGate);

  const uGlyphScale = uniform(config.skin.glyph.scale);
  const uHDensity = uniform(config.skin.glyph.horizontalDensity);
  const uVDensity = uniform(config.skin.glyph.verticalDensity);
  const uSharp = uniform(config.skin.glyph.sharpness);

  const uTone = uniform(config.skin.tone.balance);
  const uToneAmt = uniform(config.skin.tone.amount);
  const uSkinWarm = uniform(config.skin.tone.skinWarmth);
  const uRim = uniform(config.skin.tone.rim);
  const uGlowGain = uniform(config.skin.tone.glowGain);

  const uGlassAmount = uniform(config.skin.glass.amount);
  const uFresnel = uniform(config.skin.glass.fresnel);
  const uFresnelPow = uniform(config.skin.glass.fresnelPower);
  const uSpecular = uniform(config.skin.glass.specular);
  const uSheen = uniform(config.skin.glass.sheen);
  const uRefraction = uniform(config.skin.glass.refraction);
  const uGlassTint = uniform(new Color(config.skin.glass.tint));

  const adaptation = adaptToBackdrop(config.skin.backdrop.color, config.skin.backdrop.adapt);
  const uInkMix = uniform(adaptation.inkMix);
  const uInkColor = uniform(
    new Color(adaptation.inkColor[0], adaptation.inkColor[1], adaptation.inkColor[2]),
  );
  const uGlowScale = uniform(adaptation.glowScale);
  const uOpacityFloor = uniform(adaptation.opacityFloor);
  const uRimColor = uniform(
    new Color(adaptation.rimColor[0], adaptation.rimColor[1], adaptation.rimColor[2]),
  );

  const uPoolAmount = uniform(config.pool.amount);
  const uPoolBreathe = uniform(config.pool.breathe);
  const uPoolNormalGate = uniform(config.pool.breathe > 0 ? clamp01(config.pool.amount) : 0);
  const uPoolFade = uniform(config.pool.fade);
  const uPoolWaterY = uniform(0);
  const uPoolTime = uniform(0);

  // Snapshot lens (dec.liquid-glass-architecture, rung 3, item 4). The gate
  // opens only once the engine binds a real texture, so a head with nothing
  // named to refract never evaluates the composite below.
  const uLensGate = uniform(0);
  const uLensAmount = uniform(config.lens.amount);
  const uLensWindow = uniform(new Vector4(0, 1, 1, -1));
  const uLensDisplacement = uniform(new Vector2(0, 0));
  const lensSnapshot = texture(lensPlaceholderTexture());

  const uniforms: HeadUniforms = {
    scroll: uScroll as unknown as ScrollUniform,
    baseOpacity: uBaseOpacity as unknown as { value: number },
    lipsOp: uLipsOp as unknown as { value: number },
    noseOp: uNoseOp as unknown as { value: number },
    jawOp: uJawOp as unknown as { value: number },
    orbitOp: uOrbitOp as unknown as { value: number },
    browOp: uBrowOp as unknown as { value: number },
    socketShadow: uSocketShadow as unknown as { value: number },
    socketMask: uSocketMask as unknown as { value: number },
    socketSize: uSocketSize as unknown as { value: number },
    cavity: uCavity as unknown as { value: number },
    lipDark: uLipDark as unknown as { value: number },
    lipHue: uLipHue as unknown as { value: number },
    lipGate: uLipGate as unknown as { value: number },
    eyelid: uEyelid as unknown as { value: number },
    brow: uBrow as unknown as { value: number },
    browGate: uBrowGate as unknown as { value: number },
    glyphScale: uGlyphScale as unknown as { value: number },
    hDensity: uHDensity as unknown as { value: number },
    vDensity: uVDensity as unknown as { value: number },
    sharp: uSharp as unknown as { value: number },
    tone: uTone as unknown as { value: number },
    toneAmt: uToneAmt as unknown as { value: number },
    skinWarm: uSkinWarm as unknown as { value: number },
    rim: uRim as unknown as { value: number },
    glowGain: uGlowGain as unknown as { value: number },
    glassAmount: uGlassAmount as unknown as { value: number },
    fresnel: uFresnel as unknown as { value: number },
    fresnelPow: uFresnelPow as unknown as { value: number },
    specular: uSpecular as unknown as { value: number },
    sheen: uSheen as unknown as { value: number },
    refraction: uRefraction as unknown as { value: number },
    glassTint: uGlassTint as unknown as { value: THREE.Color },
    inkMix: uInkMix as unknown as { value: number },
    inkColor: uInkColor as unknown as { value: THREE.Color },
    glowScale: uGlowScale as unknown as { value: number },
    opacityFloor: uOpacityFloor as unknown as { value: number },
    rimColor: uRimColor as unknown as { value: THREE.Color },
    poolAmount: uPoolAmount as unknown as { value: number },
    poolBreathe: uPoolBreathe as unknown as { value: number },
    poolNormalGate: uPoolNormalGate as unknown as { value: number },
    poolFade: uPoolFade as unknown as { value: number },
    poolWaterY: uPoolWaterY as unknown as { value: number },
    poolTime: uPoolTime as unknown as { value: number },
    lensGate: uLensGate as unknown as { value: number },
    lensAmount: uLensAmount as unknown as { value: number },
    lensWindow: uLensWindow as unknown as { value: THREE.Vector4 },
    lensDisplacement: uLensDisplacement as unknown as { value: THREE.Vector2 },
    lensTexture: lensSnapshot as unknown as { value: THREE.Texture },
  };

  const aLips = attribute('aLips', 'float');
  const aJaw = attribute('aJaw', 'float');
  const aEyelid = attribute('aEyelid', 'float');
  const aBrow = attribute('aBrow', 'float');
  const aCavity = attribute('aCavity', 'float');
  const aNose = attribute('aNose', 'float');
  const aSocket = attribute('aSocket', 'float');
  const aThickness = attribute('aThickness', 'float');

  // ---------------------------------------------------------------------
  // Tier 1 breathe (dec.liquid-glass-architecture, item 3, work item 4).
  //
  // `NodeMaterial.setupPosition` runs morph targets, then skinning, then
  // assigns `positionNode` over `positionLocal`. So the offset MUST be built
  // as `positionLocal.add(...)` and MUST take its direction from
  // `normalLocal`: reading `positionGeometry` or `normalGeometry` here would
  // silently discard every viseme morph and all bone skinning.
  //
  // `normalLocal` is used unnormalised in the DISPLACEMENT on purpose: a
  // degenerate normal normalises to NaN, `0 * NaN` is NaN, and normalising
  // here would let one bad triangle destroy the mesh at `pool.amount = 0`.
  // glTF normals are unit length and the amplitude is millimetric, so the
  // length error is noise. The shading normal below does normalise, because
  // `transformNormalToView` has no choice, but it does so on a vector that is
  // `normalLocal` plus a tiny perturbation rather than on the perturbation.
  const breatheAbove = positionLocal.y.sub(uPoolWaterY).max(0);
  const breatheWeight = exp(breatheAbove.div(-BREATHE_FALLOFF));
  const breathePhaseX = positionLocal.x.mul(BREATHE_KX).add(uPoolTime.mul(BREATHE_OMEGA));
  const breathePhaseZ = positionLocal.z.mul(BREATHE_KZ).add(uPoolTime.mul(BREATHE_OMEGA * 0.7));
  const breatheSinX = sin(breathePhaseX);
  const breatheSinZ = sin(breathePhaseZ);
  // Mapped to [0,1], so the displacement is outward only. That is load
  // bearing: the occlusion mask at renderOrder 0 keeps bounding the internals
  // only while the shell never intrudes past it.
  const breatheShape = breatheSinX.mul(breatheSinZ).mul(0.5).add(0.5);
  const breatheAmp = uPoolBreathe.mul(uPoolAmount);
  const breatheOffset = breatheAmp.mul(breatheWeight).mul(breatheShape);
  const breathePosition = positionLocal.add(normalLocal.mul(breatheOffset));

  // Analytic gradient of the same field, so the shading normal follows the
  // deformation instead of reading as texture swim
  // (dec.liquid-glass-architecture, Consequences).
  const breatheWeightSlope = breatheWeight
    .div(-BREATHE_FALLOFF)
    .mul(smoothstep(0, 1e-4, breatheAbove));
  const breatheShapeDx = cos(breathePhaseX).mul(BREATHE_KX).mul(breatheSinZ).mul(0.5);
  const breatheShapeDz = breatheSinX.mul(cos(breathePhaseZ).mul(BREATHE_KZ)).mul(0.5);
  const breatheGradient = vec3(
    breatheWeight.mul(breatheShapeDx),
    breatheWeightSlope.mul(breatheShape),
    breatheWeight.mul(breatheShapeDz),
  ).mul(breatheAmp);
  // Perturb in LOCAL space, then transform once. Two traps live here, and
  // both cost the whole head when they fire.
  //
  // `transformNormalToView` ends in `transformDirection`, which normalises.
  // Feeding it the perturbation on its own means feeding it the exact zero
  // vector whenever the gradient is zero, which is every fragment at
  // `pool.amount = 0`, and `normalize(vec3(0))` is NaN. That NaN reaches the
  // fresnel, the fresnel reaches the alpha, and the silhouette collapses from
  // 50311 pixels to 3452 in the visual eval. Subtracting inside a vector that
  // is already unit length keeps the argument finite.
  //
  // And the side flip is three's `directionToFaceDirection`, which reads
  // `material.side`: identity on `FrontSide`, negated on `BackSide`. It is not
  // re-exported from `three/tsl`, and the per-fragment `faceDirection` sign is
  // not the same thing, so the two sides get their own node below. Get this
  // wrong and the interior wall shades against a normal pointing outward.
  const breatheTangential = breatheGradient.sub(normalLocal.mul(dot(breatheGradient, normalLocal)));
  const breatheNormalLocal = normalLocal.sub(breatheTangential);
  const breatheNormalViewRaw = transformNormalToView(breatheNormalLocal);
  // At gate 0 the second operand is exactly how three builds `normalView`
  // itself, and `mix(a, b, 0)` is `a` bit for bit, so the shipped shading
  // chain is reproduced rather than approximated. `normalView` inside each
  // material's own normal sub-build already carries that material's side
  // flip, so the two operands are always like for like.
  const breatheNormalFront = mix(normalView, breatheNormalViewRaw, uPoolNormalGate);
  const breatheNormalInterior = mix(normalView, breatheNormalViewRaw.negate(), uPoolNormalGate);

  // Waterline fade (work item 5). The clip plane cuts the body at world Y 0
  // and the shell is hollow, so the cut exposes the interior wall. Fading the
  // glass terms out over a band above the waterline is what stops the cross
  // section reading as an empty shell. `mix(1, fade, 0)` is exactly 1, so this
  // is inert at `pool.amount = 0`.
  const waterFade = smoothstep(0, uPoolFade.max(1e-4), positionWorld.y);
  const waterFadeMix = mix(float(1), waterFade, uPoolAmount);

  const densU = float(PLANAR_DENSITY / GRID_COLS).mul(uHDensity).div(uGlyphScale);
  const densV = float(PLANAR_DENSITY / GRID_ROWS).mul(uVDensity).div(uGlyphScale);

  // Glass response: one fresnel term drives the refraction offset, the edge
  // opacity, and the rim. `positionViewDirection` points at the eye, so the
  // dot falls to zero exactly where the surface turns away (dec.glass-backdrop-adaptive).
  const fresnel = pow(saturate(float(1).sub(dot(normalView, positionViewDirection))), uFresnelPow);
  const glassFresnel = fresnel.mul(uGlassAmount);

  const bindNormal = normalGeometry.normalize();
  const axisW = pow(bindNormal.abs(), uSharp);
  const weights = axisW.div(axisW.dot(vec3(1)));
  const px = positionGeometry.x.mul(weights.z).add(positionGeometry.z.mul(weights.x)).add(positionGeometry.x.mul(weights.y));
  const py = positionGeometry.y.mul(weights.z.add(weights.x)).add(positionGeometry.z.mul(weights.y));
  // The glyph grid stays welded to the bind pose where the surface faces the
  // camera; only the grazing band shifts, which is where a glass shell would
  // actually bend what is behind it. Row staggering keeps the unrefracted row
  // so the flow rate never steps as the head turns.
  const refractOffset = normalView.xy.mul(uRefraction).mul(glassFresnel);
  const rowY = floor(py.mul(PLANAR_DENSITY));
  const rateY = float(0.75).add(fract(rowY.mul(0.618)).mul(0.5));
  const sampled = texture(
    skin.texture,
    vec2(
      px.add(refractOffset.x).mul(densU).add(0.5).add(uScroll.mul(rateY)),
      py.add(refractOffset.y).mul(densV),
    ),
  );

  const keyDir = vec3(1.2, 1.6, 2.0).normalize();
  const fillDir = vec3(-1.5, 0.4, 1.0).normalize();
  const shadeBase = saturate(dot(normalWorld, keyDir)).mul(SHADE_KEY_WEIGHT)
    .add(saturate(dot(normalWorld, fillDir)).mul(SHADE_FILL_WEIGHT))
    .add(SHADE_AMBIENT)
    .clamp(SHADE_FLOOR, 1);

  const lipM = pow(aLips, uLipGate);
  const browM = pow(aBrow, uBrowGate);
  const socket = saturate(pow(aSocket, float(1).div(uSocketSize)));

  const shade = shadeBase
    .mul(float(1).sub(aCavity.mul(uCavity)))
    .mul(float(1).sub(socket.mul(uSocketShadow)))
    .mul(float(1).sub(lipM.mul(uLipDark)))
    .mul(float(1).sub(aEyelid.mul(uEyelid)))
    .mul(float(1).sub(browM.mul(uBrow)))
    .clamp(0.03, 1);

  const luma = luminance(sampled.rgb);
  const toneCol = mix(vec3(0.62, 0.90, 1.0), vec3(1.0, 0.82, 0.5), uTone);
  const toned = mix(sampled.rgb, toneCol.mul(luma), uToneAmt);
  const skinCol = vec3(1.0, 0.76, 0.62);
  const warmed = mix(toned, skinCol.mul(luma), uSkinWarm.mul(shadeBase));
  const lipCol = vec3(1.0, 0.42, 0.38);
  const glyph = mix(warmed, lipCol.mul(luma), lipM.mul(uLipHue));
  // On a bright host page the emissive look has nothing to glow against, so
  // the glyph colour crosses over to a dark ink derived from the page itself.
  const inked = mix(glyph, uInkColor, uInkMix);

  const zoneBoost = lipM.mul(uLipsOp)
    .add(aNose.mul(uNoseOp))
    .add(aJaw.mul(uJawOp))
    .add(aEyelid.mul(uOrbitOp))
    .add(browM.mul(uBrowOp));
  // Beer-Lambert: thicker body transmits less of the page behind it, so the
  // cranium reads as a block while the nose and chin stay clear.
  const bodyOpacity = float(1)
    .sub(exp(aThickness.mul(GLASS_ABSORPTION).negate()))
    .mul(uGlassAmount);
  // The pre-glass alpha, kept in exactly the order and shape it had before
  // this change so the GPU evaluates the same instruction sequence and
  // `glass.amount = 0` reproduces the approved look bit for bit.
  const baseAlpha = luma.mul(float(1).sub(uBaseOpacity)).add(uBaseOpacity)
    .add(zoneBoost)
    .add(socket.mul(uSocketMask));
  // What the body newly hides, as a share of the pixel. The front glyphs keep
  // their own alpha; this is the extra coverage the thickness buys. The
  // saturate is what stops the additive zone boosts driving it negative.
  const bodyShare = bodyOpacity.mul(float(1).sub(baseAlpha.saturate()));
  const totalAlpha = baseAlpha
    // Glass thickens towards the silhouette, which also stops the back of the
    // head reading through at grazing angles. The waterline fade rides on the
    // glass terms only: the base glyph alpha is left alone so the face does
    // not dissolve, only the shell's own volume does.
    .add(glassFresnel.mul(uFresnel).mul(waterFadeMix))
    // Mid-tone pages give neither glow nor ink much contrast; lift the floor.
    .add(uOpacityFloor)
    .add(bodyShare.mul(waterFadeMix))
    .clamp(0, 1);
  material.opacityNode = totalAlpha;
  material.positionNode = breathePosition;
  material.normalNode = breatheNormalFront;

  // Blinn highlight against the scene key light, in world space so it tracks
  // both the head pose and the camera.
  const viewDirWorld = cameraPosition.sub(positionWorld).normalize();
  const specular = pow(saturate(dot(normalWorld, keyDir.add(viewDirWorld).normalize())), uSheen)
    .mul(uSpecular)
    .mul(uGlassAmount);

  material.colorNode = inked.mul(shade);
  material.emissiveNode = inked.mul(uGlowGain).mul(uGlowScale).mul(shade)
    .add(uRimColor.mul(fresnel.mul(uRim)))
    .add(uGlassTint.mul(specular).mul(uGlowScale));

  // Interior wall: the same glyph surface seen from inside, dimmed and pushed
  // through the body's own absorption so the far side reads as depth rather
  // than as a second face. Every node it consumes is the node the front
  // material consumes, so the two halves track one set of uniforms with no
  // fan-out in `applyConfigToBindings`. The front-only terms (rim, specular,
  // silhouette fresnel, opacity floor) have no meaning on an inside face and
  // are deliberately absent.
  const transmitted = exp(
    vec3(1).sub(uGlassTint).mul(GLASS_ABSORPTION).mul(aThickness).negate(),
  );
  const interiorTint = inked.mul(shade).mul(transmitted).mul(INTERIOR_DIM);
  interior.colorNode = interiorTint;
  interior.emissiveNode = interiorTint.mul(uGlowGain).mul(uGlowScale);
  interior.opacityNode = baseAlpha
    .saturate()
    .mul(INTERIOR_OPACITY)
    .mul(uGlassAmount)
    .mul(waterFadeMix)
    .clamp(0, 1);
  // The interior rides the same displacement as the front, or the two halves
  // of one body separate at the seam.
  interior.positionNode = breathePosition;
  interior.normalNode = breatheNormalInterior;

  // ---------------------------------------------------------------------
  // Snapshot lens (dec.liquid-glass-architecture, rung 3, item 4).
  //
  // The substitution has to happen on the DEEPEST pass, and that is the
  // interior wall. What the head shows of the page is
  // `front * a + dst * (1 - a)`, where `dst` is whatever was already in the
  // framebuffer; a fragment can only replace its own destination, never reach
  // into one another layer already blended. Doing this on the front surface
  // would substitute the interior wall along with the page and delete the far
  // side of the head at full strength. Doing it here leaves the front glass
  // composite untouched and puts the refracted page exactly where the page
  // was.
  //
  // The exchange, with `a` the interior's own alpha, `w` the lens amount and
  // `L` the sampled snapshot: emit `rgb' = (C*a + L*(1-a)*w) / a'` at
  // `a' = a + (1-a)*w`. Source-alpha blending then produces
  // `C*a + L*(1-a)*w + page*(1-a)*(1-w)`, which is the page crossfading into
  // its lensed copy with the wall's own colour untouched at either end.
  //
  // The offset is `normal.xy * thickness`, not a fresnel band: a slab of
  // thickness t bends what is behind it by about `n.xy * t * (1 - 1/ior)`, so
  // the cranium displaces several times what the nose tip does, which is the
  // whole reason the head reads as a solid block of glass rather than a
  // decal. `breatheNormalInterior` is already the side-flipped view normal
  // this pass shades with, so the lens follows the pool breathe for free.
  const lensShift = breatheNormalInterior.xy.mul(aThickness).mul(uLensDisplacement);
  const lensUv = screenUV.add(lensShift).mul(uLensWindow.zw).add(uLensWindow.xy);
  const lensColor = lensSnapshot.sample(lensUv);
  // Mixed in the linear working space, like every other blend in the scene.
  //
  // This is NOT identical to the page it replaces, and the difference is
  // inherent rather than a bug to chase. The live page never enters the
  // canvas: three renders the scene into a linear target, an output pass
  // encodes it, and the BROWSER COMPOSITOR then adds `page * (1 - A)` to the
  // encoded, premultiplied result. Folding the snapshot in here computes
  // `encode(C*a + L*(1-a))` where the compositor computes
  // `encode(C*a) + encode(L)*(1-a)`, and `encode(x*a)` is not `encode(x)*a`.
  // No formulation inside the scene can reproduce that, because the front
  // pass's own alpha is not known here and the encode sits between them. An
  // sRGB round trip on both operands was built and measured: it moved the
  // residual from 42.7k to 45.3k pixels, so it bought nothing and cost two
  // transfer functions per fragment. The consequence is stated in the API
  // docs and measured by `tools/smoke/lens-shot.mjs`: switching the lens on
  // also moves the head-over-page blend from the compositor's encoded space
  // into the scene's linear one, which is the more correct of the two.
  const lensBase = output.a;
  const lensAlpha = lensBase.add(float(1).sub(lensBase).mul(uLensAmount));
  const lensRgb = output.rgb
    .mul(lensBase)
    .add(lensColor.rgb.mul(float(1).sub(lensBase)).mul(uLensAmount))
    // Bounded, not merely non-zero: with the gate open the denominator is at
    // least `min(w, 1)`, and the numerator carries the same `w`, so the
    // quotient never exceeds the brighter of the wall and the snapshot.
    .div(lensAlpha.max(1e-4));
  // `mix(x, y, 0)` is `x * 1 + y * 0`, which is `x` bit for bit, so a closed
  // gate reproduces `output` exactly rather than approximately. It is derived
  // from whether a texture is bound, never from `lens.amount`: at amount 0
  // with the gate open the quotient is only mathematically an identity.
  interior.outputNode = vec4(
    mix(output.rgb, lensRgb, uLensGate),
    mix(lensBase, lensAlpha, uLensGate),
  );

  return {
    material: material as unknown as THREE.Material,
    interior: interior as unknown as THREE.Material,
    scroll: uScroll as unknown as ScrollUniform,
    uniforms,
  };
}

export function buildEyeballMaterial(
  eyeSkin: TextSkinEngine,
  c: { cx: number; cy: number; cz: number },
  config: HeadConfig = DEFAULT_HEAD_CONFIG,
): BuiltEyeballMaterial {
  const material = new MeshBasicNodeMaterial();
  material.name = 'eye_sclera';
  (material as unknown as Record<string, unknown>).isEyeball = true;
  material.transparent = false;
  material.depthTest = true;
  material.depthWrite = true;
  prepTexture(eyeSkin.texture);

  const uScroll = uniform(0);
  const uEyeDensity = uniform(config.eyes.density);
  const uScleraGlow = uniform(config.eyes.scleraGlow);
  const uIrisGlow = uniform(config.eyes.irisGlow);
  const uEyePresence = uniform(config.eyes.presence);
  const uPupil = uniform(config.eyes.pupil);
  const uFlowDir = uniform(config.eyes.flowDirection);
  const uIrisSize = uniform(config.eyes.irisSize);
  const uIrisColor = uniform(new Color(config.eyes.irisColor));
  const uScleraColor = uniform(new Color(config.eyes.scleraColor));

  const uniforms: EyeUniforms = {
    scroll: uScroll as unknown as ScrollUniform,
    eyeDensity: uEyeDensity as unknown as { value: number },
    scleraGlow: uScleraGlow as unknown as { value: number },
    irisGlow: uIrisGlow as unknown as { value: number },
    eyePresence: uEyePresence as unknown as { value: number },
    pupil: uPupil as unknown as { value: number },
    flowDir: uFlowDir as unknown as { value: number },
    irisSize: uIrisSize as unknown as { value: number },
    irisColor: uIrisColor as unknown as { value: THREE.Color },
    scleraColor: uScleraColor as unknown as { value: THREE.Color },
  };

  const px = positionGeometry.x.abs().sub(c.cx);
  const py = positionGeometry.y.sub(c.cy);
  const pz = positionGeometry.z.sub(c.cz);
  const len = px.mul(px).add(py.mul(py)).add(pz.mul(pz)).sqrt();
  const ang = acos(saturate(pz.div(len)));
  const r = ang.div(uIrisSize);
  const theta = atan(py, px);

  const WEDGES = 10;
  const RINGS = 3.0;
  const u = theta.div(Math.PI * 2).mul(WEDGES);
  const v = r.mul(RINGS).sub(uScroll.mul(uFlowDir).mul(3.0));
  const ringText = luminance(texture(eyeSkin.texture, vec2(u, v)).rgb);

  const voidFade = smoothstep(uPupil, uPupil.add(0.28), r);
  const outerEdge = float(1).sub(smoothstep(0.955, 1.0, r));
  const iris = uIrisColor.mul(ringText).mul(uIrisGlow).mul(voidFade).mul(outerEdge);

  const densU = uEyeDensity.div(GRID_COLS);
  const densV = uEyeDensity.div(GRID_ROWS);
  const bindNormal = normalGeometry.normalize();
  const axisW = pow(bindNormal.abs(), float(5.5));
  const weights = axisW.div(axisW.dot(vec3(1)));
  const projectedX = positionGeometry.x.mul(weights.z)
    .add(positionGeometry.z.mul(weights.x))
    .add(positionGeometry.x.mul(weights.y));
  const projectedY = positionGeometry.y.mul(weights.z.add(weights.x))
    .add(positionGeometry.z.mul(weights.y));
  const projectedRow = floor(projectedY.mul(PLANAR_DENSITY));
  const projectedRate = float(0.75).add(fract(projectedRow.mul(0.618)).mul(0.5));
  const scleraSample = texture(
    eyeSkin.texture,
    vec2(
      projectedX.mul(densU).add(0.5).add(uScroll.mul(0.4).mul(projectedRate)),
      projectedY.mul(densV),
    ),
  );
  const scleraText = luminance(scleraSample.rgb);

  const scleraLit = uScleraColor.mul(scleraText.mul(uScleraGlow).add(0.012));
  const outsideIris = smoothstep(0.97, 1.02, r);
  const sclera = scleraLit.mul(outsideIris);

  material.colorNode = iris.add(sclera).mul(uEyePresence).add(vec3(0.004, 0.005, 0.008));

  return {
    material: material as unknown as THREE.Material,
    uniforms,
  };
}
