import type Anthropic from '@anthropic-ai/sdk';
import { executeTool, TOOL_DEFINITIONS } from '../src/agent/tools';
import { systemPrompt } from '../src/agent/system-prompt';
import type { Transcript, TranscriptStep } from '../src/agent/transcript';
import type { Dataset, Lang } from '../src/domain/types';

export const DEFAULT_MODEL = 'claude-opus-5-5';
const MAX_ROUNDS = 8;

/** The one SDK call the loop needs; the real client is adapted to it in live-server.ts, tests pass a fake. */
export interface MessagesClient {
  beta: {
    messages: {
      create(
        params: Anthropic.Beta.MessageCreateParamsNonStreaming,
      ): Promise<Anthropic.Beta.BetaMessage>;
    };
  };
}

export interface HistoryTurn {
  question: string;
  answer: string;
}

export interface AgentTurn {
  transcript: Transcript;
  /** The model that actually answered (differs from the requested one after a server-side fallback). */
  model: string;
}

export class AgentError extends Error {}

export async function runAgentTurn(args: {
  client: MessagesClient;
  dataset: Dataset;
  question: string;
  lang: Lang;
  history: HistoryTurn[];
  model?: string;
}): Promise<AgentTurn> {
  const { client, dataset, question, lang } = args;
  const model = args.model ?? DEFAULT_MODEL;

  const messages: Anthropic.Beta.BetaMessageParam[] = [
    ...args.history.flatMap((h): Anthropic.Beta.BetaMessageParam[] => [
      { role: 'user', content: h.question },
      { role: 'assistant', content: h.answer },
    ]),
    { role: 'user', content: question },
  ];
  const steps: TranscriptStep[] = [];

  for (let round = 0; round < MAX_ROUNDS; round++) {
    const response = await client.beta.messages.create({
      model,
      max_tokens: 16000,
      system: [
        { type: 'text', text: systemPrompt(dataset, lang), cache_control: { type: 'ephemeral' } },
      ],
      tools: TOOL_DEFINITIONS as Anthropic.Beta.BetaTool[],
      // Opus 5.5: thinking cannot be disabled; effort defaults to medium, so it is set explicitly.
      thinking: { type: 'adaptive' },
      output_config: { effort: 'medium' },
      // On a safety-classifier decline, the API reruns the request on Anthropic's recommended model.
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      messages,
    });

    if (response.stop_reason === 'refusal') {
      throw new AgentError('The model declined to answer this question.');
    }
    if (response.stop_reason === 'max_tokens') {
      throw new AgentError('The answer was cut off (max_tokens).');
    }

    for (const block of response.content) {
      if (block.type === 'text' && block.text.trim())
        steps.push({ type: 'text', text: block.text });
    }
    const toolUses = response.content.filter(
      (b): b is Anthropic.Beta.BetaToolUseBlock => b.type === 'tool_use',
    );

    if (response.stop_reason !== 'tool_use' && response.stop_reason !== 'pause_turn') {
      return { transcript: { question, steps }, model: response.model };
    }

    // Full content goes back unchanged, thinking blocks included.
    messages.push({ role: 'assistant', content: response.content });
    if (response.stop_reason === 'pause_turn') continue;

    const results: Anthropic.Beta.BetaToolResultBlockParam[] = toolUses.map((use) => {
      const result = executeTool(dataset, use.name, use.input);
      steps.push({ type: 'tool_call', id: use.id, name: use.name, input: use.input, result });
      return {
        type: 'tool_result',
        tool_use_id: use.id,
        content: JSON.stringify(result.ok ? result.data : { error: result.error }),
        ...(result.ok ? {} : { is_error: true }),
      };
    });
    // All results of one turn in a single user message, in call order.
    messages.push({ role: 'user', content: results });
  }
  throw new AgentError(`No final answer after ${MAX_ROUNDS} tool rounds.`);
}
