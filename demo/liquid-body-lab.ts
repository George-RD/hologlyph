import { Plane, Raycaster, Vector2, Vector3 } from 'three';
import { createEngine } from '../src/index.js';
import type { Engine, LoadedAvatar, RendererHost } from '../src/contracts.js';
import { liquidBody } from '../src/shaders/index.js';

// This undeployed review page deliberately exposes the same inspection hooks
// as engine.html. Private scene access is not part of the consumer API.
type ReviewEngine = Engine & { avatar: LoadedAvatar; sysRenderer: RendererHost };
function element<T extends HTMLElement>(id: string): T {
  const node = document.getElementById(id);
  if (!node) throw new Error(`Missing review element: ${id}`);
  return node as T;
}
const canvas = element<HTMLCanvasElement>('holo');
const host = element<HTMLElement>('host');
const status = element<HTMLElement>('status');
const engine = createEngine() as ReviewEngine;
const liquid = liquidBody(engine.vfx);
let ready = false;
let close = false;
let side = false;
let poseHeld = false;
let pointer = -1;
let frame = 0;
const plane = new Plane(new Vector3(0, 0, 1), 0);
const raycaster = new Raycaster();
const point = new Vector3();
const down = new Vector3();
const origin = new Vector2();
const ndc = new Vector2();

function view(): void {
  if (!ready) return;
  const camera = engine.sysRenderer.camera;
  const yaw = side ? 0.48 : 0;
  const distance = close ? 0.88 : 2.45;
  camera.position.set(Math.sin(yaw) * distance, close ? -0.08 : 0.24, Math.cos(yaw) * distance);
  camera.lookAt(0, close ? -0.12 : -0.03, close ? 0.12 : 0);
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
  engine.speech.cancel();
  engine.setMotionFrozen(true);
  poseHeld = false;
  if (value > 0) {
    close = false;
    view();
  }
  liquid.setAmount(value, immediate);
  element('head').setAttribute('aria-pressed', String(value === 0));
  element('liquid').setAttribute('aria-pressed', String(value === 1));
}

function pointerPoint(event: PointerEvent): Vector3 | null {
  const rect = canvas.getBoundingClientRect();
  ndc.set(2 * (event.clientX - rect.left) / rect.width - 1, 1 - 2 * (event.clientY - rect.top) / rect.height);
  raycaster.setFromCamera(ndc, engine.sysRenderer.camera);
  return raycaster.ray.intersectPlane(plane, point);
}

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
  if (!world) return;
  const x = Math.max(-0.6, Math.min(0.6, origin.x + world.x - down.x));
  const y = Math.max(-0.2, Math.min(0.85, origin.y + world.y - down.y));
  liquid.steerTo(x, y);
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
element('head').addEventListener('click', () => amount(0));
element('liquid').addEventListener('click', () => amount(1));
element('ripple').addEventListener('click', () => liquid.impulse(0.5, -0.2, 1.5));
element('side').addEventListener('click', () => { side = !side; view(); });
element('close').addEventListener('click', () => { close = !close; view(); });
element('speak').addEventListener('click', () => {
  if (liquid.amount > 0.001) return;
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

function tick(): void {
  const inHead = liquid.amount === 0 && liquid.targetAmount === 0;
  if (inHead && !poseHeld) engine.setMotionFrozen(false);
  element<HTMLButtonElement>('ripple').disabled = !liquid.canSteer;
  element<HTMLButtonElement>('speak').disabled = !inHead;
  status.textContent = liquid.canSteer ? 'Drag the liquid. Release to let it settle.'
    : inHead ? 'Choose a mouth shape or press Speak.' : liquid.targetAmount === 1 ? 'Becoming liquid.' : 'Re-forming here.';
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
window.addEventListener('pagehide', () => {
  cancelAnimationFrame(frame);
  liquid.release();
  engine.dispose();
}, { once: true });
