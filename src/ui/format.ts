const MACHINE_ID = /\b(L\d+-M\d+)\b/g;

/**
 * Renders an answer as paragraphs and "- " lists, with machine ids as buttons.
 * Built with DOM nodes and textContent only: model output never becomes HTML.
 */
export function renderAnswer(text: string, onMachine: (id: string) => void): DocumentFragment {
  const frag = document.createDocumentFragment();
  let list: HTMLUListElement | null = null;
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (!line) {
      list = null;
      continue;
    }
    if (line.startsWith('- ') || line.startsWith('* ')) {
      if (!list) {
        list = document.createElement('ul');
        frag.appendChild(list);
      }
      const li = document.createElement('li');
      appendWithRefs(li, line.slice(2), onMachine);
      list.appendChild(li);
    } else {
      list = null;
      const p = document.createElement('p');
      appendWithRefs(p, line, onMachine);
      frag.appendChild(p);
    }
  }
  return frag;
}

function appendWithRefs(el: HTMLElement, text: string, onMachine: (id: string) => void): void {
  let last = 0;
  for (const match of text.matchAll(MACHINE_ID)) {
    const id = match[1] ?? '';
    const at = match.index ?? 0;
    el.append(text.slice(last, at));
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'machine-ref';
    btn.textContent = id;
    btn.addEventListener('click', () => onMachine(id));
    el.append(btn);
    last = at + id.length;
  }
  el.append(text.slice(last));
}
