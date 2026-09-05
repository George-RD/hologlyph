import { createEngine } from '../src/index.js';
import type { Expression } from '../src/index.js';

interface CaptionOption {
  readonly id: string;
  readonly label: string;
  readonly text: string;
}

interface ExpressionOption {
  readonly value: Expression;
  readonly mark: string;
  readonly label: string;
}

type OpenMenu = 'expressions' | 'captions' | null;

const CAPTIONS: readonly CaptionOption[] = [
  {
    id: 'hello',
    label: 'Introduction',
    text: 'Hello. I am Hologlyph, a face made from text, light and glass.',
  },
  {
    id: 'mobile',
    label: 'Mobile demo',
    text: 'This is the mobile demo. The controls stay out of the way until you need them.',
  },
  {
    id: 'expression',
    label: 'Expressions',
    text: 'Change my expression, then tap say again and see how the same voice feels different.',
  },
  {
    id: 'visemes',
    label: 'Speech motion',
    text: 'My mouth follows speech using timed viseme shapes rather than a video stream.',
  },
  {
    id: 'embedded',
    label: 'Web native',
    text: 'The same talking head can live inside a website, a product interface or an agent.',
  },
];

const EXPRESSIONS: readonly ExpressionOption[] = [
  { value: 'neutral', mark: 'N', label: 'neutral' },
  { value: 'friendly', mark: 'F', label: 'friendly' },
  { value: 'thinking', mark: '?', label: 'thinking' },
  { value: 'agree', mark: '✓', label: 'agree' },
  { value: 'concern', mark: '…', label: 'concern' },
  { value: 'happy', mark: '☺', label: 'happy' },
  { value: 'surprised', mark: '!', label: 'surprised' },
];

const BACKDROPS = ['#05070d', '#101826', '#1b2430', '#2b1d33', '#0e2a2a', '#f4f1ea', '#ffffff'] as const;

function requiredElement<T extends HTMLElement>(id: string): T {
  const node = document.getElementById(id);
  if (!(node instanceof HTMLElement)) throw new Error(`Missing #${id}`);
  return node as T;
}

const canvasNode = document.getElementById('holo');
if (!(canvasNode instanceof HTMLCanvasElement)) throw new Error('Missing #holo canvas');
const canvas = canvasNode;

const stage = requiredElement<HTMLElement>('stage');
const topChrome = requiredElement<HTMLElement>('topChrome');
const commandDock = requiredElement<HTMLElement>('commandDock');
const expressionTrigger = requiredElement<HTMLButtonElement>('expressionTrigger');
const speakTrigger = requiredElement<HTMLButtonElement>('speakTrigger');
const captionTrigger = requiredElement<HTMLButtonElement>('captionTrigger');
const expressionMenu = requiredElement<HTMLElement>('expressionMenu');
const captionPanel = requiredElement<HTMLElement>('captionPanel');
const captionList = requiredElement<HTMLElement>('captionList');
const captionText = requiredElement<HTMLElement>('captionText');
const closeCaptions = requiredElement<HTMLButtonElement>('closeCaptions');
const settingsTrigger = requiredElement<HTMLButtonElement>('settingsTrigger');
const settingsPanel = requiredElement<HTMLDialogElement>('settingsPanel');
const closeSettings = requiredElement<HTMLButtonElement>('closeSettings');
const statusToast = requiredElement<HTMLElement>('statusToast');

const glassAmount = requiredElement<HTMLInputElement>('glassAmount');
const glassAmountValue = requiredElement<HTMLOutputElement>('glassAmountValue');
const presence = requiredElement<HTMLInputElement>('presence');
const presenceValue = requiredElement<HTMLOutputElement>('presenceValue');
const glassTint = requiredElement<HTMLInputElement>('glassTint');
const toneBalance = requiredElement<HTMLInputElement>('toneBalance');
const toneBalanceValue = requiredElement<HTMLOutputElement>('toneBalanceValue');
const warmth = requiredElement<HTMLInputElement>('warmth');
const warmthValue = requiredElement<HTMLOutputElement>('warmthValue');
const rim = requiredElement<HTMLInputElement>('rim');
const rimValue = requiredElement<HTMLOutputElement>('rimValue');
const reducedMotion = requiredElement<HTMLInputElement>('reducedMotion');
const backdropSwatches = requiredElement<HTMLElement>('backdropSwatches');
const backdropValue = requiredElement<HTMLOutputElement>('backdropValue');

const engine = createEngine();
(window as unknown as { __hologlyphEngine?: typeof engine }).__hologlyphEngine = engine;

const firstCaption = CAPTIONS[0];
if (!firstCaption) throw new Error('At least one sample caption is required');
let currentCaption: CaptionOption = firstCaption;
let currentExpression: Expression = 'friendly';
let openMenu: OpenMenu = null;
let speechRun = 0;
let toastTimer: number | null = null;
let ready = false;

