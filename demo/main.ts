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
