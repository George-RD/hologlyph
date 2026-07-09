/**
 * Renderer host tests: backend reporting logic and dispose safety. No GPU is
 * touched — `init()` is never called in the required tests, and `three/webgpu`
 * is mocked so importing the host has no browser/WebGPU side effects.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createRendererHost, detectBackend } from '../src/renderer';

vi.mock('three/webgpu', () => {
  return {
    WebGPURenderer: class {
      clippingPlanes: unknown[] = [];
      async init() {}
      setPixelRatio() {}
      setSize() {}
      render() {}
      dispose() {}
    },
  };
});

function setGpu(value: unknown): void {
  Object.defineProperty(navigator, 'gpu', { configurable: true, value });
}

afterEach(() => {
  setGpu(undefined);
});

describe('backend detection', () => {
  it('reports webgpu when navigator.gpu exists', () => {
    setGpu({});
    expect(detectBackend()).toBe('webgpu');
  });

  it('reports webgl2 when navigator.gpu is absent', () => {
    setGpu(undefined);
    expect(detectBackend()).toBe('webgl2');
  });
});

describe('renderer host construction safety (no init)', () => {
  it('starts uninitialized but owns a scene and camera', () => {
    const host = createRendererHost();
    expect(host.backend).toBe('uninitialized');
    expect(host.scene).toBeDefined();
    expect(host.camera).toBeDefined();
    expect(typeof host.camera.aspect).toBe('number');
  });

  it('guards GPU methods before init without throwing', () => {
    const host = createRendererHost();
    expect(() => host.setSize(640, 480)).not.toThrow();
    expect(() => host.setClippingPlane({} as never)).not.toThrow();
    expect(() => host.render()).not.toThrow();
  });

  it('disposes idempotently without a renderer', () => {
    const host = createRendererHost();
    expect(() => host.dispose()).not.toThrow();
    expect(() => host.dispose()).not.toThrow();
    expect(host.backend).toBe('uninitialized');
  });
});

describe('backend after init', () => {
  it('resolves backend from navigator.gpu availability (mocked GPU)', async () => {
    setGpu(undefined);
    const host = createRendererHost();
    await host.init({} as HTMLCanvasElement);
    expect(host.backend).toBe('webgl2');
    host.dispose();

    setGpu({});
    const host2 = createRendererHost();
    await host2.init({} as HTMLCanvasElement);
    expect(host2.backend).toBe('webgpu');
    host2.dispose();
  });
});
describe('gpuRenderer accessor', () => {
  it('is null before init', () => {
    const host = createRendererHost();
    expect(host.gpuRenderer).toBeNull();
    host.dispose();
  });

  it('exposes the WebGPURenderer instance after init', async () => {
    setGpu({});
    const host = createRendererHost();
    await host.init({} as HTMLCanvasElement);
    expect(host.gpuRenderer).not.toBeNull();
    host.dispose();
  });
});
