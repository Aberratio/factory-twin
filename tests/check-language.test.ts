import { describe, expect, it } from 'vitest';
import { findPolish, isChecked } from '../scripts/check-language';

describe('language guard', () => {
  it('checks source, tests and docs but not the Polish UI strings or sample data', () => {
    expect(isChecked('src/main.ts')).toBe(true);
    expect(isChecked('tests/i18n.test.ts')).toBe(true);
    expect(isChecked('README.md')).toBe(true);
    expect(isChecked('docs/architecture.md')).toBe(true);
    expect(isChecked('src/ui/i18n.ts')).toBe(false);
    expect(isChecked('src/data/plant.json')).toBe(false);
    expect(isChecked('src/recordings/pl/quality-alarm.json')).toBe(false);
    expect(isChecked('scenarios/quality-alarm.json')).toBe(false);
    expect(isChecked('docs/screenshots/desktop-overview-pl.png')).toBe(false);
  });

  it('reports lines with Polish diacritics', () => {
    // Escaped, so this file passes the guard it tests.
    const polish = 'za\u017c\u00f3\u0142\u0107';
    expect(findPolish(`plain English\n${polish}\n`)).toEqual([{ line: 2, text: polish }]);
    expect(findPolish('Hall A, line 2')).toEqual([]);
  });
});
