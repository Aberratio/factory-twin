import { defineConfig } from 'vitest/config';

// Browser smoke tests: `npm run test:e2e` (builds first, needs Playwright's Chromium).
export default defineConfig({
  test: {
    include: ['tests-e2e/**/*.e2e.ts'],
    testTimeout: 60_000,
    hookTimeout: 60_000,
    fileParallelism: false,
  },
});
