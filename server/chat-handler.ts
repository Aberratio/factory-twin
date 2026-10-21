import Anthropic from '@anthropic-ai/sdk';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Dataset } from '../src/domain/types';
import { AgentError, runAgentTurn, type MessagesClient } from './agent';
import { parseChatRequest } from './chat-request';

export const MAX_BODY = 64 * 1024;
const LOCAL_ORIGIN = /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/;

export interface ChatHandlerOptions {
  dataset: Dataset;
  model: string;
  /** Creates the SDK client on first use; throws when no key is configured. */
  getClient: () => MessagesClient;
  log?: (message: string) => void;
}

/**
 * POST /api/chat for live mode. Runs in the local Node process that holds the API key;
 * the browser gets back only the transcript. Every refusal is a JSON { error } with a status.
 */
export function createChatHandler(opts: ChatHandlerOptions) {
  let client: MessagesClient | null = null;

  async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    if (req.method !== 'POST') return send(res, 405, { error: 'POST only' });
    // Only the local page may spend the key: refuse cross-site requests to localhost.
    const origin = req.headers.origin;
    if (origin && !LOCAL_ORIGIN.test(origin)) {
      return send(res, 403, { error: 'Cross-origin requests are not allowed' });
    }
    if (!req.headers['content-type']?.includes('application/json')) {
      return send(res, 415, { error: 'Expected application/json' });
    }

    let raw: string;
    try {
      raw = await readBody(req);
    } catch {
      return send(res, 413, { error: `Request body over ${MAX_BODY} bytes` });
    }
    let body: unknown;
    try {
      body = JSON.parse(raw);
    } catch {
      return send(res, 400, { error: 'Invalid JSON' });
    }
    const parsed = parseChatRequest(body);
    if (!parsed.ok) return send(res, 400, { error: parsed.error });

    try {
      client ??= opts.getClient();
    } catch (err) {
      return send(res, 503, { error: (err as Error).message });
    }

    try {
      const turn = await runAgentTurn({
        client,
        dataset: opts.dataset,
        model: opts.model,
        ...parsed.value,
      });
      send(res, 200, turn);
    } catch (err) {
      const [status, message] = describeError(err);
      opts.log?.(`[live] ${status}: ${(err as Error).message}`);
      send(res, status, { error: message });
    }
  }

  return (req: IncomingMessage, res: ServerResponse): void => {
    handle(req, res).catch((err: unknown) => {
      opts.log?.(`[live] 500: ${(err as Error).message}`);
      if (!res.headersSent) send(res, 500, { error: 'Internal error' });
    });
  };
}

function describeError(err: unknown): [number, string] {
  if (err instanceof AgentError) return [502, err.message];
  if (err instanceof Anthropic.AuthenticationError) return [502, 'The API key was rejected.'];
  if (err instanceof Anthropic.RateLimitError) return [429, 'Rate limited; try again shortly.'];
  if (err instanceof Anthropic.APIError)
    return [502, `Claude API error (${err.status ?? 'network'})`];
  return [500, 'Internal error'];
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => {
      size += c.length;
      if (size > MAX_BODY) {
        req.removeAllListeners('data');
        req.resume();
        reject(new Error('too large'));
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
