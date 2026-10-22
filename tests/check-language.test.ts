import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { blockLines, findPolish, findViolations } from '../scripts/check-language';

// Built from code points, so this file passes the guard it tests.
const polish = `za${String.fromCodePoint(0x17c, 0xf3, 0x142, 0x107)}`;

const dictionary = [
  "import { isLang } from '../domain/langs';",
  'const STRINGS = {',
  '  en: {',
  "    send: 'Ask',",
  '  },',
  '  pl: {',
  `    send: '${polish}',`,
  '    tools: {',
  `      orders: '${polish}',`,
  '    },',
  '  },',
  '};',
].join('\n');

describe('language guard', () => {
  it('reports lines with Polish diacritics', () => {
    expect(findPolish(`plain English\n${polish}\n`)).toEqual([{ line: 2, text: polish }]);
    expect(findPolish('Hall A, line 2')).toEqual([]);
  });

  it('flags Polish in source, tests and docs', () => {
    for (const path of ['src/main.ts', 'tests/i18n.test.ts', 'README.md', 'docs/architecture.md']) {
      expect(findViolations(path, polish), path).toHaveLength(1);
    }
  });

  it('allows Polish in the sample data files and the Polish recordings', () => {
    for (const path of [
      'src/data/plant.json',
      'src/data/orders.csv',
      'src/recordings/pl/quality-alarm.json',
      'scenarios/quality-alarm.json',
    ]) {
      expect(findViolations(path, polish), path).toEqual([]);
    }
  });

  it('allows only .json and .csv files under src/data', () => {
    expect(findViolations('src/data/browser.ts', polish)).toHaveLength(1);
    expect(findViolations('src/data/nested/plant.json', polish)).toHaveLength(1);
  });

  it('allows Polish in the UI dictionary only inside its pl block', () => {
    expect(findViolations('src/ui/i18n.ts', dictionary)).toEqual([]);
    const inEnglish = dictionary.replace("send: 'Ask'", `send: '${polish}'`);
    expect(findViolations('src/ui/i18n.ts', inEnglish)).toEqual([
      { line: 4, text: `    send: '${polish}',` },
    ]);
    const inCode = `${dictionary}\n// ${polish}`;
    expect(findViolations('src/ui/i18n.ts', inCode)).toEqual([{ line: 13, text: `// ${polish}` }]);
  });

  it('finds the pl block of the real dictionary, which does not include the en block', () => {
    const text = readFileSync('src/ui/i18n.ts', 'utf8');
    const lines = text.split('\n');
    const inside = blockLines(text, /^\s*pl: \{$/);
    const en = blockLines(text, /^\s*en: \{$/);
    expect(inside.size).toBeGreaterThan(20);
    expect([...en].some((n) => inside.has(n))).toBe(false);
    expect(lines[Math.max(...inside)]?.trim()).toBe('},');
  });

  it('skips binary files', () => {
    expect(findViolations('docs/screenshots/desktop-overview-pl.png', polish)).toEqual([]);
  });
});
