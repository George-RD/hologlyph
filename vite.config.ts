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
      external: [/^three/, /^kokoro-js/],
    },
    target: 'es2022',
    sourcemap: true,
  },
});
