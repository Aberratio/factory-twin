import type { FocusTarget, SceneAction } from '../agent/actions';
import { machineStates } from '../domain/queries';
import type { Dataset, Lang } from '../domain/types';
import type { SceneView } from './view';

/**
 * Hall view for browsers without WebGL: the same lines and machines as an HTML board, with the
 * same status colours, highlights and selection. The chat, the answers and the scene actions
 * keep working, which matters most inside the kokot.it iframe.
 */
export class FallbackScene implements SceneView {
  private readonly chips = new Map<string, { el: HTMLButtonElement; name: HTMLSpanElement }>();
  private readonly lineNames = new Map<string, HTMLElement>();
  private readonly note: HTMLParagraphElement;
  private readonly message: (lang: Lang) => string;

  constructor(
    private readonly container: HTMLElement,
    private readonly ds: Dataset,
    opts: { lang: Lang; message: (lang: Lang) => string; onSelect?: (id: string | null) => void },
  ) {
    this.message = opts.message;
    const board = document.createElement('div');
    board.className = 'scene-fallback';
    this.note = document.createElement('p');
    this.note.className = 'scene-fallback-note';
    board.append(this.note);

    const status = new Map(machineStates(ds).map((s) => [s.machine.id, s.status]));
    for (const line of ds.lines) {
      const row = document.createElement('section');
      row.className = 'fallback-line';
      row.dataset.line = line.id;
      const title = document.createElement('h3');
      row.append(title);
      this.lineNames.set(line.id, title);
      const list = document.createElement('div');
      list.className = 'fallback-machines';
      for (const m of ds.machines.filter((x) => x.line === line.id)) {
        const el = document.createElement('button');
        el.type = 'button';
        el.className = 'fallback-machine';
        el.dataset.id = m.id;
        el.dataset.status = status.get(m.id) ?? 'running';
        const dot = document.createElement('span');
        dot.className = `dot dot--${el.dataset.status}`;
        const id = document.createElement('strong');
        id.textContent = m.id;
        const name = document.createElement('span');
        name.className = 'fallback-name';
        el.append(dot, id, name);
        el.addEventListener('click', () => {
          this.select(m.id);
          opts.onSelect?.(m.id);
        });
        list.append(el);
        this.chips.set(m.id, { el, name });
      }
      row.append(list);
      board.append(row);
    }
    container.append(board);
    container.dataset.loop = 'none';
    this.setLang(opts.lang);
  }

  apply(action: SceneAction): void {
    if (action.type === 'highlight') {
      for (const id of action.machineIds) {
        const chip = this.chips.get(id)?.el;
        if (!chip) continue;
        chip.classList.add('is-highlighted');
        chip.dataset.tone = action.tone;
      }
    } else {
      this.focus(action.target);
    }
  }

  reset(): void {
    for (const { el } of this.chips.values()) {
      el.classList.remove('is-highlighted');
      delete el.dataset.tone;
    }
  }

  focus(target: FocusTarget): void {
    const el =
      target.kind === 'machine'
        ? this.chips.get(target.id)?.el
        : target.kind === 'line'
          ? this.lineNames.get(target.id)?.parentElement
          : null;
    el?.scrollIntoView?.({ block: 'nearest' });
  }

  select(machineId: string | null): void {
    for (const [id, { el }] of this.chips) el.classList.toggle('is-selected', id === machineId);
  }

  setLang(lang: Lang): void {
    this.note.textContent = this.message(lang);
    for (const line of this.ds.lines) {
      const title = this.lineNames.get(line.id);
      if (title) title.textContent = `${line.id} · ${line.name[lang]}`;
    }
    for (const m of this.ds.machines) {
      const chip = this.chips.get(m.id);
      if (chip) chip.name.textContent = m.name[lang];
    }
  }
}
