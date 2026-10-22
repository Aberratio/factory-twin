// Browser smoke test of the static build (recorded mode), in headless Chromium.
// Run with `npm run test:e2e` (builds first). Covers what unit tests cannot see:
// the page runs with no server API, an answer moves the scene, embed mode, the DPR cap,
// the hidden-tab pause and prefers-reduced-motion.
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { chromium, type Browser, type Page } from 'playwright';
import type { PreviewServer } from 'vite';
import { preview } from 'vite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import qualityAlarmPl from '../src/recordings/pl/quality-alarm.json';

let server: PreviewServer;
let browser: Browser;
const PORT = 4318;
const base = `http://localhost:${PORT}/`;

beforeAll(async () => {
  server = await preview({
    configLoader: 'runner',
    preview: { port: PORT, strictPort: true, host: 'localhost' },
  });
  browser = await chromium.launch({
    args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
  });
});

afterAll(async () => {
  await browser?.close();
  await new Promise<void>((resolve) => server?.httpServer.close(() => resolve()));
});

async function open(query: string, opts: { dpr?: number; reducedMotion?: boolean } = {}) {
  const page = await browser.newPage({
    viewport: { width: 1280, height: 800 },
    deviceScaleFactor: opts.dpr ?? 1,
  });
  if (opts.reducedMotion) await page.emulateMedia({ reducedMotion: 'reduce' });
  const apiCalls: string[] = [];
  const errors: string[] = [];
  page.on('request', (r) => {
    if (r.url().includes('/api/')) apiCalls.push(r.url());
  });
  page.on('pageerror', (e) => errors.push(e.message));
  // Record every chat state change with the page's own clock, from the first script on.
  await page.addInitScript(() => {
    const log: { state: string; t: number }[] = [];
    (window as unknown as { __chatLog: typeof log }).__chatLog = log;
    new MutationObserver(() => {
      log.push({ state: document.documentElement.dataset.chat ?? '', t: performance.now() });
    }).observe(document, { subtree: true, attributeFilter: ['data-chat'] });
  });
  await page.goto(base + query);
  return { page, apiCalls, errors };
}

const idle = (page: Page, timeout = 20_000) =>
  page.waitForFunction(() => document.documentElement.dataset.chat === 'idle', null, { timeout });

