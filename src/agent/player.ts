import type { Dataset } from '../domain/types';
import { toSceneActions, type SceneAction } from './actions';
import type { Transcript } from './transcript';

/** Fixed beats of a replay, in ms. No randomness and no clock: a transcript always plays the same. */
export const TIMING = {
  thinkingDelay: 450,
  toolDelay: 650,
  actionDelay: 250,
  answerDelay: 400,
  msPerWord: 28,
  maxRevealMs: 2200,
} as const;

export type TimelineEvent =
  | { at: number; kind: 'question'; text: string }
  | { at: number; kind: 'thinking' }
  | { at: number; kind: 'tool'; name: string; ok: boolean }
  | { at: number; kind: 'action'; action: SceneAction }
  | { at: number; kind: 'answer'; text: string; revealMs: number }
  | { at: number; kind: 'done' };

export function buildTimeline(
  ds: Dataset,
  transcript: Transcript,
  opts: { reducedMotion: boolean },
): TimelineEvent[] {
  const beat = (ms: number) => (opts.reducedMotion ? 0 : ms);
  const events: TimelineEvent[] = [];
  let t = 0;

  events.push({ at: t, kind: 'question', text: transcript.question });
  t += beat(TIMING.thinkingDelay);
  events.push({ at: t, kind: 'thinking' });

  for (const step of transcript.steps) {
    if (step.type !== 'tool_call') continue;
    t += beat(TIMING.toolDelay);
    events.push({ at: t, kind: 'tool', name: step.name, ok: step.result.ok });
    for (const action of toSceneActions(ds, [step])) {
      t += beat(TIMING.actionDelay);
      events.push({ at: t, kind: 'action', action });
    }
  }

  const text = transcript.steps
    .flatMap((s) => (s.type === 'text' && s.text.trim() ? [s.text.trim()] : []))
    .join('\n\n');
  const words = text.split(/\s+/).filter(Boolean).length;
  const revealMs = beat(Math.min(words * TIMING.msPerWord, TIMING.maxRevealMs));
  t += beat(TIMING.answerDelay);
  events.push({ at: t, kind: 'answer', text, revealMs });
  t += revealMs;
  events.push({ at: t, kind: 'done' });
  return events;
}
