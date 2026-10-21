// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SceneAction } from '../src/agent/actions';
import { listRecordings } from '../src/recordings';
import type { FactoryScene } from '../src/scene/factory-scene';
import { Chat } from '../src/ui/chat';
import { loadDataset } from '../src/data/browser';

// The chat panel against a fake scene and a fake fetch: what reaches the scene, and when.

const ds = loadDataset(); // the bundled (browser) loader, as the page uses it

function fakeScene() {
  const applied: SceneAction[] = [];
  const scene = {
    apply: (a: SceneAction) => applied.push(a),
    reset: vi.fn(),
    focus: vi.fn(),
    select: vi.fn(),
  };
  return { scene: scene as unknown as FactoryScene, applied, reset: scene.reset };
}

function mount(live: boolean) {
  document.body.innerHTML = `
    <p id="intro"></p><div id="scenarios"></div><div id="log"></div>
    <form id="composer"><input id="question" /><button type="submit">Ask</button></form>`;
  const { scene, applied, reset } = fakeScene();
  const chat = new Chat({
    ds,
    scene,
    lang: 'en',
    live,
    reducedMotion: true,
    recordings: listRecordings('en'),
    els: {
      intro: document.getElementById('intro') as HTMLElement,
      scenarios: document.getElementById('scenarios') as HTMLElement,
      log: document.getElementById('log') as HTMLElement,
      form: document.getElementById('composer') as HTMLFormElement,
      input: document.getElementById('question') as HTMLInputElement,
    },
  });
  return { chat, applied, reset };
}

/** A fetch whose response we release by hand, to interleave it with other user actions. */
function deferredFetch() {
  let release: (body: unknown) => void = () => undefined;
  const calls: { signal?: AbortSignal | null }[] = [];
  const fetchMock = vi.fn((_url: string, init?: RequestInit) => {
    calls.push({ signal: init?.signal });
    return new Promise<Response>((resolve, reject) => {
      init?.signal?.addEventListener('abort', () =>
        reject(new DOMException('aborted', 'AbortError')),
      );
      release = (body) => resolve(new Response(JSON.stringify(body), { status: 200 }));
    });
  });
  return { fetchMock, calls, release: (b: unknown) => release(b) };
}

const liveAnswer = {
  model: 'claude-opus-5-5',
  transcript: {
    question: 'Is L3 ok?',
    steps: [
      {
        type: 'tool_call',
        id: 't',
        name: 'focus_camera',
        input: { target: 'L3' },
        result: { ok: true, data: { focused: 'L3' } },
      },
      { type: 'text', text: 'Yes.' },
    ],
  },
};

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('Chat', () => {
  it('plays a recording: scene reset, then its scene actions in order, then the answer', async () => {
    const { chat, applied, reset } = mount(false);
    const rec = listRecordings('en').find((r) => r.id === 'downtime-week');
    if (!rec) throw new Error('missing recording');
    chat.playRecording(rec);
    await vi.runAllTimersAsync();
    expect(reset).toHaveBeenCalledTimes(1);
    expect(applied).toEqual([
      { type: 'highlight', machineIds: ['L2-M2'], tone: 'alert' },
      { type: 'focus', target: { kind: 'machine', id: 'L2-M2' } },
    ]);
    expect(document.getElementById('log')?.textContent).toContain('290 of 500 minutes');
    expect(document.documentElement.dataset.chat).toBe('idle');
  });

  it('plays a live answer through the same timeline', async () => {
    const { fetchMock, release } = deferredFetch();
    vi.stubGlobal('fetch', fetchMock);
    const { chat, applied } = mount(true);
    const pending = chat.askLive('Is L3 ok?');
    release(liveAnswer);
    await pending;
    await vi.runAllTimersAsync();
    expect(applied).toEqual([{ type: 'focus', target: { kind: 'line', id: 'L3' } }]);
    expect(document.getElementById('log')?.textContent).toContain('Yes.');
  });

  it('drops a live answer that arrives after the user moved on to a recording', async () => {
    const { fetchMock, calls, release } = deferredFetch();
    vi.stubGlobal('fetch', fetchMock);
    const { chat, applied, reset } = mount(true);

    const pending = chat.askLive('Is L3 ok?');
    const rec = listRecordings('en').find((r) => r.id === 'quality-alarm');
    if (!rec) throw new Error('missing recording');
    chat.playRecording(rec);
    await vi.runAllTimersAsync();
    const afterRecording = [...applied];

    release(liveAnswer); // too late: the request was abandoned
    await pending;
    await vi.runAllTimersAsync();

    expect(calls[0]?.signal?.aborted).toBe(true);
    expect(applied).toEqual(afterRecording); // no camera jump to L3
    expect(reset).toHaveBeenCalledTimes(1); // the recording's reset only
    expect(document.documentElement.dataset.chat).toBe('idle');
    expect(document.querySelector('.thinking')).toBeNull();
  });

  it('rejects a malformed live answer instead of passing it to the scene', async () => {
    const { fetchMock, release } = deferredFetch();
    vi.stubGlobal('fetch', fetchMock);
    const { chat, applied } = mount(true);
    const pending = chat.askLive('x');
    release({
      model: 'm',
      transcript: { question: 'x', steps: [{ type: 'script', code: 'alert(1)' }] },
    });
    await pending;
    await vi.runAllTimersAsync();
    expect(applied).toEqual([]);
    expect(document.querySelector('.msg--agent.msg--error')?.textContent).toMatch(/unknown type/);
  });
});
