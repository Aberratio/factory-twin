/// <reference types="vitest/config" />
import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  server: { host: 'localhost' },
  preview: { host: 'localhost' },
  test: { include: ['tests/**/*.test.ts'] },
});