function showToast(message: string, duration = 1600): void {
  statusToast.textContent = message;
  statusToast.classList.add('visible');
  if (toastTimer !== null) window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => {
    statusToast.classList.remove('visible');
    toastTimer = null;
  }, duration);
}

function setSpeaking(speaking: boolean): void {
  speakTrigger.setAttribute('aria-pressed', String(speaking));
  document.body.classList.toggle('is-speaking', speaking);
}

function renderCaption(): void {
  captionText.textContent = currentCaption.text;
  document.body.dataset.lastCaption = currentCaption.id;
  for (const button of captionList.querySelectorAll<HTMLButtonElement>('.caption-choice')) {
    button.setAttribute('aria-current', String(button.dataset.captionId === currentCaption.id));
  }
}

async function speakCurrent(): Promise<void> {
  if (!ready) return;
  const run = ++speechRun;
  document.body.dataset.speechCount = String(run);
  renderCaption();
  setOpenMenu(null);
  setSpeaking(true);
  try {
    await engine.speak(currentCaption.text);
  } catch (error) {
    console.warn('[hologlyph] Speech failed', error);
    if (run === speechRun) showToast('Speech is unavailable in this browser', 2600);
  } finally {
    if (run === speechRun) setSpeaking(false);
  }
}

/** Keep the whole fan inside the safe area without clamping buttons onto each other. */
function positionExpressionMenu(): void {
  const triggerRect = expressionTrigger.getBoundingClientRect();
  const safeRect = topChrome.getBoundingClientRect();
  const dockRect = commandDock.getBoundingClientRect();
  const buttons = Array.from(expressionMenu.querySelectorAll<HTMLButtonElement>('.expression-option'));
  const size = buttons[0]?.offsetWidth ?? 48;
  const radius = Math.min(128, Math.max(0, (safeRect.width - size) / 2));
  const width = radius * 2 + size;
  const height = radius + size + 22; // Space for the labels below the end buttons.
  const desiredLeft = triggerRect.left + triggerRect.width / 2 - width / 2;
  const left = Math.max(safeRect.left, Math.min(safeRect.right - width, desiredLeft));

  // A real container box is needed for focus, hit-testing and visibility checks.
  expressionMenu.style.width = `${width}px`;
  expressionMenu.style.height = `${height}px`;
  expressionMenu.style.left = `${left}px`;
  expressionMenu.style.top = `${Math.max(safeRect.top, dockRect.top - height - 8)}px`;

  buttons.forEach((button, index) => {
    const progress = buttons.length <= 1 ? 0.5 : index / (buttons.length - 1);
    const angle = Math.PI * (1 + progress);
    const x = width / 2 + Math.cos(angle) * radius;
    const y = radius + size / 2 + Math.sin(angle) * radius;
    button.style.setProperty('--x', `${x.toFixed(1)}px`);
    button.style.setProperty('--y', `${y.toFixed(1)}px`);
  });
}

/** Move focus out before hiding a panel, and into its current choice on opening. */
function setOpenMenu(next: OpenMenu): void {
  const previous = openMenu;
  if (previous !== next) {
    if (expressionMenu.contains(document.activeElement)) expressionTrigger.focus({ preventScroll: true });
    if (captionPanel.contains(document.activeElement)) captionTrigger.focus({ preventScroll: true });
  }
  openMenu = next;
  const expressionsOpen = next === 'expressions';
  const captionsOpen = next === 'captions';

  expressionMenu.classList.toggle('open', expressionsOpen);
  expressionMenu.setAttribute('aria-hidden', String(!expressionsOpen));
  expressionMenu.inert = !expressionsOpen;
  expressionTrigger.setAttribute('aria-expanded', String(expressionsOpen));

  captionPanel.classList.toggle('open', captionsOpen);
  captionPanel.setAttribute('aria-hidden', String(!captionsOpen));
  captionPanel.inert = !captionsOpen;
  captionTrigger.setAttribute('aria-expanded', String(captionsOpen));

  document.body.classList.toggle('menu-open', expressionsOpen || captionsOpen);
  if (expressionsOpen) {
    positionExpressionMenu();
    if (previous !== next) {
      expressionMenu.querySelector<HTMLButtonElement>('[aria-pressed="true"]')?.focus({ preventScroll: true });
    }
  } else if (captionsOpen && previous !== next) {
    captionList.querySelector<HTMLButtonElement>('[aria-current="true"]')?.focus({ preventScroll: true });
  }
}

