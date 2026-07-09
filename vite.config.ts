import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    lib: {
      entry: {
        hologlyph: 'src/index.ts',
        'adapters/react': 'src/adapters/react.ts',
        'adapters/vue': 'src/adapters/vue.ts',
        'adapters/svelte': 'src/adapters/svelte.ts',
      },
      formats: ['es'],
    },
    rollupOptions: {
      external: [/^three/],
    },
    target: 'es2022',
    sourcemap: true,
  },
});
