import type { Dataset } from '../domain/types';
import type { TranscriptStep } from './transcript';

export type FocusTarget =
  { kind: 'machine'; id: string } | { kind: 'line'; id: string } | { kind: 'overview' };

export type SceneAction =
  | { type: 'highlight'; machineIds: string[]; tone: 'alert' | 'info' }
  | { type: 'focus'; target: FocusTarget };

/**
 * Maps the agent's scene tool calls to scene actions, in call order. Only successful calls count,
 * and ids are re-checked against the plant: a recording is data, so a hand-edited one cannot make
 * the scene look up a machine that does not exist.
 */
export function toSceneActions(ds: Dataset, steps: readonly TranscriptStep[]): SceneAction[] {
  const machines = new Set(ds.machines.map((m) => m.id));
  const lines = new Set(ds.lines.map((l) => l.id));
  const actions: SceneAction[] = [];

  for (const step of steps) {
    if (step.type !== 'tool_call' || !step.result.ok) continue;
    const input = (
      typeof step.input === 'object' && step.input !== null ? step.input : {}
    ) as Record<string, unknown>;

    if (step.name === 'highlight_machines') {
      const ids = Array.isArray(input.machine_ids) ? input.machine_ids : [];
      const machineIds = ids.filter(
        (id): id is string => typeof id === 'string' && machines.has(id),
      );
      if (machineIds.length) {
        actions.push({
          type: 'highlight',
          machineIds,
          tone: input.tone === 'alert' ? 'alert' : 'info',
        });
      }
    } else if (step.name === 'focus_camera') {
      const t = input.target;
      if (t === 'overview') actions.push({ type: 'focus', target: { kind: 'overview' } });
      else if (typeof t === 'string' && machines.has(t))
        actions.push({ type: 'focus', target: { kind: 'machine', id: t } });
      else if (typeof t === 'string' && lines.has(t))
        actions.push({ type: 'focus', target: { kind: 'line', id: t } });
    }
  }
  return actions;
}
