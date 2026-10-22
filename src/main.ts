import './styles/tokens.css';
import './styles/app.css';
import logoUrl from './assets/brand/logo.svg';
import { loadDataset } from './data/browser';
import { machineStatusRows, plantOverview } from './domain/queries';
import { isLang } from './domain/langs';
import type { Lang, MachineStatus } from './domain/types';
import { listRecordings } from './recordings';
import { FactoryScene } from './scene/factory-scene';
import { FallbackScene } from './scene/fallback-scene';
import { readMotionScale } from './scene/tokens';
import { isWebGLAvailable, type SceneView } from './scene/view';
import { Chat } from './ui/chat';
import { detectLang, statusLabel, strings } from './ui/i18n';

const LIVE = import.meta.env.MODE === 'live';
const params = new URLSearchParams(location.search);
const embed = params.get('embed') === '1';
const autoplay = params.get('autoplay') !== '0';
// --motion-scale is the brand's reduced-motion switch (0 under prefers-reduced-motion)
const reducedMotion = readMotionScale() === 0;

const $ = <T extends HTMLElement>(id: string) => {
  const el = document.getElementById(id);
  if (!el) throw new Error(`#${id} missing`);
  return el as T;
};

if (embed) document.documentElement.classList.add('embed');

const ds = loadDataset();
let lang: Lang = detectLang(params, navigator.language);

function createScene(): SceneView {
  const onSelect = (id: string | null) => showMachine(id);
  const fallback = () =>
    new FallbackScene($('scene'), ds, { lang, onSelect, message: (l) => strings(l).noWebgl });
  if (!isWebGLAvailable() || params.get('webgl') === '0') return fallback();
  try {
    return new FactoryScene($('scene'), ds, { reducedMotion, lang, onSelect });
  } catch (err) {
    // e.g. a context that cannot be created after all: keep the page and the chat working
    console.warn('3D view unavailable, using the board view', err);
    $('scene').replaceChildren();
    return fallback();
  }
}

const scene = createScene();

let chat: Chat | undefined;
let autoplayTimer: number | undefined;

function render(): void {
  const t = strings(lang);
  document.documentElement.lang = lang;
  $('brand-sub').textContent =
    `${ds.plant.company.name} · ${ds.plant.company.site} — ${t.subtitle}`;
  $('fictional-badge').textContent = t.fictional;
  const mode = $('mode-badge');
  mode.textContent = LIVE ? t.modeLive : t.modeRecorded;
  mode.classList.toggle('badge--live', LIVE);
  $('scene').setAttribute('aria-label', t.sceneLabel);
  $('chat-title').textContent = t.chatTitle;
  for (const b of document.querySelectorAll<HTMLButtonElement>('[data-lang]')) {
    b.setAttribute('aria-pressed', String(b.dataset.lang === lang));
  }

  renderHud();

  const form = $<HTMLFormElement>('composer');
  const input = $<HTMLInputElement>('question');
  const note = $('composer-note');
  form.hidden = !LIVE;
  note.hidden = LIVE || embed;
  input.placeholder = t.placeholder;
  const submit = form.querySelector('button');
  if (submit) submit.textContent = t.send;
  const code = document.createElement('code');
  code.textContent = 'npm run dev:live';
  note.replaceChildren(t.liveNote, ' ', code);

  const link = document.createElement('a');
  link.href = 'https://kokot.it';
  link.className = 'footer-brand';
  const logo = document.createElement('img');
  logo.src = logoUrl;
  logo.alt = 'kokot.it';
  logo.height = 14;
  link.append(logo);
  $('footer').replaceChildren(`${t.footer} `, link);

  scene.setLang(lang);
  chat?.dispose();
  $('log').replaceChildren();
  chat = new Chat({
    ds,
    scene,
    lang,
    live: LIVE,
    reducedMotion,
    recordings: listRecordings(lang),
    els: { intro: $('chat-intro'), scenarios: $('scenarios'), log: $('log'), form, input },
  });
}

function renderHud(): void {
  const t = strings(lang);
  const o = plantOverview(ds);
  const kpi = (dot: string, label: string, value: number) => {
    const el = document.createElement('div');
    el.className = 'kpi';
    const d = document.createElement('span');
    d.className = `dot dot--${dot}`;
    const v = document.createElement('strong');
    v.textContent = String(value);
    el.append(d, v, ` ${label}`);
    return el;
  };
  const asOf = document.createElement('div');
  asOf.className = 'kpi kpi--legend';
  asOf.textContent = `${t.asOf} ${ds.plant.snapshot.replace('T', ' ')}`;
  $('hud').replaceChildren(
    kpi('running', t.running, o.status_counts.running),
    kpi('down', t.down, o.status_counts.down),
    kpi('quality_alarm', t.quality_alarm, o.status_counts.quality_alarm),
    kpi('risk', t.ordersAtRisk, o.order_risk_counts.at_risk + o.order_risk_counts.late),
    asOf,
  );
}

function showMachine(id: string | null): void {
  const card = $('machine-card');
  const row = id ? machineStatusRows(ds, { machineId: id })[0] : undefined;
  const machine = ds.machines.find((m) => m.id === id);
  if (!id || !row || !machine) {
    card.hidden = true;
    return;
  }
  const t = strings(lang);
  const line = ds.lines.find((l) => l.id === machine.line);

  const h = document.createElement('h2');
  h.textContent = `${id} · ${machine.name[lang]}`;
  const dl = document.createElement('dl');
  const add = (k: string, v: string | Node) => {
    const dt = document.createElement('dt');
    dt.textContent = k;
    const dd = document.createElement('dd');
    dd.append(v);
    dl.append(dt, dd);
  };
  const pill = document.createElement('span');
  pill.className = 'status-pill';
  const dot = document.createElement('span');
  dot.className = `dot dot--${row.status}`;
  pill.append(dot, statusLabel(lang, row.status as MachineStatus));
  add(t.status, pill);
  add(t.line, `${machine.line} · ${line?.name[lang] ?? ''}`);
  if (row.down_since) add(t.since, row.down_since.replace('T', ' '));
  if (row.reason) add(t.reason, row.reason);
  add(t.rejects8h, `${(row.reject_rate_8h * 100).toFixed(1)}%`);

  const close = document.createElement('button');
  close.type = 'button';
  close.className = 'close';
  close.setAttribute('aria-label', t.close);
  close.textContent = '×';
  close.addEventListener('click', () => {
    scene.select(null);
    card.hidden = true;
  });
  card.replaceChildren(close, h, dl);

  if (LIVE) {
    const ask = document.createElement('button');
    ask.type = 'button';
    ask.className = 'scenario card-ask';
    ask.textContent = t.askAbout;
    ask.addEventListener('click', () => void chat?.askLive(t.askAboutPrompt(id)));
    card.append(ask);
  }
  card.hidden = false;
}

for (const b of document.querySelectorAll<HTMLButtonElement>('[data-lang]')) {
  b.addEventListener('click', () => {
    const next = b.dataset.lang;
    if (!isLang(next) || next === lang) return;
    lang = next;
    params.set('lang', lang);
    history.replaceState(null, '', `?${params.toString()}`);
    window.clearTimeout(autoplayTimer);
    showMachine(null);
    render();
  });
}

render();

if (autoplay) {
  const recordings = listRecordings(lang);
  const first = recordings.find((r) => r.id === params.get('scenario')) ?? recordings[0];
  if (first)
    autoplayTimer = window.setTimeout(() => chat?.playRecording(first), reducedMotion ? 0 : 700);
}
