import Anthropic from '@anthropic-ai/sdk';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import type { MessagesClient } from '../server/agent';
import { createChatHandler, MAX_BODY } from '../server/chat-handler';
import { demoDataset } from './helpers';

// Request-level tests of POST /api/chat on a real local HTTP server, with a fake SDK client.

const ds = demoDataset();
let server: Server | undefined;

afterEach(async () => {
  await new Promise<void>((resolve) => (server ? server.close(() => resolve()) : resolve()));
  server = undefined;
});

const answer = (text: string) =>
  ({
    content: [{ type: 'text', text, citations: null }],
    stop_reason: 'end_turn',
    model: 'claude-opus-5-5',
  }) as unknown as Anthropic.Beta.BetaMessage;

function client(create: () => Promise<Anthropic.Beta.BetaMessage>): MessagesClient {
  return { beta: { messages: { create } } };
}

async function start(getClient: () => MessagesClient): Promise<string> {
  const handler = createChatHandler({ dataset: ds, model: 'claude-opus-5-5', getClient });
  server = createServer(handler);
  await new Promise<void>((resolve) => server?.listen(0, '127.0.0.1', resolve));
  return `http://127.0.0.1:${(server?.address() as AddressInfo).port}/`;
}

const json = { 'content-type': 'application/json' };
const ok = () => client(async () => answer('L2-M2 is down.'));

async function post(url: string, body: string, headers: Record<string, string> = json) {
  const res = await fetch(url, { method: 'POST', headers, body });
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
}

describe('POST /api/chat', () => {
  it('answers a valid question with the transcript and the model that answered', async () => {
    const url = await start(ok);
    const res = await post(url, JSON.stringify({ question: 'Which line is down?', lang: 'en' }));
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      model: 'claude-opus-5-5',
      transcript: {
        question: 'Which line is down?',
        steps: [{ type: 'text', text: 'L2-M2 is down.' }],
      },
    });
  });

  it('refuses other methods with 405', async () => {
    const url = await start(ok);
    expect((await fetch(url)).status).toBe(405);
  });

  it('refuses a cross-site origin with 403, so another website cannot spend the key', async () => {
    const url = await start(ok);
    const res = await post(url, JSON.stringify({ question: 'x' }), {
      ...json,
      origin: 'https://evil.example',
    });
    expect(res.status).toBe(403);
  });

  it('accepts the local page origin', async () => {
    const url = await start(ok);
    const res = await post(url, JSON.stringify({ question: 'x' }), {
      ...json,
      origin: 'http://localhost:5173',
    });
    expect(res.status).toBe(200);
  });

  it('refuses a non-JSON content type with 415', async () => {
    const url = await start(ok);
    expect((await post(url, 'question=x', { 'content-type': 'text/plain' })).status).toBe(415);
  });

  it('refuses a body over the limit with 413', async () => {
    const url = await start(ok);
    const res = await post(url, JSON.stringify({ question: 'x', pad: 'y'.repeat(MAX_BODY) }));
    expect(res.status).toBe(413);
  });

  it('refuses malformed JSON and an invalid request with 400', async () => {
    const url = await start(ok);
    expect((await post(url, '{nope')).status).toBe(400);
    expect((await post(url, JSON.stringify({ question: '' }))).body).toEqual({
      error: 'question is required',
    });
  });

  it('answers 503 with a hint when no API key is configured', async () => {
    const url = await start(() => {
      throw new Error('ANTHROPIC_API_KEY is not set.');
    });
    const res = await post(url, JSON.stringify({ question: 'x' }));
    expect(res).toEqual({ status: 503, body: { error: 'ANTHROPIC_API_KEY is not set.' } });
  });

  it('maps a refusal to 502, a rate limit to 429 and other API errors to 502', async () => {
    const refusal = {
      content: [],
      stop_reason: 'refusal',
      model: 'm',
    } as unknown as Anthropic.Beta.BetaMessage;
    let url = await start(() => client(async () => refusal));
    expect((await post(url, JSON.stringify({ question: 'x' }))).status).toBe(502);
    await new Promise<void>((r) => server?.close(() => r()));

    url = await start(() =>
      client(async () => {
        throw new Anthropic.RateLimitError(429, undefined, 'slow down', new Headers());
      }),
    );
    expect(await post(url, JSON.stringify({ question: 'x' }))).toEqual({
      status: 429,
      body: { error: 'Rate limited; try again shortly.' },
    });
    await new Promise<void>((r) => server?.close(() => r()));

    url = await start(() =>
      client(async () => {
        throw new Anthropic.InternalServerError(500, undefined, 'boom', new Headers());
      }),
    );
    expect(await post(url, JSON.stringify({ question: 'x' }))).toEqual({
      status: 502,
      body: { error: 'Claude API error (500)' },
    });
  });

  it('reports a rejected key as 502 without echoing the API error', async () => {
    const url = await start(() =>
      client(async () => {
        throw new Anthropic.AuthenticationError(
          401,
          undefined,
          'invalid x-api-key sk-ant-...',
          new Headers(),
        );
      }),
    );
    expect(await post(url, JSON.stringify({ question: 'x' }))).toEqual({
      status: 502,
      body: { error: 'The API key was rejected.' },
    });
  });

  it('never leaks an unexpected error message to the browser', async () => {
    const url = await start(() =>
      client(async () => {
        throw new Error('secret internal detail');
      }),
    );
    expect(await post(url, JSON.stringify({ question: 'x' }))).toEqual({
      status: 500,
      body: { error: 'Internal error' },
    });
  });
});
