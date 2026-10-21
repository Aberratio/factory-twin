import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { createServer as createHttpServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build, createServer, type ViteDevServer } from 'vite';
import { afterEach, describe, expect, it } from 'vitest';
import { createClient } from '../server/live-client';

// The real vite.config.ts, end to end: is /api/chat mounted only in live mode, and does the
// API key stay out of everything the browser can download?

const root = fileURLToPath(new URL('..', import.meta.url));
const configFile = join(root, 'vite.config.ts');
// assembled at runtime so secret scanners do not mistake the test value for a key
const CANARY = ['canary', 'not', 'a', 'key', '7f3a91'].join('-');

let vite: ViteDevServer | undefined;
let http: Server | undefined;
const savedKey = process.env.ANTHROPIC_API_KEY;
// never let a developer's real .env reach these tests (a live test would make a billed call)
process.env.FACTORY_TWIN_SKIP_DOTENV = '1';

afterEach(async () => {
  await new Promise<void>((r) => (http ? http.close(() => r()) : r()));
  await vite?.close();
  vite = http = undefined;
  if (savedKey === undefined) delete process.env.ANTHROPIC_API_KEY;
  else process.env.ANTHROPIC_API_KEY = savedKey;
});

async function serve(mode: string): Promise<string> {
  vite = await createServer({
    configFile,
    root,
    mode,
    logLevel: 'silent',
    appType: 'custom',
    server: { middlewareMode: true, hmr: false, ws: false },
  });
  const middlewares = vite.middlewares;
  http = createHttpServer((req, res) =>
    middlewares(req, res, () => {
      res.statusCode = 404;
      res.end('not found');
    }),
  );
  await new Promise<void>((r) => http?.listen(0, '127.0.0.1', r));
  return `http://127.0.0.1:${(http.address() as AddressInfo).port}/api/chat`;
}

const ask = (url: string) =>
  fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ question: 'Which line is down?' }),
  });

describe('live mode wiring (vite.config.ts)', () => {
  it('mounts /api/chat in live mode; without a key it answers 503 with a hint', async () => {
    delete process.env.ANTHROPIC_API_KEY;
    const res = await ask(await serve('live'));
    expect(res.status).toBe(503);
    expect(((await res.json()) as { error: string }).error).toMatch(/ANTHROPIC_API_KEY/);
  }, 30_000);

  it('does not mount /api/chat in the default (recorded) mode', async () => {
    process.env.ANTHROPIC_API_KEY = CANARY;
    const res = await ask(await serve('development'));
    expect(res.status).toBe(404);
  }, 30_000);
});

describe('createClient', () => {
  it('refuses to start without a key and builds a client with one (no network call)', () => {
    delete process.env.ANTHROPIC_API_KEY;
    expect(() => createClient()).toThrow(/ANTHROPIC_API_KEY/);
    process.env.ANTHROPIC_API_KEY = CANARY;
    expect(typeof createClient().beta.messages.create).toBe('function');
  });
});

describe('the API key never reaches the browser', () => {
  it('a build made with a key in the environment contains neither the key nor the SDK', async () => {
    process.env.ANTHROPIC_API_KEY = CANARY;
    const outDir = mkdtempSync(join(tmpdir(), 'factory-twin-build-'));
    try {
      for (const mode of ['production', 'live']) {
        await build({
          configFile,
          root,
          mode,
          logLevel: 'silent',
          build: { outDir, emptyOutDir: true },
        });
        const files: string[] = [];
        const walk = (dir: string) => {
          for (const name of readdirSync(dir)) {
            const p = join(dir, name);
            if (statSync(p).isDirectory()) walk(p);
            else files.push(p);
          }
        };
        walk(outDir);
        expect(files.length).toBeGreaterThan(1);
        // base './': the page must work from any sub-path (kokot.it embeds it under one)
        const html = readFileSync(join(outDir, 'index.html'), 'utf8');
        expect(html).toContain('src="./assets/');
        expect(html).not.toMatch(/(src|href)="\/assets\//);
        for (const file of files) {
          const text = readFileSync(file, 'utf8');
          expect(text.includes(CANARY), `${mode}: ${file}`).toBe(false);
          expect(/@anthropic-ai|api\.anthropic\.com/.test(text), `${mode}: ${file}`).toBe(false);
        }
      }
    } finally {
      rmSync(outDir, { recursive: true, force: true });
    }
  }, 60_000);
});
