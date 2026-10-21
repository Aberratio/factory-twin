import type Anthropic from '@anthropic-ai/sdk';
import { describe, expect, it } from 'vitest';
import { runAgentTurn, type MessagesClient, AgentError } from '../server/agent';
import { executeTool } from '../src/agent/tools';
import { demoDataset } from './helpers';

const ds = demoDataset();

type Block = Anthropic.Beta.BetaContentBlock;

function message(content: Block[], stop_reason: Anthropic.Beta.BetaMessage['stop_reason']) {
  return {
    content,
    stop_reason,
    model: 'claude-opus-5-5',
  } as unknown as Anthropic.Beta.BetaMessage;
}

const toolUse = (id: string, name: string, input: unknown) =>
  ({ type: 'tool_use', id, name, input }) as unknown as Block;
const text = (t: string) => ({ type: 'text', text: t, citations: null }) as unknown as Block;

/** Scripted stand-in for client.beta.messages: records each request, returns the next reply. */
function fakeClient(replies: Anthropic.Beta.BetaMessage[]) {
  const requests: Anthropic.Beta.MessageCreateParamsNonStreaming[] = [];
  const client: MessagesClient = {
    beta: {
      messages: {
        create: async (params) => {
          requests.push(structuredClone(params) as Anthropic.Beta.MessageCreateParamsNonStreaming);
          const next = replies.shift();
          if (!next) throw new Error('no more scripted replies');
          return next;
        },
      },
    },
  };
  return { client, requests };
}

describe('runAgentTurn', () => {
  it('executes the tools Claude asks for and returns a transcript of calls, results and text', async () => {
    const { client, requests } = fakeClient([
      message(
        [
          toolUse('tu_1', 'get_downtime', { category: 'unplanned' }),
          toolUse('tu_2', 'highlight_machines', { machine_ids: ['L2-M2'], tone: 'alert' }),
        ],
        'tool_use',
      ),
      message([text('L2-M2 lost 290 minutes.')], 'end_turn'),
    ]);

    const turn = await runAgentTurn({
      client,
      dataset: ds,
      question: 'Worst machine?',
      lang: 'en',
      history: [],
    });

    expect(turn.transcript.steps).toEqual([
      {
        type: 'tool_call',
        id: 'tu_1',
        name: 'get_downtime',
        input: { category: 'unplanned' },
        result: executeTool(ds, 'get_downtime', { category: 'unplanned' }),
      },
      {
        type: 'tool_call',
        id: 'tu_2',
        name: 'highlight_machines',
        input: { machine_ids: ['L2-M2'], tone: 'alert' },
        result: { ok: true, data: { highlighted: ['L2-M2'], tone: 'alert' } },
      },
      { type: 'text', text: 'L2-M2 lost 290 minutes.' },
    ]);
    expect(turn.model).toBe('claude-opus-5-5');

    // both results go back in ONE user message, in call order
    const second = requests[1]!;
    const last = second.messages.at(-1)!;
    expect(last.role).toBe('user');
    expect(Array.isArray(last.content) && last.content.map((b) => b.type)).toEqual([
      'tool_result',
      'tool_result',
    ]);
  });

  it('sends a failed tool back as is_error so Claude can correct itself', async () => {
    const { client, requests } = fakeClient([
      message([toolUse('tu_1', 'get_machine_status', { machine_id: 'L9-M9' })], 'tool_use'),
      message([text('There is no machine L9-M9.')], 'end_turn'),
    ]);
    await runAgentTurn({ client, dataset: ds, question: 'L9-M9?', lang: 'en', history: [] });
    const result = requests[1]!.messages.at(-1)!
      .content as Anthropic.Beta.BetaToolResultBlockParam[];
    expect(result[0]).toMatchObject({ type: 'tool_result', tool_use_id: 'tu_1', is_error: true });
  });

  it('asks the current Opus with adaptive thinking, explicit effort, server-side fallback and all tools', async () => {
    const { client, requests } = fakeClient([message([text('ok')], 'end_turn')]);
    await runAgentTurn({ client, dataset: ds, question: 'hi', lang: 'pl', history: [] });
    const req = requests[0]!;
    expect(req.model).toBe('claude-opus-5-5');
    expect(req.thinking).toEqual({ type: 'adaptive' });
    expect(req.output_config).toEqual({ effort: 'medium' });
    expect(req.betas).toEqual(['server-side-fallback-2026-07-01']);
    expect(req.fallbacks).toBe('default');
    expect(req.tool_choice).toBeUndefined(); // forced tool choice is a 400 on this model
    expect(req.tools?.map((t) => ('name' in t ? t.name : ''))).toHaveLength(7);
    expect(JSON.stringify(req.system)).toMatch(/Polish/);
  });

  it('replays earlier turns as plain user/assistant text', async () => {
    const { client, requests } = fakeClient([message([text('ok')], 'end_turn')]);
    await runAgentTurn({
      client,
      dataset: ds,
      question: 'And on line 3?',
      lang: 'en',
      history: [{ question: 'Any downtime?', answer: 'Yes, L2-M2.' }],
    });
    expect(requests[0]!.messages).toEqual([
      { role: 'user', content: 'Any downtime?' },
      { role: 'assistant', content: 'Yes, L2-M2.' },
      { role: 'user', content: 'And on line 3?' },
    ]);
  });

  it('stops on a refusal without running the refused turn', async () => {
    const { client } = fakeClient([message([toolUse('tu_1', 'get_downtime', {})], 'refusal')]);
    await expect(
      runAgentTurn({ client, dataset: ds, question: 'x', lang: 'en', history: [] }),
    ).rejects.toThrow(AgentError);
  });

  it('gives up after a bounded number of tool rounds', async () => {
    const loop = Array.from({ length: 20 }, (_, i) =>
      message([toolUse(`tu_${i}`, 'get_plant_overview', {})], 'tool_use'),
    );
    const { client, requests } = fakeClient(loop);
    await expect(
      runAgentTurn({ client, dataset: ds, question: 'x', lang: 'en', history: [] }),
    ).rejects.toThrow(/rounds/);
    expect(requests.length).toBe(8);
  });
});
