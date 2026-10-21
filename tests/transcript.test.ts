import { describe, expect, it } from 'vitest';
import { parseRecording, parseTranscript } from '../src/agent/transcript';
import { executeTool, TOOL_DEFINITIONS } from '../src/agent/tools';
import { demoDataset } from './helpers';

// A live answer arrives over HTTP and a recording from a JSON file: both are untrusted until parsed.

const valid = {
  question: 'Which line is down?',
  steps: [
    {
      type: 'tool_call',
      id: 'a',
      name: 'get_plant_overview',
      input: {},
      result: { ok: true, data: {} },
    },
    { type: 'text', text: 'L2.' },
  ],
};

describe('parseTranscript', () => {
  it('accepts a well-formed transcript', () => {
    expect(parseTranscript(valid)).toEqual(valid);
  });

  it.each([
    ['not an object', 'nope'],
    ['missing question', { steps: valid.steps }],
    ['steps not a list', { question: 'q', steps: {} }],
    ['unknown step type', { question: 'q', steps: [{ type: 'html', html: '<b>' }] }],
    ['text that is not a string', { question: 'q', steps: [{ type: 'text', text: 1 }] }],
    [
      'tool call without result',
      { question: 'q', steps: [{ type: 'tool_call', id: 'a', name: 'x' }] },
    ],
    [
      'failed result without an error',
      { question: 'q', steps: [{ type: 'tool_call', id: 'a', name: 'x', result: { ok: false } }] },
    ],
  ])('rejects %s', (_label, value) => {
    expect(() => parseTranscript(value)).toThrow();
  });

  it('allows an empty step list (a live answer can be text-free on refusal paths)', () => {
    expect(parseTranscript({ question: 'q', steps: [] }).steps).toEqual([]);
  });
});

describe('parseRecording', () => {
  const rec = {
    schemaVersion: 1,
    id: 'x',
    lang: 'en',
    order: 1,
    title: 't',
    source: 'scripted',
    model: null,
    ...valid,
  };

  it('accepts a well-formed recording', () => {
    expect(parseRecording(rec).id).toBe('x');
  });

  it('rejects an unknown language, an empty step list and a wrong schema version', () => {
    expect(() => parseRecording({ ...rec, lang: 'de' })).toThrow(/lang/);
    expect(() => parseRecording({ ...rec, steps: [] })).toThrow(/steps/);
    expect(() => parseRecording({ ...rec, schemaVersion: 2 })).toThrow(/schemaVersion/);
  });
});

describe('tool registry', () => {
  it('has a handler for every advertised tool', () => {
    const ds = demoDataset();
    for (const t of TOOL_DEFINITIONS) {
      const r = executeTool(ds, t.name, {});
      expect(r.ok || !r.error.startsWith('Unknown tool'), t.name).toBe(true);
    }
  });
});
