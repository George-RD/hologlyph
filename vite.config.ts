import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    lib: {
      entry: {
        hologlyph: 'src/index.ts',
        'adapters/react': 'src/adapters/react.ts',
        'adapters/vue': 'src/adapters/vue.ts',
        'adapters/svelte': 'src/adapters/svelte.ts',
        speech: 'src/speech/index.ts',
      },
      formats: ['es'],
    },
    rollupOptions: {
      // `kokoro-js` and `@zumer/snapdom` are optional peers reached only
      // through a dynamic import. External keeps both out of `dist/` entirely,
      // so a consumer who never opts in ships neither byte nor install.
      external: [/^three/, /^kokoro-js/, /^@zumer\/snapdom/],
    },
    target: 'es2022',
    sourcemap: true,
  },
});
