import Anthropic from '@anthropic-ai/sdk';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Plugin } from 'vite';
import { AgentError, runAgentTurn, type MessagesClient } from './agent';
import { parseChatRequest } from './chat-request';
import { loadDatasetFromDisk } from './dataset-node';
import { createClient, liveModel } from './live-client';

const MAX_BODY = 64 * 1024;

/**
 * `npm run dev:live`: mounts POST /api/chat on the Vite dev server (Node, localhost only).
 * The API key stays in this process; the browser only ever receives the transcript.
 */
export function liveApiPlugin(): Plugin {
  let client: MessagesClient | null = null;
  const dataset = loadDatasetFromDisk();

  return {
    name: 'factory-twin-live-api',
    apply: 'serve',
    configureServer(server) {
      if (!process.env.ANTHROPIC_API_KEY) {
        server.config.logger.warn(
          '[live] ANTHROPIC_API_KEY is not set; /api/chat will answer 503. See .env.example.',
        );
      } else {
        server.config.logger.info(`[live] /api/chat ready, model ${liveModel()}`);
      }
      server.middlewares.use('/api/chat', (req, res) => {
        void handle(req, res).catch((err: unknown) => {
          server.config.logger.error(`[live] ${(err as Error).message}`);
          send(res, 500, { error: 'Internal error' });
        });
      });
    },
  };

  async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    if (req.method !== 'POST') return send(res, 405, { error: 'POST only' });
    // Only the local page may spend the key: refuse cross-site requests to localhost.
    const origin = req.headers.origin;
    if (origin && !/^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(origin)) {
      return send(res, 403, { error: 'Cross-origin requests are not allowed' });
    }
    if (!req.headers['content-type']?.includes('application/json')) {
      return send(res, 415, { error: 'Expected application/json' });
    }
    let body: unknown;
    try {
      body = JSON.parse(await readBody(req));
    } catch (err) {
      return send(res, 400, { error: (err as Error).message || 'Invalid JSON' });
    }
    const parsed = parseChatRequest(body);
    if (!parsed.ok) return send(res, 400, { error: parsed.error });

    try {
      client ??= createClient();
    } catch (err) {
      return send(res, 503, { error: (err as Error).message });
    }

    try {
      const turn = await runAgentTurn({ client, dataset, model: liveModel(), ...parsed.value });
      send(res, 200, turn);
    } catch (err) {
      if (err instanceof AgentError) return send(res, 502, { error: err.message });
      if (err instanceof Anthropic.AuthenticationError)
        return send(res, 502, { error: 'The API key was rejected.' });
      if (err instanceof Anthropic.RateLimitError)
        return send(res, 429, { error: 'Rate limited; try again shortly.' });
      if (err instanceof Anthropic.APIError)
        return send(res, 502, { error: `Claude API error (${err.status ?? 'network'})` });
      throw err;
    }
  }
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => {
      size += c.length;
      if (size > MAX_BODY) {
        reject(new Error('Request body too large'));
        req.destroy();
      } else chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function send(res: ServerResponse, status: number, payload: unknown): void {
  res.statusCode = status;
  res.setHeader('content-type', 'application/json; charset=utf-8');
  res.setHeader('cache-control', 'no-store');
  res.end(JSON.stringify(payload));
}
