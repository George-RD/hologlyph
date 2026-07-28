# hologlyph

A web-native, text-skinned talking head for interactive pages.

Three.js is externalised from the hologlyph bundles and should be provided by the consuming app as a peer dependency. By default, `createEngine()` (or the `<hologlyph-head>` element with no `src`) loads a packaged realistic head bust lazy-loaded as a ~880 kB gzip chunk; the main bundle is 38 kB gzip. The bust is built from ICT-FaceKit (USC-ICT, MIT) -- the licence survives sublicensing of the derived binary. Pass `avatarUrl` to override with your own GLB. Set `avatarUrl: ''` to force the lightweight procedural placeholder. Load failures degrade gracefully to the placeholder with a console warning.

The canvas is transparent and the head renders as glass, so it sits directly on your page background. On mount the engine samples the first opaque background colour at or above its host element and adapts the skin to it: glyphs glow on dark pages, cross over to dark ink on light ones, and the opacity floor lifts on mid tones. Override the detection when your background is painted somewhere the walk cannot see it, for example a canvas or an image:

```ts
const engine = createEngine({
  headConfig: { skin: { backdrop: { color: '#1b3a6b', auto: false } } },
});
```

Set `skin.backdrop.adapt` to `0` to pin the dark-page look on every background, and tune the glass itself through `skin.glass` (`fresnel`, `specular`, `refraction`, `tint`).

### Glyphs suspended inside the glass

`skin.glass` dresses the surface; `interior` fills the volume behind it. Raise
`interior.count` above `0` and the engine suspends that many camera-facing
glyph sprites between the near and far surfaces of the head, placed by the
same baked thickness field the glass absorption uses and sampling cells of the
text-skin canvas the surface already carries, so it costs no new asset and no
second texture upload.

```ts
engine.vfx.setHeadConfig({ interior: { count: 240, inertia: 0.55 } });
```

Each glyph chases a rest position carried by the head's own frame, so moving
the head drags them off course and they settle again; `inertia` is how far
behind they run, `drift` how much they wander while the head is still, and
`depthFade` how much the far ones dim and desaturate. They can never be
brighter than the surface text: `brightness` is clamped to `[0,1]` and
multiplies the sampled letterform.

`interior.count` is a hard gate and ships at `0`. Nothing is sampled, nothing
is allocated and no object joins the scene until you raise it. Under
`prefers-reduced-motion` the lag is removed and the drift is damped.

## Declarative web component

The web component is the primary surface. Register it once, then use the custom element in HTML.

```sh
npm install hologlyph
```

```ts
import { defineHologlyphHead } from 'hologlyph';

defineHologlyphHead();
```

```html
<hologlyph-head
  src="/avatar.glb"
  text-skin="Welcome to hologlyph"
  mode="auto"
></hologlyph-head>
```

The element also exposes `speak(text)` and `setEmotion(expression)` for imperative control after it is registered:

```ts
import type { HologlyphHeadElement } from 'hologlyph';

const head = document.querySelector<HologlyphHeadElement>('hologlyph-head');
head?.setEmotion('friendly');
await head?.speak('Hello');
```

Supported attributes are `src`, `text-skin`, `mode`, `reduced-motion`, and
`refract`.

## Optional page lens (`refract`)

By default the head is a transparent canvas and the page behind it shows
through undisturbed. Point `refract` at a CSS selector and that subtree is
rasterised and refracted through the glass, displaced by the head's surface
normals and its baked thickness.

```sh
npm install @zumer/snapdom
```

```html
<section id="hero">...</section>
<hologlyph-head refract="#hero"></hologlyph-head>
```

No browser API hands rendered page pixels to WebGL, so by default this is a
SNAPSHOT, not a live feed (one Chromium exception, below), and the limits are
part of the contract rather than bugs:

- **Content is frozen between captures.** A CSS animation behind the head does
  not move in the refraction. Captures happen on request, when the source moves
  or resizes, and once a scroll settles; never per frame.
- **Cross-origin images need CORS headers** or they rasterise blank, silently.
- **`position: fixed` subtrees are typically excluded** by DOM rasterisers.
- **The first capture costs 10 to 150 ms of main thread** on a real page.
- **Never point it at `document.body`.** Every limit above scales with what is
  inside.

Switching the lens on also makes the head opaque where it covers the named
subtree, which moves the head-over-page blend from the browser compositor into
the scene. Turn `lens.amount` down to crossfade back towards the live
page.

A named source also stands the compositor glass layer down while it is
contributing pixels. That layer (`compositor`, off by default) frosts the
live page behind the silhouette, and it answers the same question the lens
does, so a page running both would show the backdrop twice at two different
offsets. The higher rung wins, because you had to name a subtree to get it. A
source that never captures, one whose rasteriser will not load, or one behind
`skin.glass.amount: 0`, does not count: the lens is painting nothing in each
case, so the frost stays exactly where it was.

`@zumer/snapdom` is an optional peer dependency, loaded through a dynamic
import the first time a subtree is named, so it costs nothing when the
attribute is absent. Supply your own rasteriser instead and you need no peer at
all:

