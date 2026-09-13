import {
  Mesh, OrthographicCamera, PlaneGeometry, RenderTarget, RGBAFormat,
  Scene, UnsignedByteType,
} from 'three';
import { NodeMaterial, WebGPURenderer } from 'three/webgpu';
import { vec3 } from 'three/tsl';
import { LiquidMaterialOwner } from '../src/shaders/liquid-material';
import { buildMouthMaterial } from '../src/shaders/mouth-material';

interface Coverage {
  amount: number;
  mouth: number;
  background: number;
}

/** Count foreground coverage and the backing revealed through discarded depth. */
function coverage(bytes: ArrayLike<number>, amount: number): Coverage {
  let mouth = 0;
  let background = 0;
  const pixels = bytes.length / 4;
  for (let i = 0; i < bytes.length; i += 4) {
    const r = bytes[i] ?? 0;
    const g = bytes[i + 1] ?? 0;
    const b = bytes[i + 2] ?? 0;
    if (r > 247 && g > 247 && b > 247) mouth++;
    if (r < 8 && g < 8 && b > 247) background++;
  }
  return { amount, mouth: mouth / pixels, background: background / pixels };
}

/**
 * Isolated GPU regression for the real mouth material's opaque fade contract.
 * White foreground and blue backing separate discarded coverage from colour
 * darkening. Only fixture colour/geometry are replaced; production blending,
 * opacity, alpha test, alpha hash and depth-writing behaviour are retained.
 * This is not a replacement head or an independent avatar animation clock.
 */
export async function probeLiquidMouthFade(): Promise<{
  backend: string;
  phases: Coverage[];
  opaqueControl: Coverage;
  offPixelDifferences: number;
}> {
  const owner = new LiquidMaterialOwner();
  const source = new NodeMaterial();
  const mouth = buildMouthMaterial(source) as NodeMaterial;
  owner.gateInterior(mouth);
  mouth.colorNode = vec3(1);
  mouth.positionNode = null;
  mouth.normalNode = null;
  const backing = new NodeMaterial();
  backing.colorNode = vec3(0, 0, 1);
  const geometry = new PlaneGeometry(2, 2);
  const foreground = new Mesh(geometry, mouth);
  const background = new Mesh(geometry, backing);
  background.position.z = -0.1;
  // Draw backing after the mouth, proving discarded fragments do not write
  // depth and revealing the actual opaque occlusion defect without the fix.
  background.renderOrder = 1;
  const scene = new Scene();
  scene.add(foreground, background);
  const camera = new OrthographicCamera(-1, 1, 1, -1, 0.1, 10);
  camera.position.z = 2;
  const renderer = new WebGPURenderer({ forceWebGL: true, antialias: false });
  const target = new RenderTarget(64, 64, { type: UnsignedByteType, format: RGBAFormat });
  // The fixture poses the production gate's uniform directly. It never
  // changes the real avatar, its solver placement or its owning VFX loop.
  const amount = (owner as unknown as { amount: { value: number } }).amount;

  /** Read pixels from the actual compiled node material at one fixed pose. */
  async function read(value: number): Promise<Uint8Array> {
    amount.value = value;
    renderer.render(scene, camera);
    const data = await renderer.readRenderTargetPixelsAsync(target, 0, 0, 64, 64);
    return new Uint8Array(data.buffer, data.byteOffset, data.byteLength).slice();
  }

  try {
    await renderer.init();
    renderer.setRenderTarget(target);
    const off = await read(0);
    const phases = [coverage(off, 0)];
    for (const value of [0.55, 0.65, 0.75, 0.82, 0.88]) phases.push(coverage(await read(value), value));
    mouth.alphaHash = false;
    mouth.needsUpdate = true;
    const opaqueControl = coverage(await read(0.75), 0.75);
    const offControl = await read(0);
    let offPixelDifferences = 0;
    for (let i = 0; i < off.length; i++) if (off[i] !== offControl[i]) offPixelDifferences++;
    return { backend: renderer.backend.constructor.name, phases, opaqueControl, offPixelDifferences };
  } finally {
    renderer.setRenderTarget(null);
    target.dispose();
    renderer.dispose();
    geometry.dispose();
    mouth.dispose();
    source.dispose();
    backing.dispose();
    owner.dispose();
  }
}
