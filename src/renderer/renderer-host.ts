/**
 * Renderer host: owns the Three.js WebGPURenderer, scene graph, and camera.
 *
 * WebGPU-first with automatic WebGL2 fallback (handled by three's
 * WebGPURenderer). The backend is reported via `navigator.gpu` availability
 * (dec.renderer-posture). All GPU-touching methods are guarded so a host can be
 * constructed and inspected without `init()` having run (dec.performance-budget:
 * safe teardown, no GPU access until mount).
 */
import * as THREE from 'three';
import { WebGPURenderer } from 'three/webgpu';
import type { RendererHost } from '../contracts.js';

/**
 * Pure backend detection. WebGPU is reported when `navigator.gpu` exists;
 * otherwise we fall back to WebGL2. Kept as a standalone function so it can be
 * unit-tested without constructing a renderer.
 */
export function detectBackend(): 'webgpu' | 'webgl2' {
  if (typeof navigator !== 'undefined' && navigator.gpu) {
    return 'webgpu';
  }
  return 'webgl2';
}

const MAX_PIXEL_RATIO = 2;

export function createRendererHost(): RendererHost {
  return new RendererHostImpl();
}

class RendererHostImpl implements RendererHost {
  private renderer: WebGPURenderer | null = null;
  private rendererInit: Promise<void> | null = null;
  private disposed = false;

  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  backend: 'webgpu' | 'webgl2' | 'uninitialized' = 'uninitialized';

  constructor() {
    this.scene.background = new THREE.Color(0x05070d);
    this.camera = new THREE.PerspectiveCamera(35, 1, 0.1, 100);
    this.camera.position.set(0, 0.05, 2.4);
    this.camera.lookAt(0, 0, 0);

    const key = new THREE.DirectionalLight(0xffffff, 2.2);
    key.position.set(1.2, 1.6, 2.0);
    this.scene.add(key);

    const fill = new THREE.DirectionalLight(0x88aaff, 0.8);
    fill.position.set(-1.5, 0.4, 1.0);
    this.scene.add(fill);

    this.scene.add(new THREE.AmbientLight(0x404a66, 1.0));
  }

  async init(canvas: HTMLCanvasElement): Promise<void> {
    if (this.disposed) return;
    if (this.renderer) return;
    if (this.rendererInit) return this.rendererInit;

    const renderer = new WebGPURenderer({ canvas, antialias: true });
    const init = (async () => {
      await renderer.init();
      if (this.disposed) {
        renderer.dispose();
        return;
      }
      this.renderer = renderer;
      this.backend = detectBackend();
    })();
    this.rendererInit = init;
    try {
      await init;
    } finally {
      if (this.rendererInit === init) {
        this.rendererInit = null;
      }
    }
  }

  setSize(width: number, height: number, pixelRatio?: number): void {
    if (!this.renderer) return;
    const fallback = typeof window !== 'undefined' ? window.devicePixelRatio : 1;
    const pr = Math.min(pixelRatio ?? fallback ?? 1, MAX_PIXEL_RATIO);
    this.renderer.setPixelRatio(pr);
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / Math.max(1, height);
    this.camera.updateProjectionMatrix();
  }

  setClippingPlane(plane: THREE.Plane): void {
    if (!this.renderer) return;
    // WebGPURenderer's published types omit `clippingPlanes`, yet the runtime
    // supports global clipping planes; assign through a narrow cast.
    (this.renderer as unknown as { clippingPlanes: THREE.Plane[] }).clippingPlanes = [plane];
  }

  render(): void {
    if (!this.renderer) return;
    // WebGPURenderer.render returns a Promise; we fire-and-forget and swallow
    // rejection so a missed frame never rejects a caller's promise chain.
    const result = this.renderer.render(this.scene, this.camera);
    if (result && typeof (result as Promise<void>).catch === 'function') {
      (result as Promise<void>).catch(() => {});
    }
  }

  /**
   * Raw WebGPURenderer instance once `init()` resolves; null before init
   * (dec.renderer-posture). The engine wires it into the asset loader for KTX2
   * transcoding support detection.
   */
  get gpuRenderer(): unknown {
    return this.renderer;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    if (this.renderer) {
      this.traverseAndDispose(this.scene);
      this.renderer.dispose();
      this.renderer = null;
    }
    if (this.rendererInit) {
      this.rendererInit = null;
    }
  }

  private traverseAndDispose(root: THREE.Object3D): void {
    root.traverse((obj) => {
      const mesh = obj as THREE.Mesh;
      if (mesh.geometry) mesh.geometry.dispose();
      const material = mesh.material;
      if (Array.isArray(material)) {
        for (const m of material) disposeMaterial(m);
      } else if (material) {
        disposeMaterial(material);
      }
    });
  }
}

function disposeMaterial(material: THREE.Material): void {
  for (const key of Object.keys(material)) {
    const value = (material as unknown as Record<string, unknown>)[key];
    if (value && (value as THREE.Texture).isTexture) {
      (value as THREE.Texture).dispose();
    }
  }
  material.dispose();
}
