// Browser smoke test of the static build (recorded mode), in headless Chromium.
// Run with `npm run test:e2e` (builds first). Covers what unit tests cannot see:
// the page runs with no server API, an answer moves the scene, embed mode, the DPR cap,
// the hidden-tab pause and prefers-reduced-motion.
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
