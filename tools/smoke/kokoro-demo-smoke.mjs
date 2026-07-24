import { chromium } from 'playwright';

const BASE = process.env.HOLOGLYPH_BASE ?? 'http://127.0.0.1:5199/hologlyph/';
const CHROME = process.env.HOLOGLYPH_CHROME;
const browser = await chromium.launch({
  ...(CHROME ? { executablePath: CHROME } : {}),
  args: ['--no-sandbox', ...(process.platform === 'darwin' ? ['--use-angle=metal'] : [])],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 820 } });
const errors = [];
const lazyRequests = [];
page.on('pageerror', (error) => errors.push(error.message));
page.on('request', (request) => {
  if (/kokoro-js|onnx-community|huggingface|hf\.co/i.test(request.url())) lazyRequests.push(request.url());
});

await page.addInitScript(() => {
  window.__speechSmokeResources = { audioClose: 0, revoke: 0 };
  window.__forceKokoroLoadFailure = false;

  const close = AudioContext.prototype.close;
  AudioContext.prototype.close = function smokeClose() {
    window.__speechSmokeResources.audioClose += 1;
    return close.call(this);
  };
  const revoke = URL.revokeObjectURL.bind(URL);
  URL.revokeObjectURL = (url) => {
    window.__speechSmokeResources.revoke += 1;
    revoke(url);
  };

  class BoundarylessUtterance {
    constructor(text) {
      this.text = text;
      this.onstart = null;
      this.onend = null;
      this.onerror = null;
      this.onboundary = null;
    }
  }
  let timer = null;
  const boundarylessSynth = {
    speak(utterance) {
      clearTimeout(timer);
      queueMicrotask(() => utterance.onstart?.());
      timer = setTimeout(() => utterance.onend?.(), 1800);
    },
    cancel() {
      clearTimeout(timer);
      timer = null;
    },
  };
  Object.defineProperty(window, 'SpeechSynthesisUtterance', {
    configurable: true,
    value: BoundarylessUtterance,
  });
  Object.defineProperty(window, 'speechSynthesis', {
    configurable: true,
    value: boundarylessSynth,
  });
});

const fakeKokoroModule = `
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
export const KokoroTTS = {
  async from_pretrained(_modelId, options = {}) {
    options.progress_callback?.({ status: 'download', file: 'model-q8.onnx', progress: 12 });
    await wait(120);
    if (globalThis.__forceKokoroLoadFailure) throw new Error('forced model load failure');
    options.progress_callback?.({ status: 'download', file: 'model-q8.onnx', progress: 100 });
    return {
      async *stream(text) {
        if (/force kokoro failure/i.test(text)) throw new Error('forced synthesis failure');
        const sampleRate = 24000;
        const samples = new Float32Array(sampleRate * 2.4);
        yield {
          phonemes: ' a e i o u p f θ t k tʃ s n r ',
          audio: { audio: samples, sampling_rate: sampleRate },
        };
      },
    };
  },
};
`;
await page.route(/kokoro-js(?:\.js)?(?:\?.*)?$/, async (route) => {
  await route.fulfill({ contentType: 'application/javascript', body: fakeKokoroModule });
});

const failures = [];
const check = (condition, message) => {
  if (!condition) failures.push(message);
};

await page.goto(BASE, { waitUntil: 'load' });
await page.waitForFunction(
  () => document.getElementById('status')?.textContent?.startsWith('live'),
  null,
  { timeout: 60000 },
);
check(lazyRequests.length === 0, `Kokoro/model request occurred before click: ${lazyRequests.join(', ')}`);

const initial = await page.evaluate(() => {
  const button = document.getElementById('hqVoiceBtn');
  const status = document.getElementById('voiceStatus');
  const progress = document.getElementById('voiceProgress');
  return {
    buttonText: button?.textContent ?? null,
    buttonName: button?.getAttribute('aria-label') ?? button?.textContent ?? null,
    statusRole: status?.getAttribute('role') ?? null,
    statusLive: status?.getAttribute('aria-live') ?? null,
    progressLabel: progress?.getAttribute('aria-label') ?? null,
  };
});
check(initial.buttonText === 'Load HQ voice', `HQ button missing or mislabelled: ${initial.buttonText}`);
check(Boolean(initial.buttonName), 'HQ button has no accessible name');
check(initial.statusRole === 'status' || initial.statusLive === 'polite', 'voice status is not live');
check(Boolean(initial.progressLabel), 'voice progress has no accessible name');

