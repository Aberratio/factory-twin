import type { Lang } from '../domain/types';
import type { ToolResult } from './tools';

/** One agent turn as the UI plays it: the same shape for a recording and for a live answer. */
export type TranscriptStep =
  | { type: 'text'; text: string }
  | { type: 'tool_call'; id: string; name: string; input: unknown; result: ToolResult };

export interface Transcript {
  question: string;
  steps: TranscriptStep[];
}

export interface Recording extends Transcript {
  schemaVersion: 1;
  id: string;
  lang: Lang;
  order: number;
  title: string;
  /** "scripted": built by scripts/build-recordings.ts; "live": captured by `npm run record`. */
  source: 'scripted' | 'live';
  /** The Claude model that produced a live recording; null for scripted ones. */
  model: string | null;
}

const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

function parseStep(v: unknown, i: number): TranscriptStep {
  if (!isObj(v)) throw new Error(`step ${i}: not an object`);
  if (v.type === 'text') {
    if (typeof v.text !== 'string') throw new Error(`step ${i}: text must be a string`);
    return { type: 'text', text: v.text };
  }
  if (v.type === 'tool_call') {
    if (typeof v.id !== 'string' || typeof v.name !== 'string')
      throw new Error(`step ${i}: id and name required`);
    const r = v.result;
    if (!isObj(r) || typeof r.ok !== 'boolean')
      throw new Error(`step ${i}: result must be { ok, ... }`);
    if (!r.ok && typeof r.error !== 'string')
      throw new Error(`step ${i}: failed result needs an error`);
    return { type: 'tool_call', id: v.id, name: v.name, input: v.input, result: r as ToolResult };
  }
  throw new Error(`step ${i}: unknown type ${String(v.type)}`);
}

/** Validates a recording loaded from JSON; throws with the reason on anything malformed. */
export function parseRecording(v: unknown): Recording {
  if (!isObj(v)) throw new Error('recording: not an object');
  if (v.schemaVersion !== 1) throw new Error('recording: schemaVersion must be 1');
  for (const k of ['id', 'title', 'question'] as const) {
    if (typeof v[k] !== 'string' || !v[k]) throw new Error(`recording: ${k} required`);
  }
  if (v.lang !== 'en' && v.lang !== 'pl') throw new Error('recording: lang must be en or pl');
  if (typeof v.order !== 'number') throw new Error('recording: order required');
  if (v.source !== 'scripted' && v.source !== 'live') throw new Error('recording: bad source');
  if (v.model !== null && typeof v.model !== 'string') throw new Error('recording: bad model');
  if (!Array.isArray(v.steps) || v.steps.length === 0) throw new Error('recording: steps required');
  return {
    schemaVersion: 1,
    id: v.id as string,
    lang: v.lang,
    order: v.order,
    title: v.title as string,
    source: v.source,
    model: v.model as string | null,
    question: v.question as string,
    steps: v.steps.map(parseStep),
  };
}
