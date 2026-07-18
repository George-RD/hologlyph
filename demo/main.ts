/**
 * Dependency-free demo wiring: instantiate the engine against the sticky
 * canvas host, drive emergence from scroll, and expose Speak + emotion controls.
 * No frameworks — the imperative engine is the primary advanced surface here.
 */
import { createEngine } from '../src/index.js';
import type { Expression } from '../src/index.js';

const canvas = document.getElementById('holo') as HTMLCanvasElement;
const host = document.getElementById('host') as HTMLElement;
const speakBtn = document.getElementById('speak') as HTMLButtonElement;
const emotionSel = document.getElementById('emotion') as HTMLSelectElement;
const stateLabel = document.getElementById('state') as HTMLSpanElement;

const engine = createEngine();

engine.on('statechange', (e) => {
  stateLabel.textContent = `state: ${e.to}`;
});
engine.on('error', (err) => {
  console.error('[hologlyph]', err);
});

void engine.mount(canvas, host);
// Expose the live engine for headless eval harnesses (tools/evals). This is a
// demo-only debug hook; the production library never sets window globals.
if (typeof window !== 'undefined') {
  (window as unknown as { __hologlyphEngine?: typeof engine }).__hologlyphEngine = engine;
}

speakBtn.addEventListener('click', () => {
  void engine.speak('Hello, I am hologlyph, a text-skinned talking head.');
});

emotionSel.addEventListener('change', () => {
  engine.setEmotion(emotionSel.value as Expression);
});

// Scroll-driven emergence: progress is how far the host has travelled up the
// viewport (0 at the bottom, 1 once it pins to the top).
function updateScroll(): void {
  const rect = host.getBoundingClientRect();
  const vh = window.innerHeight || 1;
  const progress = 1 - Math.min(Math.max(rect.top / vh, 0), 1);
  engine.setScrollProgress(progress);
}

window.addEventListener('scroll', updateScroll, { passive: true });
updateScroll();

// Pointer-drag head control: drag the head to rotate it. The canvas owns the
// gesture (touch-action: none below) so page scroll still works elsewhere.
const YAW_GAIN = 0.005;
const PITCH_GAIN = 0.004;
const YAW_LIMIT = 0.5;
const PITCH_LIMIT = 0.35;

let activePointerId = -1;
let lastX = 0;
let lastY = 0;
let dragYaw = 0;
let dragPitch = 0;

canvas.style.touchAction = 'none';

canvas.addEventListener('pointerdown', (e) => {
  if (activePointerId !== -1) return;
  activePointerId = e.pointerId;
  lastX = e.clientX;
  lastY = e.clientY;
  canvas.setPointerCapture(e.pointerId);
});

canvas.addEventListener('pointermove', (e) => {
  if (e.pointerId !== activePointerId) return;
  const dx = e.clientX - lastX;
  const dy = e.clientY - lastY;
  lastX = e.clientX;
  lastY = e.clientY;
  dragYaw = Math.max(-YAW_LIMIT, Math.min(YAW_LIMIT, dragYaw + dx * YAW_GAIN));
  dragPitch = Math.max(-PITCH_LIMIT, Math.min(PITCH_LIMIT, dragPitch + dy * PITCH_GAIN));
  engine.motion.setHeadTarget(dragYaw, dragPitch);
});

function endDrag(e: PointerEvent): void {
  if (e.pointerId !== activePointerId) return;
  activePointerId = -1;
  if (canvas.hasPointerCapture(e.pointerId)) canvas.releasePointerCapture(e.pointerId);
}

canvas.addEventListener('pointerup', endDrag);
canvas.addEventListener('pointercancel', endDrag);
canvas.addEventListener('lostpointercapture', endDrag);
