/// <reference types="vitest/config" />
import { defineConfig, loadEnv, type PluginOption } from 'vite';

export default defineConfig(async ({ mode }) => {
  const plugins: PluginOption[] = [];
  if (mode === 'live') {
    // Load .env into this Node process only. Nothing here is exposed to the browser:
    // Vite ships only VITE_-prefixed variables, and the key is not one of them.
    const env = loadEnv(mode, process.cwd(), '');
    for (const key of ['ANTHROPIC_API_KEY', 'FACTORY_TWIN_MODEL']) {
      if (env[key] && !process.env[key]) process.env[key] = env[key];
    }
    const { liveApiPlugin } = await import('./server/vite-live-plugin');
    plugins.push(liveApiPlugin());
  }

  return {
    base: './',
    plugins,
    server: { host: 'localhost' },
    preview: { host: 'localhost' },
    build: { target: 'es2022', chunkSizeWarningLimit: 800 },
    test: { include: ['tests/**/*.test.ts'] },
  };
});
