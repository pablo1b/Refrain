import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Strudel's webaudio package registers an AudioWorklet and pulls in a few
// globals; esnext + optimizeDeps keeps it happy inside a Vite app.
export default defineConfig({
  plugins: [react()],
  server: { port: 5173 },
  build: { target: 'esnext' },
  // @strudel/web is a large self-contained bundle (its own core + AudioWorklet)
  // used for playback; @strudel/transpiler is a tiny, side-effect-free evaluator
  // the engine uses only for read-only clock-tick queries. Pre-bundle both for
  // fast, stable dev loads. (The transpiler pulls a 2nd @strudel/core; that's
  // intentional and harmless — see src/audio/strudelEngine.ts.)
  optimizeDeps: {
    include: ['@strudel/web', '@strudel/transpiler'],
    esbuildOptions: { target: 'esnext' },
  },
});
