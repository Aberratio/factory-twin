// Builds nothing: run `npm run build` first. Serves dist/ with `vite preview`, opens it in
// headless Chromium and saves docs/screenshots/*.png. `npm run screenshots`.
import { mkdirSync } from 'node:fs';
import { chromium, type Page } from 'playwright';
import { preview } from 'vite';

const OUT = 'docs/screenshots';

interface Shot {
  file: string;
  query: string;
  width: number;
  height: number;
  /** Extra settle time after the answer, for the camera flight. */
  settleMs?: number;
  after?: (page: Page) => Promise<void>;
}

const SHOTS: Shot[] = [
  { file: 'overview-en.png', query: '?lang=en&scenario=shift-overview', width: 1440, height: 900 },
  { file: 'downtime-en.png', query: '?lang=en&scenario=downtime-week', width: 1440, height: 900 },
  { file: 'quality-pl.png', query: '?lang=pl&scenario=quality-alarm', width: 1440, height: 900 },
  {
    file: 'embed-order-en.png',
    query: '?embed=1&lang=en&scenario=order-zl-2041',
    width: 1100,
    height: 620,
  },
  {
    file: 'mobile-orders-pl.png',
    query: '?lang=pl&scenario=orders-at-risk',
    width: 390,
    height: 844,
  },
  {
    file: 'machine-card-en.png',
    query: '?lang=en&autoplay=0',
    width: 1440,
    height: 900,
    after: async (page) => {
      // click the down welding cell in the middle of the hall
      await page.locator('.label-machine', { hasText: 'L2-M2' }).first().waitFor();
      const box = await page.locator('#scene canvas').boundingBox();
      if (!box) return;
      await page.mouse.click(box.x + box.width * 0.47, box.y + box.height * 0.52);
      await page.waitForTimeout(400);
    },
  },
];

mkdirSync(OUT, { recursive: true });
const server = await preview({
  configLoader: 'runner',
  preview: { port: 4317, strictPort: true, host: 'localhost' },
});
const base = 'http://localhost:4317/';
const browser = await chromium.launch({
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});

try {
  for (const shot of SHOTS) {
    const page = await browser.newPage({
      viewport: { width: shot.width, height: shot.height },
      deviceScaleFactor: shot.width < 500 ? 2 : 1,
    });
    page.on('pageerror', (err) => console.error(`[${shot.file}] ${err.message}`));
    await page.goto(base + shot.query);
    await page.evaluate(() => document.fonts.ready);
    if (shot.query.includes('autoplay=0')) {
      await page.waitForTimeout(800);
    } else {
      await page.waitForFunction(() => document.documentElement.dataset.chat === 'busy', null, {
        timeout: 10_000,
      });
      await page.waitForFunction(() => document.documentElement.dataset.chat === 'idle', null, {
        timeout: 30_000,
      });
      await page.waitForTimeout(shot.settleMs ?? 900);
    }
    await shot.after?.(page);
    await page.screenshot({ path: `${OUT}/${shot.file}` });
    console.info(`saved ${OUT}/${shot.file}`);
    await page.close();
  }
} finally {
  await browser.close();
  await new Promise<void>((resolve) => server.httpServer.close(() => resolve()));
}