describe('static build, recorded mode', () => {
  it('plays a scenario with no server API: answer text plus a highlighted machine', async () => {
    const { page, apiCalls, errors } = await open('?lang=en&scenario=downtime-week');
    await page.waitForFunction(() => document.documentElement.dataset.chat === 'busy');
    await idle(page);
    expect(await page.locator('.msg--agent').innerText()).toContain('290 of 500 minutes');
    expect(await page.locator('.label-machine.is-highlighted').allInnerTexts()).toEqual([
      expect.stringContaining('L2-M2'),
    ]);
    expect(apiCalls).toEqual([]);
    expect(errors).toEqual([]);
    expect(await page.locator('#composer').isVisible()).toBe(false);
    await page.close();
  });

  it('a user clicks a scenario, sees the machine statuses and the answer, then switches language', async () => {
    const { page, apiCalls, errors } = await open('?lang=en&autoplay=0');
    // statuses from the data: the welding cell is down, the mill has a quality alarm
    await expect
      .poll(() => page.locator('.label-machine', { hasText: 'L2-M2' }).getAttribute('data-status'))
      .toBe('down');
    expect(
      await page.locator('.label-machine', { hasText: 'L1-M2' }).getAttribute('data-status'),
    ).toBe('quality_alarm');
    expect(await page.locator('.label-machine[data-status="running"]').count()).toBe(10);

    await page.getByRole('button', { name: 'Quality alarm' }).click();
    await idle(page);
    expect(
      await page.getByRole('button', { name: 'Quality alarm' }).getAttribute('aria-pressed'),
    ).toBe('true');
    expect(await page.locator('.msg--agent').innerText()).toContain('8 of 200 parts');
    expect(await page.locator('.label-machine.is-highlighted').allInnerTexts()).toEqual([
      expect.stringContaining('L1-M2'),
    ]);

    await page.getByRole('button', { name: 'PL', exact: true }).click();
    expect(await page.locator('html').getAttribute('lang')).toBe('pl');
    expect(await page.getByRole('button', { name: qualityAlarmPl.title }).isVisible()).toBe(true);
    expect(await page.locator('.msg').count()).toBe(0); // the English answer is gone
    expect(await page.locator('.label-machine.is-highlighted').count()).toBe(0); // and so is its highlight
    expect(page.url()).toContain('lang=pl');
    expect(apiCalls).toEqual([]);
    expect(errors).toEqual([]);
    await page.close();
  });

  it('hides the header and footer in embed mode', async () => {
    const { page } = await open('?embed=1&autoplay=0');
    await page.locator('#scene canvas').waitFor();
    expect(await page.locator('.topbar').isVisible()).toBe(false);
    expect(await page.locator('.footer').isVisible()).toBe(false);
    expect(await page.locator('.chat').isVisible()).toBe(true);
    await page.close();
  });

  it('caps the canvas pixel ratio at 1.75 on a 3x screen', async () => {
    const { page } = await open('?autoplay=0', { dpr: 3 });
    const canvas = page.locator('#scene canvas');
    await canvas.waitFor();
    const ratio = await canvas.evaluate((c: HTMLCanvasElement) => c.width / c.clientWidth);
    expect(ratio).toBeGreaterThan(1.7);
    expect(ratio).toBeLessThanOrEqual(1.75 + 0.01);
    await page.close();
  });

  it('pauses the render loop while the tab is hidden and resumes when visible', async () => {
    const { page } = await open('?autoplay=0');
    const scene = page.locator('#scene');
    await expect.poll(() => scene.getAttribute('data-loop')).toBe('running');
    const setHidden = (hidden: boolean) =>
      page.evaluate((h) => {
        Object.defineProperty(document, 'hidden', { configurable: true, get: () => h });
        document.dispatchEvent(new Event('visibilitychange'));
      }, hidden);
    await setHidden(true);
    expect(await scene.getAttribute('data-loop')).toBe('paused');
    await setHidden(false);
    expect(await scene.getAttribute('data-loop')).toBe('running');
    await page.close();
  });

  it('with prefers-reduced-motion, plays the same answer with no delays', async () => {
    /** busy -> idle time of the first answer, measured inside the page. */
    const playMs = async (page: Page) => {
      const handle = await page.waitForFunction(
        () => {
          const log = (window as unknown as { __chatLog: { state: string; t: number }[] })
            .__chatLog;
          const busy = log.find((e) => e.state === 'busy');
          const done = busy && log.find((e) => e.state === 'idle' && e.t >= busy.t);
          return busy && done ? done.t - busy.t : null;
        },
        null,
        { timeout: 20_000 },
      );
      return (await handle.jsonValue()) as number;
    };

    const normal = await open('?lang=en&scenario=quality-alarm');
    const normalMs = await playMs(normal.page);
    const normalText = await normal.page.locator('.msg--agent').innerText();
    await normal.page.close();

    const reduced = await open('?lang=en&scenario=quality-alarm', { reducedMotion: true });
    const reducedMs = await playMs(reduced.page);
    const reducedText = await reduced.page.locator('.msg--agent').innerText();
    await reduced.page.close();

    expect(normalMs).toBeGreaterThan(2000); // fixed beats: ~0.45 s + 4 tools + 2 actions + reveal
    expect(reducedMs).toBeLessThan(250); // all beats are 0 ms
    expect(reducedText).toBe(normalText);
  });
});

describe('browser without WebGL (e.g. an iframe with 3D disabled)', () => {
  it('falls back to the board view; the assistant, highlights and machine card still work', async () => {
    const noGl = await chromium.launch({ args: ['--disable-webgl', '--disable-3d-apis'] });
    try {
      const page = await noGl.newPage({ viewport: { width: 1280, height: 800 } });
      const errors: string[] = [];
      page.on('pageerror', (e) => errors.push(e.message));
      await page.goto(`${base}?lang=en&scenario=downtime-week`);
      await page.waitForFunction(() => document.documentElement.dataset.chat === 'busy');
      await idle(page);
      expect(await page.locator('#scene canvas').count()).toBe(0);
      expect(await page.locator('.scene-fallback-note').innerText()).toContain('WebGL');
      expect(await page.locator('.msg--agent').innerText()).toContain('290 of 500 minutes');
      expect(
        await page
          .locator('.fallback-machine.is-highlighted')
          .evaluateAll((els) => els.map((e) => (e as HTMLElement).dataset.id)),
      ).toEqual(['L2-M2']);
      await page.locator('.fallback-machine[data-id="L1-M2"]').click();
      expect(await page.locator('#machine-card h2').innerText()).toContain('L1-M2');
      expect(errors).toEqual([]);
    } finally {
      await noGl.close();
    }
  });
});

