import { describe, expect, it } from 'vitest';
import { toSceneActions } from '../src/agent/actions';
import { executeTool } from '../src/agent/tools';
import type { TranscriptStep } from '../src/agent/transcript';
import { demoDataset } from './helpers';

const ds = demoDataset();

/** A tool step whose result really comes from the tool, as in a recording or a live turn. */
function call(name: string, input: Record<string, unknown>, id = `call_${name}`): TranscriptStep {
  return { type: 'tool_call', id, name, input, result: executeTool(ds, name, input) };
}

describe('toSceneActions', () => {
  it('turns highlight_machines into a highlight action', () => {
    expect(
      toSceneActions(ds, [call('highlight_machines', { machine_ids: ['L2-M2'], tone: 'alert' })]),
    ).toEqual([{ type: 'highlight', machineIds: ['L2-M2'], tone: 'alert' }]);
  });

  it('turns focus_camera into a focus action for a machine, a line or the overview', () => {
    expect(
      toSceneActions(ds, [
        call('focus_camera', { target: 'L1-M2' }, 'a'),
        call('focus_camera', { target: 'L3' }, 'b'),
        call('focus_camera', { target: 'overview' }, 'c'),
      ]),
    ).toEqual([
      { type: 'focus', target: { kind: 'machine', id: 'L1-M2' } },
      { type: 'focus', target: { kind: 'line', id: 'L3' } },
      { type: 'focus', target: { kind: 'overview' } },
    ]);
  });

  it('keeps the order in which the agent called the tools', () => {
    const actions = toSceneActions(ds, [
      call('focus_camera', { target: 'L2' }),
      call('get_machine_status', { line_id: 'L2' }),
      call('highlight_machines', { machine_ids: ['L2-M2', 'L2-M4'] }),
    ]);
    expect(actions.map((a) => a.type)).toEqual(['focus', 'highlight']);
  });

  it('ignores data tools and text', () => {
    expect(
      toSceneActions(ds, [call('get_downtime', {}), { type: 'text', text: 'L2-M2 is down.' }]),
    ).toEqual([]);
  });

  it('drops a scene call whose tool result was an error, even with valid ids', () => {
    // the ids are fine; the unknown field is what makes the tool fail
    const step = call('highlight_machines', { machine_ids: ['L2-M2'], colour: 'red' });
    expect(step.type === 'tool_call' && step.result.ok).toBe(false);
    expect(toSceneActions(ds, [step])).toEqual([]);
  });

  it('does not trust a recorded result: re-validates ids against the plant', () => {
    // a hand-edited recording claiming success for a machine that does not exist
    const forged: TranscriptStep = {
      type: 'tool_call',
      id: 'x',
      name: 'highlight_machines',
      input: { machine_ids: ['L2-M2', 'L9-M9'] },
      result: { ok: true, data: { highlighted: ['L2-M2', 'L9-M9'], tone: 'info' } },
    };
    expect(toSceneActions(ds, [forged])).toEqual([
      { type: 'highlight', machineIds: ['L2-M2'], tone: 'info' },
    ]);
  });

  it('drops a forged highlight with no valid ids left and a focus on an unknown target', () => {
    const steps: TranscriptStep[] = [
      {
        type: 'tool_call',
        id: 'x',
        name: 'highlight_machines',
        input: { machine_ids: ['nope'] },
        result: { ok: true, data: {} },
      },
      {
        type: 'tool_call',
        id: 'y',
        name: 'focus_camera',
        input: { target: 'roof' },
        result: { ok: true, data: {} },
      },
    ];
    expect(toSceneActions(ds, steps)).toEqual([]);
  });
});
