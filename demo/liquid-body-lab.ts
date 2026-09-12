import { Plane, Raycaster, Vector2, Vector3 } from 'three';
import { createEngine, liquidBody } from '../src/index.js';
import type { Engine, LoadedAvatar, RendererHost } from '../src/contracts.js';

// This undeployed review page exposes the same inspection hooks as engine.html.
// Private scene access is not part of the consumer API.
type ReviewEngine = Engine & { avatar: LoadedAvatar; sysRenderer: RendererHost };
function element<T extends HTMLElement>(id: string): T {
  const node = document.getElementById(id);
  if (!node) throw new Error(`Missing review element: ${id}`);
  return node as T;
}
const canvas = element<HTMLCanvasElement>('holo');
const host = element<HTMLElement>('host');
const status = element<HTMLElement>('status');
const headButton = element<HTMLButtonElement>('head');
const liquidButton = element<HTMLButtonElement>('liquid');
const rippleButton = element<HTMLButtonElement>('ripple');
const speakButton = element<HTMLButtonElement>('speak');
const engine = createEngine() as ReviewEngine;
const liquid = liquidBody(engine.vfx);
let ready = false;
let close = false;
let side = false;
let poseHeld = false;
let pointer = -1;
let frame = 0;
let disposed = false;
let lastView = '';
let lastStatus = '';
const plane = new Plane(new Vector3(0, 0, 1), 0);
const raycaster = new Raycaster();
const point = new Vector3();
const down = new Vector3();
const origin = new Vector2();
const ndc = new Vector2();

function view(): void {
  if (!ready) return;
  const camera = engine.sysRenderer.camera;
  const state = `${liquid.amount}:${close}:${side}:${camera.aspect}`;
  if (state === lastView) return;
  lastView = state;
  const q = liquid.amount * liquid.amount * (3 - 2 * liquid.amount);
  const yaw = side ? 0.48 : 0;
  // A puddle spreads wider than the head and sits lower. Frame its surface,
  // not the original head's empty centre; retain visible room for travel.
  const aspectScale = Math.max(1, 0.85 / Math.max(camera.aspect, 0.2));
  const distance = ((close ? 0.88 : 2.45) * (1 - q) + 4.5 * q) * aspectScale;
  const targetY = (close ? -0.12 : -0.03) * (1 - q) - 0.68 * q;
  const rise = (close ? 0.04 : 0.27) * (1 - q) + 2 * q;
  camera.position.set(Math.sin(yaw) * distance, targetY + rise, Math.cos(yaw) * distance);
  camera.lookAt(0, targetY, close ? 0.12 * (1 - q) : 0);
  camera.updateMatrixWorld();
}

function background(name: string): void {
  const colour = name === 'light' ? '#eff3fa' : name === 'checker' ? '#60738d' : '#05070d';
  document.body.classList.toggle('light', name === 'light');
  document.body.classList.toggle('checker', name === 'checker');
  document.body.style.backgroundColor = colour;
  engine.vfx.setHeadConfig({ skin: { backdrop: { color: colour, auto: false } } });
}

function pose(name: string): void {
  if (!ready || liquid.amount > 0.001) return;
  engine.speech.cancel();
  engine.setMotionFrozen(true);
  poseHeld = true;
  for (const mesh of engine.avatar.morphMeshes) mesh.morphTargetInfluences?.fill(0);
  if (name !== 'sil') engine.avatar.setMorph(`viseme_${name}`, 1);
}

function amount(value: number, immediate = false): void {
  if (!ready) return;
  engine.speech.cancel();
  engine.setMotionFrozen(true);
  poseHeld = false;
  if (value > 0) close = false;
  liquid.setAmount(value, immediate);
  view();
  headButton.setAttribute('aria-pressed', String(value === 0));
  liquidButton.setAttribute('aria-pressed', String(value === 1));
}

function pointerPoint(event: PointerEvent): Vector3 | null {
  const rect = canvas.getBoundingClientRect();
  if (!(rect.width > 0) || !(rect.height > 0)) return null;
  ndc.set(2 * (event.clientX - rect.left) / rect.width - 1, 1 - 2 * (event.clientY - rect.top) / rect.height);
  raycaster.setFromCamera(ndc, engine.sysRenderer.camera);
  return raycaster.ray.intersectPlane(plane, point);
}