describe('scene labels stay inside the scene', () => {
  const views = [
    { query: '', width: 1024, height: 768 },
    { query: '', width: 1280, height: 800 },
    { query: '', width: 1440, height: 900 },
    { query: '&embed=1', width: 1200, height: 700 },
    { query: '&embed=1', width: 900, height: 560 },
  ];
  for (const lang of ['en', 'pl']) {
    for (const v of views) {
      it(`${lang}, ${v.width}x${v.height}${v.query}: every visible label is within the scene`, async () => {
        const page = await browser.newPage({ viewport: { width: v.width, height: v.height } });
        try {
          await page.goto(`${base}?lang=${lang}&autoplay=0${v.query}`);
          await page.evaluate(() => document.fonts.ready);
          await page.locator('.label-line').first().waitFor({ state: 'attached' });
          // let the render loop place the labels and fit the line labels
          await page.waitForTimeout(500);
          const outside = await page.evaluate(() => {
            const scene = document.getElementById('scene')!.getBoundingClientRect();
            return [...document.querySelectorAll<HTMLElement>('.label-line, .label-machine')]
              .filter((el) => {
                const style = getComputedStyle(el);
                return style.display !== 'none' && style.visibility !== 'hidden';
              })
              .map((el) => ({ text: el.textContent, r: el.getBoundingClientRect() }))
              .filter(
                ({ r }) =>
                  r.width > 0 &&
                  (r.left < scene.left - 0.5 ||
                    r.right > scene.right + 0.5 ||
                    r.top < scene.top - 0.5 ||
                    r.bottom > scene.bottom + 0.5),
              )
              .map(({ text, r }) => `${text} (${Math.round(r.left)}..${Math.round(r.right)})`);
          });
          expect(await page.locator('.label-line').count()).toBe(3);
          expect(outside).toEqual([]);
          // the overview is framed so no line label needs the edge shift
          const shifted = await page
            .locator('.label-line')
            .evaluateAll((els) => els.filter((e) => (e as HTMLElement).style.marginLeft).length);
          expect(shifted).toBe(0);
        } finally {
          await page.close();
        }
      });
    }
  }
});

describe('embedded on another site: the frame reports its height', () => {
  // The host page is served on another origin (127.0.0.1 vs localhost), like kokot.it framing the
  // build. Its listener is the README snippet: check e.origin, then size the iframe to the height.
  let host: Server;
  let hostUrl: string;

  beforeAll(async () => {
    host = createServer((req, res) => {
      const url = new URL(req.url ?? '/', 'http://127.0.0.1');
      const width = Number(url.searchParams.get('width') ?? 1000);
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.end(`<!doctype html><html><body style="margin:0">
        <iframe id="twin" src="${base}?embed=1&lang=en&scenario=quality-alarm"
          title="Factory Twin" style="display:block;width:${width}px;height:300px;border:0"></iframe>
        <script>
          window.messages = [];
          const frame = document.getElementById('twin');
          window.addEventListener('message', (e) => {
            if (e.origin !== '${new URL(base).origin}') return;
            if (e.source !== frame.contentWindow) return;
            if (!e.data || e.data.type !== 'factory-twin:height') return;
            window.messages.push({ height: e.data.height, origin: e.origin });
            frame.style.height = e.data.height + 'px';
          });
        </script></body></html>`);
    });
    await new Promise<void>((resolve) => host.listen(0, '127.0.0.1', resolve));
    hostUrl = `http://127.0.0.1:${(host.address() as AddressInfo).port}/case-study`;
  });

  afterAll(() => new Promise<void>((resolve) => host.close(() => resolve())));

  type Message = { height: number; origin: string };
  const messages = (page: Page) =>
    page.evaluate(() => (window as unknown as { messages: Message[] }).messages);

  for (const width of [1000, 420]) {
    it(`${width}px wide: the host receives the height and the count settles (no resize loop)`, async () => {
      const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
      const errors: string[] = [];
      page.on('pageerror', (e) => errors.push(e.message));
      try {
        await page.goto(`${hostUrl}?width=${width}`);
        await expect.poll(async () => (await messages(page)).length).toBeGreaterThan(0);
        const frame = page.frames().find((f) => f.url().startsWith(base));
        if (!frame) throw new Error('embedded frame not found');
        // let the autoplayed answer finish, so the chat has reached its final size
        await frame.waitForFunction(() => document.documentElement.dataset.chat === 'idle', null, {
          timeout: 20_000,
        });
        await page.waitForTimeout(1000);
        const settled = await messages(page);
        await page.waitForTimeout(2000);
        const later = await messages(page);

        expect(later.length).toBe(settled.length);
        expect(later.length).toBeLessThan(20);
        expect(new Set(later.map((m) => m.origin))).toEqual(new Set([new URL(base).origin]));
        const last = later.at(-1)!.height;
        expect(last).toBeGreaterThan(300);
        // the frame is exactly as tall as its content: nothing cut off, no inner scrollbar
        const frameHeight = await page
          .locator('#twin')
          .evaluate((f) => Math.round(f.getBoundingClientRect().height));
        expect(frameHeight).toBe(last);
        const inner = await frame.evaluate(() => ({
          scroll: document.documentElement.scrollHeight,
          client: document.documentElement.clientHeight,
        }));
        expect(inner.scroll).toBeLessThanOrEqual(inner.client);
        expect(await frame.locator('#scene canvas').count()).toBe(1);
        expect(errors).toEqual([]);
      } finally {
        await page.close();
      }
    });
  }
});
