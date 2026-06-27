import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Strudel's webaudio package registers an AudioWorklet and pulls in a few
// globals; esnext + optimizeDeps keeps it happy inside a Vite app.
export default defineConfig({
  plugins: [react()],
  server: { port: 5173 },
  build: { target: 'esnext' },
  // @strudel/core is a singleton (it warns if instantiated twice). The engine
  // dynamically imports BOTH @strudel/web and @strudel/transpiler; pre-bundle
  // them in the same optimize pass and dedupe core so it loads exactly once.
  resolve: { dedupe: ['@strudel/core'] },
  optimizeDeps: {
    include: ['@strudel/web', '@strudel/transpiler'],
    esbuildOptions: { target: 'esnext' },
  },
});