await page.click('#hqVoiceBtn');
await page.waitForFunction(() => /loading hq voice/i.test(document.getElementById('voiceStatus')?.textContent ?? ''));
const loading = await page.evaluate(() => ({
  disabled: document.getElementById('hqVoiceBtn')?.disabled,
  hidden: document.getElementById('voiceProgress')?.hidden,
  busy: document.getElementById('hqVoiceBtn')?.getAttribute('aria-busy'),
}));
check(loading.disabled === true, 'HQ button was not disabled during load');
check(loading.hidden === false, 'HQ progress was not shown during load');
check(loading.busy === 'true', 'HQ button did not expose aria-busy during load');

await page.waitForFunction(() => /hq voice ready/i.test(document.getElementById('voiceStatus')?.textContent ?? ''), null, { timeout: 15000 });
const ready = await page.evaluate(() => ({
  activeKind: window.__lab.speech.activeKind,
  loaded: window.__lab.speech.hqLoaded,
  progress: document.getElementById('voiceProgress')?.value,
  progressHidden: document.getElementById('voiceProgress')?.hidden,
}));
check(lazyRequests.length > 0, 'Kokoro runtime was not requested after click');
check(ready.activeKind === 'kokoro' && ready.loaded === true, `adapter did not swap after load: ${JSON.stringify(ready)}`);
check(ready.progress === 100, `ready progress did not reach 100: ${ready.progress}`);
check(ready.progressHidden === true, 'progress remained visible after ready');

await page.fill('#saybar input', 'canonical viseme smoke');
await page.click('#speakBtn');
const canonical = [
  'viseme_sil', 'viseme_aa', 'viseme_ee', 'viseme_ih', 'viseme_oh', 'viseme_ou',
  'viseme_pp', 'viseme_ff', 'viseme_th', 'viseme_dd', 'viseme_kk', 'viseme_ch',
  'viseme_ss', 'viseme_nn', 'viseme_rr',
];
const framesSeen = new Set();
const morphsSeen = new Set();
const tongueMorphsSeen = new Set();
for (let index = 0; index < 75; index += 1) {
  await page.waitForTimeout(45);
  const sample = await page.evaluate((names) => {
    const weights = window.__lab.speech.frameWeights;
    const active = names.filter((name) => (weights[name] ?? 0) > 0.01);
    const applied = [];
    window.__lab.scene.traverse((object) => {
      if (!object.isMesh || !object.morphTargetDictionary || !object.morphTargetInfluences) return;
      for (const name of active) {
        const morphIndex = object.morphTargetDictionary[name];
        if (morphIndex !== undefined && object.morphTargetInfluences[morphIndex] > 0.01) applied.push(name);
      }
    });
    const tongues = [];
    window.__lab.scene.traverse((object) => {
      if (!object.isMesh || !object.morphTargetDictionary || !object.morphTargetInfluences) return;
      for (const name of ['tongue_up', 'tongue_out', 'tongue_back']) {
        const morphIndex = object.morphTargetDictionary[name];
        if (morphIndex !== undefined && object.morphTargetInfluences[morphIndex] > 0.01) tongues.push(name);
      }
    });
    return { active, applied, tongues, silence: window.__lab.speech.lastFrameWasSilence };
  }, canonical);
  for (const name of sample.active) framesSeen.add(name);
  for (const name of sample.applied) morphsSeen.add(name);
  for (const name of sample.tongues) tongueMorphsSeen.add(name);
  if (sample.silence) framesSeen.add('viseme_sil');
}
check(canonical.every((name) => framesSeen.has(name)), `not every canonical frame arrived: ${canonical.filter((name) => !framesSeen.has(name)).join(', ')}`);
check(canonical.filter((name) => name !== 'viseme_sil').every((name) => morphsSeen.has(name)), `canonical weights did not reach morph meshes: ${canonical.filter((name) => name !== 'viseme_sil' && !morphsSeen.has(name)).join(', ')}`);
check(['tongue_up', 'tongue_out', 'tongue_back'].every((name) => tongueMorphsSeen.has(name)), `tongue correctives did not reach morph meshes: ${['tongue_up', 'tongue_out', 'tongue_back'].filter((name) => !tongueMorphsSeen.has(name)).join(', ')}`);

