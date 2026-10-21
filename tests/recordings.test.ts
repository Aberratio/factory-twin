import { describe, expect, it } from 'vitest';
import { listRecordings, LANGS } from '../src/recordings';
import { executeTool } from '../src/agent/tools';
import { toSceneActions } from '../src/agent/actions';
import { buildTimeline } from '../src/agent/player';
import { parseRecording, type Recording } from '../src/agent/transcript';
import { buildScriptedRecording, loadScenarios } from '../server/recordings';
import { demoDataset } from './helpers';

const ds = demoDataset();

describe('recorded scenarios', () => {
  it('ships 3 to 5 scenarios in every language, with the same ids in the same order', () => {
    const ids = LANGS.map((lang) => listRecordings(lang).map((r) => r.id));
    expect(ids[0]!.length).toBeGreaterThanOrEqual(3);
    expect(ids[0]!.length).toBeLessThanOrEqual(5);
    for (const other of ids.slice(1)) expect(other).toEqual(ids[0]);
  });

  // Scripted recordings share one tool plan across languages by construction; a live capture
  // (`npm run record`) may legitimately take a different path in each language.
  // Matched by scenario id, so one language re-recorded live does not shift the comparison.
  const pairedScripted = (recordings: Record<string, Recording[]>) =>
    recordings
      .en!.filter((en) => en.source === 'scripted')
      .flatMap((en) =>
        LANGS.slice(1).flatMap((lang) => {
          const other = recordings[lang]?.find((r) => r.id === en.id);
          return other?.source === 'scripted' ? [[en, other] as const] : [];
        }),
      );
  const calls = (r: Recording) =>
    r.steps.flatMap((s) => (s.type === 'tool_call' ? [[s.name, s.input]] : []));
  const shipped = () => Object.fromEntries(LANGS.map((l) => [l, listRecordings(l)]));

  it('runs the same tool calls in every language (scenarios scripted in both)', () => {
    const pairs = pairedScripted(shipped());
    expect(pairs.length).toBeGreaterThanOrEqual(3);
    for (const [en, other] of pairs)
      expect(calls(other), `${other.lang}/${en.id}`).toEqual(calls(en));
  });

  it('pin: one language replaced by a live capture leaves the others compared pairwise', () => {
    // as after `npm run record -- --only quality-alarm --lang pl`
    const recs = shipped();
    recs.pl = recs.pl!.map((r) =>
      r.id === 'quality-alarm' ? { ...r, source: 'live' as const } : r,
    );
    expect(pairedScripted(recs).map(([en]) => en.id)).toEqual([
      'shift-overview',
      'downtime-week',
      'order-zl-2041',
      'orders-at-risk',
    ]);
  });

  for (const lang of LANGS) {
    describe(lang, () => {
      for (const rec of listRecordings(lang)) {
        describe(rec.id, () => {
          it('passes the schema check', () => {
            expect(() => parseRecording(rec)).not.toThrow();
            expect(rec.lang).toBe(lang);
          });

          it('agrees with what the tools return today, call by call', () => {
            const calls = rec.steps.filter((s) => s.type === 'tool_call');
            expect(calls.length).toBeGreaterThan(0);
            for (const s of calls) {
              if (s.type !== 'tool_call') continue;
              expect(s.result, `${s.name}(${JSON.stringify(s.input)})`).toEqual(
                executeTool(ds, s.name, s.input),
              );
            }
          });

          it('moves the scene and names every highlighted machine in the answer', () => {
            const actions = toSceneActions(ds, rec.steps);
            // a live capture without a scene action is allowed (record-live.ts warns about it)
            if (rec.source === 'scripted') expect(actions.length).toBeGreaterThan(0);
            const answer = rec.steps.flatMap((s) => (s.type === 'text' ? [s.text] : [])).join('\n');
            expect(answer.trim().length).toBeGreaterThan(0);
            for (const a of actions) {
              if (a.type === 'highlight')
                for (const id of a.machineIds) expect(answer).toContain(id);
            }
          });

          it('replays to the identical timeline every time', () => {
            const a = buildTimeline(ds, rec, { reducedMotion: false });
            const b = buildTimeline(ds, structuredClone(rec), { reducedMotion: false });
            expect(b).toEqual(a);
          });
        });
      }
    });
  }

  it('scripted recordings are up to date with their scenario scripts (run `npm run recordings:build`)', () => {
    const scenarios = loadScenarios();
    for (const lang of LANGS) {
      for (const rec of listRecordings(lang).filter((r) => r.source === 'scripted')) {
        const scenario = scenarios.find((s) => s.id === rec.id);
        expect(scenario, rec.id).toBeDefined();
        expect(rec).toEqual(buildScriptedRecording(scenario!, lang, ds));
      }
    }
  });
});