function selectExpression(expression: Expression, announce = true): void {
  currentExpression = expression;
  engine.setEmotion(expression);
  expressionTrigger.dataset.expression = expression;

  for (const button of expressionMenu.querySelectorAll<HTMLButtonElement>('.expression-option')) {
    button.setAttribute('aria-pressed', String(button.dataset.expression === expression));
  }

  setOpenMenu(null);
  if (announce) showToast(`${expression} expression`);
}

/** Use the native modal for focus containment and an inert background. */
function setSettingsOpen(open: boolean): void {
  if (open === settingsPanel.open) return;
  if (open) {
    setOpenMenu(null);
    settingsPanel.inert = false;
    settingsPanel.setAttribute('aria-hidden', 'false');
    settingsPanel.showModal();
    closeSettings.focus({ preventScroll: true });
  } else {
    settingsPanel.close();
    settingsTrigger.focus({ preventScroll: true });
    settingsPanel.inert = true;
    settingsPanel.setAttribute('aria-hidden', 'true');
  }
  document.body.classList.toggle('settings-open', open);
  settingsTrigger.setAttribute('aria-expanded', String(open));
}

for (const [index, option] of EXPRESSIONS.entries()) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'expression-option';
  button.textContent = option.mark;
  button.dataset.expression = option.value;
  button.dataset.label = option.label;
  button.style.setProperty('--order', String(index));
  button.setAttribute('aria-label', option.label);
  button.setAttribute('aria-pressed', String(option.value === currentExpression));
  button.addEventListener('click', () => selectExpression(option.value));
  expressionMenu.append(button);
}
expressionMenu.setAttribute('aria-hidden', 'true');
expressionMenu.inert = true;
captionPanel.inert = true;
settingsPanel.inert = true;

for (const option of CAPTIONS) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'caption-choice';
  button.dataset.captionId = option.id;
  const label = document.createElement('strong');
  label.textContent = option.label;
  const text = document.createElement('span');
  text.textContent = option.text;
  button.append(label, text);
  button.setAttribute('aria-current', String(option.id === currentCaption.id));
  button.addEventListener('click', () => {
    currentCaption = option;
    void speakCurrent();
  });
  captionList.append(button);
}
renderCaption();

expressionTrigger.addEventListener('click', () => {
  setOpenMenu(openMenu === 'expressions' ? null : 'expressions');
});

speakTrigger.addEventListener('click', () => {
  void speakCurrent();
});

captionTrigger.addEventListener('click', () => {
  setOpenMenu(openMenu === 'captions' ? null : 'captions');
});

closeCaptions.addEventListener('click', () => setOpenMenu(null));
settingsTrigger.addEventListener('click', () => setSettingsOpen(!document.body.classList.contains('settings-open')));
closeSettings.addEventListener('click', () => setSettingsOpen(false));
settingsPanel.addEventListener('cancel', (event) => {
  event.preventDefault();
  setSettingsOpen(false);
});
settingsPanel.addEventListener('click', (event) => {
  if (event.target !== settingsPanel) return;
  const rect = settingsPanel.getBoundingClientRect();
  if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) {
    setSettingsOpen(false);
  }
});

document.addEventListener('pointerdown', (event) => {
  const target = event.target;
  if (!(target instanceof Node)) return;
  if (
    openMenu !== null &&
    !expressionMenu.contains(target) &&
    !captionPanel.contains(target) &&
    !expressionTrigger.contains(target) &&
    !captionTrigger.contains(target)
  ) {
    setOpenMenu(null);
  }
});

document.addEventListener('keydown', (event) => {
  if (event.key !== 'Escape' || settingsPanel.open) return;
  setOpenMenu(null);
});

function formatValue(value: number, digits: number): string {
  return value.toFixed(digits);
}

function bindRange(
  input: HTMLInputElement,
  output: HTMLOutputElement,
  initial: number,
  digits: number,
  apply: (value: number) => void,
): void {
  input.value = String(initial);
  output.textContent = formatValue(initial, digits);
  input.addEventListener('input', () => {
    const value = input.valueAsNumber;
    output.textContent = formatValue(value, digits);
    apply(value);
  });
}

const initialConfig = engine.vfx.headConfig;
bindRange(glassAmount, glassAmountValue, initialConfig.skin.glass.amount, 2, (value) => {
  engine.vfx.setHeadConfig({ skin: { glass: { amount: value } } });
});
bindRange(presence, presenceValue, initialConfig.skin.opacity.base, 3, (value) => {
  engine.vfx.setHeadConfig({ skin: { opacity: { base: value } } });
});
bindRange(toneBalance, toneBalanceValue, initialConfig.skin.tone.balance, 2, (value) => {
  engine.vfx.setHeadConfig({ skin: { tone: { balance: value } } });
});
bindRange(warmth, warmthValue, initialConfig.skin.tone.skinWarmth, 2, (value) => {
  engine.vfx.setHeadConfig({ skin: { tone: { skinWarmth: value } } });
});
bindRange(rim, rimValue, initialConfig.skin.tone.rim, 3, (value) => {
  engine.vfx.setHeadConfig({ skin: { tone: { rim: value } } });
});