await page.fill('#saybar input', 'cancel this long provider utterance');
await page.click('#speakBtn');
await page.waitForFunction(() => window.__lab.speech.speaking === true);
await page.waitForTimeout(250);
await page.click('#speakBtn');
await page.waitForFunction(() => window.__lab.speech.speaking === false);
await page.waitForFunction((names) => {
  const weights = window.__lab.speech.frameWeights;
  if (names.some((name) => (weights[name] ?? 0) > 0.001)) return false;
  let activeMorph = false;
  window.__lab.scene.traverse((object) => {
    if (activeMorph || !object.isMesh || !object.morphTargetDictionary || !object.morphTargetInfluences) return;
    for (const name of names) {
      const index = object.morphTargetDictionary[name];
      if (index !== undefined && object.morphTargetInfluences[index] > 0.01) {
        activeMorph = true;
        return;
      }
    }
  });
  return !activeMorph;
}, [...canonical, 'tongue_up', 'tongue_out', 'tongue_back']);
const cancelled = await page.evaluate(() => ({
  label: document.getElementById('speakBtn')?.textContent,
  pressed: document.getElementById('speakBtn')?.getAttribute('aria-pressed'),
  revoke: window.__speechSmokeResources.revoke,
}));
check(cancelled.label === 'speak' && cancelled.pressed === 'false', `cancel state incorrect: ${JSON.stringify(cancelled)}`);
check(cancelled.revoke >= 1, 'cancellation did not release the provider object URL');

await page.fill('#saybar input', 'force kokoro failure');
await page.click('#speakBtn');
await page.waitForFunction(() => /browser voice restored/i.test(document.getElementById('voiceStatus')?.textContent ?? ''), null, { timeout: 10000 });
const synthesisFailure = await page.evaluate(() => ({
  activeKind: window.__lab.speech.activeKind,
  retryDisabled: document.getElementById('hqVoiceBtn')?.disabled,
  retryLabel: document.getElementById('hqVoiceBtn')?.textContent,
}));
check(synthesisFailure.activeKind === 'browser', `synthesis failure did not restore browser adapter: ${JSON.stringify(synthesisFailure)}`);
check(synthesisFailure.retryDisabled === false && /retry/i.test(synthesisFailure.retryLabel ?? ''), 'HQ retry was not offered after synthesis failure');

await page.waitForFunction(() => window.__lab.speech.speaking === true);
let fallbackPeak = 0;
for (let index = 0; index < 20; index += 1) {
  await page.waitForTimeout(75);
  fallbackPeak = Math.max(fallbackPeak, await page.evaluate(() => {
    let peak = 0;
    window.__lab.scene.traverse((object) => {
      if (!object.isMesh || !object.morphTargetDictionary || !object.morphTargetInfluences) return;
      for (const [name, morphIndex] of Object.entries(object.morphTargetDictionary)) {
        if (name.startsWith('viseme_') && name !== 'viseme_sil') peak = Math.max(peak, object.morphTargetInfluences[morphIndex] ?? 0);
      }
    });
    return peak;
  }));
}
check(fallbackPeak > 0.1, `boundaryless browser fallback was not visible (peak ${fallbackPeak.toFixed(3)})`);
if (await page.evaluate(() => window.__lab.speech.speaking)) await page.click('#speakBtn');
await page.waitForFunction(() => window.__lab.speech.speaking === false);

await page.evaluate(() => { window.__forceKokoroLoadFailure = true; });
await page.click('#hqVoiceBtn');
await page.waitForFunction(() => /browser voice restored/i.test(document.getElementById('voiceStatus')?.textContent ?? '') && !document.getElementById('hqVoiceBtn')?.disabled, null, { timeout: 10000 });
check(await page.evaluate(() => window.__lab.speech.activeKind === 'browser'), 'forced HQ load failure replaced the browser adapter');

const resourcesBeforeUnload = await page.evaluate(() => ({ ...window.__speechSmokeResources }));
await page.evaluate(() => {
  window.dispatchEvent(new Event('beforeunload'));
  window.dispatchEvent(new Event('beforeunload'));
});
await page.waitForTimeout(50);
const resourcesAfterUnload = await page.evaluate(() => ({ ...window.__speechSmokeResources }));
check(resourcesAfterUnload.audioClose - resourcesBeforeUnload.audioClose === 1, `audio disposed ${resourcesAfterUnload.audioClose - resourcesBeforeUnload.audioClose} times on repeated unload`);

if (errors.length) failures.push(`page errors: ${errors.join('; ')}`);
await browser.close();
if (failures.length) {
  console.error(`FAIL:\n - ${failures.join('\n - ')}`);
  process.exit(1);
}
console.log('PASS: Kokoro demo lazy load, visemes, cancellation, fallback, and disposal');
