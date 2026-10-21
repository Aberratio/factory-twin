import type { SceneAction } from '../agent/actions';
import { buildTimeline, type TimelineEvent } from '../agent/player';
import { parseTranscript, type Recording, type Transcript } from '../agent/transcript';
import type { Dataset, Lang } from '../domain/types';
import type { FactoryScene } from '../scene/factory-scene';
import { renderAnswer } from './format';
import { strings } from './i18n';
import { revealText, runTimeline } from './runner';

export interface LiveTurnResponse {
  transcript: Transcript;
  model: string;
}

export interface ChatOptions {
  ds: Dataset;
  scene: FactoryScene;
  lang: Lang;
  live: boolean;
  reducedMotion: boolean;
  recordings: Recording[];
  els: {
    intro: HTMLElement;
    scenarios: HTMLElement;
    log: HTMLElement;
    form: HTMLFormElement | null;
    input: HTMLInputElement | null;
  };
}

/** The chat panel: plays recorded scenarios or live answers through one timeline, so both look the same. */
export class Chat {
  private cancel: (() => void)[] = [];
  private history: { question: string; answer: string }[] = [];
  private busy = false;

  constructor(private readonly o: ChatOptions) {
    const t = strings(o.lang);
    o.els.intro.textContent = o.live ? t.chatIntroLive : t.chatIntroRecorded;
    this.renderScenarios();
    o.els.form?.addEventListener('submit', (e) => {
      e.preventDefault();
      const q = o.els.input?.value.trim();
      if (q && !this.busy) void this.askLive(q);
    });
  }

  playRecording(rec: Recording): void {
    this.markScenario(rec.id);
    this.play(rec);
  }

  async askLive(question: string): Promise<void> {
    const t = strings(this.o.lang);
    if (this.o.els.input) this.o.els.input.value = '';
    this.stop();
    this.setBusy(true);
    const { body } = this.startTurn(question);
    const thinking = this.thinking(body);
    try {
      const res = await fetch('./api/chat', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ question, lang: this.o.lang, history: this.history.slice(-10) }),
      });
      const json = (await res.json()) as LiveTurnResponse | { error: string };
      thinking.remove();
      if (!res.ok || 'error' in json)
        throw new Error('error' in json ? json.error : res.statusText);
      // Live answers replay through the same timeline as recordings; the question is already shown.
      // The response is untrusted input: validate it like a recording before it reaches the scene.
      this.play(parseTranscript(json.transcript), { skipQuestion: true, body });
    } catch (err) {
      thinking.remove();
      const p = document.createElement('p');
      p.textContent = `${t.error}: ${(err as Error).message}`;
      body.parentElement?.classList.add('msg--error');
      body.appendChild(p);
      this.setBusy(false);
    }
  }

  stop(): void {
    this.cancel.forEach((c) => c());
    this.cancel = [];
  }

  private play(
    transcript: Transcript,
    opts: { skipQuestion?: boolean; body?: HTMLElement } = {},
  ): void {
    this.stop();
    this.setBusy(true);
    this.o.scene.reset();
    const events = buildTimeline(this.o.ds, transcript, { reducedMotion: this.o.reducedMotion });
    let body = opts.body ?? null;
    let steps: HTMLElement | null = null;
    let thinking: HTMLElement | null = null;

    const handle = (e: TimelineEvent) => {
      switch (e.kind) {
        case 'question':
          if (!opts.skipQuestion) body = this.startTurn(e.text).body;
          break;
        case 'thinking':
          if (body) thinking = this.thinking(body);
          break;
        case 'tool':
          steps ??= this.steps(body);
          steps?.appendChild(this.chip(this.toolLabel(e.name), e.ok ? 'step' : 'step step--error'));
          break;
        case 'action':
          this.o.scene.apply(e.action);
          steps ??= this.steps(body);
          steps?.appendChild(this.chip(this.actionLabel(e.action), 'step step--action'));
          break;
        case 'answer': {
          thinking?.remove();
          if (!body) break;
          const out = document.createElement('div');
          body.appendChild(out);
          const finish = () => {
            out.replaceChildren(renderAnswer(e.text, (id) => this.focusMachine(id)));
            this.scrollDown();
          };
          this.cancel.push(revealText(out, e.text, e.revealMs, finish));
          this.history.push({ question: transcript.question, answer: e.text });
          break;
        }
        case 'done':
          this.setBusy(false);
          break;
      }
      this.scrollDown();
    };
    this.cancel.push(runTimeline(events, handle));
  }

  private focusMachine(id: string): void {
    this.o.scene.focus({ kind: 'machine', id });
    this.o.scene.select(id);
  }

  private startTurn(question: string): { body: HTMLElement } {
    const user = document.createElement('div');
    user.className = 'msg msg--user';
    user.textContent = question;
    const agent = document.createElement('div');
    agent.className = 'msg msg--agent';
    agent.setAttribute('aria-live', 'polite');
    this.o.els.log.append(user, agent);
    return { body: agent };
  }

  private thinking(body: HTMLElement): HTMLElement {
    const el = document.createElement('div');
    el.className = 'thinking';
    el.textContent = strings(this.o.lang).thinking;
    body.appendChild(el);
    return el;
  }

  private steps(body: HTMLElement | null): HTMLElement | null {
    if (!body) return null;
    const el = document.createElement('div');
    el.className = 'steps';
    body.insertBefore(el, body.firstChild);
    return el;
  }

  private chip(text: string, className: string): HTMLElement {
    const el = document.createElement('span');
    el.className = className;
    el.textContent = text;
    return el;
  }

  private toolLabel(name: string): string {
    return strings(this.o.lang).tools[name] ?? name;
  }

  private actionLabel(a: SceneAction): string {
    const t = strings(this.o.lang);
    if (a.type === 'highlight') return t.actionHighlight(a.machineIds.join(', '));
    return t.actionFocus(a.target.kind === 'overview' ? t.overview : a.target.id);
  }

  private renderScenarios(): void {
    const { scenarios } = this.o.els;
    scenarios.replaceChildren();
    for (const rec of this.o.recordings) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'scenario';
      b.dataset.id = rec.id;
      b.textContent = rec.title;
      b.title = rec.question;
      b.setAttribute('aria-pressed', 'false');
      b.addEventListener('click', () => this.playRecording(rec));
      scenarios.appendChild(b);
    }
  }

  private markScenario(id: string): void {
    for (const b of this.o.els.scenarios.querySelectorAll<HTMLButtonElement>('.scenario')) {
      b.setAttribute('aria-pressed', String(b.dataset.id === id));
    }
  }

  private setBusy(busy: boolean): void {
    this.busy = busy;
    const button = this.o.els.form?.querySelector('button');
    if (button) button.disabled = busy;
    // lets the embedding page and the screenshot script know when an answer has finished
    document.documentElement.dataset.chat = busy ? 'busy' : 'idle';
  }

  private scrollDown(): void {
    const log = this.o.els.log;
    log.scrollTop = log.scrollHeight;
  }
}
