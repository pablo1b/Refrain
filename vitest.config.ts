import { defineConfig } from 'vitest/config';

// Root Vitest config. Projects (unit + browser tiers) live in
// vitest.workspace.ts; root-only options like coverage belong here.
export default defineConfig({
  test: {
    coverage: {
      provider: 'v8',
      reportsDirectory: './coverage',
      reporter: ['text', 'html'],
      include: ['src/**/*.{ts,tsx}'],
      exclude: [
        'src/**/*.d.ts',
        'src/main.tsx',
        'src/**/*.test.{ts,tsx}',
        'src/**/*.browser.test.{ts,tsx}',
      ],
      // Pure logic — the inner ring — should stay near-total. Components and
      // boundaries are exercised by the browser + agent tiers instead.
      thresholds: {
        'src/music/**': { statements: 90, branches: 85, functions: 90, lines: 90 },
      },
    },
  },
});