glassTint.value = initialConfig.skin.glass.tint;
glassTint.addEventListener('input', () => {
  engine.vfx.setHeadConfig({ skin: { glass: { tint: glassTint.value } } });
});

const themeColour = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
let currentBackdrop = initialConfig.skin.backdrop.color.toLowerCase();

function setBackdrop(colour: string): void {
  currentBackdrop = colour.toLowerCase();
  document.documentElement.style.setProperty('--backdrop', colour);
  document.body.style.background = colour;
  backdropValue.textContent = colour;
  themeColour?.setAttribute('content', colour);
  engine.vfx.setHeadConfig({ skin: { backdrop: { color: colour, auto: false } } });
  for (const button of backdropSwatches.querySelectorAll<HTMLButtonElement>('.swatch')) {
    button.setAttribute('aria-pressed', String(button.dataset.colour === currentBackdrop));
  }
}

for (const colour of BACKDROPS) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'swatch';
  button.style.background = colour;
  button.dataset.colour = colour;
  button.setAttribute('aria-label', `Use ${colour} backdrop`);
  button.setAttribute('aria-pressed', String(colour === currentBackdrop));
  button.addEventListener('click', () => setBackdrop(colour));
  backdropSwatches.append(button);
}
setBackdrop(currentBackdrop);

reducedMotion.checked = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
reducedMotion.addEventListener('change', () => engine.vfx.setReducedMotion(reducedMotion.checked));

engine.on('error', (error) => {
  console.warn('[hologlyph]', error);
  showToast('Speech or rendering is unavailable in this browser', 2600);
});

speakTrigger.disabled = true;
expressionTrigger.disabled = true;
captionTrigger.disabled = true;

await engine.mount(canvas, stage);
engine.setScrollProgress(1);
selectExpression(currentExpression, false);
ready = true;
speakTrigger.disabled = false;
expressionTrigger.disabled = false;
captionTrigger.disabled = false;
document.body.dataset.ready = 'true';

const resize = (): void => {
  engine.resize(stage.clientWidth, stage.clientHeight);
  if (openMenu === 'expressions') positionExpressionMenu();
};

const resizeObserver = new ResizeObserver(resize);
resizeObserver.observe(stage);
window.addEventListener('resize', resize, { passive: true });
window.addEventListener('orientationchange', resize, { passive: true });
resize();

const YAW_GAIN = 0.005;
const PITCH_GAIN = 0.004;
const YAW_LIMIT = 0.5;
const PITCH_LIMIT = 0.35;
let activePointerId: number | null = null;
let lastX = 0;
let lastY = 0;
let dragYaw = 0;
let dragPitch = 0;

canvas.addEventListener('pointerdown', (event) => {
  if (event.button !== 0 || !event.isPrimary || activePointerId !== null) return;
  activePointerId = event.pointerId;
  lastX = event.clientX;
  lastY = event.clientY;
  canvas.classList.add('dragging');
  canvas.setPointerCapture(event.pointerId);
});

canvas.addEventListener('pointermove', (event) => {
  if (event.pointerId !== activePointerId) return;
  const dx = event.clientX - lastX;
  const dy = event.clientY - lastY;
  lastX = event.clientX;
  lastY = event.clientY;
  dragYaw = Math.max(-YAW_LIMIT, Math.min(YAW_LIMIT, dragYaw + dx * YAW_GAIN));
  dragPitch = Math.max(-PITCH_LIMIT, Math.min(PITCH_LIMIT, dragPitch + dy * PITCH_GAIN));
  engine.motion.setHeadTarget(dragYaw, dragPitch);
});

function endDrag(event: PointerEvent): void {
  if (event.pointerId !== activePointerId) return;
  activePointerId = null;
  canvas.classList.remove('dragging');
  if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
}

canvas.addEventListener('pointerup', endDrag);
canvas.addEventListener('pointercancel', endDrag);
canvas.addEventListener('lostpointercapture', endDrag);

// A cached page keeps its mounted engine. Disposing on every pagehide leaves
// a dead canvas when the visitor returns from the full studio with Back.
window.addEventListener('pagehide', (event) => {
  activePointerId = null;
  canvas.classList.remove('dragging');
  if (event.persisted) return;
  resizeObserver.disconnect();
  if (toastTimer !== null) window.clearTimeout(toastTimer);
  engine.dispose();
});
window.addEventListener('pageshow', (event) => {
  if (event.persisted) resize();
});
