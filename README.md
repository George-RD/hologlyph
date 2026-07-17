# hologlyph

A web-native, text-skinned talking head for interactive pages.

Three.js is externalised from the hologlyph bundles and should be provided by the consuming app as a peer dependency. By default, `createEngine()` (or the `<hologlyph-head>` element with no `src`) loads a packaged realistic head bust lazy-loaded as a ~720 kB gzip chunk; the main bundle stays at ~10.8 kB gzip. The bust is built from ICT-FaceKit (USC-ICT, MIT) -- the licence survives sublicensing of the derived binary. Pass `avatarUrl` to override with your own GLB. Set `avatarUrl: ''` to force the lightweight procedural placeholder. Load failures degrade gracefully to the placeholder with a console warning.

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

Supported attributes are `src`, `text-skin`, `mode`, and `reduced-motion`.

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
