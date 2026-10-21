import Anthropic from '@anthropic-ai/sdk';
import { DEFAULT_MODEL, type MessagesClient } from './agent';

/** Server-side only. Reads ANTHROPIC_API_KEY from the environment; the key never reaches the browser. */
export function createClient(): MessagesClient {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error('ANTHROPIC_API_KEY is not set. Copy .env.example to .env and add your key.');
  }
  const anthropic = new Anthropic();
  return { beta: { messages: { create: (params) => anthropic.beta.messages.create(params) } } };
}

export function liveModel(): string {
  return process.env.FACTORY_TWIN_MODEL || DEFAULT_MODEL;
}
