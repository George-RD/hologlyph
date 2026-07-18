/**
 * Renderer host tests: backend reporting logic and dispose safety. No GPU is
 * touched — `init()` is never called in the required tests, and `three/webgpu`
 * is mocked so importing the host has no browser/WebGPU side effects.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createRendererHost, detectBackend } from '../src/renderer';

type InitHandle = {
  promise: Promise<void>;
  resolve: () => void;
};

type MockRenderer = {
  initCalls: number;
  init: () => Promise<void>;
  disposeCalls: number;
  dispose: () => void;
  setPixelRatio: ReturnType<typeof vi.fn>;
  setSize: ReturnType<typeof vi.fn>;
  render: ReturnType<typeof vi.fn>;
  clippingPlanes: unknown[];
};

const rendererInstances: MockRenderer[] = [];
let initHandle: InitHandle = makeInitDeferred();

function makeInitDeferred(): InitHandle {
  let resolve = () => {};
  const promise = new Promise<void>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

vi.mock('three/webgpu', () => ({
  WebGPURenderer: class {
    clippingPlanes: unknown[] = [];
    initCalls = 0;
    disposeCalls = 0;
    setPixelRatio = vi.fn();
    setSize = vi.fn();
    render = vi.fn();
    init() {
      this.initCalls += 1;
      return initHandle.promise;
    }
    dispose() {
      this.disposeCalls += 1;
    }
    constructor() {
      rendererInstances.push(this);
    }
  },
}));

function resetInitHandle(): void {
  initHandle = makeInitDeferred();
}

function resolveInitHandle(): void {
  initHandle.resolve();
}

function setGpu(value: unknown): void {
  Object.defineProperty(navigator, 'gpu', { configurable: true, value });
}

function latestRenderer(): MockRenderer {
  if (rendererInstances.length === 0) {
    throw new Error('No renderer instance has been created');
  }
  const latest = rendererInstances[rendererInstances.length - 1];
  if (latest === undefined) {
    throw new Error('No renderer instance has been created');
  }
  return latest;
}

afterEach(() => {
  setGpu(undefined);
  rendererInstances.length = 0;
  resetInitHandle();
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
    resolveInitHandle();
    await host.init({} as HTMLCanvasElement);
    expect(host.backend).toBe('webgl2');
    host.dispose();
    expect(latestRenderer().disposeCalls).toBe(1);

    setGpu({});
    const host2 = createRendererHost();
    resolveInitHandle();
    await host2.init({} as HTMLCanvasElement);
    expect(host2.backend).toBe('webgpu');
    host2.dispose();
    expect(latestRenderer().disposeCalls).toBe(1);
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
    resolveInitHandle();
    await host.init({} as HTMLCanvasElement);
    expect(host.gpuRenderer).toBe(latestRenderer() as unknown);
    host.dispose();
  });
});

describe('renderer init race', () => {
  it('disposes the created renderer when disposed while init is pending', async () => {
    setGpu({});
    resetInitHandle();
    const host = createRendererHost();
    const init = host.init({} as HTMLCanvasElement);
    host.dispose();
    resolveInitHandle();
    await init;
    expect(latestRenderer().disposeCalls).toBe(1);
    expect(host.backend).toBe('uninitialized');
  });
});
