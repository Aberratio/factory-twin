import { readdirSync, readFileSync } from 'node:fs';
import { executeTool } from '../src/agent/tools';
import type { Recording, TranscriptStep } from '../src/agent/transcript';
import type { Dataset, Lang, Localized } from '../src/domain/types';

/** A scenario script in scenarios/*.json: the question, the tool calls to make, and the answer text. */
export interface Scenario {
  id: string;
  order: number;
  title: Localized;
  question: Localized;
  plan: { name: string; input: Record<string, unknown> }[];
  answer: Localized;
}

export const scenariosDir = new URL('../scenarios/', import.meta.url);
export const recordingsDir = new URL('../src/recordings/', import.meta.url);

export function loadScenarios(): Scenario[] {
  return readdirSync(scenariosDir)
    .filter((f) => f.endsWith('.json'))
    .map((f) => JSON.parse(readFileSync(new URL(f, scenariosDir), 'utf8')) as Scenario)
    .sort((a, b) => a.order - b.order);
}

/**
 * Builds a recording without calling any model: every tool result is the real output of the
 * tool on the demo data; only the answer text is scripted. Deterministic by construction.
 */
export function buildScriptedRecording(scenario: Scenario, lang: Lang, ds: Dataset): Recording {
  const steps: TranscriptStep[] = scenario.plan.map((call, i) => {
    const result = executeTool(ds, call.name, call.input);
    if (!result.ok) throw new Error(`${scenario.id}: ${call.name} failed: ${result.error}`);
    return { type: 'tool_call', id: `call_${i + 1}`, name: call.name, input: call.input, result };
  });
  steps.push({ type: 'text', text: scenario.answer[lang] });
  return {
    schemaVersion: 1,
    id: scenario.id,
    lang,
    order: scenario.order,
    title: scenario.title[lang],
    source: 'scripted',
    model: null,
    question: scenario.question[lang],
    steps,
  };
}
