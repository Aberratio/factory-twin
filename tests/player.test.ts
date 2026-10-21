import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildTimeline, TIMING } from '../src/agent/player';
import { executeTool } from '../src/agent/tools';
import type { Transcript } from '../src/agent/transcript';
import { demoDataset } from './helpers';

const ds = demoDataset();

const transcript: Transcript = {
  question: 'Which machine lost the most time this week?',
  steps: [
    {
      type: 'tool_call',
      id: 't1',
      name: 'get_downtime',
      input: {},
      result: executeTool(ds, 'get_downtime', {}),
    },
    {
      type: 'tool_call',
      id: 't2',
      name: 'highlight_machines',
      input: { machine_ids: ['L2-M2'], tone: 'alert' },
      result: executeTool(ds, 'highlight_machines', { machine_ids: ['L2-M2'], tone: 'alert' }),
    },
    {
      type: 'tool_call',
      id: 't3',
      name: 'focus_camera',
      input: { target: 'L2-M2' },
      result: executeTool(ds, 'focus_camera', { target: 'L2-M2' }),
    },
    { type: 'text', text: 'The robotic welding cell L2-M2: 290 minutes.' },
  ],
};

afterEach(() => vi.restoreAllMocks());

describe('buildTimeline', () => {
  it('plays question, tool calls with their scene actions, then the answer, then done', () => {
    const kinds = buildTimeline(ds, transcript, { reducedMotion: false }).map((e) => e.kind);
    expect(kinds).toEqual([
      'question',
      'thinking',
      'tool',
      'tool',
      'action',
      'tool',
      'action',
      'answer',
      'done',
    ]);
  });

  it('schedules events at fixed offsets derived only from the transcript', () => {
    const tl = buildTimeline(ds, transcript, { reducedMotion: false });
    const at = tl.map((e) => e.at);
    // strictly non-decreasing
    expect([...at].sort((a, b) => a - b)).toEqual(at);
    expect(tl[0]?.at).toBe(0);
    expect(tl[1]?.at).toBe(TIMING.thinkingDelay);
    // a scene action follows its own tool call by a fixed beat
    expect(tl[4]!.at - tl[3]!.at).toBe(TIMING.actionDelay);
    const answer = tl.find((e) => e.kind === 'answer');
    const done = tl.at(-1)!;
    expect(answer?.kind === 'answer' && done.at - answer.at).toBe(
      answer?.kind === 'answer' && answer.revealMs,
    );
  });

  it('scales the answer reveal with its length, within a cap', () => {
    const short = buildTimeline(
      ds,
      { ...transcript, steps: [{ type: 'text', text: 'Yes.' }] },
      { reducedMotion: false },
    );
    const long = buildTimeline(
      ds,
      { ...transcript, steps: [{ type: 'text', text: 'word '.repeat(500) }] },
      { reducedMotion: false },
    );
    const reveal = (tl: ReturnType<typeof buildTimeline>) => {
      const a = tl.find((e) => e.kind === 'answer');
      return a?.kind === 'answer' ? a.revealMs : -1;
    };
    expect(reveal(short)).toBe(TIMING.msPerWord);
    expect(reveal(long)).toBe(TIMING.maxRevealMs);
  });

  it('collapses every delay to zero for prefers-reduced-motion, keeping the order', () => {
    const tl = buildTimeline(ds, transcript, { reducedMotion: true });
    expect(tl.every((e) => e.at === 0)).toBe(true);
    expect(tl.map((e) => e.kind)).toEqual(
      buildTimeline(ds, transcript, { reducedMotion: false }).map((e) => e.kind),
    );
    const a = tl.find((e) => e.kind === 'answer');
    expect(a?.kind === 'answer' && a.revealMs).toBe(0);
  });

  it('is deterministic: same input, same output, without touching randomness or the clock', () => {
    const random = vi.spyOn(Math, 'random');
    const now = vi.spyOn(Date, 'now');
    const a = JSON.stringify(buildTimeline(ds, transcript, { reducedMotion: false }));
    const b = JSON.stringify(buildTimeline(ds, transcript, { reducedMotion: false }));
    expect(a).toBe(b);
    expect(random).not.toHaveBeenCalled();
    expect(now).not.toHaveBeenCalled();
  });

  it('joins several text blocks into one answer', () => {
    const tl = buildTimeline(
      ds,
      {
        question: 'q',
        steps: [
          { type: 'text', text: 'First.' },
          { type: 'text', text: 'Second.' },
        ],
      },
      { reducedMotion: false },
    );
    const answers = tl.filter((e) => e.kind === 'answer');
    expect(answers).toHaveLength(1);
    expect(answers[0]?.kind === 'answer' && answers[0].text).toBe('First.\n\nSecond.');
  });
});