```ts
engine.setLensSource(document.querySelector('#hero'), {
  rasterise: async (element) => myRasteriser(element), // -> CanvasImageSource
});
engine.captureLens(); // force a fresh snapshot
```

### Live DOM where Chromium allows it

Chromium behind `--enable-blink-features=CanvasDrawElement` can paint real DOM
into a canvas at vsync, which is the only way to refract a running CSS
animation or the value someone is typing. The library uses it automatically
when it is there and never depends on it:

```html
<canvas layoutsubtree width="720" height="720">
  <div id="hero">live, animating content</div>
</canvas>
<hologlyph-head refract="#hero"></hologlyph-head>
```

Two conditions, both silent when unmet. The API must be present, and the named
element must be an IMMEDIATE CHILD of a `<canvas layoutsubtree>`, because
Chromium only allows an element to be drawn into the canvas that owns it. Miss
either and you get the snapshot lens above, with no error and no difference in
what you write. Passing your own `rasterise` always chooses the snapshot path.

While it is engaged the lens draws the named element into its parent canvas
every frame, so that canvas belongs to the lens, not to your own 2D drawing.

**Keep interactive controls out of the refracted subtree.** Hit-testing follows
the undistorted layout box, and `getElementTransform` can only express an
affine mapping, so a lens can never be reconciled with it: a control under the
head is unreachable there. The engine warns when it finds one as the source is
bound, and it cannot do anything else, because it must not move your DOM. It
does not re-check afterwards, so a control added to the subtree later goes
unmentioned.

The API is Chromium-only and was origin-trialled in Chrome 148 to 150. Nothing
here is load-bearing: when it lapses, the snapshot path is what remains.

## Imperative engine

Use the engine directly when your application owns the canvas and host element.

```sh
npm install hologlyph
```

```ts
import { createEngine } from 'hologlyph';

const engine = createEngine({ avatarUrl: '/avatar.glb' });
const canvas = document.querySelector('canvas');
const host = document.querySelector<HTMLElement>('#head-host');

if (canvas && host) {
  await engine.mount(canvas, host);
  engine.setEmotion('friendly');
  await engine.speak('Hello');
}
```

## Optional Kokoro HQ voice

Install the optional adapter, then load it only from an explicit user gesture.
The model weights remain outside the Hologlyph bundle and download on demand.

```sh
npm install hologlyph kokoro-js
```

```ts
import { createKokoroTTSAdapter } from 'hologlyph/speech';

const hqVoice = createKokoroTTSAdapter({
  dtype: 'q8',
  onProgress: ({ progress }) => console.log(progress),
});

loadVoiceButton.addEventListener('click', async () => {
  try {
    await engine.audio.resumeFromGesture();
    await hqVoice.load();
    engine.setVoiceAdapter(hqVoice);
  } catch (error) {
    console.error('HQ voice load failed; keeping the current adapter', error);
  }
});
```

The caller owns the adapter passed to `setVoiceAdapter` and must dispose it
after the engine no longer uses it. Model or synthesis errors emit `error` and
`end`; the host decides whether to restore another adapter.

## React

```sh
npm install hologlyph react
```

The wrapper accepts the caller's React namespace, so it does not import React itself:

```tsx
import * as React from 'react';
import { createHologlyphHead } from 'hologlyph/react';

const HologlyphHead = createHologlyphHead(React);

export function Avatar() {
  return (
    <HologlyphHead
      src="/avatar.glb"
      text="Welcome"
      mode="auto"
      onReady={() => console.log('ready')}
      onSpeechStart={() => console.log('speaking')}
    />
  );
}
```

Available wrapper props include `src`, `text`, `mode`, `reducedMotion`, `onReady`, `onStateChange`, `onSpeechStart`, `onSpeechEnd`, and `onError`.

## Vue

```sh
npm install hologlyph vue
```

Register the returned Vue 3 options component. Tell the Vue compiler to treat `hologlyph-head` as a custom element (for example via `app.config.compilerOptions.isCustomElement`), then use it in a single-file component:

```vue
<script setup lang="ts">
  import { hologlyphHeadVue } from 'hologlyph/vue';

  const HologlyphHead = hologlyphHeadVue();
</script>

<template>
  <HologlyphHead src="/avatar.glb" text="Welcome" mode="auto" />
</template>
```

The component props are `src`, `text`, `mode`, and `reducedMotion`. It emits `ready`, `statechange`, `speechstart`, `speechend`, and `error`.

## Svelte

```sh
npm install hologlyph svelte
```

Use the exported action on a `hologlyph-head` element:

```svelte
<script lang="ts">
  import { hologlyphHead } from 'hologlyph/svelte';

  let avatar = '/avatar.glb';
</script>

<hologlyph-head
  use:hologlyphHead={{
    src: avatar,
    text: 'Welcome',
    mode: 'auto',
    onReady: () => console.log('ready'),
  }}
/>
```

The action accepts `src`, `text`, `mode`, `reducedMotion`, `onReady`, `onStateChange`, `onSpeechStart`, `onSpeechEnd`, and `onError`.