function steer(x: number, y: number): void {
  liquid.steerTo(Math.max(-0.6, Math.min(0.6, x)), Math.max(-0.2, Math.min(0.85, y)));
}

canvas.tabIndex = 0;
canvas.addEventListener('pointerdown', event => {
  if (!ready || !liquid.canSteer || pointer !== -1) return;
  const world = pointerPoint(event);
  if (!world) return;
  pointer = event.pointerId;
  down.copy(world);
  origin.set(...liquid.position);
  canvas.setPointerCapture(pointer);
  liquid.impulse(0.35, 0.1, 0.7);
});
canvas.addEventListener('pointermove', event => {
  if (event.pointerId !== pointer) return;
  const world = pointerPoint(event);
  if (world) steer(origin.x + world.x - down.x, origin.y + world.y - down.y);
});
function release(event: PointerEvent): void {
  if (event.pointerId !== pointer) return;
  const id = pointer;
  pointer = -1;
  liquid.release();
  if (canvas.hasPointerCapture(id)) canvas.releasePointerCapture(id);
}
canvas.addEventListener('pointerup', release);
canvas.addEventListener('pointercancel', release);
canvas.addEventListener('lostpointercapture', release);
canvas.addEventListener('keydown', event => {
  if (!liquid.canSteer) return;
  const delta: Record<string, readonly [number, number]> = {
    ArrowLeft: [-0.12, 0], ArrowRight: [0.12, 0], ArrowUp: [0, 0.12], ArrowDown: [0, -0.12],
  };
  const step = delta[event.key];
  if (step) { event.preventDefault(); steer(liquid.position[0] + step[0], liquid.position[1] + step[1]); }
  if (event.key === ' ') { event.preventDefault(); liquid.impulse(0.3, 0, 1.3); }
});
canvas.addEventListener('keyup', event => { if (event.key.startsWith('Arrow')) liquid.release(); });
headButton.addEventListener('click', () => amount(0));
liquidButton.addEventListener('click', () => amount(1));
rippleButton.addEventListener('click', () => liquid.impulse(0.5, -0.2, 1.5));
element('side').addEventListener('click', () => { side = !side; view(); });
element('close').addEventListener('click', () => { close = !close; view(); });
speakButton.addEventListener('click', () => {
  if (!ready || liquid.amount > 0.001) return;
  poseHeld = false;
  engine.setMotionFrozen(false);
  void engine.speak('Hello George. These letters form my teeth and tongue.');
});
for (const button of document.querySelectorAll<HTMLButtonElement>('[data-pose]')) {
  button.addEventListener('click', () => pose(button.dataset.pose ?? 'sil'));
}
for (const button of document.querySelectorAll<HTMLButtonElement>('[data-bg]')) {
  button.addEventListener('click', () => background(button.dataset.bg ?? 'dark'));
}

engine.on('error', error => { status.textContent = error.message; console.error(error); });
await engine.mount(canvas, host);
ready = true;
engine.setScrollProgress(1);
view();
const resize = new ResizeObserver(() => {
  if (!disposed) { engine.resize(canvas.clientWidth, canvas.clientHeight); view(); }
});
resize.observe(host);

function tick(): void {
  if (disposed) return;
  const inHead = liquid.amount === 0 && liquid.targetAmount === 0;
  if (inHead && !poseHeld) engine.setMotionFrozen(false);
  view();
  rippleButton.disabled = !liquid.canSteer;
  speakButton.disabled = !inHead;
  const message = liquid.canSteer ? 'Drag the liquid. Release to let it settle.'
    : inHead ? 'Choose a mouth shape or press Speak.' : liquid.targetAmount === 1 ? 'Becoming liquid.' : 'Re-forming here.';
  if (message !== lastStatus) { lastStatus = message; status.textContent = message; }
  frame = requestAnimationFrame(tick);
}
frame = requestAnimationFrame(tick);
const review = {
  engine, liquid, pose, amount, background,
  view(options: { close?: boolean; side?: boolean }): void {
    close = options.close ?? close;
    side = options.side ?? side;
    view();
  },
  get ready(): boolean { return ready; },
};
(window as unknown as { __liquidLab: typeof review }).__liquidLab = review;
window.addEventListener('pagehide', event => {
  if (event.persisted) { liquid.release(); return; }
  disposed = true;
  resize.disconnect();
  cancelAnimationFrame(frame);
  liquid.release();
  engine.dispose();
});
