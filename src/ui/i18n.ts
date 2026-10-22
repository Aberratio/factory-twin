import { isLang } from '../domain/langs';
import type { Lang, MachineStatus } from '../domain/types';

const STRINGS = {
  en: {
    title: 'Factory Twin',
    subtitle: 'Digital twin of a production hall with an AI shift assistant',
    fictional: 'fictional data',
    modeRecorded: 'recorded demo',
    modeLive: 'live',
    running: 'Running',
    down: 'Down',
    quality_alarm: 'Quality alarm',
    ordersAtRisk: 'Orders at risk or late',
    asOf: 'as of',
    chatTitle: 'Shift assistant',
    chatIntroRecorded:
      'Pick a question. These are recorded runs: the agent queries the plant data with tools, answers and points at the machines in 3D.',
    chatIntroLive:
      'Ask about orders, downtime or quality. Claude answers with live tool calls on the plant data.',
    placeholder: 'e.g. Why is line 2 stopped?',
    send: 'Ask',
    thinking: 'Checking the plant data',
    liveNote: 'Recorded demo. Run it locally with your own API key for free-form questions:',
    error: 'Something went wrong',
    line: 'Line',
    status: 'Status',
    since: 'Since',
    reason: 'Reason',
    rejects8h: 'Rejects (8 h)',
    close: 'Close',
    askAbout: 'Ask about this machine',
    askAboutPrompt: (id: string) => `What is going on with ${id}?`,
    noWebgl:
      'This browser cannot show the 3D view (WebGL is off), so the hall is shown as a board. The assistant works the same.',
    sceneLabel:
      '3D view of the production hall. Drag to rotate, scroll to zoom, click a machine for details.',
    footer: 'Veldra Components is a fictional company. Demo by',
    tools: {
      get_plant_overview: 'plant overview',
      get_machine_status: 'machine status',
      get_downtime: 'downtime',
      get_quality: 'quality checks',
      get_orders: 'orders',
      highlight_machines: 'highlight',
      focus_camera: 'camera',
    } as Record<string, string>,
    actionHighlight: (ids: string) => `highlight ${ids}`,
    actionFocus: (target: string) => `camera → ${target}`,
    overview: 'overview',
  },
  pl: {
    title: 'Factory Twin',
    subtitle: 'Cyfrowy bliźniak hali produkcyjnej z asystentem AI',
    fictional: 'dane fikcyjne',
    modeRecorded: 'nagrane demo',
    modeLive: 'na żywo',
    running: 'Praca',
    down: 'Przestój',
    quality_alarm: 'Alarm jakości',
    ordersAtRisk: 'Zlecenia zagrożone lub spóźnione',
    asOf: 'stan na',
    chatTitle: 'Asystent zmiany',
    chatIntroRecorded:
      'Wybierz pytanie. To nagrane przebiegi: agent pyta dane hali przez narzędzia, odpowiada i pokazuje maszyny w 3D.',
    chatIntroLive:
      'Zapytaj o zlecenia, przestoje albo jakość. Claude odpowiada, wywołując narzędzia na danych hali.',
    placeholder: 'np. Dlaczego stoi linia 2?',
    send: 'Zapytaj',
    thinking: 'Sprawdzam dane hali',
    liveNote: 'Nagrane demo. Pytania z własną treścią: uruchom lokalnie z własnym kluczem API:',
    error: 'Coś poszło nie tak',
    line: 'Linia',
    status: 'Status',
    since: 'Od',
    reason: 'Przyczyna',
    rejects8h: 'Braki (8 h)',
    close: 'Zamknij',
    askAbout: 'Zapytaj o tę maszynę',
    askAboutPrompt: (id: string) => `Co się dzieje z ${id}?`,
    noWebgl:
      'Ta przeglądarka nie pokaże widoku 3D (WebGL jest wyłączony), więc hala jest pokazana jako tablica. Asystent działa tak samo.',
    sceneLabel:
      'Widok 3D hali produkcyjnej. Przeciągnij, aby obrócić, przewiń, aby przybliżyć, kliknij maszynę, aby zobaczyć szczegóły.',
    footer: 'Veldra Components to firma fikcyjna. Demo by',
    tools: {
      get_plant_overview: 'przegląd hali',
      get_machine_status: 'status maszyn',
      get_downtime: 'przestoje',
      get_quality: 'kontrola jakości',
      get_orders: 'zlecenia',
      highlight_machines: 'podświetlenie',
      focus_camera: 'kamera',
    } as Record<string, string>,
    actionHighlight: (ids: string) => `podświetl ${ids}`,
    actionFocus: (target: string) => `kamera → ${target}`,
    overview: 'cała hala',
  },
} satisfies Record<Lang, unknown>;

export type Strings = (typeof STRINGS)['en'];

export function strings(lang: Lang): Strings {
  return STRINGS[lang];
}

export function statusLabel(lang: Lang, status: MachineStatus): string {
  return STRINGS[lang][status];
}

/** ?lang= wins, then the browser language, then English. */
export function detectLang(params: URLSearchParams, navigatorLanguage: string | undefined): Lang {
  const p = params.get('lang');
  if (isLang(p)) return p;
  return navigatorLanguage?.toLowerCase().startsWith('pl') ? 'pl' : 'en';
}
