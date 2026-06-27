import { defineWorkspace } from 'vitest/config';
import react from '@vitejs/plugin-react';

// Two test tiers as separate Vitest projects:
//   • unit    — fast, happy-dom, system boundaries mocked (the bulk)
//   • browser — real Chromium via Playwright, for code that needs a real DOM
//               (CodeMirror, getComputedStyle theme vars, layout)
export default defineWorkspace([
  {
    plugins: [react()],
    test: {
      name: 'unit',
      environment: 'happy-dom',
      globals: true,
      setupFiles: ['./tests/setup.unit.ts'],
      include: ['src/**/*.test.{ts,tsx}'],
      exclude: ['src/**/*.browser.test.{ts,tsx}', 'node_modules/**'],
    },
  },
  {
    plugins: [react()],
    test: {
      name: 'browser',
      globals: true,
      setupFiles: ['./tests/setup.browser.ts'],
      include: ['src/**/*.browser.test.{ts,tsx}'],
      browser: {
        enabled: true,
        provider: 'playwright',
        name: 'chromium',
        headless: true,
        screenshotFailures: false,
      },
    },
  },
]);
